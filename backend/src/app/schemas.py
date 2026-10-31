"""Schemas API and bot."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, Field, field_validator, model_validator

# Trading 212 tickers are case-sensitive: European listings use a lowercase exchange letter
# (e.g. "SIGTl_EQ" for London), so they must never be upper-cased.
TICKER_PATTERN = r"^[A-Za-z0-9._-]+$"

Ticker = Annotated[str, Field(min_length=1, max_length=40, pattern=TICKER_PATTERN)]
FinitePositive = Annotated[float, Field(gt=0, allow_inf_nan=False)]


class HealthResponse(BaseModel):
    status: str
    auth_required: bool


class BotMode(StrEnum):
    dry_run = "DRY_RUN"
    live = "LIVE"


class OrderType(StrEnum):
    market = "MARKET"
    limit = "LIMIT"
    stop = "STOP"
    stop_limit = "STOP_LIMIT"


class TimeValidity(StrEnum):
    day = "DAY"
    good_till_cancel = "GOOD_TILL_CANCEL"


class PlaceOrderRequest(BaseModel):
    ticker: Ticker
    quantity: float = Field(allow_inf_nan=False)
    order_type: OrderType = OrderType.market
    limit_price: FinitePositive | None = None
    stop_price: FinitePositive | None = None
    time_validity: TimeValidity = TimeValidity.day
    extended_hours: bool = False
    confirm_live: bool = False
    note: str | None = Field(default=None, max_length=120)

    @field_validator("ticker", mode="before")
    @classmethod
    def strip_ticker(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_by_order_type(self) -> "PlaceOrderRequest":
        if self.order_type == OrderType.market:
            return self

        if self.order_type == OrderType.limit and self.limit_price is None:
            raise ValueError("limit_price is required for LIMIT orders")

        if self.order_type == OrderType.stop and self.stop_price is None:
            raise ValueError("stop_price is required for STOP orders")

        if self.order_type == OrderType.stop_limit and (
            self.stop_price is None or self.limit_price is None
        ):
            raise ValueError("stop_price and limit_price are required for STOP_LIMIT orders")

        return self


class BotConfig(BaseModel):
    enabled: bool = False
    mode: BotMode = BotMode.dry_run
    tickers: list[Ticker] = Field(default_factory=list)

    allocated_cash_amount: float = Field(default=500.0, ge=20.0, le=1_000_000.0)
    min_trade_notional: float = Field(default=20.0, ge=5.0, le=100000.0)
    max_order_quantity: float = Field(default=3.0, ge=0.0001, le=10000.0)

    grid_step_pct: float = Field(default=1.2, ge=0.2, le=20.0)
    max_grid_depth: int = Field(default=5, ge=1, le=30)
    reanchor_on_breakout: bool = True

    execution_order_type: OrderType = OrderType.limit
    execution_time_validity: TimeValidity = TimeValidity.day
    limit_price_offset_pct: float = Field(default=0.15, ge=0.01, le=5.0)
    stop_price_offset_pct: float = Field(default=0.25, ge=0.01, le=5.0)

    short_window: int = Field(default=20, ge=2, le=120)
    long_window: int = Field(default=50, ge=3, le=240)
    rsi_period: int = Field(default=14, ge=5, le=100)
    buy_rsi_max: float = Field(default=65.0, ge=1.0, le=99.0)
    sell_rsi_min: float = Field(default=35.0, ge=1.0, le=99.0)
    trend_tolerance_pct: float = Field(default=0.6, ge=0.0, le=10.0)

    regime_filter_enabled: bool = True
    signal_filter_enabled: bool = True
    signal_probability_threshold: float = Field(default=0.6, ge=0.5, le=0.99)

    atr_period: int = Field(default=14, ge=5, le=120)
    risk_per_trade_pct: float = Field(default=1.0, ge=0.1, le=5.0)
    stop_loss_atr_multiplier: float = Field(default=1.5, ge=0.5, le=8.0)
    take_profit_atr_multiplier: float = Field(default=2.5, ge=0.5, le=15.0)

    poll_interval_seconds: int = Field(default=45, ge=10, le=1800)
    max_daily_trades: int = Field(default=8, ge=1, le=100)
    cooldown_after_win_seconds: int = Field(default=1800, ge=0, le=86400)
    cooldown_after_loss_seconds: int = Field(default=7200, ge=0, le=172800)
    extended_hours: bool = False
    stop_guard_drawdown_pct: float = Field(default=3.5, ge=0.2, le=30.0)
    max_daily_drawdown_pct: float = Field(default=5.0, ge=0.5, le=30.0)
    max_weekly_drawdown_pct: float = Field(default=10.0, ge=1.0, le=50.0)

    @field_validator("tickers", mode="before")
    @classmethod
    def normalize_tickers(cls, tickers: object) -> object:
        if not isinstance(tickers, list):
            return tickers
        normalized: list[object] = []
        for ticker in tickers:
            item = ticker.strip() if isinstance(ticker, str) else ticker
            if item and item not in normalized:
                normalized.append(item)
        return normalized

    @model_validator(mode="after")
    def check_strategy_consistency(self) -> "BotConfig":
        if self.long_window <= self.short_window:
            raise ValueError("long_window must be greater than short_window")
        if self.sell_rsi_min >= self.buy_rsi_max:
            raise ValueError("sell_rsi_min must be lower than buy_rsi_max")
        if self.max_weekly_drawdown_pct < self.max_daily_drawdown_pct:
            raise ValueError("max_weekly_drawdown_pct must be >= max_daily_drawdown_pct")
        return self


class BotDecision(BaseModel):
    at: datetime
    ticker: str
    action: str
    reason: str
    regime: str | None = None
    confidence: float | None = None
    price: float | None = None
    quantity: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    order_type: OrderType | None = None
    executed: bool = False
    mode: BotMode
    error: str | None = None


class BotAllocationStatus(BaseModel):
    free_cash: float = 0.0
    allocated_cash: float = 0.0
    allocated_in_use: float = 0.0
    allocated_remaining: float = 0.0


class BotStatus(BaseModel):
    running: bool
    config: BotConfig
    last_cycle_at: datetime | None = None
    daily_trades: int = 0
    allocation: BotAllocationStatus = Field(default_factory=BotAllocationStatus)
    regime_by_ticker: dict[str, str] = Field(default_factory=dict)
    recent_decisions: list[BotDecision] = Field(default_factory=list)


class OrderExecutionResponse(BaseModel):
    environment: str
    executed_at: datetime
    order_type: OrderType
    order: dict


class Candle(BaseModel):
    at: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


class MarketHistoryResponse(BaseModel):
    ticker: str
    provider: str
    interval: str
    range: str
    candles: list[Candle]
