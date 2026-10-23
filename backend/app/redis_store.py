"""Small Redis adapter for state that must survive process boundaries."""

from __future__ import annotations

import json
from typing import Any, Optional

from redis.asyncio import Redis
from fastapi_limiter import FastAPILimiter

from app.config import REDIS_URL

OIDC_STATE_TTL_SECONDS = 600
_client: Optional[Redis] = None


def _redis() -> Redis:
    global _client
    if _client is None:
        _client = Redis.from_url(REDIS_URL, decode_responses=True)
    return _client


async def save_oidc_state(state: str, payload: dict[str, Any]) -> None:
    await _redis().set(
        f"facutools:oidc:state:{state}",
        json.dumps(payload),
        ex=OIDC_STATE_TTL_SECONDS,
    )


async def consume_oidc_state(state: str) -> Optional[dict[str, Any]]:
    raw = await _redis().getdel(f"facutools:oidc:state:{state}")
    if raw is None:
        return None
    return json.loads(raw)


async def init_rate_limiter() -> None:
    await FastAPILimiter.init(_redis(), prefix="facutools:public-network")


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
    FastAPILimiter.redis = None