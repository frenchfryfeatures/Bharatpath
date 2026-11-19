"""access - request and response schemas (`/admin/access`, 2026-11-19).

What the console's Access Management screen reads and sends. No schema here
carries a Cognito subject, and none carries anything about a candidate.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.core.schemas import ApiSchema
from app.modules.access.domain import MAX_ROLE_NAME, MAX_ROLES_PER_INVITE, MAX_SCOPE_TENANTS

Risk = Literal["LOW", "HIGH", "CRITICAL"]


class _Base(ApiSchema):
    pass


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------
class PermissionView(_Base):
    key: str
    module: str
    label: str
    risk: Risk
    #: Held only by SUPER_ADMIN; a custom role can never include it.
    super_admin_only: bool
    #: Permissions a role must also grant to include this one.
    requires: list[str]
    #: Whether an organisation-scoped assignment can use it (see `scope_tenant_ids`).
    scopable: bool


class PermissionGroup(_Base):
    module: str
    permissions: list[PermissionView]


# ---------------------------------------------------------------------------
# Roles
# ---------------------------------------------------------------------------
class RoleView(_Base):
    id: uuid.UUID
    key: str
    name: str
    description: str | None
    is_system: bool
    status: Literal["ACTIVE", "ARCHIVED"]
    permissions: list[str]
    #: People holding it now (live, unexpired assignments): who a change affects.
    holders: int
    created_at: datetime
    updated_at: datetime


class RoleRequest(_Base):
    name: str = Field(min_length=1, max_length=MAX_ROLE_NAME)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[str] = Field(min_length=1, max_length=100)


class DuplicateRoleRequest(_Base):
    name: str = Field(min_length=1, max_length=MAX_ROLE_NAME)


class RoleChangeImpact(_Base):
    """What saving `permissions` on this role would do, before it is saved."""

    holders: int
    added: list[str]
    removed: list[str]
    #: HIGH and CRITICAL permissions the change adds.
    high_risk_added: list[str]
    #: Null when the set may be saved, else the refusal code saving would get.
    refusal: str | None


# ---------------------------------------------------------------------------
# Staff
# ---------------------------------------------------------------------------
class AssignmentView(_Base):
    id: uuid.UUID
    role_id: uuid.UUID
    role_key: str
    role_name: str
    is_system: bool
    #: Null: every organisation.
    scope_tenant_ids: list[uuid.UUID] | None
    expires_at: datetime | None
    expired: bool
    reason: str | None
    granted_by: uuid.UUID | None
    granted_at: datetime


class StaffMemberView(_Base):
    user_id: uuid.UUID
    email: str | None
    #: ACTIVE, or REVOKED while suspended.
    status: Literal["ACTIVE", "REVOKED"]
    #: Has signed in at least once.
    signed_in: bool
    joined_at: datetime
    roles: list[AssignmentView]
    #: The union of the live roles: what this person may do now.
    effective_permissions: list[str]


class StaffPage(_Base):
    items: list[StaffMemberView]
    next_cursor: str | None


class RoleGrant(_Base):
    role_id: uuid.UUID
    #: Limit the grant to these organisations; null for every one.
    scope_tenant_ids: list[uuid.UUID] | None = Field(default=None, max_length=MAX_SCOPE_TENANTS)
    expires_at: datetime | None = None


_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class InviteStaffRequest(_Base):
    email: str = Field(min_length=3, max_length=320, pattern=_EMAIL_PATTERN)
    roles: list[RoleGrant] = Field(min_length=1, max_length=MAX_ROLES_PER_INVITE)


class InviteStaffResponse(_Base):
    member: StaffMemberView
    #: SENT, or ALREADY_REGISTERED when the address already had a sign-in.
    invitation: Literal["SENT", "ALREADY_REGISTERED"]


# ---------------------------------------------------------------------------
# The caller's own access
# ---------------------------------------------------------------------------
class MyRole(_Base):
    key: str
    name: str
    scope_tenant_ids: list[uuid.UUID] | None
    expires_at: datetime | None


class MyAccess(_Base):
    """What the console should show this person. The server still checks
    every request; this only spares them buttons that would answer 403."""

    roles: list[MyRole]
    #: Held for every organisation.
    permissions: list[str]
    #: Held only for some organisations (on routes addressed by one).
    scoped_permissions: list[str]
    is_super_admin: bool


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------
class AccessEventRow(_Base):
    id: int
    actor_id: uuid.UUID | None
    action: str
    target_type: str
    target_id: str | None
    request_id: str | None
    metadata: dict[str, Any]
    occurred_at: datetime


class AccessHistoryPage(_Base):
    items: list[AccessEventRow]
    next_cursor: str | None
