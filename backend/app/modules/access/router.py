"""access - HTTP layer: the console's Access Management screen (`/admin/access`).

Routes only. Every one names its permission (`require_permission`), and
`tests/invariants/test_admin_console.py` holds them to `ROUTE_PERMISSION`
like every other console route.

Tabs, and what serves them:

* **Admin Users** -- `GET /staff`, `GET /staff/{user_id}`, `POST /staff`
  (invite), `POST /staff/{user_id}/roles`, `POST .../roles/{assignment_id}/revoke`,
  `POST /staff/{user_id}/suspend`, `POST /staff/{user_id}/reinstate`.
* **Roles** -- `GET /roles`, `GET /roles/{id}`, `POST /roles`,
  `PUT /roles/{id}`, `POST /roles/{id}/impact` (who a change affects, before
  it is saved), `POST /roles/{id}/duplicate`, `POST /roles/{id}/archive`.
* **Permissions** -- `GET /permissions`.
* **Audit History** -- `GET /history`.
* **Me** -- `GET /me`, any member of staff: what to show them.

Every write is CRITICAL (SUPER_ADMIN's alone): it needs `X-Access-Reason`, an
enrolled authenticator and a sign-in in the last few minutes, and the reason
lands on the audit row beside the before and after.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.deps import (
    CurrentUser,
    DbSession,
    access_reason,
    client_ip,
    get_request_id,
    require_permission,
)
from app.core.errors import PermissionDeniedError
from app.modules.access import service
from app.modules.access.schemas import (
    AccessHistoryPage,
    DuplicateRoleRequest,
    InviteStaffRequest,
    InviteStaffResponse,
    MyAccess,
    PermissionGroup,
    RoleChangeImpact,
    RoleGrant,
    RoleRequest,
    RoleView,
    StaffMemberView,
    StaffPage,
)

router = APIRouter()


def can(permission: str) -> list[Any]:
    return [Depends(require_permission(permission))]


def _meta(request: Request) -> service.RequestMeta:
    return service.RequestMeta(
        reason=access_reason(request),
        request_id=get_request_id(request),
        ip=client_ip(request),
        user_agent=request.headers.get("User-Agent"),
    )


# --- me ------------------------------------------------------------------------------
@router.get("/me", response_model=MyAccess, summary="The caller's own roles and permissions")
async def my_access(user: CurrentUser) -> MyAccess:
    """Any member of staff. The console reads it to decide which pages and
    buttons to show; every request is still checked on its own."""
    if user.staff is None:
        raise PermissionDeniedError()
    return service.my_access(user)


# --- permissions ---------------------------------------------------------------------
@router.get(
    "/permissions",
    response_model=list[PermissionGroup],
    dependencies=can("admins.view"),
    summary="The permission catalogue, grouped by module",
)
async def list_permissions() -> list[PermissionGroup]:
    return service.permission_catalogue()


# --- roles ---------------------------------------------------------------------------
@router.get("/roles", response_model=list[RoleView], dependencies=can("admins.view"))
async def list_roles(
    session: DbSession, include_archived: bool = Query(default=False)
) -> list[RoleView]:
    """System roles first, then custom ones. `holders` is how many people a
    change would affect."""
    return await service.list_roles(session, include_archived=include_archived)


@router.get("/roles/{role_id}", response_model=RoleView, dependencies=can("admins.view"))
async def get_role(role_id: uuid.UUID, session: DbSession) -> RoleView:
    return await service.get_role(session, role_id=role_id)


@router.post(
    "/roles/{role_id}/impact",
    response_model=RoleChangeImpact,
    dependencies=can("admins.view"),
    summary="What saving these permissions would change, without saving",
)
async def role_impact(
    role_id: uuid.UUID, payload: RoleRequest, session: DbSession
) -> RoleChangeImpact:
    return await service.role_impact(session, role_id=role_id, permissions=payload.permissions)


@router.post(
    "/roles",
    response_model=RoleView,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("roles.manage"),
)
async def create_role(
    payload: RoleRequest, request: Request, user: CurrentUser, session: DbSession
) -> RoleView:
    return await service.create_role(session, ctx=user, payload=payload, meta=_meta(request))


@router.put("/roles/{role_id}", response_model=RoleView, dependencies=can("roles.manage"))
async def update_role(
    role_id: uuid.UUID,
    payload: RoleRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> RoleView:
    """A custom role only; system roles are code. Takes effect for every
    holder on their next request."""
    return await service.update_role(
        session, ctx=user, role_id=role_id, payload=payload, meta=_meta(request)
    )


@router.post(
    "/roles/{role_id}/duplicate",
    response_model=RoleView,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("roles.manage"),
)
async def duplicate_role(
    role_id: uuid.UUID,
    payload: DuplicateRoleRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> RoleView:
    return await service.duplicate_role(
        session, ctx=user, role_id=role_id, name=payload.name, meta=_meta(request)
    )


@router.post("/roles/{role_id}/archive", response_model=RoleView, dependencies=can("roles.manage"))
async def archive_role(
    role_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> RoleView:
    """Refused (409 `role_in_use`) while anyone holds it: remove it from them first."""
    return await service.archive_role(session, ctx=user, role_id=role_id, meta=_meta(request))


# --- staff ---------------------------------------------------------------------------
@router.get("/staff", response_model=StaffPage, dependencies=can("admins.view"))
async def list_staff(
    session: DbSession,
    q: str | None = Query(default=None, max_length=120, description="Part of an email"),
    status_filter: Literal["ACTIVE", "REVOKED"] | None = Query(default=None, alias="status"),
    cursor: str | None = Query(default=None, max_length=320),
    limit: int | None = Query(default=None, ge=1, le=200),
) -> StaffPage:
    return await service.list_staff(
        session, query=q, status=status_filter, cursor=cursor, limit=limit
    )


@router.get("/staff/{user_id}", response_model=StaffMemberView, dependencies=can("admins.view"))
async def get_staff(user_id: uuid.UUID, session: DbSession) -> StaffMemberView:
    return await service.get_staff(session, user_id=user_id)


@router.post(
    "/staff",
    response_model=InviteStaffResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("admins.invite"),
)
async def invite_staff(
    payload: InviteStaffRequest, request: Request, user: CurrentUser, session: DbSession
) -> InviteStaffResponse:
    """Create a member of staff with these roles and email them a temporary
    password (business pool). Sent last: a refusal emails nobody."""
    return await service.invite_staff(session, ctx=user, payload=payload, meta=_meta(request))


@router.post(
    "/staff/{user_id}/roles",
    response_model=StaffMemberView,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("admins.manage"),
)
async def assign_role(
    user_id: uuid.UUID,
    payload: RoleGrant,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> StaffMemberView:
    return await service.assign_role(
        session, ctx=user, user_id=user_id, grant=payload, meta=_meta(request)
    )


@router.post(
    "/staff/{user_id}/roles/{assignment_id}/revoke",
    response_model=StaffMemberView,
    dependencies=can("admins.manage"),
)
async def revoke_role(
    user_id: uuid.UUID,
    assignment_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> StaffMemberView:
    """409 `last_super_admin` for the last active Super Admin's role."""
    return await service.revoke_assignment(
        session, ctx=user, user_id=user_id, assignment_id=assignment_id, meta=_meta(request)
    )


@router.post(
    "/staff/{user_id}/suspend", response_model=StaffMemberView, dependencies=can("admins.manage")
)
async def suspend_staff(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> StaffMemberView:
    """Refused on the next request, and every session ended."""
    return await service.suspend_staff(session, ctx=user, user_id=user_id, meta=_meta(request))


@router.post(
    "/staff/{user_id}/reinstate", response_model=StaffMemberView, dependencies=can("admins.manage")
)
async def reinstate_staff(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> StaffMemberView:
    return await service.reinstate_staff(session, ctx=user, user_id=user_id, meta=_meta(request))


# --- history -------------------------------------------------------------------------
@router.get("/history", response_model=AccessHistoryPage, dependencies=can("audit.view"))
async def access_history(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    user_id: uuid.UUID | None = Query(
        default=None, description="Only rows about or by this person"
    ),
    cursor: str | None = Query(default=None, max_length=24),
    limit: int | None = Query(default=None, ge=1, le=200),
) -> AccessHistoryPage:
    """Every access-management change and every HIGH or CRITICAL permission
    used, newest first, with the reason given."""
    return await service.access_history(
        session,
        ctx=user,
        target_user_id=user_id,
        cursor=cursor,
        limit=limit,
        meta=_meta(request),
    )
