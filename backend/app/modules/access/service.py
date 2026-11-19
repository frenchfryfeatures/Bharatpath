"""access - business logic

Access management for our own staff (2026-11-19). Who may call what is the
router's `require_permission`; this module holds the rules a change must keep:

* **Nobody changes their own access** -- not their roles, not their status.
* **SUPER_ADMIN is all or nothing**: no scope, no expiry, and the last one
  cannot be removed or suspended. The service checks first so the answer is a
  clear 409; `guard_last_super_admin` in migration 0022 holds it for every
  writer regardless.
* **System roles are code.** They cannot be edited or archived; a custom role
  can, and a role still held cannot be archived.
* **A change bites on the next request.** Every write marks the affected
  people's cached access as changed before it commits
  (`app.core.auth.staff_access.mark_changed`).
* **Every change is an audit row** with the before and after, the reason (the
  `X-Access-Reason` the step-up already required), and the actor's IP address
  and user agent, in the same transaction.
* **The invitation is sent last**, as every account made on someone's behalf
  is: a refusal anywhere before it emails nobody, and a Cognito failure rolls
  the rows back (502 `account_directory_unavailable`).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

from sqlalchemy import RowMapping
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, audit_event
from app.core.auth import membership as membership_lookup
from app.core.auth import staff_access
from app.core.auth.directory import DirectoryError, get_account_directory
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.core.staff_permissions import (
    BY_KEY,
    GRANTABLE,
    PERMISSIONS,
    PLATFORM_STAFF,
    SUPER_ADMIN,
    Grant,
    StaffAccess,
    roles_granting,
    system_role_permissions,
)
from app.core.tenant import TenantContext
from app.modules.access import repository
from app.modules.access.domain import (
    assignment_refusal,
    custom_role_refusal,
    high_risk_added,
    permission_diff,
    role_key_for,
    self_change_refusal,
)
from app.modules.access.schemas import (
    AccessEventRow,
    AccessHistoryPage,
    AssignmentView,
    InviteStaffRequest,
    InviteStaffResponse,
    MyAccess,
    MyRole,
    PermissionGroup,
    PermissionView,
    RoleChangeImpact,
    RoleGrant,
    RoleRequest,
    RoleView,
    StaffMemberView,
    StaffPage,
)
from app.modules.identity import service as identity_service

logger = get_logger(__name__)

#: The audit actions the Access Management "Audit History" tab lists.
ACCESS_AUDIT_ACTIONS: Final[tuple[str, ...]] = (
    AuditAction.STAFF_INVITED.value,
    AuditAction.STAFF_ROLE_ASSIGNED.value,
    AuditAction.STAFF_ROLE_REVOKED.value,
    AuditAction.STAFF_SUSPENDED.value,
    AuditAction.STAFF_REINSTATED.value,
    AuditAction.STAFF_ROLE_CREATED.value,
    AuditAction.STAFF_ROLE_UPDATED.value,
    AuditAction.STAFF_ROLE_ARCHIVED.value,
    AuditAction.STAFF_SENSITIVE_ACCESS.value,
)


# ---------------------------------------------------------------------------
# Errors. Codes, never sentences.
# ---------------------------------------------------------------------------
class StaffMemberNotFoundError(NotFoundError):
    code = "staff_member_not_found"
    title = "No such member of staff"


class StaffRoleNotFoundError(NotFoundError):
    code = "staff_role_not_found"
    title = "No such role"


class StaffAssignmentNotFoundError(NotFoundError):
    code = "staff_assignment_not_found"
    title = "No such role assignment"


class AccessChangeRefusedError(ConflictError):
    """A change the rules refuse; `code` says which rule."""

    code = "access_change_refused"
    title = "This access change is not allowed"


@dataclass(frozen=True, slots=True)
class RequestMeta:
    """What every access-management audit row records about the request."""

    reason: str | None
    request_id: str | None
    ip: str | None
    user_agent: str | None

    def audit(self) -> dict[str, Any]:
        return {
            "reason": self.reason,
            "ip": self.ip,
            "user_agent": (self.user_agent or "")[:200] or None,
        }


def _now() -> datetime:
    return datetime.now(UTC)


def _refuse(code: str | None) -> None:
    if code is not None:
        raise AccessChangeRefusedError(code=code)


def _invalid(code: str | None) -> None:
    if code is not None:
        raise ValidationError(code=code)


async def _platform_tenant(session: AsyncSession) -> uuid.UUID:
    tenant_id = await identity_service.platform_tenant_id(session)
    if tenant_id is None:  # pragma: no cover - a caller of this is staff, so it exists
        raise StaffMemberNotFoundError()
    return tenant_id


def _last_super_admin(exc: DBAPIError) -> bool:
    return "LAST_SUPER_ADMIN" in str(exc.orig)


# ---------------------------------------------------------------------------
# The catalogue and the caller's own access
# ---------------------------------------------------------------------------
def permission_catalogue() -> list[PermissionGroup]:
    groups: dict[str, list[PermissionView]] = {}
    for spec in PERMISSIONS:
        groups.setdefault(spec.module, []).append(
            PermissionView(
                key=spec.key,
                module=spec.module,
                label=spec.label,
                risk=spec.risk,
                super_admin_only=spec.super_admin_only,
                requires=list(spec.requires),
                scopable=spec.scopable,
            )
        )
    return [PermissionGroup(module=m, permissions=p) for m, p in groups.items()]


def my_access(ctx: TenantContext) -> MyAccess:
    staff = ctx.staff or StaffAccess()
    every = staff.unscoped_permissions
    return MyAccess(
        roles=[
            MyRole(
                key=g.role_key,
                name=g.role_name,
                scope_tenant_ids=None
                if g.scope_tenant_ids is None
                else sorted(g.scope_tenant_ids, key=str),
                expires_at=g.expires_at,
            )
            for g in staff.grants
        ],
        permissions=sorted(every),
        scoped_permissions=sorted(staff.permissions - every),
        is_super_admin=staff.is_super_admin,
    )


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
async def list_roles(session: AsyncSession, *, include_archived: bool = False) -> list[RoleView]:
    rows = await repository.list_roles(session, include_archived=include_archived)
    custom = await repository.role_permissions(
        session, role_ids=[r["id"] for r in rows if not r["is_system"]]
    )
    return [_role_view(r, custom.get(r["id"], [])) for r in rows]


async def get_role(session: AsyncSession, *, role_id: uuid.UUID) -> RoleView:
    for role in await list_roles(session, include_archived=True):
        if role.id == role_id:
            return role
    raise StaffRoleNotFoundError()


def _role_view(row: RowMapping, custom_permissions: list[str]) -> RoleView:
    permissions = (
        sorted(system_role_permissions(row["key"])) if row["is_system"] else custom_permissions
    )
    return RoleView(
        id=row["id"],
        key=row["key"],
        name=row["name"],
        description=row["description"],
        is_system=row["is_system"],
        status=row["status"],
        permissions=permissions,
        holders=int(row["holders"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def role_impact(
    session: AsyncSession, *, role_id: uuid.UUID, permissions: Iterable[str]
) -> RoleChangeImpact:
    """What saving `permissions` would change, without saving it."""
    role = await get_role(session, role_id=role_id)
    after = sorted(set(permissions))
    diff = permission_diff(role.permissions, after)
    refusal = (
        "system_role_fixed"
        if role.is_system
        else custom_role_refusal(name=role.name, permissions=after)
    )
    return RoleChangeImpact(
        holders=role.holders,
        added=diff["added"],
        removed=diff["removed"],
        high_risk_added=high_risk_added(role.permissions, after),
        refusal=refusal,
    )


async def create_role(
    session: AsyncSession, *, ctx: TenantContext, payload: RoleRequest, meta: RequestMeta
) -> RoleView:
    permissions = sorted(set(payload.permissions))
    _invalid(custom_role_refusal(name=payload.name, permissions=permissions))
    await repository.lock(session)
    key = await _free_key(session, role_key_for(payload.name))
    role_id = await repository.insert_role(
        session,
        key=key,
        name=payload.name.strip(),
        description=payload.description,
        created_by=ctx.user_id,
    )
    await repository.replace_permissions(session, role_id=role_id, permissions=permissions)
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_ROLE_CREATED,
        target_type="staff_role",
        target_id=role_id,
        metadata={"key": key, "permissions": permissions},
    )
    return await get_role(session, role_id=role_id)


async def _free_key(session: AsyncSession, base: str) -> str:
    key, n = base, 2
    while await repository.key_taken(session, key=key):
        suffix = f"_{n}"
        key = f"{base[: 64 - len(suffix)]}{suffix}"
        n += 1
    return key


async def update_role(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    role_id: uuid.UUID,
    payload: RoleRequest,
    meta: RequestMeta,
) -> RoleView:
    await repository.lock(session)
    role = await repository.get_role(session, role_id=role_id, lock=True)
    if role is None:
        raise StaffRoleNotFoundError()
    _refuse("system_role_fixed" if role.is_system else None)
    _refuse("role_archived" if role.status != "ACTIVE" else None)
    after = sorted(set(payload.permissions))
    _invalid(custom_role_refusal(name=payload.name, permissions=after))
    before = (await repository.role_permissions(session, role_ids=[role_id]))[role_id]
    holders = await repository.role_holders(session, role_id=role_id)
    await staff_access.mark_changed(holders)
    await repository.update_role(
        session,
        role_id=role_id,
        name=payload.name.strip(),
        description=payload.description,
        updated_by=ctx.user_id,
    )
    await repository.replace_permissions(session, role_id=role_id, permissions=after)
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_ROLE_UPDATED,
        target_type="staff_role",
        target_id=role_id,
        metadata={
            "key": role.key,
            "name_before": role.name,
            "name_after": payload.name.strip(),
            "permissions_before": before,
            "permissions_after": after,
            **permission_diff(before, after),
            "holders_affected": len(holders),
        },
    )
    return await get_role(session, role_id=role_id)


async def duplicate_role(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    role_id: uuid.UUID,
    name: str,
    meta: RequestMeta,
) -> RoleView:
    """A new custom role with the source's permissions. Copying SUPER_ADMIN
    drops what only it may hold, so the copy is an Operations Admin."""
    source = await get_role(session, role_id=role_id)
    return await create_role(
        session,
        ctx=ctx,
        payload=RoleRequest(
            name=name,
            description=source.description,
            permissions=sorted(set(source.permissions) & GRANTABLE),
        ),
        meta=meta,
    )


async def archive_role(
    session: AsyncSession, *, ctx: TenantContext, role_id: uuid.UUID, meta: RequestMeta
) -> RoleView:
    await repository.lock(session)
    role = await repository.get_role(session, role_id=role_id, lock=True)
    if role is None:
        raise StaffRoleNotFoundError()
    _refuse("system_role_fixed" if role.is_system else None)
    if role.status == "ARCHIVED":
        return await get_role(session, role_id=role_id)
    # Held by anyone, expired grants aside: archive is not a quiet revoke.
    _refuse("role_in_use" if await repository.live_holder_count(session, role_id=role_id) else None)
    await staff_access.mark_changed(await repository.role_holders(session, role_id=role_id))
    await repository.archive_role(session, role_id=role_id, by=ctx.user_id)
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_ROLE_ARCHIVED,
        target_type="staff_role",
        target_id=role_id,
        metadata={"key": role.key},
    )
    return await get_role(session, role_id=role_id)


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------
async def list_staff(
    session: AsyncSession,
    *,
    query: str | None,
    status: str | None,
    cursor: str | None,
    limit: int | None,
) -> StaffPage:
    size = max(1, min(limit or 50, 200))
    tenant_id = await identity_service.platform_tenant_id(session)
    if tenant_id is None:
        return StaffPage(items=[], next_cursor=None)
    rows = await repository.staff_rows(
        session,
        platform_tenant_id=tenant_id,
        email_contains=(query or "").strip().lower() or None,
        status=status,
        after_email=cursor,
        limit=size + 1,
    )
    page = list(rows[:size])
    items = await _members(session, page)
    more = len(rows) > size
    return StaffPage(items=items, next_cursor=(page[-1]["email"] or "") if more else None)


async def get_staff(session: AsyncSession, *, user_id: uuid.UUID) -> StaffMemberView:
    tenant_id = await identity_service.platform_tenant_id(session)
    if tenant_id is None:
        raise StaffMemberNotFoundError()
    rows = await repository.staff_rows(
        session, platform_tenant_id=tenant_id, user_ids=[user_id], limit=1
    )
    if not rows:
        raise StaffMemberNotFoundError()
    return (await _members(session, rows))[0]


async def _members(session: AsyncSession, rows: Sequence[RowMapping]) -> list[StaffMemberView]:
    assignments = await repository.assignments_of(session, user_ids=[r["user_id"] for r in rows])
    custom = await repository.role_permissions(
        session, role_ids={a["role_id"] for a in assignments if not a["is_system"]}
    )
    by_user: dict[uuid.UUID, list[RowMapping]] = {}
    for a in assignments:
        by_user.setdefault(a["user_id"], []).append(a)
    now = _now()
    out = []
    for row in rows:
        held = by_user.get(row["user_id"], [])
        access = StaffAccess.from_grants(
            (
                Grant(
                    role_key=a["role_key"],
                    role_name=a["role_name"],
                    permissions=system_role_permissions(a["role_key"])
                    if a["is_system"]
                    else frozenset(custom.get(a["role_id"], [])),
                    scope_tenant_ids=None
                    if a["scope_tenant_ids"] is None
                    else frozenset(a["scope_tenant_ids"]),
                    expires_at=a["expires_at"],
                )
                for a in held
                if a["role_status"] == "ACTIVE"
            ),
            now=now,
        )
        out.append(
            StaffMemberView(
                user_id=row["user_id"],
                email=row["email"],
                status=row["status"],
                signed_in=bool(row["signed_in"]),
                joined_at=row["joined_at"],
                roles=[_assignment_view(a) for a in held],
                effective_permissions=sorted(access.permissions)
                if row["status"] == "ACTIVE"
                else [],
            )
        )
    return out


def _assignment_view(a: RowMapping) -> AssignmentView:
    return AssignmentView(
        id=a["id"],
        role_id=a["role_id"],
        role_key=a["role_key"],
        role_name=a["role_name"],
        is_system=a["is_system"],
        scope_tenant_ids=None if a["scope_tenant_ids"] is None else list(a["scope_tenant_ids"]),
        expires_at=a["expires_at"],
        expired=bool(a["expired"]),
        reason=a["reason"],
        granted_by=a["granted_by"],
        granted_at=a["granted_at"],
    )


async def _check_grant(session: AsyncSession, grant: RoleGrant) -> tuple[uuid.UUID, str]:
    role = await repository.get_role(session, role_id=grant.role_id)
    if role is None:
        raise StaffRoleNotFoundError()
    permissions = (
        system_role_permissions(role.key)
        if role.is_system
        else frozenset((await repository.role_permissions(session, role_ids=[role.id]))[role.id])
    )
    scope = None if grant.scope_tenant_ids is None else sorted(set(grant.scope_tenant_ids), key=str)
    _invalid(
        assignment_refusal(
            role_key=role.key,
            role_active=role.status == "ACTIVE",
            role_permissions=permissions,
            scope_tenant_ids=scope,
            expires_at=grant.expires_at,
            now=_now(),
        )
    )
    return role.id, role.key


async def invite_staff(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    payload: InviteStaffRequest,
    meta: RequestMeta,
) -> InviteStaffResponse:
    """Make an address a member of staff with these roles, then email the
    sign-in. Refused for an address that is staff already (assign a role
    instead) or that belongs to a candidate or an organisation."""
    email = identity_service.normalise_email(str(payload.email))
    await repository.lock(session)
    if len({g.role_id for g in payload.roles}) != len(payload.roles):
        raise ValidationError(code="role_repeated")
    checked = [(g, *await _check_grant(session, g)) for g in payload.roles]
    tenant_id = await identity_service.platform_tenant_id(session)
    if tenant_id is not None and await repository.is_staff_email(
        session, platform_tenant_id=tenant_id, email=email
    ):
        # Suspended staff included: reinstate them, or assign a role.
        raise AccessChangeRefusedError(code="staff_already_member")
    tenant_id, user_id = await identity_service.provision_platform_staff(session, email=email)
    for grant, role_id, _key in checked:
        await repository.insert_assignment(
            session,
            user_id=user_id,
            role_id=role_id,
            scope_tenant_ids=_scope(grant),
            expires_at=grant.expires_at,
            reason=meta.reason,
            granted_by=ctx.user_id,
        )
    await staff_access.mark_changed([user_id])
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_INVITED,
        target_type="staff_member",
        target_id=user_id,
        metadata={"roles": [_grant_audit(g, key) for g, _id, key in checked]},
    )
    outcome = await identity_service.send_invitation(pool="BUSINESS", email=email)
    return InviteStaffResponse(member=await get_staff(session, user_id=user_id), invitation=outcome)


def _scope(grant: RoleGrant) -> list[uuid.UUID] | None:
    if grant.scope_tenant_ids is None:
        return None
    return sorted(set(grant.scope_tenant_ids), key=str)


def _grant_audit(grant: RoleGrant, role_key: str) -> dict[str, Any]:
    scope = _scope(grant)
    return {
        "role_key": role_key,
        "scope_tenant_ids": None if scope is None else [str(t) for t in scope],
        "expires_at": None if grant.expires_at is None else grant.expires_at.isoformat(),
    }


async def _target(session: AsyncSession, ctx: TenantContext, user_id: uuid.UUID) -> StaffMemberView:
    _refuse(self_change_refusal(actor_id=ctx.user_id, target_id=user_id))
    return await get_staff(session, user_id=user_id)


async def assign_role(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    grant: RoleGrant,
    meta: RequestMeta,
) -> StaffMemberView:
    await repository.lock(session)
    member = await _target(session, ctx, user_id)
    _refuse("staff_suspended" if member.status != "ACTIVE" else None)
    role_id, role_key = await _check_grant(session, grant)
    if await repository.live_assignment(session, user_id=user_id, role_id=role_id) is not None:
        raise AccessChangeRefusedError(code="role_already_held")
    roles_before = sorted(r.role_key for r in member.roles)
    await staff_access.mark_changed([user_id])
    await repository.insert_assignment(
        session,
        user_id=user_id,
        role_id=role_id,
        scope_tenant_ids=_scope(grant),
        expires_at=grant.expires_at,
        reason=meta.reason,
        granted_by=ctx.user_id,
    )
    after = await get_staff(session, user_id=user_id)
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_ROLE_ASSIGNED,
        target_type="staff_member",
        target_id=user_id,
        metadata={
            **_grant_audit(grant, role_key),
            "roles_before": roles_before,
            "roles_after": sorted(r.role_key for r in after.roles),
            "permissions_before": member.effective_permissions,
            "permissions_after": after.effective_permissions,
        },
    )
    return after


async def revoke_assignment(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    assignment_id: uuid.UUID,
    meta: RequestMeta,
) -> StaffMemberView:
    await repository.lock(session)
    member = await _target(session, ctx, user_id)
    held = next((r for r in member.roles if r.id == assignment_id), None)
    if held is None:
        raise StaffAssignmentNotFoundError()
    if held.role_key == SUPER_ADMIN and member.status == "ACTIVE":
        _refuse("last_super_admin" if await _active_super_admins(session) <= 1 else None)
    await staff_access.mark_changed([user_id])
    try:
        await repository.revoke_assignment(
            session, assignment_id=assignment_id, by=ctx.user_id, reason=meta.reason or ""
        )
    except DBAPIError as exc:
        if _last_super_admin(exc):
            raise AccessChangeRefusedError(code="last_super_admin") from exc
        raise
    after = await get_staff(session, user_id=user_id)
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_ROLE_REVOKED,
        target_type="staff_member",
        target_id=user_id,
        metadata={
            "assignment_id": str(assignment_id),
            "role_key": held.role_key,
            "roles_before": sorted(r.role_key for r in member.roles),
            "roles_after": sorted(r.role_key for r in after.roles),
            "permissions_before": member.effective_permissions,
            "permissions_after": after.effective_permissions,
        },
    )
    return after


async def _active_super_admins(session: AsyncSession) -> int:
    return await repository.active_super_admin_count(session)


async def suspend_staff(
    session: AsyncSession, *, ctx: TenantContext, user_id: uuid.UUID, meta: RequestMeta
) -> StaffMemberView:
    """Stop a member of staff now: membership revoked (their next request is
    refused), cached access distrusted, and every Cognito session ended."""
    await repository.lock(session)
    member = await _target(session, ctx, user_id)
    if member.status != "ACTIVE":
        return member
    if any(r.role_key == SUPER_ADMIN and not r.expired for r in member.roles):
        _refuse("last_super_admin" if await _active_super_admins(session) <= 1 else None)
    tenant_id = await _platform_tenant(session)
    await membership_lookup.mark_tenant_changed(tenant_id, [user_id])
    await staff_access.mark_changed([user_id])
    try:
        await identity_service.revoke_membership(session, user_id=user_id, tenant_id=tenant_id)
    except DBAPIError as exc:
        if _last_super_admin(exc):
            raise AccessChangeRefusedError(code="last_super_admin") from exc
        raise
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_SUSPENDED,
        target_type="staff_member",
        target_id=user_id,
        metadata={
            "roles": sorted(r.role_key for r in member.roles),
            "permissions_before": member.effective_permissions,
        },
    )
    await _end_sessions(session, user_id)
    return await get_staff(session, user_id=user_id)


async def reinstate_staff(
    session: AsyncSession, *, ctx: TenantContext, user_id: uuid.UUID, meta: RequestMeta
) -> StaffMemberView:
    """Undo a suspension. The roles they held come back with them: a
    suspension stops a person, it does not rewrite what they were given."""
    await repository.lock(session)
    member = await _target(session, ctx, user_id)
    if member.status == "ACTIVE":
        return member
    tenant_id = await _platform_tenant(session)
    await membership_lookup.mark_tenant_changed(tenant_id, [user_id])
    await staff_access.mark_changed([user_id])
    await identity_service.grant_membership(
        session, user_id=user_id, tenant_id=tenant_id, role=PLATFORM_STAFF
    )
    after = await get_staff(session, user_id=user_id)
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_REINSTATED,
        target_type="staff_member",
        target_id=user_id,
        metadata={"roles": sorted(r.role_key for r in after.roles)},
    )
    return after


async def _end_sessions(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Best effort, after the rows: the revoked membership already refuses
    every request, so a Cognito failure here leaves refresh tokens that can
    mint only refused tokens. Logged, never raised."""
    subject = await staff_access.cognito_subject(session, user_id)
    if subject is None:
        return
    try:
        await get_account_directory().sign_out_everywhere(pool="BUSINESS", subject=subject)
    except DirectoryError as exc:
        logger.warning("staff_sign_out_failed", code=exc.code)


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
async def access_history(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    target_user_id: uuid.UUID | None,
    cursor: str | None,
    limit: int | None,
    meta: RequestMeta,
) -> AccessHistoryPage:
    size = max(1, min(limit or 50, 200))
    try:
        before = int(cursor) if cursor else None
    except ValueError as exc:
        raise ValidationError(code="invalid_cursor") from exc
    await _audit(
        session,
        ctx,
        meta,
        action=AuditAction.STAFF_ACCESS_HISTORY_READ,
        target_type="audit_events",
        target_id=target_user_id,
        metadata={"filtered": target_user_id is not None},
    )
    rows = await repository.access_events(
        session,
        actions=ACCESS_AUDIT_ACTIONS,
        target_user_id=target_user_id,
        before_id=before,
        limit=size + 1,
    )
    page = rows[:size]
    return AccessHistoryPage(
        items=[AccessEventRow.model_validate(dict(r)) for r in page],
        next_cursor=str(page[-1]["id"]) if len(rows) > size else None,
    )


# ---------------------------------------------------------------------------
# For other modules and scripts
# ---------------------------------------------------------------------------
async def staff_holding(session: AsyncSession, *, permission: str) -> list[uuid.UUID]:
    """Active staff who hold `permission` for every organisation -- who hears
    about work waiting behind it (the KYB queue)."""
    if permission not in BY_KEY:
        raise ValueError(f"unknown permission: {permission}")
    tenant_id = await identity_service.platform_tenant_id(session)
    if tenant_id is None:
        return []
    return await repository.holders_of(
        session,
        platform_tenant_id=tenant_id,
        system_role_keys=roles_granting(permission),
        permission=permission,
    )


async def provision_staff(
    session: AsyncSession,
    *,
    email: str,
    role_keys: Iterable[str],
    reason: str = "provisioned by script",
) -> tuple[uuid.UUID, uuid.UUID]:
    """A member of staff with these system or custom roles, unscoped and
    without expiry: `scripts/create_platform_staff.py` (the first SUPER_ADMIN
    of an environment) and the tests. No route calls it; the console invites
    through `invite_staff`, which checks and audits. Returns
    `(tenant_id, user_id)`. Re-running it for a role already held is a no-op."""
    tenant_id, user_id = await identity_service.provision_platform_staff(
        session, email=identity_service.normalise_email(email)
    )
    for key in role_keys:
        role = await repository.get_role_by_key(session, key=key)
        if role is None:
            raise ValueError(f"no such staff role: {key}")
        if await repository.live_assignment(session, user_id=user_id, role_id=role.id) is None:
            await repository.insert_assignment(
                session,
                user_id=user_id,
                role_id=role.id,
                scope_tenant_ids=None,
                expires_at=None,
                reason=reason,
                granted_by=None,
            )
    await staff_access.mark_changed([user_id])
    return tenant_id, user_id


async def _audit(
    session: AsyncSession,
    ctx: TenantContext,
    meta: RequestMeta,
    *,
    action: AuditAction,
    target_type: str,
    target_id: uuid.UUID | None,
    metadata: dict[str, Any],
) -> None:
    await audit_event(
        session,
        action=action,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type=target_type,
        target_id=target_id,
        request_id=meta.request_id,
        metadata={**metadata, **meta.audit()},
    )
