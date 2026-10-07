"""jobs - SQLAlchemy ORM models.

Composer, validation, publish gate, lifecycle.

Two constraints that are business rules expressed as database rules:

* **Salary range is mandatory** (PRD 5.2). NOT NULL, plus a check that max is
  not below min.
* **No job reaches PUBLISHED without approved KYB** (invariant 8). Enforced by
  a Postgres trigger in the Alembic baseline as well as the domain service, so
  a direct repository call still fails.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import TenantScoped, Timestamps, UUIDPrimaryKey

# SRS 1.20.6
JOB_STATES = ("DRAFT", "PUBLISHED", "PAUSED", "CLOSED")


class Job(Base, UUIDPrimaryKey, TenantScoped, Timestamps):
    __tablename__ = "jobs"

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    skills: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    location: Mapped[str | None] = mapped_column(String(255))
    work_mode: Mapped[str | None] = mapped_column(String(24))
    experience_min_months: Mapped[int | None] = mapped_column(Integer)

    # Money is integer minor units (paise). Never a float.
    salary_min_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    salary_max_minor: Mapped[int] = mapped_column(Integer, nullable=False)

    # A threshold below the base is meaningless - every candidate has at least
    # 700 - so the range is constrained to the live part of the scale.
    min_score: Mapped[int | None] = mapped_column(Integer)

    #: The rest of the posting -- openings, responsibilities, education,
    #: interview rounds, screening questions -- as one document validated by
    #: `jobs.details.JobDetails`. Read whole and shown whole; nothing searches
    #: inside it except the board's `settings.visibility` predicate.
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )

    status: Mapped[str] = mapped_column(String(16), default="DRAFT", nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED')",
            name="ck_jobs_status",
        ),
        CheckConstraint("salary_max_minor >= salary_min_minor", name="ck_jobs_salary_range"),
        CheckConstraint("salary_min_minor >= 0", name="ck_jobs_salary_non_negative"),
        CheckConstraint(
            "min_score IS NULL OR min_score BETWEEN 700 AND 990",
            name="ck_jobs_min_score_range",
        ),
        # The candidate board pages on (published_at, id). The trigger
        # `trg_stamp_published_at` fills it; this holds it.
        CheckConstraint(
            "status <> 'PUBLISHED' OR published_at IS NOT NULL",
            name="ck_jobs_published_at",
        ),
        # The target of `applications (job_id, tenant_id)`, so an application
        # can only ever be filed under the tenant that owns its job.
        UniqueConstraint("id", "tenant_id", name="uq_jobs_id_tenant"),
        Index(
            "ix_jobs_published",
            "status",
            "published_at",
            postgresql_where="status = 'PUBLISHED'",
        ),
        Index("ix_jobs_tenant_status", "tenant_id", "status"),
    )
