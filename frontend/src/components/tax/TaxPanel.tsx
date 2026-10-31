import { useEffect, useState } from "react";

import { errorMessage } from "../../api/http";
import {
  computeTaxReport,
  fetchAccountInfo,
  type AccountInfo,
  type DividendBox,
  type TaxReport,
} from "../../api/tax";
import { formatDate } from "../../lib/format";
import ForeignAccountCard from "./ForeignAccountCard";
import TaxDetails from "./TaxDetails";
import TaxGuide from "./TaxGuide";
import TaxSources, { type LoadedFile } from "./TaxSources";
import TaxSummary from "./TaxSummary";

const FIRST_YEAR = 2019;
const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: currentYear - FIRST_YEAR + 1 }, (_, index) => currentYear - index);

function TaxPanel() {
  const [year, setYear] = useState(currentYear - 1);
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [selectedReports, setSelectedReports] = useState<number[]>([]);
  const [priorLosses, setPriorLosses] = useState(0);
  const [treatyRatePct, setTreatyRatePct] = useState(15);
  const [overrides, setOverrides] = useState<Record<string, DividendBox>>({});
  const [report, setReport] = useState<TaxReport | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchAccountInfo()
      .then(setAccountInfo)
      .catch(() => setAccountInfo(null));
  }, []);

  const hasSources = files.length > 0 || selectedReports.length > 0;

  const compute = async (categoryOverrides = overrides) => {
    setLoading(true);
    setError("");
    try {
      const result = await computeTaxReport({
        year,
        csv_files: files.map(({ name, content }) => ({ name, content })),
        report_ids: selectedReports,
        prior_capital_losses: Math.max(0, priorLosses || 0),
        default_treaty_rate: Math.min(50, Math.max(0, treatyRatePct || 0)) / 100,
        category_overrides: categoryOverrides,
      });
      setReport(result);
    } catch (err) {
      setError(errorMessage(err, "Calcul impossible"));
    } finally {
      setLoading(false);
    }
  };

  const onOverrideChange = (instrumentKey: string, box: DividendBox) => {
    const next = { ...overrides, [instrumentKey]: box };
    setOverrides(next);
    void compute(next);
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void compute();
  };

  return (
    <section className="tax-panel">
      <article className="card no-print">
        <div className="card-header">
          <h2>Fiscalité — reconstitution de l'IFU</h2>
          {report && (
            <button type="button" className="secondary" onClick={() => window.print()}>
              Imprimer / PDF
            </button>
          )}
        </div>
        <p className="meta">
          Trading 212 étant un courtier étranger, il ne fournit pas d'IFU : cet onglet recalcule à partir de votre
          historique les montants à déclarer (2042, 2042-C, 2047, 2074, 3916).
        </p>

        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Année des revenus
            <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
              {YEARS.map((item) => (
                <option key={item} value={item}>
                  {item} (déclaration {item + 1})
                </option>
              ))}
            </select>
          </label>
          <label>
            Moins-values antérieures reportables (€)
            <input
              type="number"
              min="0"
              step="0.01"
              value={priorLosses}
              onChange={(event) => setPriorLosses(Number(event.target.value))}
            />
          </label>
          <label>
            Taux conventionnel par défaut (%)
            <input
              type="number"
              min="0"
              max="50"
              step="0.5"
              value={treatyRatePct}
              onChange={(event) => setTreatyRatePct(Number(event.target.value))}
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={loading || !hasSources}>
              {loading ? "Calcul..." : "Calculer"}
            </button>
          </div>
        </form>

        <TaxSources
          year={year}
          files={files}
          onFilesChange={setFiles}
          selectedReports={selectedReports}
          onSelectedReportsChange={setSelectedReports}
        />
        {error && <p className="error">{error}</p>}
      </article>

      {report && (
        <>
          <p className="meta print-title">
            Revenus {report.year} · {report.sources.transactions} opérations importées (
            {formatDate(report.sources.period_start)} → {formatDate(report.sources.period_end)}) · sources :{" "}
            {report.sources.files.join(", ")}
          </p>
          <TaxSummary report={report} />
          <TaxDetails report={report} onOverrideChange={onOverrideChange} />
        </>
      )}

      <ForeignAccountCard account={report?.foreign_account ?? null} accountInfo={accountInfo} />
      <TaxGuide />
    </section>
  );
}

export default TaxPanel;
