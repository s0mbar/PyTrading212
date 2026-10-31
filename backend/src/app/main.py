"""Main FastAPI application."""

import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from time import monotonic
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .bot_engine import TradingBotEngine
from .config import settings
from .errors import trading212_http_error
from .routers import tax
from .schemas import (
    TICKER_PATTERN,
    BotConfig,
    BotStatus,
    Candle,
    HealthResponse,
    MarketHistoryResponse,
    OrderExecutionResponse,
    OrderType,
    PlaceOrderRequest,
)
from .security import is_auth_enabled, require_access_token
from .services.market_data import ALLOWED_INTERVALS, ALLOWED_RANGES, fetch_history
from .services.trading212 import Trading212Client, Trading212Error

logger = logging.getLogger("pytrading212")

OVERVIEW_CACHE_TTL_SECONDS = 12.0
_overview_cache_data: dict[str, Any] | None = None
_overview_cache_until: float = 0.0

bot_engine = TradingBotEngine()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if not is_auth_enabled():
        logger.warning(
            "APP_ACCESS_TOKEN is empty: the API (orders included) is reachable without "
            "authentication. Keep it bound to localhost or set a token in .env."
        )
    await bot_engine.start()
    yield
    await bot_engine.stop()


app = FastAPI(title="PyTrading212 API", version="0.4.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Never echo the submitted input back (CSV files, NaN values that break JSON encoding)."""
    errors = [
        {
            "loc": list(error.get("loc", ())),
            "msg": error.get("msg", ""),
            "type": error.get("type", ""),
        }
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": errors})


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(status="ok", auth_required=is_auth_enabled())


protected = APIRouter(dependencies=[Depends(require_access_token)])


@protected.get("/api/trading212/account")
async def get_account() -> dict[str, Any]:
    async with Trading212Client() as client:
        try:
            return await client.fetch_account_summary()
        except Trading212Error as exc:
            raise trading212_http_error(exc) from exc


@protected.get("/api/trading212/positions")
async def get_positions() -> list[dict[str, Any]]:
    async with Trading212Client() as client:
        try:
            return await client.fetch_positions()
        except Trading212Error as exc:
            raise trading212_http_error(exc) from exc


@protected.get("/api/trading212/orders/pending")
async def get_pending_orders() -> list[dict[str, Any]]:
    async with Trading212Client() as client:
        try:
            return await client.fetch_pending_orders()
        except Trading212Error as exc:
            raise trading212_http_error(exc) from exc


@protected.get("/api/trading212/overview")
async def get_overview() -> dict[str, Any]:
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
                "environment": settings.environment_label,
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
            raise trading212_http_error(exc) from exc


@protected.post("/api/trading212/orders", response_model=OrderExecutionResponse)
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

    if settings.is_live and not request.confirm_live:
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
            raise trading212_http_error(exc) from exc

    logger.info(
        "Order sent env=%s type=%s ticker=%s quantity=%s",
        settings.environment_label,
        request.order_type.value,
        request.ticker,
        quantity,
    )
    return OrderExecutionResponse(
        environment=settings.environment_label,
        executed_at=datetime.now(UTC),
        order_type=request.order_type,
        order=order,
    )


@protected.post("/api/trading212/orders/market", response_model=OrderExecutionResponse)
async def place_market_order_compat(request: PlaceOrderRequest) -> OrderExecutionResponse:
    market_request = request.model_copy(update={"order_type": OrderType.market})
    return await place_order(market_request)


@protected.get("/api/market/history", response_model=MarketHistoryResponse)
async def get_market_history(
    ticker: str = Query(min_length=1, max_length=40, pattern=TICKER_PATTERN),
    interval: str = Query(default="1h"),
    range_value: str = Query(default="3mo", alias="range"),
) -> MarketHistoryResponse:
    if interval not in ALLOWED_INTERVALS or range_value not in ALLOWED_RANGES:
        raise HTTPException(status_code=422, detail="Unsupported interval or range")
    try:
        candles = await fetch_history(ticker=ticker, interval=interval, range_value=range_value)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Market data provider error: {exc}") from exc

    return MarketHistoryResponse(
        ticker=ticker,
        provider="YAHOO_CHART",
        interval=interval,
        range=range_value,
        candles=[Candle(**candle) for candle in candles],
    )


@protected.get("/api/trading212/bot/status", response_model=BotStatus)
async def get_bot_status() -> BotStatus:
    return bot_engine.get_status()


@protected.put("/api/trading212/bot/config", response_model=BotStatus)
async def update_bot_config(config: BotConfig) -> BotStatus:
    try:
        await bot_engine.update_config(config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return bot_engine.get_status()


@protected.post("/api/trading212/bot/run", response_model=BotStatus)
async def run_bot_once() -> BotStatus:
    return await bot_engine.run_cycle()


app.include_router(protected)
app.include_router(tax.router)
