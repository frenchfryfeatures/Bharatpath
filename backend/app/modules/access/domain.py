"""access - pure domain logic

Access management for our own staff (2026-11-19): who holds which console
roles, what each role grants, and the rules a change must keep. The catalogue
itself -- permissions, risk, the system roles -- is `app.core.staff_permissions`,
because the route guard in `app.core.deps` reads it and may not import this.

No I/O. No database, no HTTP, no clock that is not passed in.

**What a SUPER_ADMIN alone may do** is expressed as permissions only that role
can hold (`super_admin_only`): inviting staff, assigning and removing roles,
suspending staff, editing roles, the KYB switch and the complete audit log.

**Refusals are codes.** Each one is a rule this module holds, not a message.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from datetime import datetime
from typing import Final
from uuid import UUID

from app.core.staff_permissions import (
    BY_KEY,
    SUPER_ADMIN,
    SYSTEM_ROLES,
    role_permission_refusal,
)

MAX_ROLE_NAME: Final = 80
MAX_ROLES_PER_INVITE: Final = 10
MAX_SCOPE_TENANTS: Final = 200

_NON_KEY = re.compile(r"[^A-Z0-9]+")


def role_key_for(name: str) -> str:
    """`College Support - North` -> `CUSTOM_COLLEGE_SUPPORT_NORTH`.

    Custom keys always start `CUSTOM_`, so one can never take a system role's
    key, today's or one added later."""
    body = _NON_KEY.sub("_", name.upper()).strip("_")[:55] or "ROLE"
    return f"CUSTOM_{body}"


def custom_role_refusal(*, name: str, permissions: Iterable[str]) -> str | None:
    if not name.strip() or len(name.strip()) > MAX_ROLE_NAME:
        return "role_name_invalid"
    return role_permission_refusal(permissions)


def grants_scopably(permissions: Iterable[str]) -> bool:
    """Whether an organisation-scoped assignment of this role would grant
    anything at all: at least one permission is used on a route addressed by
    an organisation."""
    return any(BY_KEY[p].scopable for p in permissions if p in BY_KEY)


def assignment_refusal(
    *,
    role_key: str,
    role_active: bool,
    role_permissions: Iterable[str],
    scope_tenant_ids: Iterable[UUID] | None,
    expires_at: datetime | None,
    now: datetime,
) -> str | None:
    """Why this role may not be given on these terms, or None."""
    if not role_active:
        return "role_archived"
    scope = None if scope_tenant_ids is None else list(scope_tenant_ids)
    if role_key == SUPER_ADMIN and (scope is not None or expires_at is not None):
        # The protected role is all or nothing: a scoped or expiring super
        # admin is how the last one quietly lapses.
        return "super_admin_is_unscoped"
    if expires_at is not None:
        if expires_at.tzinfo is None:
            return "expiry_needs_timezone"
        if expires_at <= now:
            return "expiry_in_the_past"
    if scope is not None:
        if not scope or len(scope) > MAX_SCOPE_TENANTS:
            return "scope_size_invalid"
        if not grants_scopably(role_permissions):
            # Every permission in the role is used only on routes that name
            # no organisation, so the grant would do nothing -- refused rather
            # than stored as a promise the guard will never keep.
            return "scope_grants_nothing"
    return None


def self_change_refusal(*, actor_id: UUID, target_id: UUID) -> str | None:
    """Nobody changes their own access. Another SUPER_ADMIN does it, which is
    also what makes "the last super admin" a rule two people keep."""
    return "staff_self_change" if actor_id == target_id else None


def permission_diff(before: Iterable[str], after: Iterable[str]) -> dict[str, list[str]]:
    old, new = set(before), set(after)
    return {"added": sorted(new - old), "removed": sorted(old - new)}


def high_risk_added(before: Iterable[str], after: Iterable[str]) -> list[str]:
    """The HIGH and CRITICAL permissions a change adds -- what the role editor
    warns about before saving."""
    return sorted(p for p in set(after) - set(before) if p in BY_KEY and BY_KEY[p].risk != "LOW")


def is_system_key(key: str) -> bool:
    return key in SYSTEM_ROLES
