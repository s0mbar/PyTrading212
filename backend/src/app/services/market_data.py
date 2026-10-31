"""Open market-data service with resilient caching and rate-limit fallback."""

import asyncio
import re
from datetime import UTC, datetime
from time import monotonic
from typing import Any
from urllib.parse import quote

import httpx


class MarketDataError(Exception):
    """Base market-data provider error."""


class MarketDataRateLimitError(MarketDataError):
    """Rate limit reached on external market-data provider."""


class MarketDataNotFoundError(MarketDataError):
    """Ticker not found on external provider."""


# cache_key -> (fresh_until_monotonic, fetched_at_monotonic, candles)
_history_cache: dict[str, tuple[float, float, list[dict[str, Any]]]] = {}


ALLOWED_INTERVALS = frozenset(
    {"1m", "2m", "5m", "15m", "30m", "60m", "90m", "1h", "1d", "1wk", "1mo"}
)
ALLOWED_RANGES = frozenset({"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"})

# Trading 212 marks European listings with a lowercase letter before "_EQ" (e.g. "SIGTl_EQ").
_EXCHANGE_LETTER_TO_YAHOO_SUFFIX = {"l": ".L", "d": ".DE", "p": ".PA"}
_EXCHANGE_LETTER_TICKER = re.compile(r"^([A-Z0-9.]+)([a-z])_EQ$")


def trading212_to_yahoo_symbol(ticker: str) -> str:
    raw = ticker.strip()
    match = _EXCHANGE_LETTER_TICKER.match(raw)
    if match and match.group(2) in _EXCHANGE_LETTER_TO_YAHOO_SUFFIX:
        return match.group(1) + _EXCHANGE_LETTER_TO_YAHOO_SUFFIX[match.group(2)]

    symbol = raw.upper()

    if symbol.endswith("_US_EQ"):
        return symbol.replace("_US_EQ", "")
    if symbol.endswith("_UK_EQ"):
        return symbol.replace("_UK_EQ", ".L")
    if symbol.endswith("_DE_EQ"):
        return symbol.replace("_DE_EQ", ".DE")

    if "_" in symbol:
        return symbol.split("_", maxsplit=1)[0]

    return symbol


def _cache_ttl_for_interval(interval: str) -> float:
    normalized = interval.strip().lower()
    if normalized in {"1m", "2m", "5m"}:
        return 90.0
    if normalized in {"15m", "30m"}:
        return 300.0
    if normalized in {"1h", "60m", "90m"}:
        return 1800.0
    if normalized in {"1d", "1wk", "1mo"}:
        return 21600.0
    return 900.0


def get_cached_history(
    *, ticker: str, interval: str = "1h", range_value: str = "3mo"
) -> list[dict[str, Any]] | None:
    symbol = trading212_to_yahoo_symbol(ticker)
    cache_key = f"{symbol}|{interval}|{range_value}"
    cached = _history_cache.get(cache_key)
    if cached is None:
        return None
    return cached[2]


async def fetch_history(
    *,
    ticker: str,
    interval: str = "1h",
    range_value: str = "3mo",
    allow_stale_on_error: bool = True,
) -> list[dict[str, Any]]:
    symbol = trading212_to_yahoo_symbol(ticker)
    cache_key = f"{symbol}|{interval}|{range_value}"
    now = monotonic()

    cached = _history_cache.get(cache_key)
    if cached is not None:
        fresh_until, _, candles = cached
        if now < fresh_until:
            return candles

    params = {
        "interval": interval,
        "range": range_value,
        "events": "history",
        "includePrePost": "false",
    }

    # Query both Yahoo hosts to reduce transient host-level throttling.
    encoded_symbol = quote(symbol, safe="")
    urls = [
        f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_symbol}",
        f"https://query2.finance.yahoo.com/v8/finance/chart/{encoded_symbol}",
    ]

    last_error: Exception | None = None

    async with httpx.AsyncClient(timeout=15.0) as client:
        for attempt, url in enumerate(urls, start=1):
            try:
                response = await client.get(url, params=params)

                if response.status_code == 429:
                    last_error = MarketDataRateLimitError(
                        f"Yahoo market data rate-limited ticker={symbol} "
                        f"interval={interval} range={range_value}"
                    )
                    await asyncio.sleep(min(0.2 * attempt, 0.5))
                    continue

                if response.status_code == 404:
                    raise MarketDataNotFoundError(f"Ticker not found on Yahoo chart API: {symbol}")

                response.raise_for_status()
                payload = response.json()
                candles = _parse_chart_payload(payload)

                if candles:
                    ttl = _cache_ttl_for_interval(interval)
                    _history_cache[cache_key] = (now + ttl, now, candles)
                    return candles

                last_error = MarketDataError(f"Empty candle payload for ticker={symbol}")
            except (httpx.HTTPError, MarketDataError) as exc:
                last_error = exc
                await asyncio.sleep(min(0.2 * attempt, 0.5))

    if cached is not None and allow_stale_on_error:
        return cached[2]

    if isinstance(last_error, Exception):
        raise last_error

    raise MarketDataError(f"Unable to fetch history for ticker={symbol}")


def _parse_chart_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    chart = payload.get("chart") or {}
    results = chart.get("result") or []
    if not results:
        return []

    first = results[0]
    timestamps = first.get("timestamp") or []

    indicators = first.get("indicators") or {}
    quote_array = indicators.get("quote") or []
    if not quote_array:
        return []

    quote = quote_array[0]
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    candles: list[dict[str, Any]] = []
    for idx, epoch in enumerate(timestamps):
        open_value = _safe_array_pick(opens, idx)
        high_value = _safe_array_pick(highs, idx)
        low_value = _safe_array_pick(lows, idx)
        close_value = _safe_array_pick(closes, idx)
        volume_value = _safe_array_pick(volumes, idx)

        if None in (open_value, high_value, low_value, close_value):
            continue

        candles.append(
            {
                "at": datetime.fromtimestamp(int(epoch), tz=UTC),
                "open": float(open_value),
                "high": float(high_value),
                "low": float(low_value),
                "close": float(close_value),
                "volume": float(volume_value or 0.0),
            }
        )

    return candles


def _safe_array_pick(values: list[Any], index: int) -> Any:
    if index < 0 or index >= len(values):
        return None
    return values[index]
