import { requestJson } from "./http";

const TAX_BASE = "/api/tax";

export type DividendBox = "2DC" | "2TS";

export type CsvFile = {
  name: string;
  content: string;
};

export type TaxReportRequest = {
  year: number;
  csv_files: CsvFile[];
  report_ids: number[];
  prior_capital_losses: number;
  default_treaty_rate: number;
  category_overrides: Record<string, DividendBox>;
};

export type DeclarationBox = {
  code: string;
  form: string;
  label: string;
  amount: number;
  declared_amount: number;
  help: string;
};

export type DisposalLine = {
  date: string;
  isin: string;
  ticker: string;
  name: string;
  quantity: number;
  proceeds: number;
  acquisition_cost: number;
  average_cost_per_share: number;
  gain: number;
  fees: number;
  broker_result: number | null;
  missing_quantity: number;
};

export type DividendLine = {
  date: string;
  isin: string;
  ticker: string;
  name: string;
  instrument_key: string;
  country: string;
  box: DividendBox;
  box_overridden: boolean;
  net: number;
  withholding_tax: number | null;
  withholding_original: number | null;
  withholding_original_currency: string;
  gross: number;
  tax_credit: number;
  action: string;
};

export type InterestLine = {
  date: string;
  label: string;
  country: string;
  amount: number;
};

export type CountryIncome = {
  country: string;
  dividends_gross: number;
  interest: number;
  withholding_tax: number;
  tax_credit: number;
};

export type CapitalGainsSummary = {
  gains: number;
  losses: number;
  net: number;
  prior_losses_used: number;
  prior_losses_remaining: number;
  disposals_count: number;
  total_proceeds: number;
};

export type TaxEstimate = {
  taxable_base: number;
  income_tax: number;
  tax_credit_used: number;
  social_contributions: number;
  total: number;
};

export type ForeignAccount = {
  entity: string;
  entity_country: string;
  regulator: string;
  account_type: string;
  account_currencies: string[];
  first_activity: string | null;
  last_activity: string | null;
};

export type TaxReport = {
  year: number;
  generated_at: string;
  boxes: DeclarationBox[];
  capital_gains: CapitalGainsSummary;
  disposals: DisposalLine[];
  dividends: DividendLine[];
  interests: InterestLine[];
  by_country: CountryIncome[];
  estimate: TaxEstimate;
  foreign_account: ForeignAccount;
  sources: { files: string[]; transactions: number; period_start: string | null; period_end: string | null };
  warnings: string[];
};

export type ExportStatus = "Queued" | "Processing" | "Running" | "Canceled" | "Failed" | "Finished";

export type ExportReport = {
  reportId: number;
  status: ExportStatus;
  timeFrom?: string;
  timeTo?: string;
  downloadLink?: string;
};

export type ExportList = {
  reports: ExportReport[];
  cached: boolean;
  next_refresh_seconds: number;
};

export type AccountInfo = {
  account_id: number | null;
  currency: string | null;
  environment: string;
};

export async function computeTaxReport(payload: TaxReportRequest): Promise<TaxReport> {
  // Parsing several years of history server-side can take a while.
  return requestJson<TaxReport>(
    `${TAX_BASE}/report`,
    { method: "POST", body: JSON.stringify(payload) },
    { timeoutMs: 180_000 }
  );
}

export async function listExports(silent = false): Promise<ExportList> {
  return requestJson<ExportList>(`${TAX_BASE}/exports`, {}, { silent });
}

export async function requestExport(year: number): Promise<{ report_id: number }> {
  return requestJson<{ report_id: number }>(`${TAX_BASE}/exports`, {
    method: "POST",
    body: JSON.stringify({ year }),
  });
}

export async function fetchAccountInfo(): Promise<AccountInfo> {
  return requestJson<AccountInfo>(`${TAX_BASE}/account`);
}
