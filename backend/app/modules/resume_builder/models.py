"""resume_builder - SQLAlchemy ORM models

One draft per candidate: the resume they are building, the template it is
laid out in, and two facts about what they did with it -- downloaded it, and
made it their resume. The sales follow-up list in the console reads the
first; the second points at the version it became.

**Not under Row-Level Security**, like `user_photos`: a draft has no tenant,
is read only by its owner (whose id comes from the verified token) and by
staff on the read-only bypass session. Every repository function takes the
owner's id. Personal data, erased with the person (`erase_candidate`).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.modules.resume_builder.domain import TEMPLATE_KEYS

_TEMPLATES = "template_key IN (" + ", ".join(f"'{k}'" for k in TEMPLATE_KEYS) + ")"


class ResumeBuilderDraft(Base):
    __tablename__ = "resume_builder_drafts"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    template_key: Mapped[str] = mapped_column(String(32), nullable=False)
    #: A `resume.structuring.StructuredResume`, validated on every write.
    content: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    #: Downloads are counted for the follow-up list: someone who took their
    #: resume away and did not pay is who sales calls (2026-10-13).
    first_downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    download_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    #: The version this draft last became. A later save makes it stale
    #: (`updated_at > pushed_at`); pushing again writes a new version.
    pushed_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("resume_versions.id", ondelete="SET NULL")
    )
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    #: When the draft last caught up with the candidate's resume: first
    #: saved, refilled, pushed, or kept as it is on purpose (2026-10-22). A CV
    #: read after this is one the draft has not seen, and the editor says so
    #: (`out_of_date`). An autosave does not move it: typing is not catching up.
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(_TEMPLATES, name="ck_resume_builder_drafts_template"),
        CheckConstraint("download_count >= 0", name="ck_resume_builder_drafts_downloads"),
        CheckConstraint(
            "(download_count = 0) = (first_downloaded_at IS NULL)",
            name="ck_resume_builder_drafts_first_download",
        ),
        Index("ix_resume_builder_drafts_pushed_version", "pushed_version_id"),
    )
