"""employer - SQLAlchemy ORM models.

Employer tenant, team members, roles.

`employer_type` and `industry` are new since 2026-08-27 ("Employer - MNC,
Industry"). Both are **enumerated and config-seeded**, not free text, or they
cannot back a filter. The client still owes us the two lists, so the values
are validated against `config_values` rather than a database enum - that way
the list can be extended without a migration.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps


class Employer(Base, Timestamps):
    """Employer-specific columns, keyed on the shared tenant row."""

    __tablename__ = "employers"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    legal_name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Validated against config_values, not a DB enum - the client owes us both
    # lists and they will change.
    employer_type: Mapped[str | None] = mapped_column(String(64))
    industry: Mapped[str | None] = mapped_column(String(64))

    # The organisation's own profile (2026-10-06). The KYB form asks the same
    # four questions at onboarding; these are what the organisation keeps
    # editing afterwards, without reopening verification. Statutory details
    # (PAN, GSTIN, address, signatory) stay in the KYB submission, because a
    # reviewer approved those values.
    trade_name: Mapped[str | None] = mapped_column(String(255))
    employee_count_band: Mapped[str | None] = mapped_column(String(16))
    website: Mapped[str | None] = mapped_column(String(255))
    about: Mapped[str | None] = mapped_column(Text)

    # Invariant 8 hangs off this column. `kyb.require_approval` defaults to
    # off (client, 2026-08-27), which moves a submission straight to APPROVED
    # on arrival - but the gate, the trigger and the test all stay.
    kyb_status: Mapped[str] = mapped_column(String(24), default="DRAFT", nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "kyb_status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', "
            "'REJECTED', 'MORE_INFO_REQUIRED')",
            name="ck_employers_kyb_status",
        ),
    )
