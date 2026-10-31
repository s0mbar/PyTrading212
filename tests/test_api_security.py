import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.bot_engine import TradingBotEngine
from app.config import Settings, settings
from app.main import app
from app.schemas import BotConfig, PlaceOrderRequest
from t212_csv import build_csv, trade

client = TestClient(app)


@pytest.fixture
def access_token(monkeypatch: pytest.MonkeyPatch) -> str:
    token = "s3cret-test-token"
    monkeypatch.setattr(settings, "app_access_token", SecretStr(token))
    return token


def test_health_is_public_and_tells_whether_auth_is_required(access_token: str) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "auth_required": True}


@pytest.mark.parametrize("header", [None, "Bearer wrong-token", "Basic abc"])
def test_protected_routes_reject_missing_or_wrong_token(
    access_token: str, header: str | None
) -> None:
    headers = {"Authorization": header} if header else {}

    response = client.get("/api/trading212/bot/status", headers=headers)

    assert response.status_code == 401


def test_protected_routes_accept_the_configured_token(access_token: str) -> None:
    response = client.get(
        "/api/trading212/bot/status", headers={"Authorization": f"Bearer {access_token}"}
    )

    assert response.status_code == 200


def test_tax_routes_are_protected(access_token: str) -> None:
    response = client.post("/api/tax/report", json={"year": 2024, "csv_files": []})

    assert response.status_code == 401


def test_security_headers_are_set() -> None:
    response = client.get("/api/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Cache-Control"] == "no-store"


def test_order_rejects_non_finite_quantity() -> None:
    response = client.post(
        "/api/trading212/orders",
        content='{"ticker": "AAPL_US_EQ", "quantity": NaN}',
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 422


def test_order_rejects_malformed_ticker() -> None:
    with pytest.raises(ValidationError):
        PlaceOrderRequest(ticker="../../evil", quantity=1)


def test_tickers_keep_their_case() -> None:
    assert PlaceOrderRequest(ticker=" SIGTl_EQ ", quantity=1).ticker == "SIGTl_EQ"
    assert BotConfig(tickers=["VUSAl_EQ", " VUSAl_EQ "]).tickers == ["VUSAl_EQ"]


def test_market_history_rejects_unknown_interval() -> None:
    response = client.get("/api/market/history", params={"ticker": "AAPL_US_EQ", "interval": "7x"})

    assert response.status_code == 422


def test_settings_reject_unknown_trading212_host() -> None:
    with pytest.raises(ValidationError):
        Settings(api_key_id="a", secret_key="b", TRADING212_BASE_URL="https://evil.example.com")


def test_settings_accept_official_hosts_with_api_suffix() -> None:
    configured = Settings(
        api_key_id="key-id",
        secret_key="very-secret-value",
        TRADING212_BASE_URL="https://live.trading212.com/api/v0/",
    )

    assert configured.is_live is True
    assert "very-secret-value" not in repr(configured)


def test_tax_report_endpoint_computes_boxes() -> None:
    # Arrange
    content = build_csv(
        trade("Market buy", "2024-01-10 10:00:00", "10", "1000"),
        trade("Market sell", "2024-03-10 10:00:00", "10", "1100"),
    )

    # Act
    response = client.post(
        "/api/tax/report", json={"year": 2024, "csv_files": [{"name": "a.csv", "content": content}]}
    )

    # Assert
    assert response.status_code == 200
    boxes = {item["code"]: item["amount"] for item in response.json()["boxes"]}
    assert boxes["3VG"] == 100.0


def test_validation_errors_do_not_echo_submitted_content() -> None:
    response = client.post(
        "/api/tax/report",
        json={"year": 1800, "csv_files": [{"name": "a.csv", "content": "PRIVATE-DATA"}]},
    )

    assert response.status_code == 422
    assert "PRIVATE-DATA" not in response.text


def test_tax_report_endpoint_rejects_invalid_csv() -> None:
    response = client.post(
        "/api/tax/report",
        json={"year": 2024, "csv_files": [{"name": "bank.csv", "content": "Date,Amount\n"}]},
    )

    assert response.status_code == 422


def test_bot_cycles_never_overlap(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    engine = TradingBotEngine()
    running = 0
    max_running = 0

    async def fake_cycle() -> None:
        nonlocal running, max_running
        running += 1
        max_running = max(max_running, running)
        await asyncio.sleep(0.01)
        running -= 1

    monkeypatch.setattr(engine, "_run_cycle_unlocked", fake_cycle)

    # Act
    async def run_concurrently() -> None:
        await asyncio.gather(engine.run_cycle(), engine.run_cycle(), engine.run_cycle())

    asyncio.run(run_concurrently())

    # Assert
    assert max_running == 1
