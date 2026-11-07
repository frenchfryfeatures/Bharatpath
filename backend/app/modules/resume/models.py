"""resume - SQLAlchemy ORM models.

Upload, parse jobs, versions, review and confirm.

**Versions are immutable and append-only.** An edit creates a new
`resume_versions` row pointing at the one it supersedes; it never mutates the
old one. That is what lets `scores.resume_version_id` mean something six
months later, which is half of invariant 1.

**The confirm gate is mandatory** (SRS 1.4.4). An unconfirmed version can never
reach scoring, because parsing is not 100% accurate and the candidate has to
see and correct what was extracted before a number is attached to it.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import UUIDPrimaryKey


class ResumeFile(Base, UUIDPrimaryKey):
    """The original uploaded document.

    Private bucket, SSE-KMS, presigned access only. Never a public URL
    (SRS 1.4.2). A failed upload must not create a partial record - the
    service enforces that with a transaction boundary, not cleanup logic.
    """

    __tablename__ = "resume_files"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    mime: Mapped[str] = mapped_column(String(128), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Type is sniffed from content, never trusted from the filename or the
    # client-declared Content-Type.
    scan_status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False)

    # The state the candidate polls. Without it the only observable signal is
    # "a version exists yet or not", which cannot tell *waiting* apart from
    # *never going to work* -- so a CV we cannot read leaves the client
    # polling an endpoint that will never change. See PARSE_STATES.
    parse_status: Mapped[str] = mapped_column(String(16), default="QUEUED", nullable=False)
    #: The parser's error code when `parse_status` is FAILED. A code, not a
    #: sentence: the client renders it in the candidate's own language.
    parse_error_code: Mapped[str | None] = mapped_column(String(64))
    #: The name the candidate's device gave the file, for their own list of
    #: uploaded resumes (2026-10-22, `domain.clean_filename`). A label only:
    #: the key and the type never come from it. NULL for uploads before then.
    original_filename: Mapped[str | None] = mapped_column(String(255))

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "scan_status IN ('PENDING', 'CLEAN', 'INFECTED', 'FAILED')",
            name="ck_resume_files_scan_status",
        ),
        CheckConstraint(
            "parse_status IN ('QUEUED', 'DONE', 'FAILED', 'BLOCKED')",
            name="ck_resume_files_parse_status",
        ),
        # A code is only meaningful on a failure, and a failure without one
        # tells the candidate nothing. Both halves, so neither can drift.
        CheckConstraint(
            "(parse_status = 'FAILED') = (parse_error_code IS NOT NULL)",
            name="ck_resume_files_parse_error_code",
        ),
        CheckConstraint("size_bytes > 0", name="ck_resume_files_size_positive"),
        Index("ix_resume_files_user", "user_id", "uploaded_at"),
    )


class ResumeVersion(Base, UUIDPrimaryKey):
    """A structured resume. Immutable once created.

    `supersedes_id` chains versions so score history stays meaningful: every
    score points at the exact version it was computed from, and that version
    can never change underneath it.
    """

    __tablename__ = "resume_versions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    resume_file_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("resume_files.id", ondelete="SET NULL"), index=True
    )
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    parsed: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    # NULL until the candidate has reviewed and confirmed. Scoring joins on
    # `confirmed_at IS NOT NULL` rather than checking it in Python.
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("resume_versions.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            # EDIT is a source in its own right, not a flag on UPLOAD. The
            # question "did a human assert this content?" is the one integrity
            # review and score provenance both ask, and as a source it is one
            # column rather than a walk up `supersedes_id`. BUILDER: the resume
            # builder (2026-10-13, migration 0019).
            "source IN ('UPLOAD', 'PASTE', 'MANUAL', 'EDIT', 'BUILDER')",
            name="ck_resume_versions_source",
        ),
        Index("ix_resume_versions_user", "user_id", "created_at"),
        Index(
            "ix_resume_versions_confirmed",
            "user_id",
            postgresql_where="confirmed_at IS NOT NULL",
        ),
        # **The chain cannot fork.** At most one version may supersede any
        # given parent. Postgres treats NULLs as distinct in a unique index,
        # so the many chain heads (supersedes_id IS NULL) are unaffected and
        # only the parent links are constrained.
        #
        # The service refuses a second edit of the same parent with a 409, but
        # two concurrent edits would both read "not yet superseded" and both
        # write. Then "the candidate's current resume" has two answers and the
        # score depends on which query won. The check in the service is for
        # the error message; this is for the guarantee.
        Index(
            "uq_resume_versions_supersedes",
            "supersedes_id",
            unique=True,
            postgresql_where="supersedes_id IS NOT NULL",
        ),
    )
