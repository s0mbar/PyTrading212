import base64

from app.config import settings
from app.services.trading212 import Trading212Client


def test_basic_auth_header_format() -> None:
    client = Trading212Client()
    header = client._auth_header["Authorization"]
    scheme, token = header.split(" ", maxsplit=1)

    assert scheme == "Basic"

    decoded = base64.b64decode(token).decode("utf-8")
    assert decoded == f"{settings.api_key_id}:{settings.secret_key}"