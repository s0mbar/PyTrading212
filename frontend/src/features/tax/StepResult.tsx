import { useEffect, useState } from "react";

import type { AccountInfo, DeclarationBox, DividendBox, TaxReport } from "../../api/tax";
import { formatDate, formatMoney, formatWholeEuros, signClass } from "../../lib/format";
import { Button, Collapsible } from "../../ui/controls";
import { Card, Notice, Stat } from "../../ui/feedback";
import ForeignAccountCard from "./ForeignAccountCard";
import TaxDetails from "./TaxDetails";
import TaxGuide from "./TaxGuide";

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span>{Math.max(0, Math.round((now - since) / 1000))} s</span>;
}

function BoxCard({ box }: { box: DeclarationBox }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(box.declared_amount));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <li className="box-card">
      <div className="box-card-head">
        <span className="box-code">{box.code}</span>
        <span className="box-form">{box.form}</span>
      </div>
      <p className="box-label">{box.label}</p>
      <p className="box-amount">{formatWholeEuros(box.declared_amount)}</p>
      <p className="box-help">
        Montant exact : {formatMoney(box.amount)}. {box.help}
      </p>
      <Button variant="secondary" className="no-print" onClick={() => void copy()}>
        {copied ? "Copié ✓" : "Copier le montant"}
      </Button>
    </li>
  );
}

type StepResultProps = {
  report: TaxReport | null;
  computingSince: number | null;
  error: string;
  accountInfo: AccountInfo | null;
  onRetry: () => void;
  onOverrideChange: (instrumentKey: string, box: DividendBox) => void;
  onBack: () => void;
};

function StepResult({ report, computingSince, error, accountInfo, onRetry, onOverrideChange, onBack }: StepResultProps) {
  if (computingSince !== null && !report) {
    return (
      <Card title="Calcul en cours…" subtitle="Lecture de tout l'historique, conversion en euros au cours BCE du jour de chaque opération.">
        <div className="progress-indeterminate" role="progressbar" aria-label="Calcul en cours">
          <span />
        </div>
        <p className="meta">
          Temps écoulé : <Elapsed since={computingSince} /> · quelques secondes à une minute selon le nombre
          d'années.
        </p>
      </Card>
    );
  }

  if (!report) {
    return (
      <div className="stack">
        <Notice tone="danger" title="Le calcul n'a pas abouti">
          {error || "Aucun résultat."}
        </Notice>
        <div className="step-nav">
          <Button variant="secondary" onClick={onBack}>
            Retour
          </Button>
          <Button onClick={onRetry}>Réessayer</Button>
        </div>
      </div>
    );
  }

  const toDeclare = report.boxes.filter((box) => box.declared_amount !== 0);
  const empty = report.boxes.filter((box) => box.declared_amount === 0);
  const { capital_gains: gains, estimate } = report;

  return (
    <div className="stack tax-result">
      {computingSince !== null && (
        <div className="progress-indeterminate" role="progressbar" aria-label="Recalcul en cours">
          <span />
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}

      <Card
        title={`Ta déclaration des revenus ${report.year}`}
        subtitle={`${report.sources.transactions} opérations lues · ${formatDate(report.sources.period_start)} → ${formatDate(report.sources.period_end)}`}
        actions={
          <Button variant="secondary" className="no-print" onClick={() => window.print()}>
            Imprimer / PDF
          </Button>
        }
      >
        {report.warnings.length > 0 && (
          <Notice tone="warning" title={`${report.warnings.length} point(s) à vérifier avant de déclarer`}>
            <ul>
              {report.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Notice>
        )}

        <h3>Les cases à remplir</h3>
        <p className="meta">
          Sur impots.gouv.fr, saisis d'abord les revenus étrangers sur la <strong>2047</strong> : ils alimentent ensuite la
          2042. Les montants sont arrondis à l'euro.
        </p>
        {toDeclare.length === 0 ? (
          <Notice tone="success">Aucun montant à déclarer pour cette année (hors formulaire 3916, ci-dessous).</Notice>
        ) : (
          <ul className="box-grid">
            {toDeclare.map((box) => (
              <BoxCard key={box.code} box={box} />
            ))}
          </ul>
        )}
        {empty.length > 0 && (
          <Collapsible title={`Cases à zéro (${empty.length}) : rien à saisir`}>
            <ul className="plain-list">
              {empty.map((box) => (
                <li key={box.code}>
                  <strong>{box.code}</strong> ({box.form}) — {box.label}
                </li>
              ))}
            </ul>
          </Collapsible>
        )}
      </Card>

      <Card title="Ventes d'actions (plus ou moins-values)">
        <div className="stats-grid">
          <Stat label="Résultat net" value={formatMoney(gains.net)} tone={signClass(gains.net)} emphasis />
          <Stat label="Plus-values" value={formatMoney(gains.gains)} tone="up" />
          <Stat label="Moins-values" value={formatMoney(gains.losses)} tone="down" />
          <Stat label={`Cessions (${gains.disposals_count})`} value={formatMoney(gains.total_proceeds)} detail="prix de vente total" />
          <Stat label="Pertes antérieures imputées" value={formatMoney(gains.prior_losses_used)} />
          <Stat
            label="Pertes encore reportables"
            value={formatMoney(gains.prior_losses_remaining + (gains.net < 0 ? -gains.net : 0))}
          />
        </div>
      </Card>

      <Card title="Estimation de l'impôt (flat tax 30 %)" subtitle="Indicatif : 12,8 % d'impôt + 17,2 % de prélèvements sociaux.">
        <div className="stats-grid">
          <Stat label="Total estimé" value={formatMoney(estimate.total)} emphasis />
          <Stat label="Base imposable" value={formatMoney(estimate.taxable_base)} />
          <Stat label="Impôt (12,8 %)" value={formatMoney(estimate.income_tax)} />
          <Stat label="Crédit d'impôt (2AB)" value={`−${formatMoney(estimate.tax_credit_used)}`} tone="up" />
          <Stat label="Prélèvements sociaux" value={formatMoney(estimate.social_contributions)} />
        </div>
        <p className="meta">
          Si le barème progressif t'est plus favorable (case 2OP), le montant réel sera différent.
        </p>
      </Card>

      <TaxDetails report={report} onOverrideChange={onOverrideChange} />
      <ForeignAccountCard account={report.foreign_account} accountInfo={accountInfo} />
      <TaxGuide />

      <div className="step-nav no-print">
        <Button variant="secondary" onClick={onBack}>
          Modifier les précisions
        </Button>
        <Button variant="ghost" onClick={onRetry} pending={computingSince !== null}>
          Recalculer
        </Button>
      </div>
    </div>
  );
}

export default StepResult;
