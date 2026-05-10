"""Authentication helpers for protected API endpoints."""

from __future__ import annotations

import os

from fastapi import Header, HTTPException


def require_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    """Validate shared demo API key from `X-API-Key` header."""
    expected = (os.environ.get("API_KEY") or os.environ.get("X_API_KEY") or "").strip()
    if not expected:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "config_error",
                "message": "API key is not configured on server",
                "details": {},
            },
        )
    if not x_api_key or x_api_key.strip() != expected:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "unauthorized",
                "message": "Invalid or missing X-API-Key",
                "details": {},
            },
        )
