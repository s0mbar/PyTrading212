"""Euro conversion of amounts booked in another currency (multi-currency accounts).

French tax computations are in euros, converted at the rate of the transaction date: the ECB
reference rate is used, falling back to the last published rate on weekends and holidays.
"""

import csv
import io
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, replace
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

import httpx

from .csv_import import ParsedHistory
from .transactions import Transaction

EURO = "EUR"
ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.{currencies}.EUR.SP00.A"
LOOKBACK_DAYS = 10
_CURRENCY_CODE = re.compile(r"^[A-Z]{3}$")


class FxRateError(Exception):
    """Reference rates could not be obtained."""


@dataclass(frozen=True)
class EuroRates:
    """Units of each currency for one euro, by publication date."""

    rates: Mapping[str, Mapping[date, Decimal]]

    def to_eur(self, amount: Decimal, currency: str, on: date) -> Decimal | None:
        if currency == EURO:
            return amount
        series = self.rates.get(currency, {})
        for offset in range(LOOKBACK_DAYS):
            rate = series.get(on - timedelta(days=offset))
            if rate:
                return amount / rate
        return None


RatesFetcher = Callable[[set[str], date, date], Awaitable[EuroRates]]


def parse_ecb_csv(content: str) -> EuroRates:
    rates: dict[str, dict[date, Decimal]] = {}
    for row in csv.DictReader(io.StringIO(content)):
        try:
            value = Decimal(row["OBS_VALUE"])
            day = date.fromisoformat(row["TIME_PERIOD"])
        except (KeyError, ValueError, InvalidOperation):
            continue
        if value > 0:
            rates.setdefault(row["CURRENCY"], {})[day] = value
    return EuroRates(rates)


async def fetch_euro_rates(currencies: set[str], start: date, end: date) -> EuroRates:
    codes = sorted(code for code in currencies if _CURRENCY_CODE.match(code))
    if not codes:
        return EuroRates({})
    params = {"startPeriod": start.isoformat(), "endPeriod": end.isoformat(), "format": "csvdata"}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(ECB_URL.format(currencies="+".join(codes)), params=params)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise FxRateError(f"Cours BCE indisponibles : {exc}") from exc
    return parse_ecb_csv(response.text)


async def convert_history_to_eur(
    history: ParsedHistory, fetch: RatesFetcher = fetch_euro_rates
) -> ParsedHistory:
    """Return the history with every non-euro total converted at the ECB rate of its date."""
    foreign = [t for t in history.transactions if t.total_currency not in ("", EURO)]
    if not foreign:
        return history

    currencies = {t.total_currency for t in foreign}
    try:
        rates = await fetch(
            currencies,
            min(t.at.date() for t in foreign) - timedelta(days=LOOKBACK_DAYS),
            max(t.at.date() for t in foreign),
        )
    except FxRateError as exc:
        return ParsedHistory(history.transactions, [*history.warnings, str(exc)])

    converted = [
        _to_eur(t, rates) if t.total_currency not in ("", EURO) else t for t in history.transactions
    ]
    count = sum(1 for t in converted if t.original_currency)
    notes = [
        f"{count} opération(s) libellée(s) en {', '.join(sorted(currencies))} converties en euros "
        "au cours de référence BCE du jour de l'opération."
    ]
    return ParsedHistory(converted, [*history.warnings, *notes] if count else history.warnings)


def _to_eur(transaction: Transaction, rates: EuroRates) -> Transaction:
    currency = transaction.total_currency
    day = transaction.at.date()
    total = rates.to_eur(transaction.total, currency, day)
    if total is None:
        return transaction

    withholding = transaction.withholding_tax
    withholding_currency = transaction.withholding_currency
    if withholding is not None and withholding_currency == currency:
        withholding = rates.to_eur(withholding, currency, day)
        withholding_currency = EURO

    result = transaction.broker_result
    return replace(
        transaction,
        total=total,
        total_currency=EURO,
        fees=rates.to_eur(transaction.fees, currency, day) or Decimal(0),
        broker_result=rates.to_eur(result, currency, day) if result is not None else None,
        withholding_tax=withholding,
        withholding_currency=withholding_currency,
        original_currency=currency,
    )
