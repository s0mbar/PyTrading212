import { useMemo } from "react";

import type { Position, TradingOverview } from "../../api/client";
import { formatMoney, formatNumber, formatPct, signClass, toNumber } from "../../lib/format";
import { Button } from "../../ui/controls";
import { Card, EmptyState, Skeleton, Stat } from "../../ui/feedback";

type Row = {
  key: string;
  ticker: string;
  name: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  priceCurrency: string;
  value: number;
  cost: number;
  pnl: number;
  pnlRatio: number;
  walletCurrency: string;
};

function toRow(position: Position, index: number): Row {
  const instrument = position.instrument ?? {};
  const wallet = position.walletImpact ?? {};
  const cost = toNumber(wallet.totalCost);
  const pnl = toNumber(wallet.unrealizedProfitLoss);
  return {
    key: `${instrument.ticker ?? "position"}-${index}`,
    ticker: instrument.ticker ?? "?",
    name: instrument.name ?? instrument.ticker ?? "?",
    quantity: toNumber(position.quantity),
    averagePrice: toNumber(position.averagePricePaid),
    currentPrice: toNumber(position.currentPrice),
    priceCurrency: instrument.currency ?? "EUR",
    value: toNumber(wallet.currentValue),
    cost,
    pnl,
    pnlRatio: cost > 0 ? pnl / cost : 0,
    walletCurrency: wallet.currency ?? "EUR",
  };
}

type PortfolioViewProps = {
  data: TradingOverview | null;
  loading: boolean;
  onOrder: (ticker: string) => void;
};

function PortfolioView({ data, loading, onOrder }: PortfolioViewProps) {
  const rows = useMemo(
    () => (data?.portfolio?.data ?? []).map(toRow).sort((a, b) => b.value - a.value),
    [data]
  );

  const cash = data?.cash ?? {};
  const total = toNumber(cash.total);
  const invested = toNumber(cash.invested);
  const ppl = toNumber(cash.ppl);
  const positionsValue = rows.reduce((sum, row) => sum + row.value, 0);

  if (!data && loading) {
    return (
      <Card>
        <Skeleton lines={6} />
      </Card>
    );
  }
  if (!data) {
    return <EmptyState title="Aucune donnée pour l'instant">Touche « Actualiser » en haut de l'écran.</EmptyState>;
  }

  return (
    <div className="stack">
      <section className="stats-grid" aria-label="Synthèse du compte">
        <Stat label="Valeur totale" value={formatMoney(total)} emphasis />
        <Stat
          label="Plus-value latente"
          value={formatMoney(ppl)}
          tone={signClass(ppl)}
          detail={invested > 0 ? formatPct(ppl / invested) : undefined}
        />
        <Stat label="Liquidités disponibles" value={formatMoney(toNumber(cash.free))} />
        <Stat label="Investi" value={formatMoney(invested)} />
        <Stat label="Résultat réalisé" value={formatMoney(toNumber(cash.result))} tone={signClass(toNumber(cash.result))} />
        {toNumber(cash.blocked) > 0 && <Stat label="Bloqué (ordres en cours)" value={formatMoney(toNumber(cash.blocked))} />}
      </section>

      <Card title={`Positions (${rows.length})`} subtitle="Triées par valeur. Touche une position pour préparer un ordre.">
        {rows.length === 0 ? (
          <EmptyState title="Aucune position ouverte" />
        ) : (
          <ul className="positions">
            <li className="position position-head" aria-hidden="true">
              <span>Titre</span>
              <span>Quantité · PRU</span>
              <span>Cours</span>
              <span>Valeur</span>
              <span>Plus-value</span>
            </li>
            {rows.map((row) => (
              <li key={row.key}>
                <button type="button" className="position" onClick={() => onOrder(row.ticker)}>
                  <span className="position-name">
                    <strong>{row.name}</strong>
                    <small>{row.ticker}</small>
                  </span>
                  <span className="position-qty">
                    <span className="mobile-label">Quantité</span>
                    {formatNumber(row.quantity)}
                    <small>PRU {formatMoney(row.averagePrice, row.priceCurrency)}</small>
                  </span>
                  <span className="position-price">
                    <span className="mobile-label">Cours</span>
                    {formatMoney(row.currentPrice, row.priceCurrency)}
                  </span>
                  <span className="position-value">
                    <span className="mobile-label">Valeur</span>
                    {formatMoney(row.value, row.walletCurrency)}
                    {positionsValue > 0 && (
                      <progress
                        className="weight"
                        value={row.value}
                        max={positionsValue}
                        aria-label={`Poids : ${formatPct(row.value / positionsValue).replace("+", "")}`}
                      />
                    )}
                  </span>
                  <span className={`position-pnl ${signClass(row.pnl)}`}>
                    <span className="mobile-label">Plus-value</span>
                    {formatMoney(row.pnl, row.walletCurrency)}
                    <small>{formatPct(row.pnlRatio)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="card-footer">
          <Button variant="secondary" onClick={() => onOrder("")}>
            Nouvel ordre
          </Button>
        </div>
      </Card>
    </div>
  );
}

export default PortfolioView;
