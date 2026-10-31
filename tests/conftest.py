"""Shared test setup: fake credentials, never the real .env secrets."""

import os

import pytest

# Environment variables take precedence over the root .env file in pydantic-settings.
os.environ["API_KEY_ID"] = "test-key-id"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["TRADING212_BASE_URL"] = "https://demo.trading212.com"
os.environ["APP_ACCESS_TOKEN"] = ""

from t212_csv import CsvFactory, build_csv  # noqa: E402


@pytest.fixture
def make_csv() -> CsvFactory:
    return build_csv
