"""kyb - SQLAlchemy ORM models.

Submissions, documents, review state machine.

**Built in full, then short-circuited by config.** The client confirmed the
shape on 2026-08-27: the onboarding form exists, approval is automatic, and we
build the approval mechanism plus a setting to enable or disable it. Disabling
it means automatic approval.

The state machine, the publish gate and the Postgres trigger all stay. Turning
verification back on is then a config change rather than re-introducing a gate
into a live marketplace - which matters, because auto-approval plus
whole-database employer access is the bulk-extraction risk raised in
docs/questions.txt section 1A.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import TenantScoped, Timestamps, UUIDPrimaryKey

# SRS 1.20.7
KYB_STATES = (
    "DRAFT",
    "SUBMITTED",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "MORE_INFO_REQUIRED",
)


class KybSubmission(Base, UUIDPrimaryKey, TenantScoped, Timestamps):
    __tablename__ = "kyb_submissions"

    state: Mapped[str] = mapped_column(String(24), default="DRAFT", nullable=False)
    #: The form answers, as submitted. Kept whole rather than spread into
    #: columns because the form is data (`kyb/forms.py`) and will change; a
    #: submission must keep saying what was asked and answered at the time.
    answers: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )
    #: Which version of the form these answers are to.
    form_version: Mapped[str | None] = mapped_column(String(64))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # A rejection must carry a reason (SRS 1.11.3).
    decision_reason: Mapped[str | None] = mapped_column(Text)
    # True when this submission was approved by the config flag rather than by
    # a human. Worth being able to tell the two apart later.
    auto_approved: Mapped[bool] = mapped_column(default=False, nullable=False)
    #: What the last reviewer pointed at, while the employer corrects it:
    #: `[{"field": code, "note": text | null}]` (2026-10-10). Set by a
    #: send-back or a rejection, cleared when the submission goes back in.
    #: The record of every decision is `kyb_reviews`.
    review_flags: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    #: The rejected submission this one was filled in from, if any.
    previous_submission_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("kyb_submissions.id", ondelete="RESTRICT")
    )

    __table_args__ = (
        CheckConstraint(
            "state IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', "
            "'REJECTED', 'MORE_INFO_REQUIRED')",
            name="ck_kyb_submissions_state",
        ),
        CheckConstraint(
            "state <> 'REJECTED' OR decision_reason IS NOT NULL",
            name="ck_kyb_rejection_has_reason",
        ),
        Index("ix_kyb_submissions_tenant_state", "tenant_id", "state"),
        Index(
            "ix_kyb_submissions_previous",
            "previous_submission_id",
            postgresql_where="previous_submission_id IS NOT NULL",
        ),
        # **One open submission per organisation.** Two would make "is this
        # employer verified?" depend on which row a query happened to find.
        # A closed submission (APPROVED or REJECTED) is history and does not
        # block a new one.
        Index(
            "uq_kyb_open_submission_per_tenant",
            "tenant_id",
            unique=True,
            postgresql_where=(
                "state IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED')"
            ),
        ),
    )


class KybDocument(Base, UUIDPrimaryKey, TenantScoped):
    """Registration and tax documents. Private bucket, presigned access only."""

    __tablename__ = "kyb_documents"

    submission_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kyb_submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    doc_type: Mapped[str] = mapped_column(String(64), nullable=False)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    #: Sniffed from the stored bytes, never taken from the upload request.
    mime: Mapped[str | None] = mapped_column(String(64))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class KybReview(Base, UUIDPrimaryKey, TenantScoped):
    """One reviewer's decision on one submission, kept whole (2026-10-10).

    **Append-only**: the app role holds no UPDATE or DELETE. A submission
    sent back and corrected is reviewed again, and each time the reviewer
    sees what changed since the last decision -- which needs what that
    decision was made on. So the answers and the latest document of each
    type are copied in at the moment of deciding.
    """

    __tablename__ = "kyb_reviews"

    submission_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("kyb_submissions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    decision: Mapped[str] = mapped_column(String(24), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    #: `[{"field": code, "note": text | null}]`, as on the submission.
    flags: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    reviewed_by: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    reviewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: What was decided on: the answers, and `doc_type -> kyb_documents.id`.
    answers: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )
    documents: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "decision IN ('UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED')",
            name="ck_kyb_reviews_decision",
        ),
        CheckConstraint(
            "decision NOT IN ('REJECTED', 'MORE_INFO_REQUIRED') OR reason IS NOT NULL",
            name="ck_kyb_reviews_reason",
        ),
        CheckConstraint(
            "decision IN ('REJECTED', 'MORE_INFO_REQUIRED') OR flags = '[]'::jsonb",
            name="ck_kyb_reviews_flags",
        ),
        Index("ix_kyb_reviews_submission", "submission_id", "reviewed_at"),
        Index("ix_kyb_reviews_reviewed_by", "reviewed_by"),
    )
