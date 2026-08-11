"""
Redis caching helpers. Namespaced JSON cache used for AI responses and market
bars. All operations no-op when Redis is unavailable.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from .config import get_settings
from .redis_client import get_redis

logger = logging.getLogger("tradeflow.cache")


def make_key(*parts: Any) -> str:
    raw = ":".join(str(p) for p in parts)
    if len(raw) > 200:
        digest = hashlib.sha256(raw.encode()).hexdigest()[:32]
        return f"{parts[0]}:{digest}"
    return raw


async def cache_get(key: str) -> Any | None:
    redis = get_redis()
    if redis is None:
        return None
    try:
        raw = await redis.get(key)
        return json.loads(raw) if raw is not None else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache_get failed for %s: %s", key, exc)
        return None


async def cache_set(key: str, value: Any, ttl: int | None = None) -> None:
    redis = get_redis()
    if redis is None:
        return
    ttl = ttl if ttl is not None else get_settings().ai_cache_ttl_seconds
    try:
        await redis.set(key, json.dumps(value, default=str), ex=ttl)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache_set failed for %s: %s", key, exc)
