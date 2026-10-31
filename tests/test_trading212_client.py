import asyncio
import base64

import httpx
import pytest

from app.config import settings
from app.errors import trading212_http_error
from app.services.trading212 import Trading212Client, Trading212Error, summary_to_cash


def client_with(handler) -> Trading212Client:
    client = Trading212Client()
    client._http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return client


def test_basic_auth_header_format() -> None:
    client = Trading212Client()
    header = client._auth_header["Authorization"]
    scheme, token = header.split(" ", maxsplit=1)

    assert scheme == "Basic"

    decoded = base64.b64decode(token).decode("utf-8")
    assert decoded == (
        f"{settings.api_key_id.get_secret_value()}:{settings.secret_key.get_secret_value()}"
    )


def test_authentication_failure_never_falls_back_to_the_other_environment() -> None:
    # Arrange
    requested_hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested_hosts.append(request.url.host)
        return httpx.Response(401)

    # Act
    with pytest.raises(Trading212Error) as error:
        asyncio.run(client_with(handler).fetch_positions())

    # Assert
    assert requested_hosts == ["demo.trading212.com"]
    assert error.value.status_code == 401


def test_upstream_authentication_failure_maps_to_bad_gateway() -> None:
    assert trading212_http_error(Trading212Error("nope", status_code=401)).status_code == 502
    assert trading212_http_error(Trading212Error("slow down", status_code=429)).status_code == 429


def test_error_body_is_truncated() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="x" * 5000)

    with pytest.raises(Trading212Error) as error:
        asyncio.run(client_with(handler).fetch_positions())

    assert len(str(error.value)) < 700


def test_summary_is_flattened_into_cash_metrics() -> None:
    summary = {
        "cash": {"availableToTrade": 120.5, "reservedForOrders": 10, "inPies": 0},
        "investments": {
            "currentValue": 900,
            "realizedProfitLoss": 42,
            "totalCost": 800,
            "unrealizedProfitLoss": 100,
        },
        "totalValue": 1030.5,
        "currency": "EUR",
        "id": 123,
    }

    cash = summary_to_cash(summary)

    assert cash["free"] == 120.5
    assert cash["blocked"] == 10
    assert cash["total"] == 1030.5
    assert cash["invested"] == 800
    assert cash["result"] == 42
    assert cash["ppl"] == 100


def test_report_download_refuses_plain_http() -> None:
    with pytest.raises(Trading212Error, match="non-HTTPS"):
        asyncio.run(Trading212Client().download_export("http://example.com/report.csv"))
