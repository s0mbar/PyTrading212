import { useEffect, useRef, useState } from "react";

import { fetchBotStatus, runBotOnce, updateBotConfig, type BotConfig, type BotStatus } from "../api/client";
import { errorMessage } from "../api/http";
import { formatMoney } from "../lib/format";

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

// Trading 212 tickers are case-sensitive (e.g. "SIGTl_EQ"): never upper-case them.
function normalizeTickers(input: string): string[] {
  return input
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter((item, idx, arr) => item.length > 0 && arr.indexOf(item) === idx);
}

type BotPanelProps = {
  onCycleDone: () => Promise<void>;
};

function BotPanel({ onCycleDone }: BotPanelProps) {
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [botConfigDraft, setBotConfigDraft] = useState<BotConfig>(DEFAULT_BOT_CONFIG);
  const [botTickersInput, setBotTickersInput] = useState<string>("");
  const [botMessage, setBotMessage] = useState<string>("");
  const [botError, setBotError] = useState<string>("");
  const [botLoading, setBotLoading] = useState<boolean>(false);

  const botDraftHydratedRef = useRef(false);

  useEffect(() => {
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
        setBotError(errorMessage(err, "Bot error"));
      }
    };

    void loadBotStatus();
    const interval = window.setInterval(() => void loadBotStatus(), 15000);
    return () => window.clearInterval(interval);
  }, []);

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
      setBotError(errorMessage(err, "Bot configuration error"));
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
      await onCycleDone();
    } catch (err) {
      setBotError(errorMessage(err, "Bot cycle error"));
    } finally {
      setBotLoading(false);
    }
  };

  return (
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
  );
}

export default BotPanel;
