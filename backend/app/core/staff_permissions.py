"""What our staff may do in the admin console: the permission catalogue and the
system roles (2026-11-19, replacing the hardcoded `CONSOLE_ROLES` map).

Pure: no I/O, no clock that is not passed in. It lives in `app.core` because
three layers read it and none of them may import the others: the route guard
(`app.core.deps.require_permission`), the access-management module that edits
roles (`app.modules.access`), and the migration that writes the guards and the
system roles into the database.

**A permission exists only where a route enforces it.** A key in this file with
no route behind it would be a checkbox in the role editor that does nothing,
which is worse than no checkbox: someone would believe they had granted or
withheld something. `tests/invariants/test_admin_console.py` fails on a
permission no route names.

**Roles are additive.** A member of staff holds one or more roles; what they may
do is the union of what those roles grant. There are no deny rules. What a
deny rule would otherwise be used for is expressed two narrower ways:

* `super_admin_only` -- a permission no role but SUPER_ADMIN can ever hold.
  A CHECK on `staff_role_permissions` refuses one in a custom role, and system
  roles are defined here, so the only way to hold one is SUPER_ADMIN.
* `requires` -- a permission that is meaningless, or a wider door, without
  another. The sales follow-up list carries whole contacts, so a role that
  grants it must grant `candidate_contact.view` too, and its route checks both.

**Risk is enforced, not decorative.** HIGH and CRITICAL permissions pass the
step-up in `require_permission`: an enrolled authenticator, a stated reason
(`X-Access-Reason`), and for CRITICAL a sign-in in the last few minutes. Every
such use writes a `staff_sensitive_access` audit row with the reason.

**Scope.** An assignment may be limited to named organisations
(`scope_tenant_ids`) and may expire. An organisation-scoped grant counts only
on a route addressed by an organisation's id (`tenant_param` on the route), and
never on a list or a candidate page: a route that cannot say which organisation
it touches cannot be scoped, so a scoped grant grants nothing there. Fail
closed, never "all of them".
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Final, Literal
from uuid import UUID

Risk = Literal["LOW", "HIGH", "CRITICAL"]

#: The membership role every member of staff holds in the PLATFORM tenant.
#: What they may do is their role assignments, never this string.
PLATFORM_STAFF: Final = "PLATFORM_STAFF"
#: The one protected role. Holds every permission, including the ones nothing
#: else may hold, and can never be removed from the last person holding it.
SUPER_ADMIN: Final = "SUPER_ADMIN"

#: The header a HIGH or CRITICAL route reads its reason from.
REASON_HEADER: Final = "X-Access-Reason"
REASON_MIN_LENGTH: Final = 5
REASON_MAX_LENGTH: Final = 500


@dataclass(frozen=True, slots=True)
class PermissionSpec:
    key: str
    module: str
    label: str
    risk: Risk = "LOW"
    super_admin_only: bool = False
    requires: tuple[str, ...] = ()
    #: True when at least one route granting it is addressed by an
    #: organisation's id, so an organisation-scoped assignment can use it.
    scopable: bool = False


def _p(
    key: str,
    module: str,
    label: str,
    risk: Risk = "LOW",
    *,
    super_admin_only: bool = False,
    requires: tuple[str, ...] = (),
    scopable: bool = False,
) -> PermissionSpec:
    return PermissionSpec(key, module, label, risk, super_admin_only, requires, scopable)


#: Ordered as the role editor groups them.
PERMISSIONS: Final[tuple[PermissionSpec, ...]] = (
    _p("dashboard.view", "Dashboard", "See the console dashboard"),
    # --- candidates
    _p("candidates.view", "Candidates", "Find and open candidates (contacts masked)"),
    _p(
        "candidates.leads",
        "Candidates",
        "The sales follow-up list, with whole phone numbers and emails",
        "HIGH",
        requires=("candidate_contact.view",),
    ),
    # --- sensitive data
    _p(
        "candidate_contact.view",
        "Sensitive data",
        "See a candidate's whole phone number and email",
        "HIGH",
    ),
    _p("resume.download", "Sensitive data", "Open a candidate's CV", "HIGH"),
    _p(
        "recordings.listen",
        "Sensitive data",
        "Listen to a candidate's interview recordings",
        "HIGH",
    ),
    # --- employer verification
    _p("kyb.view", "Employers", "See KYB submissions and the approval setting"),
    _p("employers.approve_kyb", "Employers", "Approve, reject or send back a KYB submission"),
    _p(
        "kyb.configure",
        "Employers",
        "Switch KYB review between manual and automatic",
        "CRITICAL",
        super_admin_only=True,
    ),
    _p("employers.view", "Employers", "Open an employer", scopable=True),
    # --- integrity
    _p("integrity.view", "Integrity", "See integrity signals"),
    _p("integrity.resolve", "Integrity", "Clear or confirm an integrity signal"),
    # --- organisations and institutes
    _p(
        "organisations.view",
        "Organisations",
        "List organisations and their suspension history",
        scopable=True,
    ),
    _p(
        "organisations.suspend",
        "Organisations",
        "Suspend or reinstate an organisation",
        "CRITICAL",
        scopable=True,
    ),
    _p("institutes.view", "Institutes", "Open a college", scopable=True),
    _p(
        "institutes.manage_seats",
        "Institutes",
        "Change a college's seat allocation",
        "HIGH",
        scopable=True,
    ),
    # --- support
    _p("disputes.view", "Support", "See disputes"),
    _p("disputes.resolve", "Support", "Assign and resolve disputes"),
    _p("notifications.suppress", "Support", "Stop messages to a person"),
    # --- accounts made on someone's behalf
    _p(
        "accounts.create",
        "Accounts",
        "Create candidate, employer and college accounts, and add organisation members",
        "HIGH",
        scopable=True,
    ),
    _p("accounts.resend_invitation", "Accounts", "Resend a sign-in invitation"),
    # --- payments
    _p("discounts.view", "Payments", "See discount codes and their uses"),
    _p("discounts.manage", "Payments", "Create and switch off discount codes", "HIGH"),
    # --- taxonomies (the employer search filters)
    _p("taxonomy.view", "Taxonomies", "See the skills and cities catalogue"),
    _p("taxonomy.create", "Taxonomies", "Add a skill or city"),
    _p("taxonomy.edit", "Taxonomies", "Edit or switch off a skill or city"),
    _p("taxonomy.import", "Taxonomies", "Import skills and cities in bulk"),
    # --- courses
    _p("courses.view", "Courses", "See courses"),
    _p("courses.manage", "Courses", "Build course modules and lessons"),
    _p("courses.publish", "Courses", "Put a course on sale or take it off"),
    # --- administration: SUPER_ADMIN's alone
    _p(
        "audit.view",
        "Administration",
        "Read the complete audit log",
        "HIGH",
        super_admin_only=True,
    ),
    _p("admins.view", "Administration", "See staff accounts and roles"),
    _p(
        "admins.invite",
        "Administration",
        "Invite a member of staff",
        "CRITICAL",
        super_admin_only=True,
    ),
    _p(
        "admins.manage",
        "Administration",
        "Assign and remove roles, suspend and reinstate staff",
        "CRITICAL",
        super_admin_only=True,
    ),
    _p(
        "roles.manage",
        "Administration",
        "Create, edit, duplicate and archive roles",
        "CRITICAL",
        super_admin_only=True,
    ),
)

PERMISSION_KEYS: Final[frozenset[str]] = frozenset(p.key for p in PERMISSIONS)
BY_KEY: Final[Mapping[str, PermissionSpec]] = {p.key: p for p in PERMISSIONS}
SUPER_ADMIN_ONLY: Final[frozenset[str]] = frozenset(
    p.key for p in PERMISSIONS if p.super_admin_only
)
GRANTABLE: Final[frozenset[str]] = PERMISSION_KEYS - SUPER_ADMIN_ONLY


@dataclass(frozen=True, slots=True)
class SystemRole:
    key: str
    name: str
    description: str
    permissions: frozenset[str]


def _role(key: str, name: str, description: str, permissions: Iterable[str]) -> SystemRole:
    return SystemRole(key, name, description, frozenset(permissions))


_VIEW_ONLY: Final = (
    "dashboard.view",
    "candidates.view",
    "kyb.view",
    "integrity.view",
    "organisations.view",
    "employers.view",
    "institutes.view",
    "disputes.view",
    "discounts.view",
    "taxonomy.view",
    "courses.view",
    "admins.view",
)

#: The roles that ship with the platform. Their permissions are defined here
#: and nowhere else, so they cannot be edited from the console; a change is a
#: code change, reviewed. The first four reproduce exactly what the old
#: `CONSOLE_ROLES` map granted (PLATFORM_ADMIN became SUPER_ADMIN), so the
#: migration that moved staff onto them changed nobody's access.
SYSTEM_ROLES: Final[Mapping[str, SystemRole]] = {
    r.key: r
    for r in (
        _role(
            SUPER_ADMIN,
            "Super Admin",
            "Everything, including access management and the complete audit log.",
            PERMISSION_KEYS,
        ),
        _role(
            "OPERATIONS_ADMIN",
            "Operations Admin",
            "Runs the platform day to day: everything except access management, "
            "the KYB switch and the audit log.",
            GRANTABLE,
        ),
        _role(
            "KYB_REVIEWER",
            "KYB Reviewer",
            "Reviews employer verification.",
            (
                "dashboard.view",
                "kyb.view",
                "employers.approve_kyb",
                "organisations.view",
                "employers.view",
            ),
        ),
        _role(
            "INTEGRITY_REVIEWER",
            "Integrity Reviewer",
            "Reviews integrity signals and the CVs behind them.",
            (
                "dashboard.view",
                "integrity.view",
                "integrity.resolve",
                "candidates.view",
                "resume.download",
            ),
        ),
        _role(
            "SUPPORT_AGENT",
            "Support Agent",
            "Answers candidates, employers and colleges; works disputes.",
            (
                "dashboard.view",
                "organisations.view",
                "candidates.view",
                "employers.view",
                "institutes.view",
                "disputes.view",
                "disputes.resolve",
                "notifications.suppress",
                "accounts.resend_invitation",
                "discounts.view",
                "taxonomy.view",
                "taxonomy.create",
                "taxonomy.edit",
                "taxonomy.import",
                "resume.download",
                "candidate_contact.view",
                "recordings.listen",
                "candidates.leads",
            ),
        ),
        _role(
            "CONTENT_MANAGER",
            "Content Manager",
            "Builds and publishes courses.",
            ("dashboard.view", "courses.view", "courses.manage", "courses.publish"),
        ),
        _role(
            "TAXONOMY_MANAGER",
            "Taxonomy Manager",
            "Curates the skills and cities employers filter by.",
            (
                "dashboard.view",
                "taxonomy.view",
                "taxonomy.create",
                "taxonomy.edit",
                "taxonomy.import",
            ),
        ),
        _role(
            "FINANCE_MANAGER",
            "Finance Manager",
            "Discount codes and college seat allocations.",
            (
                "dashboard.view",
                "discounts.view",
                "discounts.manage",
                "organisations.view",
                "institutes.view",
                "institutes.manage_seats",
            ),
        ),
        _role(
            "READ_ONLY_AUDITOR",
            "Read-only Auditor",
            "Sees every queue and record a view permission opens; changes nothing "
            "and sees no whole contact, CV or recording.",
            _VIEW_ONLY,
        ),
    )
}

#: What the old membership roles became (migration 0022).
LEGACY_ROLE_TO_SYSTEM_ROLE: Final[Mapping[str, str]] = {
    "PLATFORM_ADMIN": SUPER_ADMIN,
    "KYB_REVIEWER": "KYB_REVIEWER",
    "INTEGRITY_REVIEWER": "INTEGRITY_REVIEWER",
    "SUPPORT_AGENT": "SUPPORT_AGENT",
}


def role_permission_refusal(permissions: Iterable[str]) -> str | None:
    """Why a custom role may not hold this set, or None. Codes, never prose."""
    held = frozenset(permissions)
    if not held:
        return "role_permissions_empty"
    if held - PERMISSION_KEYS:
        return "role_permission_unknown"
    if held & SUPER_ADMIN_ONLY:
        return "role_permission_super_admin_only"
    for key in held:
        if set(BY_KEY[key].requires) - held:
            return "role_permission_requires_another"
    return None


# ---------------------------------------------------------------------------
# A member of staff's effective access
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class Grant:
    """One live role assignment, as resolution needs it."""

    role_key: str
    role_name: str
    permissions: frozenset[str]
    #: None: every organisation. Otherwise only these.
    scope_tenant_ids: frozenset[UUID] | None = None
    expires_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class StaffAccess:
    """What one member of staff may do now: the union of their live grants."""

    grants: tuple[Grant, ...] = ()
    #: The access each permission has: None for every organisation, else the
    #: organisations it is limited to. A permission absent here is not held.
    _scope: Mapping[str, frozenset[UUID] | None] = field(default_factory=dict)

    @classmethod
    def from_grants(cls, grants: Iterable[Grant], *, now: datetime) -> StaffAccess:
        live = tuple(g for g in grants if g.expires_at is None or g.expires_at > now)
        scope: dict[str, frozenset[UUID] | None] = {}
        for grant in live:
            for key in grant.permissions:
                if key not in PERMISSION_KEYS:
                    continue
                current = scope.get(key, frozenset())
                if grant.scope_tenant_ids is None or current is None:
                    scope[key] = None
                else:
                    scope[key] = current | grant.scope_tenant_ids
        return cls(grants=live, _scope=scope)

    def can(self, permission: str, *, tenant_id: UUID | None = None) -> bool:
        """True when `permission` is held for every organisation, or -- on a
        route addressed by one -- for `tenant_id`. A scoped grant never
        answers a question that names no organisation."""
        if permission not in self._scope:
            return False
        limited = self._scope[permission]
        if limited is None:
            return True
        return tenant_id is not None and tenant_id in limited

    @property
    def unscoped_permissions(self) -> frozenset[str]:
        return frozenset(k for k, v in self._scope.items() if v is None)

    @property
    def permissions(self) -> frozenset[str]:
        """Every permission held anywhere, scoped or not -- for the console to
        decide what to show. Authorisation always goes through `can`."""
        return frozenset(self._scope)

    @property
    def role_keys(self) -> tuple[str, ...]:
        return tuple(sorted({g.role_key for g in self.grants}))

    @property
    def is_super_admin(self) -> bool:
        return any(g.role_key == SUPER_ADMIN for g in self.grants)

    @property
    def legacy_role(self) -> str:
        """The membership role this person would have held before 0022, for the
        admin portal that still routes on `/auth/me`'s `role`. Deprecated:
        `staff.permissions` is the answer, and this goes when the portal reads it."""
        if self.is_super_admin:
            return "PLATFORM_ADMIN"
        for legacy in ("KYB_REVIEWER", "INTEGRITY_REVIEWER", "SUPPORT_AGENT"):
            if legacy in self.role_keys:
                return legacy
        return PLATFORM_STAFF


def system_role_permissions(role_key: str) -> frozenset[str]:
    role = SYSTEM_ROLES.get(role_key)
    return role.permissions if role is not None else frozenset()


def roles_granting(permission: str) -> frozenset[str]:
    """The system roles that hold `permission`."""
    return frozenset(k for k, r in SYSTEM_ROLES.items() if permission in r.permissions)
