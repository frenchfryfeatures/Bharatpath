"""identity - pure domain logic

Users, sessions, Cognito linkage, memberships.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Which role may be held in which kind of tenant.** Our own staff belong to
one PLATFORM tenant, so `memberships.tenant_id` stays NOT NULL and the
one-membership-per-account rule still answers "who is this caller acting
for?" with a single row. The pairing below is what stops
that becoming a way in: an employer owner who could add a team member as
`PLATFORM_ADMIN` would have handed themselves the console. The service checks
the team roles it offers; `guard_membership_tenant_type` in the baseline is
generated from `ROLE_TENANT_TYPE` and refuses every other writer.
"""

from __future__ import annotations

from typing import Final

TENANT_TYPES: Final = ("EMPLOYER", "COLLEGE", "PLATFORM")

#: The staff roles. Held only in the PLATFORM tenant.
PLATFORM_ROLES: Final[frozenset[str]] = frozenset(
    {"PLATFORM_ADMIN", "KYB_REVIEWER", "INTEGRITY_REVIEWER", "SUPPORT_AGENT"}
)

#: `role -> the tenant type it may be held in`. CANDIDATE is absent: a
#: candidate belongs to no tenant and holds no membership at all.
ROLE_TENANT_TYPE: Final[dict[str, str]] = {
    "EMPLOYER_OWNER": "EMPLOYER",
    "EMPLOYER_RECRUITER": "EMPLOYER",
    "EMPLOYER_VIEWER": "EMPLOYER",
    "COLLEGE_ADMIN": "COLLEGE",
    "COLLEGE_STAFF": "COLLEGE",
    **dict.fromkeys(sorted(PLATFORM_ROLES), "PLATFORM"),
}


def role_fits_tenant(role: str, tenant_type: str) -> bool:
    """True when `role` may be held in a tenant of `tenant_type`."""
    return ROLE_TENANT_TYPE.get(role) == tenant_type


def suspendable(tenant_type: str) -> bool:
    """The PLATFORM tenant cannot be suspended.

    Suspending it would lock out every member of staff at once, including the
    one who could lift it -- a stop-operations control that can stop the
    people operating it has no recovery path short of a database session.
    """
    return tenant_type in ("EMPLOYER", "COLLEGE")
