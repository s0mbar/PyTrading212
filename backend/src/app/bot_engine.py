"""Algorithmic bot engine with 3-layer architecture.

Layers:
1) Market regime detection
2) Signal generation (rules + confidence filter)
3) Adaptive risk management
"""

import asyncio
import math
from collections import deque
from datetime import UTC, date, datetime
from statistics import mean
from time import monotonic
from typing import Any

from .config import settings
from .schemas import (
    BotAllocationStatus,
    BotConfig,
    BotDecision,
    BotMode,
    BotStatus,
    OrderType,
)
from .services.market_data import fetch_history
from .services.trading212 import Trading212Client, Trading212Error


class TradingBotEngine:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._config = BotConfig(poll_interval_seconds=settings.bot_default_poll_interval_seconds)
        self._running = False
        self._loop_task: asyncio.Task[None] | None = None

        self._grid_anchor: dict[str, float] = {}
        self._grid_level: dict[str, int] = {}
        self._protection_levels: dict[str, tuple[float, float]] = {}
        self._cooldown_until: dict[str, float] = {}

        self._decision_history: deque[BotDecision] = deque(maxlen=150)
        self._last_cycle_at: datetime | None = None
        self._regime_by_ticker: dict[str, str] = {}

        self._daily_counter_date = date.today()
        self._daily_trades = 0
        self._allocation = BotAllocationStatus()

        self._daily_anchor_total: float | None = None
        self._weekly_anchor_total: float | None = None
        self._week_anchor_id: tuple[int, int] | None = None

    async def start(self) -> None:
        async with self._lock:
            if self._loop_task is None:
                self._running = True
                self._loop_task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        async with self._lock:
            self._running = False
            if self._loop_task is not None:
                self._loop_task.cancel()
                try:
                    await self._loop_task
                except asyncio.CancelledError:
                    pass
                self._loop_task = None

    async def _run_loop(self) -> None:
        while self._running:
            try:
                if self._config.enabled:
                    await self.run_cycle()
            except Exception as exc:  # noqa: BLE001
                self._append_decision(
                    BotDecision(
                        at=datetime.now(UTC),
                        ticker="BOT",
                        action="ERROR",
                        reason="Cycle failure",
                        executed=False,
                        mode=self._config.mode,
                        error=str(exc),
                    )
                )
            await asyncio.sleep(self._config.poll_interval_seconds)

    async def update_config(self, config: BotConfig) -> BotConfig:
        if len(config.tickers) > settings.bot_max_tickers:
            raise ValueError(f"Too many tickers. Max allowed: {settings.bot_max_tickers}")

        async with self._lock:
            self._config = config

        for ticker in config.tickers:
            self._grid_level.setdefault(ticker, 0)

        return self._config

    def get_status(self) -> BotStatus:
        return BotStatus(
            running=self._running,
            config=self._config,
            last_cycle_at=self._last_cycle_at,
            daily_trades=self._daily_trades,
            allocation=self._allocation,
            regime_by_ticker=self._regime_by_ticker,
            recent_decisions=list(self._decision_history),
        )

    async def run_cycle(self) -> BotStatus:
        config = self._config
        self._rotate_daily_counter()

        if not config.tickers:
            self._append_decision(
                BotDecision(
                    at=datetime.now(UTC),
                    ticker="BOT",
                    action="SKIP",
                    reason="No ticker configured",
                    executed=False,
                    mode=config.mode,
                )
            )
            return self.get_status()

        async with Trading212Client() as client:
            try:
                cash = await client.fetch_account_cash()
                positions = await client.fetch_positions()
            except Trading212Error as exc:
                self._append_decision(
                    BotDecision(
                        at=datetime.now(UTC),
                        ticker="BOT",
                        action="ERROR",
                        reason="Unable to fetch account snapshot",
                        executed=False,
                        mode=config.mode,
                        error=str(exc),
                    )
                )
                return self.get_status()

            account_total = float(cash.get("total", 0.0) or 0.0)
            if self._is_global_drawdown_triggered(account_total):
                self._append_decision(
                    BotDecision(
                        at=datetime.now(UTC),
                        ticker="BOT",
                        action="HALT",
                        reason="Global drawdown guard triggered (day/week)",
                        executed=False,
                        mode=config.mode,
                    )
                )
                return self.get_status()

            free_cash = float(cash.get("free", 0.0) or 0.0)
            positions_by_ticker = {
                str((position.get("instrument") or {}).get("ticker", "")).upper(): position
                for position in positions
            }

            allocated_in_use = sum(
                _position_notional(positions_by_ticker.get(ticker)) for ticker in config.tickers
            )
            allocated_cash = min(config.allocated_cash_amount, free_cash + allocated_in_use)
            allocated_remaining = max(0.0, allocated_cash - allocated_in_use)

            self._allocation = BotAllocationStatus(
                free_cash=free_cash,
                allocated_cash=allocated_cash,
                allocated_in_use=allocated_in_use,
                allocated_remaining=allocated_remaining,
            )

            remaining_budget = allocated_remaining

            for ticker in config.tickers:
                decision, budget_delta = await self._process_ticker(
                    client,
                    ticker=ticker,
                    position=positions_by_ticker.get(ticker),
                    config=config,
                    remaining_budget=remaining_budget,
                )
                self._append_decision(decision)
                remaining_budget = max(0.0, remaining_budget + budget_delta)

            self._allocation.allocated_remaining = remaining_budget
            self._last_cycle_at = datetime.now(UTC)

        return self.get_status()

    async def _process_ticker(
        self,
        client: Trading212Client,
        *,
        ticker: str,
        position: dict[str, Any] | None,
        config: BotConfig,
        remaining_budget: float,
    ) -> tuple[BotDecision, float]:
        now = datetime.now(UTC)

        try:
            candles = await fetch_history(ticker=ticker, interval="1h", range_value="3mo")
        except Exception as exc:  # noqa: BLE001
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="ERROR",
                    reason="Market data fetch failed",
                    executed=False,
                    mode=config.mode,
                    error=str(exc),
                ),
                0.0,
            )

        if not candles:
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="SKIP",
                    reason="No historical data available",
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        closes = [float(candle["close"]) for candle in candles]
        highs = [float(candle["high"]) for candle in candles]
        lows = [float(candle["low"]) for candle in candles]

        needed = max(config.long_window + 2, config.rsi_period + 2, config.atr_period + 2)
        if len(closes) < needed:
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="HOLD",
                    reason="Insufficient historical warmup",
                    price=closes[-1],
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        price = closes[-1]
        quantity_owned = float((position or {}).get("quantity", 0.0) or 0.0)
        quantity_available = float(
            (position or {}).get("quantityAvailableForTrading", quantity_owned) or quantity_owned
        )

        short_now = mean(closes[-config.short_window :])
        long_now = mean(closes[-config.long_window :])
        rsi = _compute_rsi(closes, config.rsi_period)
        atr = _compute_atr(highs, lows, closes, config.atr_period)
        drawdown_pct = _drawdown_pct(position)

        regime, regime_confidence = _detect_regime(
            closes=closes,
            atr=atr,
            short_now=short_now,
            long_now=long_now,
        )
        self._regime_by_ticker[ticker] = regime

        if self._is_ticker_cooldown_active(ticker):
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="SKIP",
                    reason="Dynamic cooldown active",
                    regime=regime,
                    confidence=regime_confidence,
                    price=price,
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        if self._daily_trades >= config.max_daily_trades:
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="SKIP",
                    reason="Daily trade limit reached",
                    regime=regime,
                    confidence=regime_confidence,
                    price=price,
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        # Layer 1: regime gate
        if config.regime_filter_enabled and regime == "HIGH_VOLATILITY" and quantity_owned <= 0:
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="SKIP",
                    reason="Regime gate: high volatility, no new long entry",
                    regime=regime,
                    confidence=regime_confidence,
                    price=price,
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        # Layer 2: signal generation
        signal_action, signal_reason = self._build_signal(
            ticker=ticker,
            regime=regime,
            price=price,
            short_now=short_now,
            long_now=long_now,
            rsi=rsi,
            drawdown_pct=drawdown_pct,
            quantity_owned=quantity_owned,
            config=config,
        )

        if signal_action == "HOLD":
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="HOLD",
                    reason=signal_reason,
                    regime=regime,
                    confidence=regime_confidence,
                    price=price,
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        signal_probability = _signal_confidence(
            regime=regime,
            short_now=short_now,
            long_now=long_now,
            rsi=rsi,
            atr=atr,
            price=price,
            action=signal_action,
        )

        if config.signal_filter_enabled and signal_probability < config.signal_probability_threshold:
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="SKIP",
                    reason=f"Signal filter rejected ({signal_probability:.2f})",
                    regime=regime,
                    confidence=signal_probability,
                    price=price,
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        # Layer 3: risk management and sizing
        stop_loss, take_profit = _protective_levels(
            price=price,
            atr=atr,
            action=signal_action,
            stop_mult=config.stop_loss_atr_multiplier,
            tp_mult=config.take_profit_atr_multiplier,
        )

        quantity = _compute_dynamic_quantity(
            action=signal_action,
            price=price,
            atr=atr,
            risk_per_trade_pct=config.risk_per_trade_pct,
            allocated_cash_amount=config.allocated_cash_amount,
            max_order_quantity=config.max_order_quantity,
            remaining_budget=remaining_budget,
            quantity_available=quantity_available,
            stop_loss_mult=config.stop_loss_atr_multiplier,
        )

        if quantity <= 0:
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="SKIP",
                    reason="Risk layer: quantity computed to zero",
                    regime=regime,
                    confidence=signal_probability,
                    price=price,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        notional = quantity * price
        if notional < config.min_trade_notional:
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action="SKIP",
                    reason="Risk layer: minimum notional not reached",
                    regime=regime,
                    confidence=signal_probability,
                    price=price,
                    quantity=quantity if signal_action == "BUY" else -quantity,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    executed=False,
                    mode=config.mode,
                ),
                0.0,
            )

        budget_delta = -notional if signal_action == "BUY" else notional

        return await self._execute_or_simulate(
            client=client,
            now=now,
            ticker=ticker,
            action=signal_action,
            quantity=quantity,
            price=price,
            regime=regime,
            confidence=signal_probability,
            reason=signal_reason,
            stop_loss=stop_loss,
            take_profit=take_profit,
            mode=config.mode,
            config=config,
            budget_delta=budget_delta,
        )

    def _build_signal(
        self,
        *,
        ticker: str,
        regime: str,
        price: float,
        short_now: float,
        long_now: float,
        rsi: float,
        drawdown_pct: float,
        quantity_owned: float,
        config: BotConfig,
    ) -> tuple[str, str]:
        if quantity_owned > 0:
            levels = self._protection_levels.get(ticker)
            if levels is not None:
                stop_loss, take_profit = levels
                if price <= stop_loss:
                    return "SELL", "Protective stop-loss reached"
                if price >= take_profit:
                    return "SELL", "Take-profit reached"

        if quantity_owned > 0 and drawdown_pct <= -config.stop_guard_drawdown_pct:
            return "SELL", "Stop-guard drawdown triggered"

        # Trend/rules signal
        trend_buy = short_now > long_now and rsi < config.buy_rsi_max
        trend_sell = short_now < long_now and rsi > config.sell_rsi_min

        # Grid signal for ranging markets
        anchor = self._grid_anchor.setdefault(ticker, price)
        level = _grid_level(price, anchor, config.grid_step_pct)
        previous_level = self._grid_level.setdefault(ticker, 0)

        if abs(level) > config.max_grid_depth and config.reanchor_on_breakout:
            self._grid_anchor[ticker] = price
            self._grid_level[ticker] = 0
            return "HOLD", "Grid breakout re-anchored"

        if regime == "RANGE":
            if level < previous_level:
                self._grid_level[ticker] = previous_level - 1
                return "BUY", f"Grid pullback buy (L{previous_level}->{level})"
            if level > previous_level and quantity_owned > 0:
                self._grid_level[ticker] = previous_level + 1
                return "SELL", f"Grid rebound sell (L{previous_level}->{level})"
            return "HOLD", "Ranging regime but no grid step crossed"

        # TREND / HIGH_VOLATILITY fallback
        if trend_buy and quantity_owned <= 0:
            return "BUY", "Trend signal validated by SMA/RSI"
        if trend_sell and quantity_owned > 0:
            return "SELL", "Trend reversal signal validated by SMA/RSI"

        return "HOLD", "No actionable signal"

    async def _execute_or_simulate(
        self,
        *,
        client: Trading212Client,
        now: datetime,
        ticker: str,
        action: str,
        quantity: float,
        price: float,
        regime: str,
        confidence: float,
        reason: str,
        stop_loss: float,
        take_profit: float,
        mode: BotMode,
        config: BotConfig,
        budget_delta: float,
    ) -> tuple[BotDecision, float]:
        signed_quantity = quantity if action == "BUY" else -quantity

        order_type = config.execution_order_type
        limit_price: float | None = None
        stop_price: float | None = None

        if order_type == OrderType.limit:
            limit_price = _limit_price_for_action(price, action, config.limit_price_offset_pct)
        elif order_type == OrderType.stop:
            stop_price = _stop_price_for_action(price, action, config.stop_price_offset_pct)
        elif order_type == OrderType.stop_limit:
            stop_price = _stop_price_for_action(price, action, config.stop_price_offset_pct)
            limit_price = _limit_price_for_stop_limit(stop_price, action, config.limit_price_offset_pct)

        if mode == BotMode.dry_run:
            if action == "BUY":
                self._protection_levels[ticker] = (stop_loss, take_profit)
            self._set_cooldown(ticker=ticker, was_loss=False, config=config)
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action=action,
                    reason=f"{reason} | dry-run",
                    regime=regime,
                    confidence=confidence,
                    price=price,
                    quantity=signed_quantity,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    order_type=order_type,
                    executed=False,
                    mode=mode,
                ),
                budget_delta,
            )

        try:
            await client.place_order(
                order_type=order_type,
                ticker=ticker,
                quantity=signed_quantity,
                extended_hours=config.extended_hours,
                limit_price=limit_price,
                stop_price=stop_price,
                time_validity=config.execution_time_validity,
            )

            self._daily_trades += 1
            self._set_cooldown(ticker=ticker, was_loss=reason.lower().startswith("protective"), config=config)

            if action == "BUY":
                self._protection_levels[ticker] = (stop_loss, take_profit)
            elif action == "SELL":
                self._protection_levels.pop(ticker, None)

            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action=action,
                    reason=reason,
                    regime=regime,
                    confidence=confidence,
                    price=price,
                    quantity=signed_quantity,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    order_type=order_type,
                    executed=True,
                    mode=mode,
                ),
                budget_delta,
            )
        except Trading212Error as exc:
            return (
                BotDecision(
                    at=now,
                    ticker=ticker,
                    action=action,
                    reason=reason,
                    regime=regime,
                    confidence=confidence,
                    price=price,
                    quantity=signed_quantity,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    order_type=order_type,
                    executed=False,
                    mode=mode,
                    error=str(exc),
                ),
                0.0,
            )

    def _set_cooldown(self, *, ticker: str, was_loss: bool, config: BotConfig) -> None:
        delay = config.cooldown_after_loss_seconds if was_loss else config.cooldown_after_win_seconds
        self._cooldown_until[ticker] = monotonic() + max(delay, 0)

    def _is_ticker_cooldown_active(self, ticker: str) -> bool:
        expires_at = self._cooldown_until.get(ticker)
        if expires_at is None:
            return False
        return monotonic() < expires_at

    def _rotate_daily_counter(self) -> None:
        current_date = date.today()
        if current_date != self._daily_counter_date:
            self._daily_counter_date = current_date
            self._daily_trades = 0
            self._daily_anchor_total = None

    def _is_global_drawdown_triggered(self, account_total: float) -> bool:
        if account_total <= 0:
            return False

        today = date.today()
        iso_year, iso_week, _ = today.isocalendar()
        current_week_id = (iso_year, iso_week)

        if self._daily_anchor_total is None:
            self._daily_anchor_total = account_total
        if self._weekly_anchor_total is None or self._week_anchor_id != current_week_id:
            self._weekly_anchor_total = account_total
            self._week_anchor_id = current_week_id

        if self._daily_anchor_total <= 0 or self._weekly_anchor_total <= 0:
            return False

        daily_dd = ((account_total - self._daily_anchor_total) / self._daily_anchor_total) * 100.0
        weekly_dd = ((account_total - self._weekly_anchor_total) / self._weekly_anchor_total) * 100.0

        return (
            daily_dd <= -self._config.max_daily_drawdown_pct
            or weekly_dd <= -self._config.max_weekly_drawdown_pct
        )

    def _append_decision(self, decision: BotDecision) -> None:
        self._decision_history.appendleft(decision)


def _compute_rsi(prices: list[float], period: int) -> float:
    deltas = [prices[idx] - prices[idx - 1] for idx in range(1, len(prices))]
    recent = deltas[-period:]
    gains = [delta for delta in recent if delta > 0]
    losses = [-delta for delta in recent if delta < 0]

    avg_gain = mean(gains) if gains else 0.0
    avg_loss = mean(losses) if losses else 0.0

    if avg_loss == 0:
        return 100.0
    if avg_gain == 0:
        return 0.0

    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _compute_atr(highs: list[float], lows: list[float], closes: list[float], period: int) -> float:
    if len(closes) < period + 1:
        return max(0.01, closes[-1] * 0.003)

    trs: list[float] = []
    for idx in range(1, len(closes)):
        high = highs[idx]
        low = lows[idx]
        prev_close = closes[idx - 1]
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)

    recent = trs[-period:]
    return max(mean(recent), closes[-1] * 0.001)


def _detect_regime(*, closes: list[float], atr: float, short_now: float, long_now: float) -> tuple[str, float]:
    price = closes[-1]
    slope_pct = ((short_now - long_now) / long_now) * 100.0 if long_now else 0.0
    atr_pct = (atr / price) * 100.0 if price else 0.0

    if atr_pct >= 2.5:
        confidence = min(0.99, 0.6 + (atr_pct - 2.5) * 0.08)
        return "HIGH_VOLATILITY", confidence

    if abs(slope_pct) <= 0.35:
        confidence = min(0.99, 0.55 + (0.35 - abs(slope_pct)) * 0.8)
        return "RANGE", confidence

    confidence = min(0.99, 0.55 + abs(slope_pct) * 0.2)
    return "TREND", confidence


def _signal_confidence(
    *,
    regime: str,
    short_now: float,
    long_now: float,
    rsi: float,
    atr: float,
    price: float,
    action: str,
) -> float:
    slope_strength = abs(short_now - long_now) / long_now if long_now else 0.0
    volatility = atr / price if price else 0.0

    if action == "BUY":
        rsi_score = max(0.0, 1.0 - abs(rsi - 45.0) / 55.0)
    else:
        rsi_score = max(0.0, 1.0 - abs(rsi - 55.0) / 55.0)

    regime_bonus = {"TREND": 0.12, "RANGE": 0.08, "HIGH_VOLATILITY": -0.08}.get(regime, 0.0)

    score = 0.48 + slope_strength * 2.1 + rsi_score * 0.16 - volatility * 1.1 + regime_bonus
    return max(0.0, min(0.99, score))


def _compute_dynamic_quantity(
    *,
    action: str,
    price: float,
    atr: float,
    risk_per_trade_pct: float,
    allocated_cash_amount: float,
    max_order_quantity: float,
    remaining_budget: float,
    quantity_available: float,
    stop_loss_mult: float,
) -> float:
    if price <= 0:
        return 0.0

    risk_budget = allocated_cash_amount * (risk_per_trade_pct / 100.0)
    stop_distance = max(atr * stop_loss_mult, price * 0.002)
    raw_qty = risk_budget / stop_distance if stop_distance > 0 else 0.0

    qty = min(raw_qty, max_order_quantity)

    if action == "BUY":
        affordable = remaining_budget / price
        qty = min(qty, affordable)
    else:
        qty = min(qty, abs(quantity_available))

    return max(0.0, qty)


def _protective_levels(
    *,
    price: float,
    atr: float,
    action: str,
    stop_mult: float,
    tp_mult: float,
) -> tuple[float, float]:
    if action == "BUY":
        return (max(0.0, price - stop_mult * atr), price + tp_mult * atr)
    return (price + stop_mult * atr, max(0.0, price - tp_mult * atr))


def _grid_level(price: float, anchor: float, step_pct: float) -> int:
    if anchor <= 0 or step_pct <= 0:
        return 0
    deviation = ((price - anchor) / anchor) * 100.0
    if deviation >= 0:
        return math.floor(deviation / step_pct)
    return -math.floor(abs(deviation) / step_pct)


def _limit_price_for_action(price: float, action: str, offset_pct: float) -> float:
    if action == "BUY":
        return max(0.0001, price * (1.0 - offset_pct / 100.0))
    return max(0.0001, price * (1.0 + offset_pct / 100.0))


def _stop_price_for_action(price: float, action: str, offset_pct: float) -> float:
    if action == "BUY":
        return max(0.0001, price * (1.0 + offset_pct / 100.0))
    return max(0.0001, price * (1.0 - offset_pct / 100.0))


def _limit_price_for_stop_limit(stop_price: float, action: str, offset_pct: float) -> float:
    half = max(0.01, offset_pct / 2.0)
    if action == "BUY":
        return max(0.0001, stop_price * (1.0 + half / 100.0))
    return max(0.0001, stop_price * (1.0 - half / 100.0))


def _drawdown_pct(position: dict[str, Any] | None) -> float:
    if not position:
        return 0.0
    wallet_impact = position.get("walletImpact") or {}
    unrealized = float(wallet_impact.get("unrealizedProfitLoss", 0.0) or 0.0)
    total_cost = float(wallet_impact.get("totalCost", 0.0) or 0.0)
    if total_cost <= 0:
        return 0.0
    return (unrealized / total_cost) * 100.0


def _position_notional(position: dict[str, Any] | None) -> float:
    if not position:
        return 0.0

    quantity = float(position.get("quantity", 0.0) or 0.0)
    average_price = float(position.get("averagePricePaid", 0.0) or 0.0)
    current_price = float(position.get("currentPrice", average_price) or average_price)

    if quantity <= 0:
        return 0.0
    return quantity * (current_price if current_price > 0 else average_price)

