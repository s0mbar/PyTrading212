import { useMemo } from "react";

import type { TradingOverview } from "../api/client";
import { formatMoney, signClass, toNumber } from "../lib/format";

type CashSummary = {
  free: number;
  total: number;
  invested: number;
  result: number;
  ppl: number;
  blocked: number;
};

type DashboardPanelProps = {
  data: TradingOverview | null;
};

function DashboardPanel({ data }: DashboardPanelProps) {
  const positions = useMemo(() => {
    const raw = data?.portfolio?.data;
    return Array.isArray(raw) ? raw : [];
  }, [data]);

  const cash = useMemo<CashSummary>(() => {
    const raw = data?.cash ?? {};
    return {
      free: toNumber(raw.free),
      total: toNumber(raw.total),
      invested: toNumber(raw.invested),
      result: toNumber(raw.result),
      ppl: toNumber(raw.ppl),
      blocked: toNumber(raw.blocked),
    };
  }, [data]);

  return (
    <>
      <div className="cash-grid">
        <article className="metric">
          <span>Free cash</span>
          <strong>{formatMoney(cash.free)}</strong>
        </article>
        <article className="metric">
          <span>Total value</span>
          <strong>{formatMoney(cash.total)}</strong>
        </article>
        <article className="metric">
          <span>Invested</span>
          <strong>{formatMoney(cash.invested)}</strong>
        </article>
        <article className="metric">
          <span>Realized result</span>
          <strong className={signClass(cash.result)}>{formatMoney(cash.result)}</strong>
        </article>
        <article className="metric">
          <span>Unrealized PnL</span>
          <strong className={signClass(cash.ppl)}>{formatMoney(cash.ppl)}</strong>
        </article>
        <article className="metric">
          <span>Blocked</span>
          <strong>{formatMoney(cash.blocked)}</strong>
        </article>
      </div>

      <article className="card">
        <h2>Positions ({positions.length})</h2>
        {positions.length === 0 ? (
          <p>No open position at the moment.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Quantity</th>
                  <th>Avg price</th>
                  <th>Current price</th>
                  <th>Unrealized PnL</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position, index) => {
                  const row = position as Record<string, unknown>;
                  const instrument = (row.instrument as Record<string, unknown> | undefined) ?? {};
                  const walletImpact = (row.walletImpact as Record<string, unknown> | undefined) ?? {};
                  const pnl = Number(walletImpact.unrealizedProfitLoss ?? 0);
                  return (
                    <tr key={`${String(instrument.ticker ?? "row")}-${index}`}>
                      <td>{String(instrument.ticker ?? "-")}</td>
                      <td>{String(row.quantity ?? "-")}</td>
                      <td>{String(row.averagePricePaid ?? "-")}</td>
                      <td>{String(row.currentPrice ?? "-")}</td>
                      <td className={signClass(pnl)}>{String(walletImpact.unrealizedProfitLoss ?? "-")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </>
  );
}

export default DashboardPanel;
