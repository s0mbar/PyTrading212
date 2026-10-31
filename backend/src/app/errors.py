"""Translate upstream errors into HTTP responses."""

from fastapi import HTTPException

from .services.trading212 import Trading212Error

# 401/403 are reserved for this API's own access control: an upstream rejection is a 502.
_FORWARDED_STATUS_CODES = frozenset({400, 404, 409, 422, 429})


def trading212_http_error(exc: Trading212Error) -> HTTPException:
    status_code = exc.status_code if exc.status_code in _FORWARDED_STATUS_CODES else 502
    return HTTPException(status_code=status_code, detail=str(exc))
