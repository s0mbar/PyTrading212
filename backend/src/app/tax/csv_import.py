"""Parse Trading 212 history CSV exports (app export or API report).

Conventions of the export, cross-checked against the open-source cgt-calc parser:
- "Total" is in the account currency, fees included: cost paid for a buy, net proceeds for a sale.
- "Exchange rate" is instrument currency per account currency (value = shares x price / rate).
- On dividend rows "Price / share" is net of foreign tax, and "Withholding tax" is in its own
  currency (usually the instrument currency).
"""

import csv
import io
import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation

from .transactions import Transaction, TransactionKind

_CASH_ACTIONS = frozenset(
    {
        "deposit",
        "withdrawal",
        "currency conversion",
        "spending cashback",
        "card debit",
        "card credit",
        "card refund",
        "new card cost",
    }
)
_INTEREST_ACTIONS = frozenset({"interest on cash", "lending interest", "dividend (interest)"})
_FEE_COLUMNS = (
    "Currency conversion fee",
    "Stamp duty reserve tax",
    "Stamp duty",
    "French transaction tax",
    "Transaction fee",
    "Finra fee",
)
_CURRENCY_IN_HEADER = re.compile(r"^(?P<name>.+?) \((?P<currency>[A-Z]{3})\)$")
_EMPTY_VALUES = frozenset({"", "not available", "n/a"})


class CsvFormatError(ValueError):
    """The file is not a readable Trading 212 history export."""


@dataclass
class ParsedHistory:
    transactions: list[Transaction] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def classify_action(action: str) -> TransactionKind:
    label = action.strip().lower()
    if label.endswith(" buy"):
        return TransactionKind.buy
    if label.endswith(" sell"):
        return TransactionKind.sell
    if label in _INTEREST_ACTIONS:
        return TransactionKind.interest
    if label.startswith("dividend (return of capital"):
        return TransactionKind.return_of_capital
    if label.startswith("dividend"):
        return TransactionKind.dividend
    if label == "stock split close":
        return TransactionKind.split_close
    if label == "stock split open":
        return TransactionKind.split_open
    if label in _CASH_ACTIONS:
        return TransactionKind.cash_movement
    return TransactionKind.unsupported


def parse_trading212_csv(content: str, *, source: str) -> ParsedHistory:
    reader = csv.DictReader(io.StringIO(content.lstrip("﻿")))
    headers = [header.strip() for header in (reader.fieldnames or [])]
    columns = _resolve_columns(headers, source)

    parsed = ParsedHistory()
    unsupported: Counter[str] = Counter()

    for line_number, raw_row in enumerate(reader, start=2):
        row = {(key or "").strip(): (value or "").strip() for key, value in raw_row.items()}
        action = row.get("Action", "")
        if not action:
            continue
        try:
            transaction = _build_transaction(row, columns, source)
        except (InvalidOperation, ValueError) as exc:
            raise CsvFormatError(f"{source}, ligne {line_number} : {exc}") from exc

        if transaction.kind == TransactionKind.unsupported:
            unsupported[action] += 1
        parsed.transactions.append(transaction)

    for action, count in sorted(unsupported.items()):
        parsed.warnings.append(
            f"{source} : {count} ligne(s) « {action} » non prises en charge par le calcul "
            "(opération sur titres, transfert...). Vérifiez-les manuellement."
        )
    return parsed


def merge_histories(histories: Iterable[ParsedHistory]) -> ParsedHistory:
    """Merge several exports (overlapping periods allowed) into one chronological history."""
    merged = ParsedHistory()
    seen: set[tuple[object, ...]] = set()
    for history in histories:
        merged.warnings.extend(history.warnings)
        for transaction in history.transactions:
            if transaction.dedup_key in seen:
                continue
            seen.add(transaction.dedup_key)
            merged.transactions.append(transaction)
    merged.transactions.sort(key=lambda item: item.at)
    return merged


@dataclass(frozen=True)
class _Columns:
    time: str
    total: str
    total_currency_column: str | None
    total_currency_fixed: str | None
    result: str | None
    fees: tuple[tuple[str, str | None, str | None], ...]


def _resolve_columns(headers: list[str], source: str) -> _Columns:
    header_set = set(headers)
    if "Action" not in header_set:
        raise CsvFormatError(
            f"{source} : colonne « Action » absente, ce n'est pas un export Trading 212"
        )

    time_column = next((name for name in ("Time", "Time (UTC)") if name in header_set), None)
    if time_column is None:
        raise CsvFormatError(f"{source} : colonne « Time » absente")

    total, total_currency_column, total_currency_fixed = _money_column("Total", headers)
    if total is None:
        raise CsvFormatError(f"{source} : colonne « Total » absente")

    result, _, _ = _money_column("Result", headers)
    fees = tuple(
        (column, currency_column, fixed)
        for column, currency_column, fixed in (
            _money_column(name, headers) for name in _FEE_COLUMNS
        )
        if column is not None
    )
    return _Columns(
        time=time_column,
        total=total,
        total_currency_column=total_currency_column,
        total_currency_fixed=total_currency_fixed,
        result=result,
        fees=fees,
    )


def _money_column(name: str, headers: list[str]) -> tuple[str | None, str | None, str | None]:
    """Locate `name` either as "Name" + "Currency (Name)" or as legacy "Name (EUR)"."""
    if name in headers:
        currency_column = f"Currency ({name})"
        return name, currency_column if currency_column in headers else None, None
    for header in headers:
        match = _CURRENCY_IN_HEADER.match(header)
        if match and match.group("name") == name:
            return header, None, match.group("currency")
    return None, None, None


def _build_transaction(row: dict[str, str], columns: _Columns, source: str) -> Transaction:
    action = row["Action"]
    kind = classify_action(action)
    total_currency = (
        columns.total_currency_fixed
        or (row.get(columns.total_currency_column, "") if columns.total_currency_column else "")
    ).upper()

    return Transaction(
        kind=kind,
        action=action,
        at=_parse_time(row.get(columns.time, "")),
        isin=row.get("ISIN", "").upper(),
        ticker=row.get("Ticker", ""),
        name=row.get("Name", ""),
        quantity=abs(_decimal(row.get("No. of shares")) or Decimal(0)),
        price_per_share=_decimal(row.get("Price / share")),
        price_currency=row.get("Currency (Price / share)", "").upper(),
        total=_decimal(row.get(columns.total)) or Decimal(0),
        total_currency=total_currency,
        withholding_tax=_decimal(row.get("Withholding tax")),
        withholding_currency=row.get("Currency (Withholding tax)", "").upper(),
        fees=_fees_in_currency(row, columns, total_currency),
        broker_result=_decimal(row.get(columns.result)) if columns.result else None,
        transaction_id=row.get("ID", ""),
        source=source,
    )


def _fees_in_currency(row: dict[str, str], columns: _Columns, currency: str) -> Decimal:
    total = Decimal(0)
    for column, currency_column, fixed in columns.fees:
        amount = _decimal(row.get(column))
        if not amount:
            continue
        fee_currency = (fixed or (row.get(currency_column, "") if currency_column else "")).upper()
        if not fee_currency or fee_currency == currency:
            total += abs(amount)
    return total


def _parse_time(value: str) -> datetime:
    if not value:
        raise ValueError("date manquante")
    parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _decimal(value: str | None) -> Decimal | None:
    if value is None:
        return None
    cleaned = value.strip().replace(" ", "").replace(" ", "")
    if cleaned.lower() in _EMPTY_VALUES:
        return None
    try:
        number = Decimal(cleaned)
    except InvalidOperation:
        if "," not in cleaned or "." in cleaned:
            raise ValueError(f"nombre illisible « {value} »") from None
        number = Decimal(cleaned.replace(",", "."))
    if not number.is_finite():
        raise ValueError(f"nombre illisible « {value} »")
    return number
