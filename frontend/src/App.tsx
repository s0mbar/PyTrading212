import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchBotStatus,
  fetchOverview,
  placeOrder,
  runBotOnce,
  type BotConfig,
  type BotStatus,
  type OrderType,
  type PlaceOrderRequest,
  type TimeValidity,
  type TradingOverview,
  updateBotConfig,
} from "./api/client";

type Status = "idle" | "loading" | "success" | "error";

type CashSummary = {
  free: number;
  total: number;
  invested: number;
  result: number;
  ppl: number;
  blocked: number;
};

type OrderFormState = {
  ticker: string;
  quantity: number;
  orderType: OrderType;
  limitPrice: number;
  stopPrice: number;
  timeValidity: TimeValidity;
  extendedHours: boolean;
  confirmLive: boolean;
};

const DEFAULT_BOT_CONFIG: BotConfig = {
  enabled: false,
  mode: "DRY_RUN",
  tickers: [],

  allocated_cash_amount: 500,
  min_trade_notional: 20,
  max_order_quantity: 3,

  grid_step_pct: 1.2,
  max_grid_depth: 5,
  reanchor_on_breakout: true,

  execution_order_type: "LIMIT",
  execution_time_validity: "DAY",
  limit_price_offset_pct: 0.15,
  stop_price_offset_pct: 0.25,

  short_window: 20,
  long_window: 50,
  rsi_period: 14,
  buy_rsi_max: 65,
  sell_rsi_min: 35,
  trend_tolerance_pct: 0.6,

  regime_filter_enabled: true,
  signal_filter_enabled: true,
  signal_probability_threshold: 0.6,

  atr_period: 14,
  risk_per_trade_pct: 1,
  stop_loss_atr_multiplier: 1.5,
  take_profit_atr_multiplier: 2.5,

  poll_interval_seconds: 45,
  max_daily_trades: 8,
  cooldown_after_win_seconds: 1800,
  cooldown_after_loss_seconds: 7200,
  extended_hours: false,
  stop_guard_drawdown_pct: 3.5,
  max_daily_drawdown_pct: 5,
  max_weekly_drawdown_pct: 10,
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(value);
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeTickers(input: string): string[] {
  return input
    .split(/[\s,;]+/)
    .map((item) => item.trim().toUpperCase())
    .filter((item, idx, arr) => item.length > 0 && arr.indexOf(item) === idx);
}

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<TradingOverview | null>(null);
  const [error, setError] = useState<string>("");

  const [orderForm, setOrderForm] = useState<OrderFormState>({
    ticker: "",
    quantity: 1,
    orderType: "MARKET",
    limitPrice: 0,
    stopPrice: 0,
    timeValidity: "DAY",
    extendedHours: false,
    confirmLive: false,
  });
  const [orderMessage, setOrderMessage] = useState<string>("");
  const [orderError, setOrderError] = useState<string>("");
  const [orderLoading, setOrderLoading] = useState<boolean>(false);

  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [botConfigDraft, setBotConfigDraft] = useState<BotConfig>(DEFAULT_BOT_CONFIG);
  const [botTickersInput, setBotTickersInput] = useState<string>("");
  const [botMessage, setBotMessage] = useState<string>("");
  const [botError, setBotError] = useState<string>("");
  const [botLoading, setBotLoading] = useState<boolean>(false);

  const loadedRef = useRef(false);
  const botDraftHydratedRef = useRef(false);

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

  const refresh = async () => {
    setStatus("loading");

    try {
      const payload = await fetchOverview();
      setData(payload);
      setError("");
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unexpected error");
    }
  };

  const loadBotStatus = async () => {
    try {
      const payload = await fetchBotStatus();
      setBotStatus(payload);

      if (!botDraftHydratedRef.current) {
        setBotConfigDraft(payload.config);
        setBotTickersInput(payload.config.tickers.join(", "));
        botDraftHydratedRef.current = true;
      }
    } catch (err) {
      setBotError(err instanceof Error ? err.message : "Bot error");
    }
  };

  useEffect(() => {
    if (loadedRef.current) {
      return;
    }
    loadedRef.current = true;
    void refresh();
    void loadBotStatus();
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadBotStatus();
    }, 15000);

    return () => window.clearInterval(interval);
  }, []);

  const onSubmitOrder = async (event: React.FormEvent) => {
    event.preventDefault();
    setOrderLoading(true);
    setOrderError("");
    setOrderMessage("");

    const payload: PlaceOrderRequest = {
      ticker: orderForm.ticker.trim().toUpperCase(),
      quantity: Number(orderForm.quantity),
      order_type: orderForm.orderType,
      time_validity: orderForm.timeValidity,
      extended_hours: orderForm.extendedHours,
      confirm_live: orderForm.confirmLive,
    };

    if (orderForm.orderType === "LIMIT" || orderForm.orderType === "STOP_LIMIT") {
      payload.limit_price = Number(orderForm.limitPrice);
    }

    if (orderForm.orderType === "STOP" || orderForm.orderType === "STOP_LIMIT") {
      payload.stop_price = Number(orderForm.stopPrice);
    }

    try {
      const result = await placeOrder(payload);
      const orderId = String(result.order.id ?? "N/A");
      const side = String(result.order.side ?? "N/A");
      const statusLabel = String(result.order.status ?? "N/A");
      setOrderMessage(
        `${result.order_type} sent (${result.environment}) • id=${orderId} • side=${side} • status=${statusLabel}`
      );
      await refresh();
    } catch (err) {
      setOrderError(err instanceof Error ? err.message : "Order execution error");
    } finally {
      setOrderLoading(false);
    }
  };

  const onSaveBotConfig = async (event: React.FormEvent) => {
    event.preventDefault();
    setBotLoading(true);
    setBotError("");
    setBotMessage("");

    try {
      const payload: BotConfig = {
        ...botConfigDraft,
        tickers: normalizeTickers(botTickersInput),
      };
      const result = await updateBotConfig(payload);
      setBotStatus(result);
      setBotConfigDraft(result.config);
      setBotTickersInput(result.config.tickers.join(", "));
      setBotMessage("Bot configuration saved.");
    } catch (err) {
      setBotError(err instanceof Error ? err.message : "Bot configuration error");
    } finally {
      setBotLoading(false);
    }
  };

  const onRunBotCycle = async () => {
    setBotLoading(true);
    setBotError("");
    setBotMessage("");

    try {
      const result = await runBotOnce();
      setBotStatus(result);
      setBotMessage("Bot cycle executed.");
      await refresh();
    } catch (err) {
      setBotError(err instanceof Error ? err.message : "Bot cycle error");
    } finally {
      setBotLoading(false);
    }
  };

  return (
    <main className="page">
      <section className="panel">
        <header className="panel-header">
          <div>
            <p className="kicker">PyTrading212</p>
            <h1>Live Trading + Adaptive Bot Console</h1>
          </div>
          <button onClick={() => void refresh()} disabled={status === "loading"}>
            {status === "loading" ? "Loading..." : "Refresh"}
          </button>
        </header>

        <p className={`environment-pill ${data?.environment === "LIVE" ? "live" : "demo"}`}>
          Environment: {data?.environment ?? "..."}
        </p>

        {data?.warning && <p className="warning-banner">{data.warning}</p>}

        {status === "error" && (
          <div className="error-box">
            <p className="error-title">Trading 212 connection failed</p>
            <p className="error">{error}</p>
          </div>
        )}

        <p className="meta">
          {data?.fetchedAt ? `Last sync: ${new Date(data.fetchedAt).toLocaleString("fr-FR")}` : ""}
          {data?.cached ? " • cached snapshot" : ""}
        </p>

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
            <strong className={cash.result >= 0 ? "up" : "down"}>{formatMoney(cash.result)}</strong>
          </article>
          <article className="metric">
            <span>Unrealized PnL</span>
            <strong className={cash.ppl >= 0 ? "up" : "down"}>{formatMoney(cash.ppl)}</strong>
          </article>
          <article className="metric">
            <span>Blocked</span>
            <strong>{formatMoney(cash.blocked)}</strong>
          </article>
        </div>

        <article className="card">
          <h2>Advanced order execution</h2>
          <form className="form-grid" onSubmit={onSubmitOrder}>
            <label>
              Ticker
              <input
                type="text"
                value={orderForm.ticker}
                onChange={(event) => setOrderForm((prev) => ({ ...prev, ticker: event.target.value }))}
                placeholder="AAPL_US_EQ"
                required
              />
            </label>

            <label>
              Quantity (+ buy / - sell)
              <input
                type="number"
                step="0.0001"
                value={orderForm.quantity}
                onChange={(event) =>
                  setOrderForm((prev) => ({ ...prev, quantity: Number(event.target.value) }))
                }
                required
              />
            </label>

            <label>
              Order type
              <select
                value={orderForm.orderType}
                onChange={(event) =>
                  setOrderForm((prev) => ({ ...prev, orderType: event.target.value as OrderType }))
                }
              >
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
                <option value="STOP">STOP</option>
                <option value="STOP_LIMIT">STOP_LIMIT</option>
              </select>
            </label>

            <label>
              Time validity
              <select
                value={orderForm.timeValidity}
                onChange={(event) =>
                  setOrderForm((prev) => ({ ...prev, timeValidity: event.target.value as TimeValidity }))
                }
              >
                <option value="DAY">DAY</option>
                <option value="GOOD_TILL_CANCEL">GOOD_TILL_CANCEL</option>
              </select>
            </label>

            {(orderForm.orderType === "LIMIT" || orderForm.orderType === "STOP_LIMIT") && (
              <label>
                Limit price
                <input
                  type="number"
                  step="0.0001"
                  value={orderForm.limitPrice}
                  onChange={(event) =>
                    setOrderForm((prev) => ({ ...prev, limitPrice: Number(event.target.value) }))
                  }
                  required
                />
              </label>
            )}

            {(orderForm.orderType === "STOP" || orderForm.orderType === "STOP_LIMIT") && (
              <label>
                Stop price
                <input
                  type="number"
                  step="0.0001"
                  value={orderForm.stopPrice}
                  onChange={(event) =>
                    setOrderForm((prev) => ({ ...prev, stopPrice: Number(event.target.value) }))
                  }
                  required
                />
              </label>
            )}

            <label className="inline-check">
              <input
                type="checkbox"
                checked={orderForm.extendedHours}
                onChange={(event) =>
                  setOrderForm((prev) => ({ ...prev, extendedHours: event.target.checked }))
                }
              />
              Allow extended hours
            </label>

            <label className="inline-check">
              <input
                type="checkbox"
                checked={orderForm.confirmLive}
                onChange={(event) =>
                  setOrderForm((prev) => ({ ...prev, confirmLive: event.target.checked }))
                }
              />
              Confirm real LIVE execution
            </label>

            <button type="submit" disabled={orderLoading}>
              {orderLoading ? "Sending..." : "Place order"}
            </button>
          </form>

          {orderMessage && <p className="success-text">{orderMessage}</p>}
          {orderError && <p className="error">{orderError}</p>}
        </article>

        <article className="card">
          <h2>Bot architecture (Regime | Signal | Risk)</h2>
          <form className="form-grid" onSubmit={onSaveBotConfig}>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={botConfigDraft.enabled}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({ ...prev, enabled: event.target.checked }))
                }
              />
              Bot enabled
            </label>

            <label>
              Mode
              <select
                value={botConfigDraft.mode}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({ ...prev, mode: event.target.value as BotConfig["mode"] }))
                }
              >
                <option value="DRY_RUN">DRY_RUN</option>
                <option value="LIVE">LIVE</option>
              </select>
            </label>

            <label>
              Tickers
              <input
                type="text"
                value={botTickersInput}
                onChange={(event) => setBotTickersInput(event.target.value)}
                placeholder="AAPL_US_EQ, SPY_US_EQ"
              />
            </label>

            <label>
              Bot cash allocation (EUR)
              <input
                type="number"
                value={botConfigDraft.allocated_cash_amount}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({ ...prev, allocated_cash_amount: Number(event.target.value) }))
                }
              />
            </label>

            <label>
              Execution order type
              <select
                value={botConfigDraft.execution_order_type}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({
                    ...prev,
                    execution_order_type: event.target.value as BotConfig["execution_order_type"],
                  }))
                }
              >
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
                <option value="STOP">STOP</option>
                <option value="STOP_LIMIT">STOP_LIMIT</option>
              </select>
            </label>

            <label>
              Execution time validity
              <select
                value={botConfigDraft.execution_time_validity}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({
                    ...prev,
                    execution_time_validity: event.target.value as BotConfig["execution_time_validity"],
                  }))
                }
              >
                <option value="DAY">DAY</option>
                <option value="GOOD_TILL_CANCEL">GOOD_TILL_CANCEL</option>
              </select>
            </label>

            <label>
              Grid step %
              <input
                type="number"
                step="0.1"
                value={botConfigDraft.grid_step_pct}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({ ...prev, grid_step_pct: Number(event.target.value) }))
                }
              />
            </label>

            <label>
              Max grid depth
              <input
                type="number"
                value={botConfigDraft.max_grid_depth}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({ ...prev, max_grid_depth: Number(event.target.value) }))
                }
              />
            </label>

            <label>
              Signal probability threshold
              <input
                type="number"
                step="0.01"
                value={botConfigDraft.signal_probability_threshold}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({
                    ...prev,
                    signal_probability_threshold: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label>
              Risk per trade %
              <input
                type="number"
                step="0.1"
                value={botConfigDraft.risk_per_trade_pct}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({ ...prev, risk_per_trade_pct: Number(event.target.value) }))
                }
              />
            </label>

            <label>
              ATR stop loss multiplier
              <input
                type="number"
                step="0.1"
                value={botConfigDraft.stop_loss_atr_multiplier}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({
                    ...prev,
                    stop_loss_atr_multiplier: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label>
              ATR take profit multiplier
              <input
                type="number"
                step="0.1"
                value={botConfigDraft.take_profit_atr_multiplier}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({
                    ...prev,
                    take_profit_atr_multiplier: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label>
              Max daily drawdown %
              <input
                type="number"
                step="0.1"
                value={botConfigDraft.max_daily_drawdown_pct}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({
                    ...prev,
                    max_daily_drawdown_pct: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label>
              Max weekly drawdown %
              <input
                type="number"
                step="0.1"
                value={botConfigDraft.max_weekly_drawdown_pct}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({
                    ...prev,
                    max_weekly_drawdown_pct: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label className="inline-check">
              <input
                type="checkbox"
                checked={botConfigDraft.regime_filter_enabled}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({ ...prev, regime_filter_enabled: event.target.checked }))
                }
              />
              Enable regime filter
            </label>

            <label className="inline-check">
              <input
                type="checkbox"
                checked={botConfigDraft.signal_filter_enabled}
                onChange={(event) =>
                  setBotConfigDraft((prev) => ({ ...prev, signal_filter_enabled: event.target.checked }))
                }
              />
              Enable signal confidence filter
            </label>

            <div className="form-actions">
              <button type="submit" disabled={botLoading}>
                {botLoading ? "Saving..." : "Save bot config"}
              </button>
              <button type="button" disabled={botLoading} onClick={() => void onRunBotCycle()}>
                Run one cycle now
              </button>
            </div>
          </form>

          <div className="allocation-grid">
            <article className="metric">
              <span>Account free cash</span>
              <strong>{formatMoney(botStatus?.allocation.free_cash ?? 0)}</strong>
            </article>
            <article className="metric">
              <span>Bot allocated cash</span>
              <strong>{formatMoney(botStatus?.allocation.allocated_cash ?? 0)}</strong>
            </article>
            <article className="metric">
              <span>Capital currently in use</span>
              <strong>{formatMoney(botStatus?.allocation.allocated_in_use ?? 0)}</strong>
            </article>
            <article className="metric">
              <span>Remaining allocation</span>
              <strong>{formatMoney(botStatus?.allocation.allocated_remaining ?? 0)}</strong>
            </article>
          </div>

          <p className="meta">
            Bot running: {botStatus?.running ? "yes" : "no"} • Daily trades: {botStatus?.daily_trades ?? 0}
            {botStatus?.last_cycle_at
              ? ` • Last cycle: ${new Date(botStatus.last_cycle_at).toLocaleString("fr-FR")}`
              : ""}
          </p>

          {botStatus && Object.keys(botStatus.regime_by_ticker).length > 0 && (
            <p className="meta">
              Regimes: {Object.entries(botStatus.regime_by_ticker)
                .map(([ticker, regime]) => `${ticker}:${regime}`)
                .join(" | ")}
            </p>
          )}

          {botMessage && <p className="success-text">{botMessage}</p>}
          {botError && <p className="error">{botError}</p>}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Ticker</th>
                  <th>Regime</th>
                  <th>Action</th>
                  <th>Conf</th>
                  <th>Order</th>
                  <th>Price</th>
                  <th>Qty</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(botStatus?.recent_decisions ?? []).slice(0, 12).map((decision, index) => (
                  <tr key={`${decision.at}-${decision.ticker}-${index}`}>
                    <td>{new Date(decision.at).toLocaleTimeString("fr-FR")}</td>
                    <td>{decision.ticker}</td>
                    <td>{decision.regime ?? "-"}</td>
                    <td>{decision.action}</td>
                    <td>{decision.confidence ? decision.confidence.toFixed(2) : "-"}</td>
                    <td>{decision.order_type ?? "-"}</td>
                    <td>{decision.price ?? "-"}</td>
                    <td>{decision.quantity ?? "-"}</td>
                    <td>{decision.error ? `${decision.reason} (${decision.error})` : decision.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

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
                        <td className={pnl >= 0 ? "up" : "down"}>{String(walletImpact.unrealizedProfitLoss ?? "-")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}

export default App;
