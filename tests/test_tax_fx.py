import asyncio
from datetime import date
from decimal import Decimal

from app.tax.csv_import import parse_trading212_csv
from app.tax.fx import EuroRates, FxRateError, convert_history_to_eur, parse_ecb_csv
from app.tax.report import TaxOptions, build_tax_report
from t212_csv import build_csv, trade

# Subset of the columns returned by the ECB data API (format=csvdata).
ECB_SAMPLE = """KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE
EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,2026-03-20,0.8
EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,2026-03-23,0.86
EXR.D.USD.EUR.SP00.A,D,USD,EUR,2026-03-23,1.16
"""


def fixed_rates(rates: EuroRates):
    async def fetch(currencies: set[str], start: date, end: date) -> EuroRates:
        return rates

    return fetch


def test_parse_ecb_csv_reads_units_per_euro() -> None:
    rates = parse_ecb_csv(ECB_SAMPLE)

    assert rates.rates["GBP"][date(2026, 3, 23)] == Decimal("0.86")
    assert rates.rates["USD"][date(2026, 3, 23)] == Decimal("1.16")


def test_weekend_uses_last_published_rate() -> None:
    rates = parse_ecb_csv(ECB_SAMPLE)

    # Sunday 2026-03-22 -> Friday 2026-03-20 rate (0.8)
    assert rates.to_eur(Decimal("80"), "GBP", date(2026, 3, 22)) == Decimal("100")


def test_missing_currency_or_rate_returns_none() -> None:
    rates = parse_ecb_csv(ECB_SAMPLE)

    assert rates.to_eur(Decimal("10"), "CHF", date(2026, 3, 23)) is None
    assert rates.to_eur(Decimal("10"), "GBP", date(2025, 1, 1)) is None


def test_sale_credited_in_gbp_is_converted_before_computing_the_gain() -> None:
    # Arrange: bought for 1000 EUR, sold for 946 GBP credited on a GBP cash balance
    content = build_csv(
        trade("Market buy", "2026-01-10 10:00:00", "10", "1000"),
        trade("Market sell", "2026-03-23 10:00:00", "10", "946", **{"Currency (Total)": "GBP"}),
    )
    history = parse_trading212_csv(content, source="t.csv")
    rates = EuroRates({"GBP": {date(2026, 3, 23): Decimal("0.86")}})

    # Act
    converted = asyncio.run(convert_history_to_eur(history, fetch=fixed_rates(rates)))
    report = build_tax_report(converted, TaxOptions(year=2026), source_names=["t.csv"])

    # Assert: 946 GBP / 0.86 = 1100 EUR -> 100 EUR gain
    [sale] = report.disposals
    assert sale.proceeds == 1100.0
    assert sale.gain == 100.0
    assert report.foreign_account.account_currencies == ["EUR", "GBP"]
    assert any("convertie" in warning for warning in report.warnings)
    assert not any("non convertis" in warning for warning in report.warnings)


def test_rate_service_failure_keeps_amounts_and_warns() -> None:
    # Arrange
    content = build_csv(
        trade("Market sell", "2026-03-23 10:00:00", "1", "50", **{"Currency (Total)": "GBP"})
    )
    history = parse_trading212_csv(content, source="t.csv")

    async def failing(currencies: set[str], start: date, end: date) -> EuroRates:
        raise FxRateError("Cours BCE indisponibles")

    # Act
    converted = asyncio.run(convert_history_to_eur(history, fetch=failing))
    report = build_tax_report(converted, TaxOptions(year=2026), source_names=["t.csv"])

    # Assert
    assert converted.transactions[0].total == Decimal("50")
    assert any("Cours BCE indisponibles" in warning for warning in report.warnings)
    assert any("non convertis" in warning for warning in report.warnings)


def test_euro_only_history_is_returned_untouched() -> None:
    history = parse_trading212_csv(
        build_csv(trade("Market buy", "2026-01-10 10:00:00", "1", "10")), source="t.csv"
    )

    async def must_not_be_called(currencies: set[str], start: date, end: date) -> EuroRates:
        raise AssertionError("no fetch expected")

    assert asyncio.run(convert_history_to_eur(history, fetch=must_not_be_called)) is history
