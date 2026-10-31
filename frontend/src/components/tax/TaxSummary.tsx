import { useState } from "react";

import type { TaxReport } from "../../api/tax";
import { formatMoney, formatWholeEuros, signClass } from "../../lib/format";

type TaxSummaryProps = {
  report: TaxReport;
};

function TaxSummary({ report }: TaxSummaryProps) {
  const [copied, setCopied] = useState("");
  const { capital_gains: gains, estimate } = report;

  const copy = async (code: string, value: number) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopied(code);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("");
    }
  };

  return (
    <>
      <article className="card">
        <h2>Cases à reporter — revenus {report.year}</h2>
        <p className="meta">
          Montants en euros, arrondis à l'euro le plus proche pour la déclaration. Les revenus de source étrangère se
          saisissent d'abord sur la <strong>2047</strong>, qui alimente ensuite la 2042.
        </p>
        <div className="table-wrap">
          <table className="boxes-table">
            <thead>
              <tr>
                <th>Formulaire</th>
                <th>Case</th>
                <th>Libellé</th>
                <th className="num">Montant exact</th>
                <th className="num">À déclarer</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {report.boxes.map((box) => (
                <tr key={box.code} className={box.amount === 0 ? "muted-row" : "highlight-row"}>
                  <td>{box.form}</td>
                  <td>
                    <span className="box-code">{box.code}</span>
                  </td>
                  <td>
                    {box.label}
                    <small className="box-help">{box.help}</small>
                  </td>
                  <td className="num">{formatMoney(box.amount)}</td>
                  <td className="num">
                    <strong>{formatWholeEuros(box.declared_amount)}</strong>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="link-button no-print"
                      onClick={() => void copy(box.code, box.declared_amount)}
                    >
                      {copied === box.code ? "Copié" : "Copier"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className="cash-grid">
        <article className="metric">
          <span>Plus-values brutes</span>
          <strong className="up">{formatMoney(gains.gains)}</strong>
        </article>
        <article className="metric">
          <span>Moins-values brutes</span>
          <strong className="down">{formatMoney(gains.losses)}</strong>
        </article>
        <article className="metric">
          <span>Résultat net des cessions</span>
          <strong className={signClass(gains.net)}>{formatMoney(gains.net)}</strong>
        </article>
        <article className="metric">
          <span>Moins-values antérieures imputées</span>
          <strong>{formatMoney(gains.prior_losses_used)}</strong>
        </article>
        <article className="metric">
          <span>Moins-values encore reportables</span>
          <strong>{formatMoney(gains.prior_losses_remaining + (gains.net < 0 ? -gains.net : 0))}</strong>
        </article>
        <article className="metric">
          <span>Prix de cession total ({gains.disposals_count} cessions)</span>
          <strong>{formatMoney(gains.total_proceeds)}</strong>
        </article>
      </div>

      <article className="card">
        <h2>Estimation de l'imposition (PFU 30 %)</h2>
        <p className="meta">
          Indicatif : prélèvement forfaitaire unique de 12,8 % d'impôt sur le revenu + 17,2 % de prélèvements sociaux.
          Si l'option pour le barème progressif (case 2OP) vous est plus favorable, le calcul diffère.
        </p>
        <div className="cash-grid">
          <article className="metric">
            <span>Base imposable</span>
            <strong>{formatMoney(estimate.taxable_base)}</strong>
          </article>
          <article className="metric">
            <span>Impôt sur le revenu (12,8 %)</span>
            <strong>{formatMoney(estimate.income_tax)}</strong>
          </article>
          <article className="metric">
            <span>Crédit d'impôt imputé (2AB)</span>
            <strong className="up">−{formatMoney(estimate.tax_credit_used)}</strong>
          </article>
          <article className="metric">
            <span>Prélèvements sociaux (17,2 %)</span>
            <strong>{formatMoney(estimate.social_contributions)}</strong>
          </article>
          <article className="metric metric-total">
            <span>Total estimé</span>
            <strong>{formatMoney(estimate.total)}</strong>
          </article>
        </div>
      </article>

      {report.warnings.length > 0 && (
        <article className="card warning-card">
          <h2>Points à vérifier ({report.warnings.length})</h2>
          <ul>
            {report.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </article>
      )}
    </>
  );
}

export default TaxSummary;
