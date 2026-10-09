"""Resolve the caller's role and tenant from OUR database. Never from a claim.

This is the module SRS 2.24.7 is really about. Cognito can tell us who someone
is; only `memberships` can tell us what they may do, and the difference is the
whole of tenant isolation.

**Why not token claims, which would be free?** Because they go stale. An
employer who removes a recruiter expects that recruiter to lose access now, not
whenever their access token happens to expire. A revocation that does not take
effect is precisely the isolation failure 2.24.7 forbids, so the authority is a
row we can delete, read on every request.

**Why a 60-second cache is the right trade.** A database read per request is
affordable but not free at the p99 the performance budget asks for; a 60-second
Redis cache makes it a microsecond lookup and bounds revocation lag at one
minute, which is a number we can state and defend. Longer would be cheaper and
harder to justify; shorter buys latency for lag nobody notices.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_redis
from app.core.logging import get_logger
from app.core.tenant import Membership
from app.settings import get_settings

logger = get_logger(__name__)

_KEY_PREFIX = "membership:v1:"
_TENANT_CHANGED_PREFIX = "tenant-changed:v1:"


def cache_key(user_id: uuid.UUID) -> str:
    return f"{_KEY_PREFIX}{user_id}"


def tenant_changed_key(tenant_id: uuid.UUID) -> str:
    return f"{_TENANT_CHANGED_PREFIX}{tenant_id}"


async def resolve(session: AsyncSession, user_id: uuid.UUID) -> Membership | None:
    """The caller's single active membership, or None for a candidate.

    A candidate has no membership row -- they belong to no tenant -- so None
    is the ordinary answer for the largest class of user, not an error.

    **A tenant under change is never answered from the cache.** See
    `mark_tenant_changed` for why deleting the cached rows is not enough on
    its own.
    """
    cached = await _read_cache(user_id)
    if cached is not None and (
        cached.membership is None or not await _tenant_changed(cached.membership.tenant_id)
    ):
        return cached.membership

    membership = await _read_database(session, user_id)
    if membership is None or not await _tenant_changed(membership.tenant_id):
        await _write_cache(user_id, membership)
    return membership


async def mark_tenant_changed(tenant_id: uuid.UUID, member_ids: list[uuid.UUID]) -> None:
    """A tenant was suspended or reinstated: stop trusting cached memberships.

    Called by the service **before its transaction commits**, which is the
    whole difficulty. Deleting the members' cached rows alone leaves a gap: a
    request landing between the delete and the commit reads the database,
    still sees the tenant active, and caches that for another 60 seconds --
    so the suspension bites a minute late, which is what "immediately" rules
    out.

    So a flag is set on the tenant for one cache lifetime. While it is set,
    `resolve` reads the database on every request for that tenant and writes
    nothing back, so no stale row can be created after this call. Once it
    expires, every row cached before it was deleted here, and every row
    written since reflects the committed state. If the transaction rolls
    back instead, the database still says active and the flag costs a minute
    of uncached reads -- the database, not the flag, is the answer.
    """
    ttl = get_settings().membership_cache_ttl_seconds
    try:
        redis = get_redis()
        await redis.set(tenant_changed_key(tenant_id), "1", ex=ttl)
        if member_ids:
            await redis.delete(*(cache_key(user_id) for user_id in member_ids))
    except Exception:  # pragma: no cover - degraded: the TTL still bounds the lag
        logger.warning("tenant_change_mark_failed", tenant_id=str(tenant_id))


async def in_suspended_tenant(session: AsyncSession, user_id: uuid.UUID) -> bool:
    """Whether this account's membership is held in a suspended tenant.

    Read only on the refusal path, so a suspended member is told why
    (`tenant_suspended`) rather than that they belong nowhere. Not a leak:
    the member knows which organisation they work for.
    """
    return bool(
        await session.scalar(
            text(
                """
                SELECT EXISTS (
                  SELECT 1
                    FROM memberships m
                    JOIN tenant_suspensions s
                      ON s.tenant_id = m.tenant_id AND s.lifted_at IS NULL
                   WHERE m.user_id = :uid AND m.status = 'ACTIVE'
                )
                """
            ),
            {"uid": str(user_id)},
        )
    )


async def invalidate(user_id: uuid.UUID) -> None:
    """Drop the cached membership immediately.

    Called when a membership is granted, revoked or has its role changed, so
    that the caller does not have to wait out the TTL. The TTL is the backstop
    for the case where this call is forgotten or fails -- it is not the primary
    mechanism, and it is also why forgetting it degrades rather than breaks.
    """
    try:
        await get_redis().delete(cache_key(user_id))
    except Exception:  # pragma: no cover - a cache we cannot clear expires anyway
        logger.warning("membership_cache_invalidate_failed", user_id=str(user_id))


# ---------------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------------
class _Cached:
    """Distinguishes 'cached: no membership' from 'not cached'.

    A bare `None` would conflate them, and the conflation costs a database
    round trip on every single candidate request -- the majority of traffic.
    """

    __slots__ = ("membership",)

    def __init__(self, membership: Membership | None) -> None:
        self.membership = membership


async def _read_cache(user_id: uuid.UUID) -> _Cached | None:
    try:
        raw = await get_redis().get(cache_key(user_id))
    except Exception:
        # A cache miss and an unreachable cache are the same thing to the
        # caller: read from Postgres. Isolation must not depend on Redis
        # being up.
        logger.warning("membership_cache_unavailable")
        return None

    if raw is None:
        return None
    payload: dict[str, Any] = json.loads(raw)
    if not payload:
        return _Cached(None)
    return _Cached(
        Membership(
            user_id=uuid.UUID(payload["user_id"]),
            tenant_id=uuid.UUID(payload["tenant_id"]),
            role=payload["role"],
            status=payload["status"],
        )
    )


async def _tenant_changed(tenant_id: uuid.UUID) -> bool:
    try:
        return bool(await get_redis().exists(tenant_changed_key(tenant_id)))
    except Exception:
        # An unreachable cache cannot be trusted to hold the flag either, so
        # the answer is "read the database" -- which is what a miss does.
        return True


async def _write_cache(user_id: uuid.UUID, membership: Membership | None) -> None:
    payload: dict[str, Any] = (
        {}
        if membership is None
        else {
            "user_id": str(membership.user_id),
            "tenant_id": str(membership.tenant_id),
            "role": membership.role,
            "status": membership.status,
        }
    )
    try:
        await get_redis().set(
            cache_key(user_id),
            json.dumps(payload),
            ex=get_settings().membership_cache_ttl_seconds,
        )
    except Exception:  # pragma: no cover - degraded, not broken
        logger.warning("membership_cache_write_failed")


async def _read_database(session: AsyncSession, user_id: uuid.UUID) -> Membership | None:
    """Read the one active membership for this user.

    `memberships` is deliberately exempt from RLS -- it is the table read to
    *determine* `app.tenant_id`, so the policy could not yet apply (see the
    exemption note in the baseline migration). Isolation here comes from the
    `user_id` filter, and `user_id` is taken from the verified token subject,
    which the caller cannot forge.

    The join on `tenants` is what makes a suspended tenant stop working
    immediately rather than at the next sign-in: suspension is an operational
    control (client, 2026-08-24) and an operational control that takes an hour
    to bite is not one.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT m.user_id, m.tenant_id, m.role, m.status
                  FROM memberships m
                  JOIN tenants t ON t.id = m.tenant_id
                 WHERE m.user_id = :uid
                   AND m.status = 'ACTIVE'
                   AND t.status = 'ACTIVE'
                   AND NOT EXISTS (
                         SELECT 1 FROM tenant_suspensions s
                          WHERE s.tenant_id = m.tenant_id
                            AND s.lifted_at IS NULL
                       )
                 LIMIT 1
                """
            ),
            {"uid": str(user_id)},
        )
    ).first()

    if row is None:
        return None
    return Membership(
        user_id=row.user_id, tenant_id=row.tenant_id, role=row.role, status=row.status
    )
