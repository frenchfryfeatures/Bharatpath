"""identity - SQLAlchemy ORM models.

Users, tenants, Cognito linkage, memberships.

Two things that are load-bearing:

**`memberships` is the authorisation source of truth, not Cognito.** Role and
tenant are read from here on every request, cached in Redis for 60 seconds.
Token claims go stale; a membership revocation that does not take effect is
precisely the tenant-isolation failure SRS 2.24.7 forbids.

**There is no `anonymous_subjects` table.** The client deleted the
anonymous-first flow on 2026-08-24 ("Without login the user cannot parse the
resume / cannot get a score"), so every candidate action belongs to a real
`users` row and everything that pointed at `subject_id` now points at
`user_id`.

No password hashes and no TOTP secrets are stored anywhere in this service -
Cognito owns both. That removes an entire class of liability from the codebase.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps, UUIDPrimaryKey
from app.modules.identity.domain import TENANT_TYPES

# SRS 1.2 names nine roles across the four surfaces. CANDIDATE is the tenth,
# and the only one that is not tenant-scoped.
ROLES = (
    "CANDIDATE",
    "EMPLOYER_OWNER",
    "EMPLOYER_RECRUITER",
    "EMPLOYER_VIEWER",
    "COLLEGE_ADMIN",
    "COLLEGE_STAFF",
    "PLATFORM_ADMIN",
    "KYB_REVIEWER",
    "INTEGRITY_REVIEWER",
    "SUPPORT_AGENT",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({joined})"


class User(Base, UUIDPrimaryKey, Timestamps):
    """A person. Candidates, employer staff, college staff and admins alike.

    NOTE for anyone adding a column here: there is **no date of birth and no
    age field**, and there must never be one (PRD rule 4, invariant 5). A CI
    guard fails the build on any column matching that pattern, including
    "seemingly reasonable defaults".
    """

    __tablename__ = "users"

    # The external identity link. Our `id` stays the internal primary key and
    # `cognito_sub` must never appear in an API response.
    cognito_sub: Mapped[str | None] = mapped_column(String(64), unique=True)
    pool: Mapped[str] = mapped_column(String(16), nullable=False)  # CANDIDATE|BUSINESS

    phone: Mapped[str | None] = mapped_column(String(20), unique=True)
    email: Mapped[str | None] = mapped_column(String(320), unique=True)

    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", nullable=False)
    locale: Mapped[str] = mapped_column(String(8), default="en", nullable=False)

    __table_args__ = (
        CheckConstraint(_in("pool", ("CANDIDATE", "BUSINESS")), name="ck_users_pool"),
        CheckConstraint(_in("status", ("ACTIVE", "SUSPENDED", "DELETED")), name="ck_users_status"),
        # A user must be reachable by something, or we can never contact them
        # and they can never sign in again.
        #
        # **Unless they asked to be forgotten** (Day 20). An erasure clears
        # phone and email and hashes the Cognito subject -- that emptying *is*
        # the pseudonymisation (the hash remains so a live token is refused
        # rather than signed up again, `app/core/auth/users.py`), and the row
        # stays only as the anchor every retained payment and audit row points
        # at. Without this carve-out the CHECK would refuse the erasure, which
        # is the constraint protecting a person's ability to sign in by
        # preventing them from leaving.
        CheckConstraint(
            "status = 'DELETED' "
            "OR phone IS NOT NULL OR email IS NOT NULL OR cognito_sub IS NOT NULL",
            name="ck_users_has_identifier",
        ),
        # The console's candidate list (`GET /admin/candidates`), newest first.
        Index("ix_users_pool_created", "pool", "created_at", "id"),
    )


class Tenant(Base, UUIDPrimaryKey, Timestamps):
    """An employer, a college, or us. The unit of isolation.

    Deliberately one table rather than two, so `memberships`, RLS policies,
    suspensions and audit all have a single foreign key to point at. The
    employer- and college-specific columns live in their own tables keyed on
    `tenant_id`.

    **PLATFORM is our own staff** (Day 19, blockers E10), and there is exactly
    one: `uq_tenants_one_platform`. It holds no employer or college data, so
    binding it reads nothing through a tenant policy. Staff reach across
    tenants by the read-only bypass engine, and write through services that
    bind the target tenant explicitly -- as a KYB decision always has.
    """

    __tablename__ = "tenants"

    type: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", nullable=False)

    __table_args__ = (
        CheckConstraint(_in("type", TENANT_TYPES), name="ck_tenants_type"),
        CheckConstraint(_in("status", ("ACTIVE", "SUSPENDED", "CLOSED")), name="ck_tenants_status"),
        Index(
            "uq_tenants_one_platform",
            "type",
            unique=True,
            postgresql_where="type = 'PLATFORM'",
        ),
    )


class Membership(Base, UUIDPrimaryKey, Timestamps):
    """Which user has which role in which tenant.

    Read on every request (Redis-cached, 60s TTL) to resolve the caller's
    tenant and role. This table - not a Cognito group, not a token claim - is
    the authority.
    """

    __tablename__ = "memberships"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", nullable=False)

    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="ck_memberships_role"),
        CheckConstraint(_in("status", ("ACTIVE", "REVOKED")), name="ck_memberships_status"),
        # One role per user per tenant. Two active rows would make "what role
        # is this caller?" ambiguous, and the answer would depend on row order.
        UniqueConstraint("user_id", "tenant_id", name="uq_membership_user_tenant"),
        Index("ix_membership_lookup", "user_id", "status"),
        Index("ix_membership_tenant", "tenant_id", "status"),
    )


class TenantSuspension(Base, UUIDPrimaryKey):
    """Admin "stop operations" (client, 2026-08-24).

    Modelled at the tenant level rather than as a college-only feature: the
    same control is what you want for a fraudulent employer, and auto-approved
    KYB makes that more likely, not less.

    Suspension blocks sign-in and API access immediately. It deletes nothing -
    you must be able to prove what was visible to whom on a given date.

    **Day 19.** One open suspension per tenant (`uq_tenant_suspension_open`);
    lifting is a latch, the row is never deleted, and
    `guard_tenant_suspension_write` mirrors the open row onto
    `tenants.status`, so every check that already reads `status = 'ACTIVE'`
    -- the job board, the seat limb, a college's invitations -- stops with it.
    The PLATFORM tenant cannot be suspended.
    """

    __tablename__ = "tenant_suspensions"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reason: Mapped[str] = mapped_column(String(500), nullable=False)
    suspended_by: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    suspended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lifted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lifted_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id")
    )

    __table_args__ = (
        Index(
            "uq_tenant_suspension_open",
            "tenant_id",
            unique=True,
            postgresql_where="lifted_at IS NULL",
        ),
        CheckConstraint(
            "(lifted_at IS NULL) = (lifted_by IS NULL)", name="ck_tenant_suspension_lifted_by"
        ),
    )
