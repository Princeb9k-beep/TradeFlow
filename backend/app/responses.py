"""
Consistent API response envelope. Every endpoint returns the same shape so the
frontend renders loading / success / empty / error states uniformly:

    { "success": bool, "data": <payload|null>, "message": str, "meta": {...} }
"""

from __future__ import annotations

from typing import Any

from fastapi import status
from fastapi.responses import JSONResponse


def ok(
    data: Any = None,
    message: str = "OK",
    meta: dict[str, Any] | None = None,
    status_code: int = status.HTTP_200_OK,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"success": True, "data": data, "message": message, "meta": meta or {}},
    )


def error(
    message: str,
    status_code: int = status.HTTP_400_BAD_REQUEST,
    *,
    code: str | None = None,
    details: Any = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "success": False,
            "data": None,
            "message": message,
            "meta": {"code": code or "error", "details": details},
        },
    )
