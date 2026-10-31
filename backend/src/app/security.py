"""Access control for the local API (it can place real orders)."""

import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings

_bearer = HTTPBearer(auto_error=False)


def is_auth_enabled() -> bool:
    return bool(settings.app_access_token.get_secret_value())


async def require_access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> None:
    """Require `Authorization: Bearer <APP_ACCESS_TOKEN>` when a token is configured.

    A custom header also forces a CORS preflight, which blocks cross-site request forgery
    from any page the browser visits.
    """
    expected = settings.app_access_token.get_secret_value()
    if not expected:
        return
    provided = credentials.credentials if credentials else ""
    if not secrets.compare_digest(provided.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Jeton d'accès manquant ou invalide",
            headers={"WWW-Authenticate": "Bearer"},
        )
