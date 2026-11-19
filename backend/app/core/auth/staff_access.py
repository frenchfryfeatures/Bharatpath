"""Resolve what a member of staff may do, from OUR database (2026-11-19).

The staff counterpart of `membership.py`, and built the same way for the same
reason: a role assignment is a row we can revoke and have it bite on the next
request, which a token claim or a Cognito group could never do.

Explicit SQL against the `access` module's tables, because `app.core` may not
import `app.modules` (the `core-depends-on-nothing` contract), exactly as
`membership.py` reads `memberships`.

**Cached for the membership TTL, and expiry is evaluated per request.** The
cache holds the assignments with their `expires_at`, not the answer, so an
assignment that expires at 14:00 stops granting at 14:00 whatever the cache
says. **A change is never answered from the cache**: `mark_changed` sets a flag
for one TTL that makes `resolve` read the database and write nothing back,
which closes the window between a revocation and its commit -- the same
technique, and the same argument, as `membership.mark_tenant_changed`.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import get_redis
from app.core.logging import get_logger
from app.core.staff_permissions import Grant, StaffAccess, system_role_permissions
from app.settings import get_settings

logger = get_logger(__name__)

_KEY_PREFIX = "staff-access:v1:"
_CHANGED_PREFIX = "staff-access-changed:v1:"
_MFA_PREFIX = "staff-mfa:v1:"


def cache_key(user_id: uuid.UUID) -> str:
    return f"{_KEY_PREFIX}{user_id}"


def changed_key(user_id: uuid.UUID) -> str:
    return f"{_CHANGED_PREFIX}{user_id}"


async def resolve(
    session: AsyncSession, user_id: uuid.UUID, *, now: datetime | None = None
) -> StaffAccess:
    """The caller's live grants. Empty -- not an error -- for staff with none."""
    now = now or datetime.now(UTC)
    grants = None
    if not await _changed(user_id):
        grants = await _read_cache(user_id)
    if grants is None:
        grants = await _read_database(session, user_id)
        if not await _changed(user_id):
            await _write_cache(user_id, grants)
    return StaffAccess.from_grants(grants, now=now)


async def mark_changed(user_ids: list[uuid.UUID]) -> None:
    """Assignments or a role's permissions changed for these people: stop
    trusting what is cached, before the change commits. See the module note."""
    if not user_ids:
        return
    ttl = get_settings().membership_cache_ttl_seconds
    try:
        redis = get_redis()
        for user_id in user_ids:
            await redis.set(changed_key(user_id), "1", ex=ttl)
        await redis.delete(*(cache_key(u) for u in user_ids))
        await redis.delete(*(f"{_MFA_PREFIX}{u}" for u in user_ids))
    except Exception:  # pragma: no cover - degraded: the TTL still bounds the lag
        logger.warning("staff_access_mark_failed", count=len(user_ids))


async def cached_mfa(user_id: uuid.UUID) -> bool | None:
    """A recent answer to "has this person enrolled an authenticator?"."""
    try:
        raw = await get_redis().get(f"{_MFA_PREFIX}{user_id}")
    except Exception:
        return None
    return None if raw is None else raw in ("1", b"1")


async def remember_mfa(user_id: uuid.UUID, enabled: bool) -> None:
    """Kept for one membership TTL: a Cognito call per sensitive request is
    affordable, but not a call per row of a page of them."""
    try:
        await get_redis().set(
            f"{_MFA_PREFIX}{user_id}",
            "1" if enabled else "0",
            ex=get_settings().membership_cache_ttl_seconds,
        )
    except Exception:  # pragma: no cover
        logger.warning("staff_mfa_cache_write_failed")


async def cognito_subject(session: AsyncSession, user_id: uuid.UUID) -> str | None:
    """The sign-in to ask Cognito about. Never leaves the server."""
    value = await session.scalar(
        text("SELECT cognito_sub FROM users WHERE id = :uid"), {"uid": str(user_id)}
    )
    return None if value is None else str(value)


# ---------------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------------
async def _changed(user_id: uuid.UUID) -> bool:
    try:
        return bool(await get_redis().exists(changed_key(user_id)))
    except Exception:
        return True


async def _read_cache(user_id: uuid.UUID) -> list[Grant] | None:
    try:
        raw = await get_redis().get(cache_key(user_id))
    except Exception:
        logger.warning("staff_access_cache_unavailable")
        return None
    if raw is None:
        return None
    return [_grant_from(item) for item in json.loads(raw)]


async def _write_cache(user_id: uuid.UUID, grants: list[Grant]) -> None:
    payload = [
        {
            "role_key": g.role_key,
            "role_name": g.role_name,
            "permissions": sorted(g.permissions),
            "scope": None
            if g.scope_tenant_ids is None
            else sorted(str(t) for t in g.scope_tenant_ids),
            "expires_at": None if g.expires_at is None else g.expires_at.isoformat(),
        }
        for g in grants
    ]
    try:
        await get_redis().set(
            cache_key(user_id),
            json.dumps(payload),
            ex=get_settings().membership_cache_ttl_seconds,
        )
    except Exception:  # pragma: no cover
        logger.warning("staff_access_cache_write_failed")


def _grant_from(item: dict[str, Any]) -> Grant:
    scope = item["scope"]
    expires = item["expires_at"]
    return Grant(
        role_key=item["role_key"],
        role_name=item["role_name"],
        permissions=frozenset(item["permissions"]),
        scope_tenant_ids=None if scope is None else frozenset(uuid.UUID(t) for t in scope),
        expires_at=None if expires is None else datetime.fromisoformat(expires),
    )


async def _read_database(session: AsyncSession, user_id: uuid.UUID) -> list[Grant]:
    """Every unrevoked assignment of an ACTIVE role, with the custom role's
    permissions. A system role's permissions are code
    (`staff_permissions.SYSTEM_ROLES`), never rows, so they cannot drift.

    Read only for a caller whose PLATFORM membership `membership.resolve`
    already found active, so the membership is not re-checked here.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT r.key, r.name, r.is_system, a.scope_tenant_ids, a.expires_at,
                       coalesce(array_agg(p.permission ORDER BY p.permission)
                                FILTER (WHERE p.permission IS NOT NULL), '{}') AS permissions
                  FROM staff_role_assignments a
                  JOIN staff_roles r ON r.id = a.role_id
                  LEFT JOIN staff_role_permissions p ON p.role_id = r.id
                 WHERE a.user_id = :uid
                   AND a.revoked_at IS NULL
                   AND r.status = 'ACTIVE'
                 GROUP BY a.id, r.key, r.name, r.is_system, a.scope_tenant_ids, a.expires_at
                """
            ),
            {"uid": str(user_id)},
        )
    ).all()
    return [
        Grant(
            role_key=row.key,
            role_name=row.name,
            permissions=system_role_permissions(row.key)
            if row.is_system
            else frozenset(row.permissions),
            scope_tenant_ids=None
            if row.scope_tenant_ids is None
            else frozenset(uuid.UUID(str(t)) for t in row.scope_tenant_ids),
            expires_at=row.expires_at,
        )
        for row in rows
    ]
