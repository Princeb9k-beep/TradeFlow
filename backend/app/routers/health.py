"""Health check — reports liveness and backing-service status."""

from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from ..database import get_sessionmaker
from ..groq_client import get_groq
from ..redis_client import get_redis
from ..responses import ok

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> object:
    db_status = "down"
    try:
        async with get_sessionmaker()() as session:
            await session.execute(text("SELECT 1"))
        db_status = "up"
    except Exception:  # noqa: BLE001
        db_status = "down"
    return ok(
        data={
            "status": "ok",
            "services": {
                "database": db_status,
                "redis": "up" if get_redis() is not None else "off",
                "ai": "up" if get_groq() is not None else "off",
            },
        },
        message="Tradeflow is running",
    )
