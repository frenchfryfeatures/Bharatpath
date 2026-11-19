"""access - persistence

Three tables (migration 0022, 2026-11-19). The guards that hold them for every
writer are in that migration; what they refuse is listed on each class.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps, UUIDPrimaryKey
from app.core.staff_permissions import GRANTABLE

ROLE_STATUSES = ("ACTIVE", "ARCHIVED")


def _in(column: str, values: tuple[str, ...] | frozenset[str]) -> str:
    return f"{column} IN (" + ", ".join(f"'{v}'" for v in sorted(values)) + ")"


class StaffRole(Base, UUIDPrimaryKey, Timestamps):
    """A named set of console permissions.

    **System roles** (`is_system`) are rows only so they can be assigned; what
    they grant is `staff_permissions.SYSTEM_ROLES`, in code, and
    `guard_staff_role_write` refuses to archive one or give it permission rows.
    **Custom roles** hold their permissions in `staff_role_permissions`.

    Never deleted (no DELETE grant): an assignment names its role for as long
    as the record of who could see what is kept. Archived instead, and only
    when nobody holds it.
    """

    __tablename__ = "staff_roles"

    key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default="ACTIVE")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: NULL for the system roles the migration wrote.
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )

    __table_args__ = (
        CheckConstraint(_in("status", ROLE_STATUSES), name="ck_staff_roles_status"),
        CheckConstraint("key ~ '^[A-Z][A-Z0-9_]{1,63}$'", name="ck_staff_roles_key"),
        CheckConstraint(
            "(status = 'ARCHIVED') = (archived_at IS NOT NULL)", name="ck_staff_roles_archived"
        ),
    )


class StaffRolePermission(Base):
    """One permission a custom role grants.

    `ck_staff_role_permissions_grantable` is generated from
    `staff_permissions.GRANTABLE`: a SUPER_ADMIN-only permission, or a key no
    route enforces, cannot be stored at all. `tests/unit/test_staff_permissions.py`
    holds the live constraint equal to the catalogue.
    """

    __tablename__ = "staff_role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("staff_roles.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    permission: Mapped[str] = mapped_column(String(64), primary_key=True)

    __table_args__ = (
        CheckConstraint(_in("permission", GRANTABLE), name="ck_staff_role_permissions_grantable"),
    )


class StaffRoleAssignment(Base, UUIDPrimaryKey):
    """One role held by one member of staff.

    Revoked, never deleted or edited (`guard_staff_assignment_write`): only
    the revocation columns may change, once. A SUPER_ADMIN assignment carries
    no scope and no expiry, and the last live one -- of a person whose staff
    membership is ACTIVE -- cannot be revoked, nor that membership revoked
    (`guard_last_super_admin`).
    """

    __tablename__ = "staff_role_assignments"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("staff_roles.id", ondelete="RESTRICT"), nullable=False
    )
    #: NULL: every organisation. Otherwise the organisations the grant is
    #: limited to (see `staff_permissions`, "Scope").
    scope_tenant_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(PGUUID(as_uuid=True)))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str | None] = mapped_column(Text)
    #: NULL for the assignments migration 0022 wrote from `memberships.role`.
    granted_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    revoke_reason: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_staff_role_assignments_user_id", "user_id"),
        Index("ix_staff_role_assignments_role_id", "role_id"),
        Index("ix_staff_role_assignments_granted_by", "granted_by"),
        Index("ix_staff_role_assignments_revoked_by", "revoked_by"),
        # One live assignment of a role per person. A second scope is the
        # same assignment widened: revoke and re-grant.
        Index(
            "uq_staff_role_assignments_live",
            "user_id",
            "role_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
        CheckConstraint(
            "scope_tenant_ids IS NULL OR cardinality(scope_tenant_ids) BETWEEN 1 AND 200",
            name="ck_staff_role_assignments_scope",
        ),
        CheckConstraint(
            "revoked_at IS NOT NULL OR (revoked_by IS NULL AND revoke_reason IS NULL)",
            name="ck_staff_role_assignments_revoked",
        ),
    )
