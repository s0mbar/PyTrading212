"""Trading 212 HTTP client."""

import base64
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

import httpx

from ..config import settings
from ..schemas import OrderType, TimeValidity

ERROR_BODY_MAX_CHARS = 500
EXPORT_MAX_BYTES = 50 * 1024 * 1024


class Trading212Error(Exception):
    """Trading 212 domain error."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def summary_to_cash(summary: dict[str, Any]) -> dict[str, float]:
    """Flatten GET /equity/account/summary into the cash metrics used by the UI and the bot."""
    cash = summary.get("cash") or {}
    investments = summary.get("investments") or {}
    return {
        "free": float(cash.get("availableToTrade") or 0.0),
        "blocked": float(cash.get("reservedForOrders") or 0.0),
        "inPies": float(cash.get("inPies") or 0.0),
        "total": float(summary.get("totalValue") or 0.0),
        "invested": float(investments.get("totalCost") or 0.0),
        "currentValue": float(investments.get("currentValue") or 0.0),
        "result": float(investments.get("realizedProfitLoss") or 0.0),
        "ppl": float(investments.get("unrealizedProfitLoss") or 0.0),
    }


class Trading212Client:
    def __init__(self) -> None:
        self._base_url = settings.trading212_base_url
        self._http_client = httpx.AsyncClient(timeout=20.0)

    async def __aenter__(self) -> "Trading212Client":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self._http_client.aclose()

    @property
    def _auth_header(self) -> dict[str, str]:
        token = f"{settings.api_key_id.get_secret_value()}:{settings.secret_key.get_secret_value()}"
        encoded = base64.b64encode(token.encode("utf-8")).decode("utf-8")
        return {"Authorization": f"Basic {encoded}"}

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        # Single configured environment on purpose: silently retrying on the other one
        # could send an order to LIVE while the UI believes it is on DEMO.
        try:
            response = await self._http_client.request(
                method,
                f"{self._base_url}{path}",
                headers=self._auth_header,
                params=params,
                json=payload,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code
            if status_code == 401:
                message = (
                    "Trading 212 rejected authentication (401). "
                    f"Environment: {settings.environment_label}. "
                    "Check API key/secret, scopes, IP restrictions and TRADING212_BASE_URL."
                )
            else:
                body = exc.response.text[:ERROR_BODY_MAX_CHARS]
                message = f"Trading 212 error ({status_code}) on {path}: {body}"
            raise Trading212Error(message, status_code=status_code) from exc
        except httpx.HTTPError as exc:
            raise Trading212Error(f"Trading 212 request failed on {path}: {exc}") from exc

        if response.status_code == 204 or not response.content:
            return {}
        return response.json()

    async def fetch_account_summary(self) -> dict[str, Any]:
        payload = await self._request("GET", "/api/v0/equity/account/summary")
        return payload if isinstance(payload, dict) else {}

    async def fetch_account_cash(self) -> dict[str, float]:
        return summary_to_cash(await self.fetch_account_summary())

    async def fetch_positions(self, ticker: str | None = None) -> list[dict[str, Any]]:
        params = {"ticker": ticker} if ticker else None
        payload = await self._request("GET", "/api/v0/equity/positions", params=params)
        return payload if isinstance(payload, list) else []

    async def fetch_pending_orders(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v0/equity/orders")
        return payload if isinstance(payload, list) else []

    async def request_history_export(
        self, *, time_from: datetime, time_to: datetime
    ) -> dict[str, Any]:
        payload = await self._request(
            "POST",
            "/api/v0/equity/history/exports",
            payload={
                "dataIncluded": {
                    "includeDividends": True,
                    "includeInterest": True,
                    "includeOrders": True,
                    "includeTransactions": True,
                },
                "timeFrom": time_from.isoformat().replace("+00:00", "Z"),
                "timeTo": time_to.isoformat().replace("+00:00", "Z"),
            },
        )
        return payload if isinstance(payload, dict) else {}

    async def list_history_exports(self) -> list[dict[str, Any]]:
        payload = await self._request("GET", "/api/v0/equity/history/exports")
        return payload if isinstance(payload, list) else []

    async def download_export(self, download_link: str) -> str:
        """Download a finished CSV report. The link is pre-signed: never forward our credentials."""
        if urlparse(download_link).scheme != "https":
            raise Trading212Error("Refusing to download a report over a non-HTTPS link")

        try:
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                response = await client.get(download_link)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise Trading212Error(f"Report download failed: {exc}") from exc

        if len(response.content) > EXPORT_MAX_BYTES:
            raise Trading212Error("Report too large")
        return response.content.decode("utf-8-sig")

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
