"""Trading 212 HTTP client."""

import base64
from collections.abc import Iterable
from typing import Any

import httpx

from ..config import settings
from ..schemas import OrderType, TimeValidity


class Trading212Error(Exception):
    """Trading 212 domain error."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def _normalize_base_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.endswith("/api/v0"):
        normalized = normalized[: -len("/api/v0")]
    return normalized


class Trading212Client:
    def __init__(self) -> None:
        self._primary_base_url = _normalize_base_url(settings.trading212_base_url)
        self._http_client = httpx.AsyncClient(timeout=20.0)

    async def __aenter__(self) -> "Trading212Client":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self._http_client.aclose()

    @property
    def _auth_header(self) -> dict[str, str]:
        token = f"{settings.api_key_id}:{settings.secret_key}"
        encoded = base64.b64encode(token.encode("utf-8")).decode("utf-8")
        return {"Authorization": f"Basic {encoded}"}

    def _candidate_base_urls(self) -> Iterable[str]:
        demo_url = "https://demo.trading212.com"
        live_url = "https://live.trading212.com"

        primary = self._primary_base_url
        if primary == demo_url:
            return (demo_url, live_url)
        if primary == live_url:
            return (live_url, demo_url)
        return (primary,)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        last_error: Trading212Error | None = None

        for base_url in self._candidate_base_urls():
            url = f"{base_url}{path}"
            try:
                response = await self._http_client.request(
                    method,
                    url,
                    headers=self._auth_header,
                    params=params,
                    json=payload,
                )
                response.raise_for_status()
                if response.status_code == 204:
                    return {}
                return response.json()
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                body = exc.response.text

                if status_code == 401:
                    last_error = Trading212Error(
                        "Trading 212 rejected authentication (401). "
                        f"Base URL tried: {base_url}. "
                        "Check API key/secret, scopes and environment (demo/live).",
                        status_code=401,
                    )
                    continue

                raise Trading212Error(
                    f"Trading 212 error ({status_code}) on {path}: {body}",
                    status_code=status_code,
                ) from exc
            except httpx.HTTPError as exc:
                raise Trading212Error(f"Trading 212 request failed on {path}: {exc}") from exc

        if last_error is not None:
            raise last_error

        raise Trading212Error("Unknown Trading 212 request failure")

    async def fetch_account_cash(self) -> dict[str, Any]:
        payload = await self._request("GET", "/api/v0/equity/account/cash")
        return payload if isinstance(payload, dict) else {"data": payload}

    async def fetch_positions(self, ticker: str | None = None) -> list[dict[str, Any]]:
        params = {"ticker": ticker} if ticker else None
        payload = await self._request("GET", "/api/v0/equity/positions", params=params)
        return payload if isinstance(payload, list) else []

    async def fetch_pending_orders(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v0/equity/orders")
        return payload if isinstance(payload, list) else []

    async def place_market_order(
        self,
        *,
        ticker: str,
        quantity: float,
        extended_hours: bool = False,
    ) -> dict[str, Any]:
        payload = await self._request(
            "POST",
            "/api/v0/equity/orders/market",
            payload={
                "ticker": ticker,
                "quantity": quantity,
                "extendedHours": extended_hours,
            },
        )
        return payload if isinstance(payload, dict) else {"data": payload}

    async def place_limit_order(
        self,
        *,
        ticker: str,
        quantity: float,
        limit_price: float,
        time_validity: TimeValidity,
    ) -> dict[str, Any]:
        payload = await self._request(
            "POST",
            "/api/v0/equity/orders/limit",
            payload={
                "ticker": ticker,
                "quantity": quantity,
                "limitPrice": limit_price,
                "timeValidity": time_validity.value,
            },
        )
        return payload if isinstance(payload, dict) else {"data": payload}

    async def place_stop_order(
        self,
        *,
        ticker: str,
        quantity: float,
        stop_price: float,
        time_validity: TimeValidity,
    ) -> dict[str, Any]:
        payload = await self._request(
            "POST",
            "/api/v0/equity/orders/stop",
            payload={
                "ticker": ticker,
                "quantity": quantity,
                "stopPrice": stop_price,
                "timeValidity": time_validity.value,
            },
        )
        return payload if isinstance(payload, dict) else {"data": payload}

    async def place_stop_limit_order(
        self,
        *,
        ticker: str,
        quantity: float,
        stop_price: float,
        limit_price: float,
        time_validity: TimeValidity,
    ) -> dict[str, Any]:
        payload = await self._request(
            "POST",
            "/api/v0/equity/orders/stop_limit",
            payload={
                "ticker": ticker,
                "quantity": quantity,
                "stopPrice": stop_price,
                "limitPrice": limit_price,
                "timeValidity": time_validity.value,
            },
        )
        return payload if isinstance(payload, dict) else {"data": payload}

    async def place_order(
        self,
        *,
        order_type: OrderType,
        ticker: str,
        quantity: float,
        extended_hours: bool = False,
        limit_price: float | None = None,
        stop_price: float | None = None,
        time_validity: TimeValidity = TimeValidity.day,
    ) -> dict[str, Any]:
        if order_type == OrderType.market:
            return await self.place_market_order(
                ticker=ticker,
                quantity=quantity,
                extended_hours=extended_hours,
            )

        if order_type == OrderType.limit:
            if limit_price is None:
                raise Trading212Error("limit_price is required for LIMIT orders")
            return await self.place_limit_order(
                ticker=ticker,
                quantity=quantity,
                limit_price=limit_price,
                time_validity=time_validity,
            )

        if order_type == OrderType.stop:
            if stop_price is None:
                raise Trading212Error("stop_price is required for STOP orders")
            return await self.place_stop_order(
                ticker=ticker,
                quantity=quantity,
                stop_price=stop_price,
                time_validity=time_validity,
            )

        if stop_price is None or limit_price is None:
            raise Trading212Error("stop_price and limit_price are required for STOP_LIMIT orders")

        return await self.place_stop_limit_order(
            ticker=ticker,
            quantity=quantity,
            stop_price=stop_price,
            limit_price=limit_price,
            time_validity=time_validity,
        )
