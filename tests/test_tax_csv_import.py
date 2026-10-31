from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.tax.csv_import import (
    CsvFormatError,
    classify_action,
    merge_histories,
    parse_trading212_csv,
)
from app.tax.transactions import TransactionKind
from t212_csv import CsvFactory, trade


@pytest.mark.parametrize(
    ("action", "expected"),
    [
        ("Market buy", TransactionKind.buy),
        ("Stop limit sell", TransactionKind.sell),
        ("Dividend (Ordinary)", TransactionKind.dividend),
        ("Dividend (Dividends paid by us corporations)", TransactionKind.dividend),
        ("Dividend (Interest)", TransactionKind.interest),
        ("Interest on cash", TransactionKind.interest),
        ("Dividend (Return of capital non us)", TransactionKind.return_of_capital),
        ("Stock split open", TransactionKind.split_open),
        ("Deposit", TransactionKind.cash_movement),
        ("Stock distribution", TransactionKind.unsupported),
    ],
)
def test_classify_action(action: str, expected: TransactionKind) -> None:
    assert classify_action(action) == expected


def test_parse_reads_amounts_dates_and_identifiers(make_csv: CsvFactory) -> None:
    # Arrange
    content = make_csv(trade("Market buy", "2024-03-15 14:30:12.123", "1.5", "150.25", ID="EOF1"))

    # Act
    history = parse_trading212_csv(content, source="export.csv")

    # Assert
    [transaction] = history.transactions
    assert transaction.kind == TransactionKind.buy
    assert transaction.at == datetime(2024, 3, 15, 14, 30, 12, 123000, tzinfo=UTC)
    assert transaction.quantity == Decimal("1.5")
    assert transaction.total == Decimal("150.25")
    assert transaction.total_currency == "EUR"
    assert transaction.transaction_id == "EOF1"
    assert history.warnings == []


def test_parse_keeps_case_sensitive_tickers(make_csv: CsvFactory) -> None:
    history = parse_trading212_csv(
        make_csv(trade("Market buy", "2024-01-02 10:00:00", "1", "10", Ticker="SIGTl_EQ")),
        source="a.csv",
    )

    assert history.transactions[0].ticker == "SIGTl_EQ"


def test_parse_supports_legacy_total_column_with_currency_in_header(make_csv: CsvFactory) -> None:
    # Arrange
    header = ["Action", "Time", "ISIN", "Ticker", "Name", "No. of shares", "Total (EUR)", "ID"]
    content = make_csv(
        {
            "Action": "Market buy",
            "Time": "2022-05-01 09:00:00",
            "No. of shares": "2",
            "Total (EUR)": "40",
        },
        header=header,
    )

    # Act
    [transaction] = parse_trading212_csv(content, source="old.csv").transactions

    # Assert
    assert transaction.total == Decimal("40")
    assert transaction.total_currency == "EUR"


def test_parse_reports_unsupported_actions(make_csv: CsvFactory) -> None:
    history = parse_trading212_csv(
        make_csv(trade("Stock distribution", "2024-01-02 10:00:00", "1", "0")), source="a.csv"
    )

    assert len(history.warnings) == 1
    assert "Stock distribution" in history.warnings[0]


def test_parse_rejects_files_that_are_not_trading212_exports() -> None:
    with pytest.raises(CsvFormatError):
        parse_trading212_csv("Date,Amount\n2024-01-01,10\n", source="bank.csv")


def test_parse_rejects_unreadable_numbers(make_csv: CsvFactory) -> None:
    with pytest.raises(CsvFormatError, match="ligne 2"):
        parse_trading212_csv(
            make_csv(trade("Market buy", "2024-01-02 10:00:00", "abc", "10")), source="a.csv"
        )


def test_merge_deduplicates_overlapping_exports(make_csv: CsvFactory) -> None:
    # Arrange
    first = make_csv(
        trade("Market buy", "2024-01-02 10:00:00", "1", "100", ID="EOF1"),
        {"Action": "Interest on cash", "Time": "2024-02-01 00:00:00", "Total": "1.23"},
    )
    second = make_csv(
        {"Action": "Interest on cash", "Time": "2024-02-01 00:00:00", "Total": "1.23"},
        trade("Market sell", "2024-03-02 10:00:00", "1", "120", ID="EOF2"),
    )

    # Act
    merged = merge_histories(
        [parse_trading212_csv(first, source="1.csv"), parse_trading212_csv(second, source="2.csv")]
    )

    # Assert
    assert [t.kind for t in merged.transactions] == [
        TransactionKind.buy,
        TransactionKind.interest,
        TransactionKind.sell,
    ]
