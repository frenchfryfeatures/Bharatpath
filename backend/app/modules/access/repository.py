"""access - persistence

Every query the module makes. `users` and `memberships` are read with plain
SQL (they are identity's; neither is under RLS), as the admin repository does.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import RowMapping, delete, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.access.models import StaffRole, StaffRoleAssignment, StaffRolePermission

#: Every access-management write takes this first. Staff change rarely, and
#: one queue makes "how many super admins are left" and "who holds this role"
#: answerable without racing a concurrent change.
_LOCK_SQL = text("SELECT pg_advisory_xact_lock(hashtext('staff_access'))")


async def lock(session: AsyncSession) -> None:
    await session.execute(_LOCK_SQL)


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
_LIVE = "a.revoked_at IS NULL AND (a.expires_at IS NULL OR a.expires_at > now())"


async def list_roles(session: AsyncSession, *, include_archived: bool) -> Sequence[RowMapping]:
    where = "" if include_archived else "WHERE r.status = 'ACTIVE'"
    return (
        (
            await session.execute(
                text(
                    f"""
                    SELECT r.id, r.key, r.name, r.description, r.is_system, r.status,
                           r.created_at, r.updated_at,
                           (SELECT count(DISTINCT a.user_id) FROM staff_role_assignments a
                             WHERE a.role_id = r.id AND {_LIVE}) AS holders
                      FROM staff_roles r
                      {where}
                     ORDER BY r.is_system DESC, r.name, r.id
                    """  # noqa: S608 - module constants, not values
                )
            )
        )
        .mappings()
        .all()
    )


async def get_role(
    session: AsyncSession, *, role_id: uuid.UUID, lock: bool = False
) -> StaffRole | None:
    stmt = select(StaffRole).where(StaffRole.id == role_id)
    if lock:
        stmt = stmt.with_for_update()
    return (await session.execute(stmt)).scalar_one_or_none()


async def get_role_by_key(session: AsyncSession, *, key: str) -> StaffRole | None:
    return (
        await session.execute(select(StaffRole).where(StaffRole.key == key))
    ).scalar_one_or_none()


async def role_holders(session: AsyncSession, *, role_id: uuid.UUID) -> list[uuid.UUID]:
    """Everyone with an unrevoked assignment of the role, expired or not --
    whose cached access to distrust when it changes."""
    rows = await session.execute(
        text(
            "SELECT DISTINCT user_id FROM staff_role_assignments "
            "WHERE role_id = :r AND revoked_at IS NULL ORDER BY user_id"
        ),
        {"r": str(role_id)},
    )
    return [r[0] for r in rows.all()]


async def live_holder_count(session: AsyncSession, *, role_id: uuid.UUID) -> int:
    value = await session.scalar(
        text(
            "SELECT count(DISTINCT a.user_id) FROM staff_role_assignments a "  # noqa: S608
            f"WHERE a.role_id = :r AND {_LIVE}"
        ),
        {"r": str(role_id)},
    )
    return int(value or 0)


async def role_permissions(
    session: AsyncSession, *, role_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    ids = list(role_ids)
    out: dict[uuid.UUID, list[str]] = {i: [] for i in ids}
    if not ids:
        return out
    rows = await session.execute(
        select(StaffRolePermission.role_id, StaffRolePermission.permission)
        .where(StaffRolePermission.role_id.in_(ids))
        .order_by(StaffRolePermission.permission)
    )
    for role_id, permission in rows.all():
        out[role_id].append(permission)
    return out


async def insert_role(
    session: AsyncSession,
    *,
    key: str,
    name: str,
    description: str | None,
    created_by: uuid.UUID,
) -> uuid.UUID:
    role_id = uuid.uuid4()
    await session.execute(
        insert(StaffRole).values(
            id=role_id,
            key=key,
            name=name,
            description=description,
            is_system=False,
            status="ACTIVE",
            created_by=created_by,
            updated_by=created_by,
        )
    )
    return role_id


async def key_taken(session: AsyncSession, *, key: str) -> bool:
    return bool(
        await session.scalar(
            text("SELECT EXISTS (SELECT 1 FROM staff_roles WHERE key = :k)"), {"k": key}
        )
    )


async def update_role(
    session: AsyncSession,
    *,
    role_id: uuid.UUID,
    name: str,
    description: str | None,
    updated_by: uuid.UUID,
) -> None:
    await session.execute(
        update(StaffRole)
        .where(StaffRole.id == role_id)
        .values(name=name, description=description, updated_by=updated_by)
    )


async def replace_permissions(
    session: AsyncSession, *, role_id: uuid.UUID, permissions: Iterable[str]
) -> None:
    await session.execute(delete(StaffRolePermission).where(StaffRolePermission.role_id == role_id))
    rows = [{"role_id": role_id, "permission": p} for p in sorted(set(permissions))]
    if rows:
        await session.execute(insert(StaffRolePermission), rows)


async def archive_role(session: AsyncSession, *, role_id: uuid.UUID, by: uuid.UUID) -> None:
    await session.execute(
        update(StaffRole)
        .where(StaffRole.id == role_id)
        .values(status="ARCHIVED", archived_at=text("now()"), updated_by=by)
    )


# ---------------------------------------------------------------------------
# Staff and assignments
# ---------------------------------------------------------------------------
async def staff_rows(
    session: AsyncSession,
    *,
    platform_tenant_id: uuid.UUID,
    user_ids: Sequence[uuid.UUID] | None = None,
    email_contains: str | None = None,
    status: str | None = None,
    after_email: str | None = None,
    limit: int = 100,
) -> Sequence[RowMapping]:
    """Members of the PLATFORM tenant, by email. A key of `(email, user_id)`
    pages them; an email is unique, so the email alone orders them."""
    clauses = ["m.tenant_id = :t"]
    params: dict[str, Any] = {"t": str(platform_tenant_id), "lim": limit}
    if user_ids is not None:
        clauses.append("m.user_id = ANY(CAST(:ids AS uuid[]))")
        params["ids"] = [str(u) for u in user_ids]
    if email_contains:
        clauses.append("u.email ILIKE :q ESCAPE '\\'")
        escaped = email_contains.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params["q"] = f"%{escaped}%"
    if status is not None:
        clauses.append("m.status = :s")
        params["s"] = status
    if after_email is not None:
        clauses.append("coalesce(u.email, '') > :after")
        params["after"] = after_email
    return (
        (
            await session.execute(
                text(
                    f"""
                    SELECT m.user_id, u.email, m.status, m.created_at AS joined_at,
                           (u.cognito_sub IS NOT NULL) AS signed_in
                      FROM memberships m
                      JOIN users u ON u.id = m.user_id
                     WHERE {" AND ".join(clauses)}
                     ORDER BY coalesce(u.email, ''), m.user_id
                     LIMIT :lim
                    """  # noqa: S608 - module constants, not values
                ),
                params,
            )
        )
        .mappings()
        .all()
    )


async def is_staff_email(
    session: AsyncSession, *, platform_tenant_id: uuid.UUID, email: str
) -> bool:
    """Whether `email` (normalised) holds a PLATFORM membership, active or not."""
    return bool(
        await session.scalar(
            text(
                "SELECT EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id "
                "WHERE m.tenant_id = :t AND u.email = :e)"
            ),
            {"t": str(platform_tenant_id), "e": email},
        )
    )


async def active_super_admin_count(session: AsyncSession) -> int:
    """The count `guard_last_super_admin` keeps above zero: live SUPER_ADMIN
    assignments of people whose staff membership is ACTIVE."""
    value = await session.scalar(
        text(
            """
            SELECT count(DISTINCT a.user_id)
              FROM staff_role_assignments a
              JOIN staff_roles r ON r.id = a.role_id AND r.key = 'SUPER_ADMIN'
              JOIN memberships m ON m.user_id = a.user_id AND m.status = 'ACTIVE'
              JOIN tenants t ON t.id = m.tenant_id AND t.type = 'PLATFORM'
             WHERE a.revoked_at IS NULL
            """
        )
    )
    return int(value or 0)


async def assignments_of(
    session: AsyncSession, *, user_ids: Sequence[uuid.UUID]
) -> Sequence[RowMapping]:
    """Unrevoked assignments, expired ones included (marked so)."""
    if not user_ids:
        return []
    return (
        (
            await session.execute(
                text(
                    """
                    SELECT a.id, a.user_id, a.role_id, r.key AS role_key, r.name AS role_name,
                           r.is_system, r.status AS role_status, a.scope_tenant_ids,
                           a.expires_at, (a.expires_at IS NOT NULL AND a.expires_at <= now())
                             AS expired,
                           a.reason, a.granted_by, a.granted_at
                      FROM staff_role_assignments a
                      JOIN staff_roles r ON r.id = a.role_id
                     WHERE a.user_id = ANY(CAST(:ids AS uuid[])) AND a.revoked_at IS NULL
                     ORDER BY a.granted_at, a.id
                    """
                ),
                {"ids": [str(u) for u in user_ids]},
            )
        )
        .mappings()
        .all()
    )


async def insert_assignment(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
    scope_tenant_ids: list[uuid.UUID] | None,
    expires_at: datetime | None,
    reason: str | None,
    granted_by: uuid.UUID | None,
) -> uuid.UUID:
    assignment_id = uuid.uuid4()
    await session.execute(
        insert(StaffRoleAssignment).values(
            id=assignment_id,
            user_id=user_id,
            role_id=role_id,
            scope_tenant_ids=scope_tenant_ids,
            expires_at=expires_at,
            reason=reason,
            granted_by=granted_by,
        )
    )
    return assignment_id


async def live_assignment(
    session: AsyncSession, *, user_id: uuid.UUID, role_id: uuid.UUID
) -> uuid.UUID | None:
    value = await session.scalar(
        select(StaffRoleAssignment.id).where(
            StaffRoleAssignment.user_id == user_id,
            StaffRoleAssignment.role_id == role_id,
            StaffRoleAssignment.revoked_at.is_(None),
        )
    )
    return value


async def get_assignment(
    session: AsyncSession, *, assignment_id: uuid.UUID
) -> StaffRoleAssignment | None:
    return (
        await session.execute(
            select(StaffRoleAssignment)
            .where(StaffRoleAssignment.id == assignment_id)
            .with_for_update()
        )
    ).scalar_one_or_none()


async def revoke_assignment(
    session: AsyncSession, *, assignment_id: uuid.UUID, by: uuid.UUID, reason: str
) -> None:
    await session.execute(
        update(StaffRoleAssignment)
        .where(StaffRoleAssignment.id == assignment_id, StaffRoleAssignment.revoked_at.is_(None))
        .values(revoked_at=text("now()"), revoked_by=by, revoke_reason=reason)
    )


async def holders_of(
    session: AsyncSession,
    *,
    platform_tenant_id: uuid.UUID,
    system_role_keys: Iterable[str],
    permission: str,
) -> list[uuid.UUID]:
    """Active staff holding `permission` for every organisation: a live,
    unexpired, unscoped assignment of a system role that grants it, or of an
    active custom role whose rows do."""
    rows = await session.execute(
        text(
            f"""
            SELECT DISTINCT a.user_id
              FROM staff_role_assignments a
              JOIN staff_roles r ON r.id = a.role_id AND r.status = 'ACTIVE'
              JOIN memberships m ON m.user_id = a.user_id AND m.tenant_id = :t
                               AND m.status = 'ACTIVE'
             WHERE {_LIVE} AND a.scope_tenant_ids IS NULL
               AND ((r.is_system AND r.key = ANY(CAST(:keys AS text[])))
                    OR (NOT r.is_system AND EXISTS (
                          SELECT 1 FROM staff_role_permissions p
                           WHERE p.role_id = r.id AND p.permission = :p)))
             ORDER BY a.user_id
            """  # noqa: S608 - module constants, not values
        ),
        {"t": str(platform_tenant_id), "keys": sorted(system_role_keys), "p": permission},
    )
    return [r[0] for r in rows.all()]


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
async def access_events(
    session: AsyncSession,
    *,
    actions: Sequence[str],
    target_user_id: uuid.UUID | None,
    before_id: int | None,
    limit: int,
) -> Sequence[RowMapping]:
    """Newest first, keyed by the audit row's own id."""
    clauses = ["action = ANY(CAST(:actions AS text[]))"]
    params: dict[str, Any] = {"actions": list(actions), "lim": limit}
    if target_user_id is not None:
        clauses.append("(target_id = :target OR actor_id = CAST(:target AS uuid))")
        params["target"] = str(target_user_id)
    if before_id is not None:
        clauses.append("id < :before")
        params["before"] = before_id
    return (
        (
            await session.execute(
                text(
                    f"""
                    SELECT id, actor_id, action, target_type, target_id, request_id,
                           metadata, occurred_at
                      FROM audit_events
                     WHERE {" AND ".join(clauses)}
                     ORDER BY id DESC
                     LIMIT :lim
                    """  # noqa: S608 - module constants, not values
                ),
                params,
            )
        )
        .mappings()
        .all()
    )
