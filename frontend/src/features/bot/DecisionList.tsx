import { useState } from "react";

import type { BotDecision } from "../../api/client";
import { formatDateTime, formatNumber, formatRelative } from "../../lib/format";
import { Button } from "../../ui/controls";
import { EmptyState } from "../../ui/feedback";
import { REGIME_LABELS } from "./botConfig";

const ACTION_LABELS: Record<string, { label: string; tone: string }> = {
  BUY: { label: "Achat", tone: "buy" },
  SELL: { label: "Vente", tone: "sell" },
  HOLD: { label: "Attente", tone: "neutral" },
  SKIP: { label: "Ignoré", tone: "neutral" },
  HALT: { label: "Arrêt de sécurité", tone: "sell" },
  ERROR: { label: "Erreur", tone: "sell" },
};

const PAGE = 10;

/** Bot journal as readable cards: what it decided, why, and whether an order left. */
function DecisionList({ decisions }: { decisions: BotDecision[] }) {
  const [visible, setVisible] = useState(PAGE);

  if (decisions.length === 0) {
    return <EmptyState title="Aucune décision pour l'instant">Le journal se remplit à chaque cycle d'analyse.</EmptyState>;
  }

  return (
    <>
      <ul className="decisions">
        {decisions.slice(0, visible).map((decision, index) => {
          const action = ACTION_LABELS[decision.action.toUpperCase()] ?? { label: decision.action, tone: "neutral" };
          return (
            <li key={`${decision.at}-${decision.ticker}-${index}`} className="decision">
              <div className="decision-head">
                <span className={`pill pill-${action.tone}`}>{action.label}</span>
                <strong>{decision.ticker}</strong>
                <time dateTime={decision.at} title={formatDateTime(decision.at)}>
                  {formatRelative(decision.at)}
                </time>
              </div>
              <p className="decision-reason">{decision.reason}</p>
              <p className="decision-meta">
                {decision.regime && <span>Régime : {REGIME_LABELS[decision.regime] ?? decision.regime}</span>}
                {decision.confidence !== undefined && decision.confidence !== null && (
                  <span>Confiance : {Math.round(decision.confidence * 100)} %</span>
                )}
                {decision.price !== undefined && decision.price !== null && <span>Prix : {formatNumber(decision.price)}</span>}
                {decision.quantity ? <span>Quantité : {formatNumber(decision.quantity)}</span> : null}
                <span>
                  {decision.executed
                    ? decision.mode === "LIVE"
                      ? "Ordre réel envoyé"
                      : "Simulé (aucun ordre)"
                    : "Pas d'ordre"}
                </span>
              </p>
              {decision.error && <p className="field-error">Erreur : {decision.error}</p>}
            </li>
          );
        })}
      </ul>
      {decisions.length > visible && (
        <Button variant="ghost" block onClick={() => setVisible((count) => count + PAGE)}>
          Afficher plus ({decisions.length - visible} restantes)
        </Button>
      )}
    </>
  );
}

export default DecisionList;
