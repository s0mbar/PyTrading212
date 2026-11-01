import { requestJson, type RequestOptions } from "./http";

const API_BASE = "/api/trading212";

export type BotMode = "DRY_RUN" | "LIVE";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
export type TimeValidity = "DAY" | "GOOD_TILL_CANCEL";

export type Position = {
  instrument?: { ticker?: string; name?: string; isin?: string; currency?: string };
  quantity?: number;
  quantityAvailableForTrading?: number;
  currentPrice?: number;
  averagePricePaid?: number;
  walletImpact?: { currency?: string; totalCost?: number; currentValue?: number; unrealizedProfitLoss?: number };
};

export type TradingOverview = {
  cash: Record<string, unknown>;
  portfolio: { data?: Position[] };
  fetchedAt?: string;
  cached?: boolean;
  warning?: string;
  environment?: "LIVE" | "DEMO";
};

export type PlaceOrderRequest = {
  ticker: string;
  quantity: number;
  order_type: OrderType;
  limit_price?: number;
  stop_price?: number;
  time_validity: TimeValidity;
  extended_hours: boolean;
  confirm_live: boolean;
  note?: string;
};

export type OrderExecutionResponse = {
  environment: string;
  executed_at: string;
  order_type: OrderType;
  order: Record<string, unknown>;
};

export type BotConfig = {
  enabled: boolean;
  mode: BotMode;
  tickers: string[];

  allocated_cash_amount: number;
  min_trade_notional: number;
  max_order_quantity: number;

  grid_step_pct: number;
  max_grid_depth: number;
  reanchor_on_breakout: boolean;

  execution_order_type: OrderType;
  execution_time_validity: TimeValidity;
  limit_price_offset_pct: number;
  stop_price_offset_pct: number;

  short_window: number;
  long_window: number;
  rsi_period: number;
  buy_rsi_max: number;
  sell_rsi_min: number;
  trend_tolerance_pct: number;

  regime_filter_enabled: boolean;
  signal_filter_enabled: boolean;
  signal_probability_threshold: number;

  atr_period: number;
  risk_per_trade_pct: number;
  stop_loss_atr_multiplier: number;
  take_profit_atr_multiplier: number;

  poll_interval_seconds: number;
  max_daily_trades: number;
  cooldown_after_win_seconds: number;
  cooldown_after_loss_seconds: number;
  extended_hours: boolean;
  stop_guard_drawdown_pct: number;
  max_daily_drawdown_pct: number;
  max_weekly_drawdown_pct: number;
};

export type BotDecision = {
  at: string;
  ticker: string;
  action: string;
  reason: string;
  regime?: string;
  confidence?: number;
  price?: number;
  quantity?: number;
  stop_loss?: number;
  take_profit?: number;
  order_type?: OrderType;
  executed: boolean;
  mode: BotMode;
  error?: string;
};

export type BotAllocation = {
  free_cash: number;
  allocated_cash: number;
  allocated_in_use: number;
  allocated_remaining: number;
};

export type BotStatus = {
  running: boolean;
  config: BotConfig;
  last_cycle_at?: string;
  daily_trades: number;
  allocation: BotAllocation;
  regime_by_ticker: Record<string, string>;
  recent_decisions: BotDecision[];
};

export type HealthStatus = {
  status: string;
  auth_required: boolean;
};

export async function fetchHealth(): Promise<HealthStatus> {
  return requestJson<HealthStatus>("/api/health", {}, { silent: true, timeoutMs: 10_000 });
}

export async function fetchOverview(options?: RequestOptions): Promise<TradingOverview> {
  return requestJson<TradingOverview>(`${API_BASE}/overview`, {}, options);
}

export async function placeOrder(payload: PlaceOrderRequest): Promise<OrderExecutionResponse> {
  return requestJson<OrderExecutionResponse>(`${API_BASE}/orders`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchBotStatus(options?: RequestOptions): Promise<BotStatus> {
  return requestJson<BotStatus>(`${API_BASE}/bot/status`, {}, options);
}

export async function updateBotConfig(config: BotConfig): Promise<BotStatus> {
  return requestJson<BotStatus>(`${API_BASE}/bot/config`, {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export async function runBotOnce(): Promise<BotStatus> {
  return requestJson<BotStatus>(`${API_BASE}/bot/run`, { method: "POST" }, { timeoutMs: 120_000 });
}
