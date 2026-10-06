"""One Redis client for the process.

Used for three things and nothing else: the membership cache, the OTP outer
throttle, and short-lived locks. Anything that must survive a restart belongs
in Postgres -- Redis here is a cache, and every read of it must be correct
when it returns nothing.
"""

from __future__ import annotations

from redis.asyncio import Redis, from_url

from app.settings import get_settings

_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = from_url(
            str(get_settings().redis_url),
            decode_responses=True,
            # RESP2 works with both portable Windows Redis and Redis 7+.
            protocol=2,
            # A cache must never be the reason a request hangs. If Redis is
            # slow, the membership lookup falls through to Postgres and the
            # throttle fails open on read but closed on write -- both better
            # than a stalled request pool.
            socket_timeout=1.0,
            socket_connect_timeout=1.0,
        )
    return _redis


async def dispose_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None
