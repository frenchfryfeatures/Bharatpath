"""Liveness and readiness.

Liveness answers "is the process alive"; readiness answers "can it serve".
They are different questions and Kubernetes/ECS treat them differently - a
readiness probe that reports DB trouble takes the task out of the load
balancer; a liveness probe that does the same would restart-loop the whole
service during a brief database blip.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response, status

from app.core.db import check_database_liveness
from app.settings import get_settings

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness - is the process up?")
async def health() -> dict[str, Any]:
    return {"status": "ok", "environment": get_settings().environment}


@router.get("/health/ready", summary="Readiness - can it serve traffic?")
async def readiness(response: Response) -> dict[str, Any]:
    db = await check_database_liveness()
    redis = await _check_redis()
    ok = db["status"] == "up" and redis["status"] == "up"
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if ok else "degraded",
        "checks": {"database": db, "redis": redis},
    }


async def _check_redis() -> dict[str, str]:
    try:
        from redis.asyncio import from_url

        client = from_url(
            str(get_settings().redis_url),
            protocol=2,
            socket_connect_timeout=1.0,
            socket_timeout=1.0,
        )
        try:
            await client.ping()
            return {"status": "up"}
        finally:
            await client.aclose()
    except Exception:
        return {"status": "down"}
