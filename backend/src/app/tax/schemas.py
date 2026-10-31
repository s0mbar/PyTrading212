"""API models of the French tax helper (amounts in euros, rounded to the cent)."""

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field, model_validator

MAX_CSV_FILES = 30
MAX_CSV_CHARS = 20_000_000
MAX_TOTAL_CSV_CHARS = 60_000_000


class DividendBox(StrEnum):
    eligible = "2DC"
    non_eligible = "2TS"


class CsvFile(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    content: str = Field(max_length=MAX_CSV_CHARS)


class TaxReportRequest(BaseModel):
    year: int = Field(ge=2000, le=2100)
    csv_files: list[CsvFile] = Field(default_factory=list, max_length=MAX_CSV_FILES)
    report_ids: list[int] = Field(default_factory=list, max_length=MAX_CSV_FILES)
    prior_capital_losses: float = Field(default=0.0, ge=0, le=1e9, allow_inf_nan=False)
    default_treaty_rate: float = Field(default=0.15, ge=0, le=0.5, allow_inf_nan=False)
    category_overrides: dict[str, DividendBox] = Field(default_factory=dict, max_length=2000)

    @model_validator(mode="after")
    def check_sources(self) -> "TaxReportRequest":
        if not self.csv_files and not self.report_ids:
            raise ValueError("Fournir au moins un export CSV ou un rapport Trading 212")
        if sum(len(item.content) for item in self.csv_files) > MAX_TOTAL_CSV_CHARS:
            raise ValueError("Exports CSV trop volumineux")
        return self


class ExportRequest(BaseModel):
    year: int = Field(ge=2000, le=2100)


class DeclarationBox(BaseModel):
    code: str
    form: str
    label: str
    amount: float
    declared_amount: int
    help: str


class DisposalLine(BaseModel):
    date: datetime
    isin: str
    ticker: str
    name: str
    quantity: float
    proceeds: float
    acquisition_cost: float
    average_cost_per_share: float
    gain: float
    fees: float
    broker_result: float | None
    missing_quantity: float


class DividendLine(BaseModel):
    date: datetime
    isin: str
    ticker: str
    name: str
    instrument_key: str
    country: str
    box: DividendBox
    box_overridden: bool
    net: float
    withholding_tax: float | None
    withholding_original: float | None
    withholding_original_currency: str
    gross: float
    tax_credit: float
    action: str


class InterestLine(BaseModel):
    date: datetime
    label: str
    country: str
    amount: float


class CountryIncome(BaseModel):
    country: str
    dividends_gross: float
    interest: float
    withholding_tax: float
    tax_credit: float


class CapitalGainsSummary(BaseModel):
    gains: float
    losses: float
    net: float
    prior_losses_used: float
    prior_losses_remaining: float
    disposals_count: int
    total_proceeds: float


class TaxEstimate(BaseModel):
    taxable_base: float
    income_tax: float
    tax_credit_used: float
    social_contributions: float
    total: float


class ForeignAccount(BaseModel):
    entity: str
    entity_country: str
    regulator: str
    account_type: str
    account_currencies: list[str]
    first_activity: date | None
    last_activity: date | None


class SourceSummary(BaseModel):
    files: list[str]
    transactions: int
    period_start: date | None
    period_end: date | None


class TaxReportResponse(BaseModel):
    year: int
    generated_at: datetime
    boxes: list[DeclarationBox]
    capital_gains: CapitalGainsSummary
    disposals: list[DisposalLine]
    dividends: list[DividendLine]
    interests: list[InterestLine]
    by_country: list[CountryIncome]
    estimate: TaxEstimate
    foreign_account: ForeignAccount
    sources: SourceSummary
    warnings: list[str]
