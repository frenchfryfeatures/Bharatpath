"""applications - SQLAlchemy ORM models.

Apply, stages, withdraw, expiry, hire confirm.

**Duplicate application prevention is a database guarantee, not a race.** A
partial unique index on (job_id, candidate_id) where the stage is non-terminal
means two concurrent applies cannot both succeed. Note this is a *different*
mechanism from the duplicate-CV detection the client dropped on 2026-08-24 -
that one is a scoring-integrity rule, this one is a constraint, and it stays.

**So is the two-sided hire.** A CHECK refuses HIRED unless both confirmations
are recorded, and `guard_application_update` in the baseline migration refuses
a stage change the pipeline does not allow, or one made by the wrong party.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import TenantScoped, Timestamps, UUIDPrimaryKey
from app.modules.applications.domain import ACTOR_TYPES, EVENT_KINDS, STAGES, TERMINAL_STAGES


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


_STAGE_LIST = _in(STAGES)
_TERMINAL_LIST = _in(TERMINAL_STAGES)


class Application(Base, UUIDPrimaryKey, TenantScoped, Timestamps):
    """One candidate's application to one job.

    Carries `tenant_id` (the employer who owns the job) so RLS applies on the
    employer side, plus `candidate_id` for the candidate's Application Board.
    """

    __tablename__ = "applications"

    # Foreign key together with `tenant_id`; see `fk_applications_job_tenant`.
    job_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    stage: Mapped[str] = mapped_column(String(16), default="SUBMITTED", nullable=False)

    # The employer's last action on this application; submission starts the
    # clock. Expiry is measured from here at sweep time, rather than stamped
    # as a deadline on each row, so changing the configured period applies to
    # every open application at once instead of only to new ones.
    employer_active_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Two-sided hire confirmation (PRD 5.2 / SRS 1.13.3). Both must be set
    # before the platform records a final hire event. Each is a latch: once
    # set, the database refuses to move or clear it.
    employer_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    candidate_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    hire_disputed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    meeting_url: Mapped[str | None] = mapped_column(String(1024))
    interview_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(f"stage IN ({_STAGE_LIST})", name="ck_applications_stage"),
        CheckConstraint(
            "stage <> 'HIRED' OR "
            "(employer_confirmed_at IS NOT NULL AND candidate_confirmed_at IS NOT NULL)",
            name="ck_applications_hired_by_both",
        ),
        CheckConstraint(
            "candidate_confirmed_at IS NULL OR employer_confirmed_at IS NOT NULL",
            name="ck_applications_candidate_confirms_second",
        ),
        CheckConstraint(
            "hire_disputed_at IS NULL OR employer_confirmed_at IS NOT NULL",
            name="ck_applications_dispute_needs_proposal",
        ),
        CheckConstraint(
            "(meeting_url IS NULL) = (interview_at IS NULL)",
            name="ck_applications_interview_complete",
        ),
        # The service validates the link properly; this is the line a direct
        # write cannot cross with a `javascript:` URL.
        CheckConstraint(
            "meeting_url IS NULL OR meeting_url LIKE 'https://%'",
            name="ck_applications_meeting_https",
        ),
        # **The tenant an application is filed under is its job's tenant, and
        # nothing else can be.** A candidate writes this row, and a candidate
        # has no tenant of their own to bind; a single-column key on `job_id`
        # would let the row claim any tenant and land in the wrong employer's
        # pipeline. Referential checks ignore RLS, so this holds for every
        # writer.
        ForeignKeyConstraint(
            ["job_id", "tenant_id"],
            ["jobs.id", "jobs.tenant_id"],
            name="fk_applications_job_tenant",
            ondelete="CASCADE",
        ),
        # The duplicate-application rule, as a database guarantee.
        Index(
            "uq_application_active",
            "job_id",
            "candidate_id",
            unique=True,
            postgresql_where=f"stage NOT IN ({_TERMINAL_LIST})",
        ),
        Index("ix_applications_candidate", "candidate_id", "created_at"),
        Index("ix_applications_job_stage", "job_id", "stage", "created_at"),
        # The pipeline across every job, oldest first (`list_for_employer`).
        Index("ix_applications_tenant_created", "tenant_id", "created_at", "id"),
        # The expiry sweep, per tenant, over open applications only.
        Index(
            "ix_applications_expiring",
            "tenant_id",
            "employer_active_at",
            postgresql_where=f"stage NOT IN ({_TERMINAL_LIST})",
        ),
    )


class ApplicationEvent(Base, UUIDPrimaryKey):
    """Every stage transition, and every interview and hire step between them.
    The candidate's Application Board renders from this, and it is the audit
    trail for hiring decisions.

    Append-only by grant. A non-stage event records the stage it happened at
    as both `from_stage` and `to_stage`.
    """

    __tablename__ = "application_events"

    application_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("applications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(
        String(24), nullable=False, server_default=text("'STAGE_CHANGED'")
    )
    from_stage: Mapped[str | None] = mapped_column(String(16))
    to_stage: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    # The employer's note on a move. Shown to the employer's team, never to
    # the candidate.
    note: Mapped[str | None] = mapped_column(Text)
    # `clock_timestamp()`, not `now()`: `now()` is the start of the
    # transaction, and one employer action can record two events (VIEWED,
    # then SHORTLISTED). They must sort in the order they happened.
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("clock_timestamp()"), nullable=False
    )

    __table_args__ = (
        CheckConstraint(f"to_stage IN ({_STAGE_LIST})", name="ck_app_events_to_stage"),
        CheckConstraint(f"kind IN ({_in(EVENT_KINDS)})", name="ck_app_events_kind"),
        CheckConstraint(f"actor_type IN ({_in(ACTOR_TYPES)})", name="ck_app_events_actor_type"),
        CheckConstraint(
            "actor_type <> 'SYSTEM' OR actor_id IS NULL", name="ck_app_events_system_has_no_actor"
        ),
        Index("ix_app_events_app_time", "application_id", "occurred_at"),
    )


class ApplicationMessage(Base, UUIDPrimaryKey):
    """An employer writing to an applicant (2026-09-29): an interview or
    online-assessment invitation, or a plain message. Sent to the candidate by
    email and in the app (`applications.message_sent`).

    **Not under RLS**, like `application_events`: it is read only by
    application id, after the application was loaded under the caller's own
    policy -- the employer's tenant or the candidate's own binding. Insert-only:
    what was sent to someone is not rewritten afterwards.

    `sender_id` is the recruiter who wrote it, for the employer's own view and
    for disputes. **No candidate schema carries it.**
    """

    __tablename__ = "application_messages"

    application_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False
    )
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    body: Mapped[str] = mapped_column(String(2000), nullable=False)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    link: Mapped[str | None] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("clock_timestamp()"), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('INTERVIEW', 'ASSESSMENT', 'GENERAL')", name="ck_application_messages_kind"
        ),
        CheckConstraint(
            "kind <> 'INTERVIEW' OR scheduled_at IS NOT NULL",
            name="ck_application_messages_interview_time",
        ),
        CheckConstraint(
            "kind <> 'ASSESSMENT' OR link IS NOT NULL",
            name="ck_application_messages_assessment_link",
        ),
        CheckConstraint(
            "link IS NULL OR link LIKE 'https://%'", name="ck_application_messages_https"
        ),
        Index("ix_application_messages_application", "application_id", "created_at"),
        Index("ix_application_messages_sender", "sender_id"),
    )
