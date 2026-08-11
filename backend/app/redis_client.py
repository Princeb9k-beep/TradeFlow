"""
Async Redis connection management.

Redis is optional: if unavailable the app still boots and skips caching (graceful
degradation). Callers tolerate `get_redis()` returning None.
"""

from __future__ import annotations

import logging

import redis.asyncio as aioredis

from .config import get_settings

logger = logging.getLogger("tradeflow.redis")

_redis: aioredis.Redis | None = None
_initialized = False


async def init_redis() -> aioredis.Redis | None:
    global _redis, _initialized
    if _initialized:
        return _redis
    _initialized = True
    settings = get_settings()
    try:
        client = aioredis.from_url(
            settings.redis_url,
            password=settings.redis_password or None,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
        )
        await client.ping()
        _redis = client
        logger.info("Connected to Redis")
    except Exception as exc:  # noqa: BLE001 - degrade gracefully
        logger.warning("Redis unavailable, caching disabled: %s", exc)
        _redis = None
    return _redis


def get_redis() -> aioredis.Redis | None:
    return _redis


async def close_redis() -> None:
    global _redis, _initialized
    if _redis is not None:
        await _redis.aclose()
    _redis = None
    _initialized = False
