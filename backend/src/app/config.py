"""Configuration applicative chargee depuis .env racine."""

from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"

LIVE_BASE_URL = "https://live.trading212.com"
DEMO_BASE_URL = "https://demo.trading212.com"
ALLOWED_BASE_URLS = frozenset({LIVE_BASE_URL, DEMO_BASE_URL})


class Settings(BaseSettings):
    api_key_id: SecretStr = Field(alias="api_key_id")
    secret_key: SecretStr = Field(alias="secret_key")
    trading212_base_url: str = Field(default=LIVE_BASE_URL, alias="TRADING212_BASE_URL")
    frontend_origin: str = Field(default="http://localhost:5173", alias="FRONTEND_ORIGIN")
    app_access_token: SecretStr = Field(default=SecretStr(""), alias="APP_ACCESS_TOKEN")
    min_order_quantity: float = Field(default=0.0001, gt=0, alias="MIN_ORDER_QUANTITY")
    max_order_quantity: float = Field(default=50.0, gt=0, alias="MAX_ORDER_QUANTITY")
    bot_default_poll_interval_seconds: int = Field(
        default=45, ge=10, alias="BOT_DEFAULT_POLL_INTERVAL_SECONDS"
    )
    bot_max_tickers: int = Field(default=12, ge=1, alias="BOT_MAX_TICKERS")

    model_config = SettingsConfigDict(
        env_file=ROOT_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @field_validator("trading212_base_url")
    @classmethod
    def restrict_base_url(cls, value: str) -> str:
        """Only the official hosts: credentials must never be sent anywhere else."""
        normalized = value.strip().rstrip("/").removesuffix("/api/v0")
        if normalized not in ALLOWED_BASE_URLS:
            allowed = ", ".join(sorted(ALLOWED_BASE_URLS))
            raise ValueError(f"TRADING212_BASE_URL must be one of: {allowed}")
        return normalized

    @property
    def is_live(self) -> bool:
        return self.trading212_base_url == LIVE_BASE_URL

    @property
    def environment_label(self) -> str:
        return "LIVE" if self.is_live else "DEMO"


settings = Settings()
