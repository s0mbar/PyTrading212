from decimal import Decimal

import pytest

from app.tax.csv_import import merge_histories, parse_trading212_csv
from app.tax.report import TaxOptions, build_tax_report
from app.tax.schemas import DividendBox, TaxReportResponse
from t212_csv import build_csv, trade


def report_for(year: int, *rows: dict[str, str], **options: object) -> TaxReportResponse:
    history = merge_histories([parse_trading212_csv(build_csv(*rows), source="test.csv")])
    return build_tax_report(history, TaxOptions(year=year, **options), source_names=["test.csv"])


def box(report: TaxReportResponse, code: str) -> float:
    return next(item.amount for item in report.boxes if item.code == code)


def dividend(
    time: str, *, isin: str, name: str, net_price: str, total: str, tax: str, **extra: str
):
    return {
        "Action": "Dividend (Ordinary)",
        "Time": time,
        "ISIN": isin,
        "Ticker": extra.pop("Ticker", "TICK"),
        "Name": name,
        "No. of shares": "10",
        "Price / share": net_price,
        "Currency (Price / share)": "USD",
        "Total": total,
        "Withholding tax": tax,
        "Currency (Withholding tax)": "USD",
        **extra,
    }


# --- Capital gains -------------------------------------------------------------------------


def test_sale_uses_weighted_average_price_including_previous_years() -> None:
    # Arrange: PMP = (1000 + 1200) / 20 = 110 EUR
    rows = (
        trade("Market buy", "2023-03-01 10:00:00", "10", "1000"),
        trade("Market buy", "2024-02-01 10:00:00", "10", "1200"),
        trade("Market sell", "2024-06-01 10:00:00", "5", "600", Result="45"),
    )

    # Act
    report = report_for(2024, *rows)

    # Assert
    [sale] = report.disposals
    assert sale.acquisition_cost == 550.0
    assert sale.gain == 50.0
    assert sale.average_cost_per_share == 110.0
    assert sale.broker_result == 45.0
    assert box(report, "3VG") == 50.0
    assert box(report, "3VH") == 0.0


def test_previous_year_sales_reduce_holding_but_are_not_reported() -> None:
    # Arrange: 2023 sale leaves 5 shares at 100; 2024 buy 5 at 120 -> PMP 110
    rows = (
        trade("Market buy", "2023-01-10 10:00:00", "10", "1000"),
        trade("Market sell", "2023-05-10 10:00:00", "5", "700"),
        trade("Market buy", "2024-01-10 10:00:00", "5", "600"),
        trade("Market sell", "2024-03-10 10:00:00", "10", "1300"),
    )

    # Act
    report = report_for(2024, *rows)

    # Assert
    assert [d.gain for d in report.disposals] == [200.0]
    assert report.capital_gains.disposals_count == 1


def test_transactions_after_the_tax_year_are_ignored() -> None:
    rows = (
        trade("Market buy", "2024-01-10 10:00:00", "10", "1000"),
        trade("Market sell", "2025-01-02 10:00:00", "10", "2000"),
    )

    assert report_for(2024, *rows).disposals == []


def test_sale_without_known_purchase_is_flagged() -> None:
    # Act
    report = report_for(2024, trade("Market sell", "2024-06-01 10:00:00", "5", "600"))

    # Assert
    [sale] = report.disposals
    assert sale.missing_quantity == 5.0
    assert sale.acquisition_cost == 0.0
    assert any("Historique d'achat incomplet" in warning for warning in report.warnings)


def test_stock_split_keeps_total_cost_and_adjusts_quantity() -> None:
    # Arrange: 2 shares for 1000 EUR become 20 shares (10:1)
    rows = (
        trade("Market buy", "2024-01-10 10:00:00", "2", "1000"),
        trade("Stock split close", "2024-02-10 05:00:00", "2", "0"),
        trade("Stock split open", "2024-02-10 05:00:00", "20", "0"),
        trade("Market sell", "2024-03-10 10:00:00", "10", "600"),
    )

    # Act
    [sale] = report_for(2024, *rows).disposals

    # Assert
    assert sale.acquisition_cost == 500.0
    assert sale.gain == 100.0


def test_reverse_split_with_new_isin_carries_the_cost_over() -> None:
    # Arrange: 20 old shares (1000 EUR) become 2 shares under a new ISIN
    rows = (
        trade("Market buy", "2024-01-10 10:00:00", "20", "1000", ISIN="US0000000001"),
        trade("Stock split open", "2024-02-10 05:00:01", "2", "0", ISIN="US0000000002"),
        trade("Stock split close", "2024-02-10 05:00:00", "20", "0", ISIN="US0000000001"),
        trade("Market sell", "2024-03-10 10:00:00", "2", "1100", ISIN="US0000000002"),
    )

    # Act
    report = report_for(2024, *rows)

    # Assert
    [sale] = report.disposals
    assert sale.acquisition_cost == 1000.0
    assert sale.gain == 100.0
    assert not any("split" in warning for warning in report.warnings)


def test_unpaired_split_row_is_flagged() -> None:
    rows = (
        trade("Market buy", "2024-01-10 10:00:00", "2", "1000"),
        trade("Stock split open", "2024-02-10 05:00:00", "20", "0"),
    )

    report = report_for(2024, *rows)

    assert any("split" in warning for warning in report.warnings)


def test_prior_losses_are_imputed_on_net_gain() -> None:
    rows = (
        trade("Market buy", "2024-01-10 10:00:00", "10", "1000"),
        trade("Market sell", "2024-03-10 10:00:00", "10", "1050"),
    )

    report = report_for(2024, *rows, prior_capital_losses=Decimal("30"))

    assert box(report, "3VG") == 20.0
    assert report.capital_gains.prior_losses_used == 30.0
    assert report.capital_gains.prior_losses_remaining == 0.0


def test_net_loss_goes_to_3vh_and_prior_losses_stay_available() -> None:
    rows = (
        trade("Market buy", "2024-01-10 10:00:00", "10", "1000"),
        trade("Market sell", "2024-03-10 10:00:00", "10", "900"),
    )

    report = report_for(2024, *rows, prior_capital_losses=Decimal("30"))

    assert box(report, "3VG") == 0.0
    assert box(report, "3VH") == 100.0
    assert report.capital_gains.prior_losses_remaining == 30.0


# --- Dividends -----------------------------------------------------------------------------


def test_us_dividend_is_declared_gross_with_treaty_tax_credit() -> None:
    # Arrange: 10 x 1.00 USD gross, 15 % withheld -> 8.50 USD net received as 7.86 EUR
    row = dividend(
        "2024-05-10 08:00:00",
        isin="US0378331005",
        name="Apple",
        net_price="0.85",
        total="7.86",
        tax="1.50",
    )

    # Act
    report = report_for(2024, row)

    # Assert
    [line] = report.dividends
    assert line.country == "US"
    assert line.box == DividendBox.eligible
    assert line.withholding_tax == pytest.approx(1.39, abs=0.01)
    assert line.gross == pytest.approx(9.25, abs=0.01)
    assert line.tax_credit == line.withholding_tax
    assert box(report, "2DC") == line.gross
    assert box(report, "2AB") == line.tax_credit


def test_tax_credit_is_capped_at_treaty_rate() -> None:
    # Arrange: 30 % withheld (no W-8BEN) -> only 15 % of gross is creditable
    row = dividend(
        "2024-05-10 08:00:00",
        isin="US0378331005",
        name="Apple",
        net_price="0.70",
        total="6.47",
        tax="3.00",
    )

    # Act
    report = report_for(2024, row)

    # Assert
    [line] = report.dividends
    assert line.gross == pytest.approx(9.24, abs=0.01)
    assert line.tax_credit == pytest.approx(line.gross * 0.15, abs=0.01)
    assert any("taux conventionnel" in warning for warning in report.warnings)


def test_fund_distribution_goes_to_2ts_unless_overridden() -> None:
    row = dividend(
        "2024-05-10 08:00:00",
        isin="IE00B3XXRP09",
        name="Vanguard S&P 500 UCITS ETF",
        net_price="0.30",
        total="2.78",
        tax="0",
    )

    default_report = report_for(2024, row)
    overridden = report_for(2024, row, category_overrides={"IE00B3XXRP09": DividendBox.eligible})

    assert box(default_report, "2TS") == 2.78
    assert box(default_report, "2DC") == 0.0
    assert box(overridden, "2DC") == 2.78
    assert overridden.dividends[0].box_overridden is True


def test_french_dividend_gets_no_foreign_tax_credit() -> None:
    row = dividend(
        "2024-05-10 08:00:00",
        isin="FR0000120271",
        name="TotalEnergies",
        net_price="0.80",
        total="8.00",
        tax="2.00",
        **{"Currency (Withholding tax)": "EUR"},
    )

    report = report_for(2024, row)

    assert report.dividends[0].tax_credit == 0.0
    assert any("source française" in warning for warning in report.warnings)


def test_unconvertible_withholding_is_reported() -> None:
    row = dividend(
        "2024-05-10 08:00:00",
        isin="CH0038863350",
        name="Nestle",
        net_price="1.95",
        total="20.00",
        tax="10.00",
        **{"Currency (Withholding tax)": "CHF"},
    )

    report = report_for(2024, row)

    assert report.dividends[0].withholding_tax is None
    assert any("non convertible" in warning for warning in report.warnings)


# --- Interest, totals, estimate ------------------------------------------------------------


def test_interest_on_cash_goes_to_2tr_with_broker_country() -> None:
    rows = (
        {"Action": "Interest on cash", "Time": "2024-01-31 23:00:00", "Total": "3.10"},
        {"Action": "Lending interest", "Time": "2024-02-29 23:00:00", "Total": "0.40"},
    )

    report = report_for(2024, *rows)

    assert box(report, "2TR") == 3.5
    assert {line.country for line in report.interests} == {"CY"}
    assert report.by_country[0].interest == 3.5


def test_declared_amounts_are_rounded_to_the_nearest_euro() -> None:
    rows = (
        trade("Market buy", "2024-01-10 10:00:00", "10", "1000"),
        trade("Market sell", "2024-03-10 10:00:00", "10", "1234.50"),
    )

    gain_box = next(item for item in report_for(2024, *rows).boxes if item.code == "3VG")

    assert gain_box.declared_amount == 235


def test_flat_tax_estimate() -> None:
    # Arrange: 100 EUR gain + 10 EUR interest -> base 110
    rows = (
        trade("Market buy", "2024-01-10 10:00:00", "10", "1000"),
        trade("Market sell", "2024-03-10 10:00:00", "10", "1100"),
        {"Action": "Interest on cash", "Time": "2024-04-30 23:00:00", "Total": "10"},
    )

    # Act
    estimate = report_for(2024, *rows).estimate

    # Assert
    assert estimate.taxable_base == 110.0
    assert estimate.income_tax == pytest.approx(14.08)
    assert estimate.social_contributions == pytest.approx(18.92)
    assert estimate.total == pytest.approx(33.0)


def test_empty_year_produces_a_warning_and_zero_boxes() -> None:
    report = report_for(2023, trade("Market buy", "2024-01-10 10:00:00", "1", "100"))

    assert all(item.amount == 0 for item in report.boxes)
    assert any("Aucune cession" in warning for warning in report.warnings)
