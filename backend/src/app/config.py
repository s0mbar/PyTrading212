"""Configuration applicative chargee depuis .env racine."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    api_key_id: str = Field(alias="api_key_id")
    secret_key: str = Field(alias="secret_key")
    trading212_base_url: str = Field(
        default="https://live.trading212.com", alias="TRADING212_BASE_URL"
    )
    frontend_origin: str = Field(default="http://localhost:5173", alias="FRONTEND_ORIGIN")
    min_order_quantity: float = Field(default=0.0001, alias="MIN_ORDER_QUANTITY")
    max_order_quantity: float = Field(default=50.0, alias="MAX_ORDER_QUANTITY")
    bot_default_poll_interval_seconds: int = Field(
        default=45, alias="BOT_DEFAULT_POLL_INTERVAL_SECONDS"
    )
    bot_max_tickers: int = Field(default=12, alias="BOT_MAX_TICKERS")

    model_config = SettingsConfigDict(
        env_file=ROOT_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


settings = Settings()
