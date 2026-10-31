"""Builders for synthetic Trading 212 CSV exports."""

import csv
import io
from collections.abc import Callable

T212_HEADER = [
    "Action",
    "Time",
    "ISIN",
    "Ticker",
    "Name",
    "Notes",
    "ID",
    "No. of shares",
    "Price / share",
    "Currency (Price / share)",
    "Exchange rate",
    "Result",
    "Currency (Result)",
    "Total",
    "Currency (Total)",
    "Withholding tax",
    "Currency (Withholding tax)",
    "Currency conversion fee",
    "Currency (Currency conversion fee)",
]

CsvFactory = Callable[..., str]


def build_csv(*rows: dict[str, str], header: list[str] | None = None) -> str:
    """Build a Trading 212 history export from partial rows."""
    columns = header or T212_HEADER
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({"Currency (Total)": "EUR", **row})
    return buffer.getvalue()


def trade(action: str, time: str, quantity: str, total: str, **extra: str) -> dict[str, str]:
    row = {
        "Action": action,
        "Time": time,
        "ISIN": "US0378331005",
        "Ticker": "AAPL",
        "Name": "Apple",
        "No. of shares": quantity,
        "Price / share": "100",
        "Currency (Price / share)": "USD",
        "Exchange rate": "1.08",
        "Total": total,
    }
    row.update(extra)
    return row
