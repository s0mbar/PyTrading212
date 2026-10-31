import { useMemo } from "react";

import type { DividendBox, TaxReport } from "../../api/tax";
import { downloadCsv, frenchDecimal } from "../../lib/csv";
import { formatDate, formatMoney, formatNumber, signClass } from "../../lib/format";

type TaxDetailsProps = {
  report: TaxReport;
  onOverrideChange: (instrumentKey: string, box: DividendBox) => void;
};

type InstrumentDistribution = {
  key: string;
  label: string;
  country: string;
  gross: number;
  box: DividendBox;
  overridden: boolean;
};

function TaxDetails({ report, onOverrideChange }: TaxDetailsProps) {
  const instruments = useMemo(() => {
    const byKey = new Map<string, InstrumentDistribution>();
    for (const line of report.dividends) {
      const current = byKey.get(line.instrument_key);
      if (current) {
        current.gross += line.gross;
      } else {
        byKey.set(line.instrument_key, {
          key: line.instrument_key,
          label: `${line.name || line.ticker} (${line.isin || line.ticker})`,
          country: line.country,
          gross: line.gross,
          box: line.box,
          overridden: line.box_overridden,
        });
      }
    }
    return [...byKey.values()].sort((a, b) => b.gross - a.gross);
  }, [report.dividends]);

  const interestTotal = report.interests.reduce((sum, line) => sum + line.amount, 0);

  const exportDisposals = () => {
    downloadCsv(
      `cessions-${report.year}.csv`,
      [
        "Date",
        "ISIN",
        "Ticker",
        "Nom",
        "Quantité",
        "Prix de cession net (EUR)",
        "PMP (EUR)",
        "Prix d'acquisition (EUR)",
        "Plus/moins-value (EUR)",
        "Frais (EUR)",
        "Quantité sans historique",
      ],
      report.disposals.map((line) => [
        formatDate(line.date),
        line.isin,
        line.ticker,
        line.name,
        frenchDecimal(line.quantity),
        frenchDecimal(line.proceeds),
        frenchDecimal(line.average_cost_per_share),
        frenchDecimal(line.acquisition_cost),
        frenchDecimal(line.gain),
        frenchDecimal(line.fees),
        frenchDecimal(line.missing_quantity),
      ])
    );
  };

  return (
    <>
      <article className="card">
        <div className="card-header">
          <h2>Cessions — détail pour le formulaire 2074 ({report.disposals.length})</h2>
          {report.disposals.length > 0 && (
            <button type="button" className="secondary no-print" onClick={exportDisposals}>
              Exporter en CSV
            </button>
          )}
        </div>
        <p className="meta">
          Prix d'acquisition = prix moyen pondéré (PMP) en euros, frais d'achat inclus ; prix de cession net des frais.
          La colonne « Résultat T212 » est le calcul du courtier, donné pour comparaison.
        </p>
        {report.disposals.length === 0 ? (
          <p>Aucune cession sur l'année.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Titre</th>
                  <th className="num">Quantité</th>
                  <th className="num">Prix de cession</th>
                  <th className="num">PMP</th>
                  <th className="num">Prix d'acquisition</th>
                  <th className="num">Plus/moins-value</th>
                  <th className="num">Résultat T212</th>
                </tr>
              </thead>
              <tbody>
                {report.disposals.map((line, index) => (
                  <tr key={`${line.date}-${line.isin}-${index}`} className={line.missing_quantity > 0 ? "flag-row" : ""}>
                    <td>{formatDate(line.date)}</td>
                    <td>
                      {line.name || line.ticker}
                      <small className="box-help">
                        {line.isin} · {line.ticker}
                        {line.missing_quantity > 0 && ` · ${formatNumber(line.missing_quantity)} titres sans achat connu`}
                      </small>
                    </td>
                    <td className="num">{formatNumber(line.quantity)}</td>
                    <td className="num">{formatMoney(line.proceeds)}</td>
                    <td className="num">{formatMoney(line.average_cost_per_share)}</td>
                    <td className="num">{formatMoney(line.acquisition_cost)}</td>
                    <td className={`num ${signClass(line.gain)}`}>{formatMoney(line.gain)}</td>
                    <td className="num">{line.broker_result === null ? "-" : formatMoney(line.broker_result)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <article className="card">
        <h2>Dividendes et distributions ({report.dividends.length})</h2>
        {instruments.length === 0 ? (
          <p>Aucun dividende sur l'année.</p>
        ) : (
          <>
            <p className="meta">
              Classement automatique : actions → 2DC (abattement 40 % si barème), ETF/fonds → 2TS. Corrigez si besoin
              (ex. REIT américaine non éligible → 2TS) : le calcul est relancé.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Pays</th>
                    <th className="num">Brut annuel</th>
                    <th>Case</th>
                  </tr>
                </thead>
                <tbody>
                  {instruments.map((instrument) => (
                    <tr key={instrument.key}>
                      <td>{instrument.label}</td>
                      <td>{instrument.country}</td>
                      <td className="num">{formatMoney(instrument.gross)}</td>
                      <td>
                        <select
                          aria-label={`Case pour ${instrument.label}`}
                          value={instrument.box}
                          onChange={(event) => onOverrideChange(instrument.key, event.target.value as DividendBox)}
                        >
                          <option value="2DC">2DC — éligible abattement</option>
                          <option value="2TS">2TS — non éligible</option>
                        </select>
                        {instrument.overridden && <small className="box-help">modifié manuellement</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <details className="details-block">
              <summary>Détail des {report.dividends.length} versements</summary>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Titre</th>
                      <th className="num">Net reçu</th>
                      <th className="num">Retenue (EUR)</th>
                      <th className="num">Retenue (devise)</th>
                      <th className="num">Brut</th>
                      <th className="num">Crédit 2AB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.dividends.map((line, index) => (
                      <tr key={`${line.date}-${line.instrument_key}-${index}`}>
                        <td>{formatDate(line.date)}</td>
                        <td>
                          {line.name || line.ticker}
                          <small className="box-help">
                            {line.country} · {line.box}
                          </small>
                        </td>
                        <td className="num">{formatMoney(line.net)}</td>
                        <td className="num">{line.withholding_tax === null ? "?" : formatMoney(line.withholding_tax)}</td>
                        <td className="num">
                          {line.withholding_original === null
                            ? "-"
                            : `${formatNumber(line.withholding_original)} ${line.withholding_original_currency}`}
                        </td>
                        <td className="num">{formatMoney(line.gross)}</td>
                        <td className="num">{formatMoney(line.tax_credit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </article>

      <article className="card">
        <h2>Intérêts ({formatMoney(interestTotal)})</h2>
        {report.interests.length === 0 ? (
          <p>Aucun intérêt sur l'année.</p>
        ) : (
          <details className="details-block">
            <summary>Détail des {report.interests.length} versements</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Nature</th>
                    <th>Pays</th>
                    <th className="num">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {report.interests.map((line, index) => (
                    <tr key={`${line.date}-${index}`}>
                      <td>{formatDate(line.date)}</td>
                      <td>{line.label}</td>
                      <td>{line.country}</td>
                      <td className="num">{formatMoney(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </article>

      {report.by_country.length > 0 && (
        <article className="card">
          <h2>Revenus encaissés à l'étranger par pays (aide 2047)</h2>
          <p className="meta">
            Pays déduit de l'ISIN (émetteur) pour les dividendes ; intérêts sur liquidités versés par l'entité Trading
            212 (Chypre).
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Pays</th>
                  <th className="num">Dividendes bruts</th>
                  <th className="num">Intérêts</th>
                  <th className="num">Retenue à la source</th>
                  <th className="num">Crédit d'impôt imputable</th>
                </tr>
              </thead>
              <tbody>
                {report.by_country.map((row) => (
                  <tr key={row.country}>
                    <td>{row.country}</td>
                    <td className="num">{formatMoney(row.dividends_gross)}</td>
                    <td className="num">{formatMoney(row.interest)}</td>
                    <td className="num">{formatMoney(row.withholding_tax)}</td>
                    <td className="num">{formatMoney(row.tax_credit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </>
  );
}

export default TaxDetails;
