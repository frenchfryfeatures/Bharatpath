"""candidate - SQLAlchemy ORM models

Candidate profile, settings, language preference.

Every tenant-scoped table carries `tenant_id` and an RLS policy.
Money is stored as integer minor units (paise) - never a float.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class CandidateProfile(Base):
    """What a candidate tells us about themselves that a CV does not.

    Today that is **where they are**: the location filter in masked search
    (SRS 1.14.1) needs one, and nothing else in the schema has it -- Layer 1
    extracts no location, and adding one to the extraction would change the
    prompt version and so every score. Declared by the candidate, optional,
    and changeable at any time.

    One row per candidate, keyed on the user. No `tenant_id`: a candidate
    belongs to no tenant.

    **Employers see this row's city and state on a masked card**, which is why
    `domain.normalise_city` refuses digits and `@`, and why there is no address
    or PIN code column.
    """

    __tablename__ = "candidate_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    #: Asked at sign-up. The masked card and the reveal both show it -- the
    #: one identifying field a card may carry (`ALLOWED_IDENTIFYING` in
    #: `test_masked_candidate.py`). Never guessed from a CV.
    full_name: Mapped[str | None] = mapped_column(String(200))
    city: Mapped[str | None] = mapped_column(String(100))
    #: A code from `app.core.reference.INDIAN_STATES`.
    state_code: Mapped[str | None] = mapped_column(String(2))
    career: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # Trigram, so the city filter's contains-match ("pun" finds "Pune",
        # "Pimpri-Chinchwad" is found by "chinch") is an index scan. pg_trgm is
        # created with the database (scripts/init_db_extensions.sql).
        Index(
            "ix_candidate_profiles_city_trgm",
            "city",
            postgresql_using="gin",
            postgresql_ops={"city": "gin_trgm_ops"},
        ),
        Index("ix_candidate_profiles_state", "state_code"),
    )
