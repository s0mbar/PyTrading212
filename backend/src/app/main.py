"""Main FastAPI application."""

from datetime import UTC, datetime
from time import monotonic
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .bot_engine import TradingBotEngine
from .config import settings
from .schemas import (
    BotConfig,
    BotStatus,
    Candle,
    HealthResponse,
    MarketHistoryResponse,
    OrderExecutionResponse,
    OrderType,
    PlaceOrderRequest,
)
from .services.market_data import fetch_history
from .services.trading212 import Trading212Client, Trading212Error

app = FastAPI(title="PyTrading212 API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OVERVIEW_CACHE_TTL_SECONDS = 12.0
_overview_cache_data: dict[str, Any] | None = None
_overview_cache_until: float = 0.0

bot_engine = TradingBotEngine()


def _error_status(exc: Trading212Error) -> int:
    if exc.status_code in {400, 401, 403, 404, 409, 422, 429}:
        return int(exc.status_code)
    return 502


def _is_live_environment() -> bool:
    return "live.trading212.com" in settings.trading212_base_url.lower()


@app.on_event("startup")
async def startup() -> None:
    await bot_engine.start()


@app.on_event("shutdown")
async def shutdown() -> None:
    await bot_engine.stop()


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.get("/api/trading212/account")
async def get_account() -> dict:
    async with Trading212Client() as client:
        try:
            return await client.fetch_account_cash()
        except Trading212Error as exc:
            raise HTTPException(status_code=_error_status(exc), detail=str(exc)) from exc


@app.get("/api/trading212/positions")
async def get_positions() -> list[dict[str, Any]]:
    async with Trading212Client() as client:
        try:
            return await client.fetch_positions()
        except Trading212Error as exc:
            raise HTTPException(status_code=_error_status(exc), detail=str(exc)) from exc


@app.get("/api/trading212/orders/pending")
async def get_pending_orders() -> list[dict[str, Any]]:
    async with Trading212Client() as client:
        try:
            return await client.fetch_pending_orders()
        except Trading212Error as exc:
            raise HTTPException(status_code=_error_status(exc), detail=str(exc)) from exc


@app.get("/api/trading212/overview")
async def get_overview() -> dict:
    global _overview_cache_data
    global _overview_cache_until

    now = monotonic()
    if _overview_cache_data is not None and now < _overview_cache_until:
        return {**_overview_cache_data, "cached": True}

    async with Trading212Client() as client:
        try:
            cash = await client.fetch_account_cash()
            positions = await client.fetch_positions()
            payload = {
                "cash": cash,
                "portfolio": {"data": positions},
                "fetchedAt": datetime.now(UTC).isoformat(),
                "cached": False,
                "environment": "LIVE" if _is_live_environment() else "DEMO",
            }
            _overview_cache_data = payload
            _overview_cache_until = now + OVERVIEW_CACHE_TTL_SECONDS
            return payload
        except Trading212Error as exc:
            if exc.status_code == 429 and _overview_cache_data is not None:
                return {
                    **_overview_cache_data,
                    "cached": True,
                    "warning": "Trading 212 rate limit reached, serving latest cached snapshot.",
                }
            raise HTTPException(status_code=_error_status(exc), detail=str(exc)) from exc


@app.post("/api/trading212/orders", response_model=OrderExecutionResponse)
async def place_order(request: PlaceOrderRequest) -> OrderExecutionResponse:
    quantity = float(request.quantity)

    if quantity == 0:
        raise HTTPException(status_code=400, detail="quantity cannot be zero")

    if abs(quantity) < settings.min_order_quantity:
        raise HTTPException(
            status_code=400,
            detail=f"quantity too small (min absolute quantity: {settings.min_order_quantity})",
        )

    if abs(quantity) > settings.max_order_quantity:
        raise HTTPException(
            status_code=400,
            detail=f"quantity too large (max absolute quantity: {settings.max_order_quantity})",
        )

    if _is_live_environment() and not request.confirm_live:
        raise HTTPException(status_code=400, detail="Live execution requires confirm_live=true")

    async with Trading212Client() as client:
        try:
            order = await client.place_order(
                order_type=request.order_type,
                ticker=request.ticker,
                quantity=quantity,
                extended_hours=request.extended_hours,
                limit_price=request.limit_price,
                stop_price=request.stop_price,
                time_validity=request.time_validity,
            )
        except Trading212Error as exc:
            raise HTTPException(status_code=_error_status(exc), detail=str(exc)) from exc

    return OrderExecutionResponse(
        environment="LIVE" if _is_live_environment() else "DEMO",
        executed_at=datetime.now(UTC),
        order_type=request.order_type,
        order=order,
    )


@app.post("/api/trading212/orders/market", response_model=OrderExecutionResponse)
async def place_market_order_compat(request: PlaceOrderRequest) -> OrderExecutionResponse:
    market_request = request.model_copy(update={"order_type": OrderType.market})
    return await place_order(market_request)


@app.get("/api/market/history", response_model=MarketHistoryResponse)
async def get_market_history(
    ticker: str = Query(min_length=1),
    interval: str = Query(default="1h"),
    range_value: str = Query(default="3mo", alias="range"),
) -> MarketHistoryResponse:
    try:
        candles = await fetch_history(ticker=ticker, interval=interval, range_value=range_value)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Market data provider error: {exc}") from exc

    return MarketHistoryResponse(
        ticker=ticker.upper(),
        provider="YAHOO_CHART",
        interval=interval,
        range=range_value,
        candles=[Candle(**candle) for candle in candles],
    )


@app.get("/api/trading212/bot/status", response_model=BotStatus)
async def get_bot_status() -> BotStatus:
    return bot_engine.get_status()


@app.put("/api/trading212/bot/config", response_model=BotStatus)
async def update_bot_config(config: BotConfig) -> BotStatus:
    try:
        await bot_engine.update_config(config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return bot_engine.get_status()


@app.post("/api/trading212/bot/run", response_model=BotStatus)
async def run_bot_once() -> BotStatus:
    return await bot_engine.run_cycle()
