"""courses - SQLAlchemy ORM models.

Catalogue, purchase, completion, +30 contribution.

**`course_completions` is a score-moving write.** Since the client reversed the
"add-ons never change the score" rule on 2026-08-24, writing a row here moves a
candidate's number - which puts this table inside invariant 3's blast radius.
It is role-restricted, audited like a reveal, and never writable by the
candidate directly.

**`contribution_points` lives on the course row and is versioned**, not
hardcoded to 30. The client will change it.

One course exists on the platform, purchasable once, +30 total (client,
2026-08-27). The unique constraint below makes "once" a database guarantee
rather than a service-layer check with a race in it.

OPEN, and it blocks more than it looks like: **what counts as completing a
course?** Nobody has answered that (docs/questions.txt section 3I1). It is not
a content question - it decides what a row in this table means, and that row
moves a score.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps, UUIDPrimaryKey


class Course(Base, UUIDPrimaryKey, Timestamps):
    __tablename__ = "courses"

    code: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    price_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    # Versioned, not hardcoded. Currently 30.
    contribution_points: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    __table_args__ = (
        CheckConstraint("price_minor >= 0", name="ck_courses_price_non_negative"),
        # Bounds the contribution at the database level as well as in
        # scoring/domain.py. Invariant 4-prime, belt and braces.
        CheckConstraint(
            "contribution_points BETWEEN 0 AND 30",
            name="ck_courses_contribution_cap",
        ),
        UniqueConstraint("code", "version", name="uq_course_code_version"),
    )


class CoursePurchase(Base, UUIDPrimaryKey):
    """A course bought, by a verified payment.

    `payment_id` is required, and `guard_course_purchase` (baseline migration)
    refuses a row whose payment is not this user's SUCCEEDED, signature-verified
    payment for this course. So a forged callback cannot reach this table even
    through a direct repository call. A seat that covers add-ons would change
    that, and is an open question for the client.
    """

    __tablename__ = "course_purchases"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("courses.id"), nullable=False
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payments.id", ondelete="RESTRICT"), nullable=False
    )
    purchased_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # "Purchasable once" as a constraint, not a check-then-insert race.
        UniqueConstraint("user_id", "course_id", name="uq_course_purchase_once"),
    )


class CourseCompletion(Base, UUIDPrimaryKey):
    """A score-moving write. Role-restricted and audited (invariant 3)."""

    __tablename__ = "course_completions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("courses.id"), nullable=False
    )
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Which version of the contribution rules applied when this was recorded.
    # Without it, replaying an old score after the client changes the points
    # gives a different number.
    contribution_version: Mapped[str] = mapped_column(String(32), nullable=False)
    # The points this completion is worth, frozen when it was recorded. A
    # course row re-priced later must not change what an earlier completion
    # contributes to a score computed after it.
    points_awarded: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_course_completion_once"),
        Index("ix_course_completions_user", "user_id"),
        CheckConstraint("points_awarded BETWEEN 0 AND 30", name="ck_course_completions_points_cap"),
        # No completion without a purchase, as a key rather than a check.
        ForeignKeyConstraint(
            ["user_id", "course_id"],
            ["course_purchases.user_id", "course_purchases.course_id"],
            name="fk_course_completions_purchase",
            ondelete="RESTRICT",
        ),
    )


# ---------------------------------------------------------------------------
# Lessons (2026-09-29)
# ---------------------------------------------------------------------------
# The course is built by staff in the console: modules, and lessons inside
# them, each a YouTube video or an uploaded file. The client expects to start
# with one video and grow into the full structure, so nothing here assumes a
# size. Lessons hang off the course *code*, not a version row: a price change
# makes a new `courses` version, and must not take the lessons with it or lock
# out the people who bought the previous version.


class CourseModule(Base, UUIDPrimaryKey, Timestamps):
    """A section of a course. Switched off, never deleted."""

    __tablename__ = "course_modules"

    course_code: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        Index("ix_course_modules_course", "course_code", "sort_order"),
        Index("ix_course_modules_created_by", "created_by"),
    )


class CourseLesson(Base, UUIDPrimaryKey, Timestamps):
    """One video. **Published** means switched on and with media a candidate
    can play: a YouTube id, or an upload that was checked once it landed.

    Staff give the duration, because a YouTube embed tells the server nothing
    and the watched rule (`domain.lesson_watched`) is measured against it.
    """

    __tablename__ = "course_lessons"

    module_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("course_modules.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    media_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    youtube_video_id: Mapped[str | None] = mapped_column(String(16))
    s3_key: Mapped[str | None] = mapped_column(String(512))
    #: Set once an upload was found in the bucket and sniffed as a video.
    media_ready_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mime: Mapped[str | None] = mapped_column(String(32))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )

    __table_args__ = (
        CheckConstraint(
            "duration_seconds > 0 AND duration_seconds <= 14400",
            name="ck_course_lessons_duration",
        ),
        CheckConstraint("media_kind IN ('YOUTUBE', 'UPLOAD')", name="ck_course_lessons_media_kind"),
        # A YouTube lesson has an id and no object; an upload the reverse. A
        # YouTube lesson is ready the moment it exists.
        CheckConstraint(
            "(media_kind = 'YOUTUBE') = (youtube_video_id IS NOT NULL) AND "
            "(media_kind = 'UPLOAD') = (s3_key IS NOT NULL) AND "
            "(media_kind = 'UPLOAD' OR media_ready_at IS NOT NULL)",
            name="ck_course_lessons_media",
        ),
        Index("ix_course_lessons_module", "module_id", "sort_order"),
        Index("ix_course_lessons_created_by", "created_by"),
    )


class CourseLessonProgress(Base, Timestamps):
    """How far one candidate got through one lesson, and when it was watched.

    `completed_at` is a latch: a lesson once watched stays watched, and the
    course completion it contributed to is a score-moving row that never
    changes either. `furthest_seconds` only moves forward.
    """

    __tablename__ = "course_lesson_progress"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("course_lessons.id", ondelete="CASCADE"), primary_key=True
    )
    position_seconds: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    furthest_seconds: Mapped[int] = mapped_column(
        Integer, default=0, server_default=text("0"), nullable=False
    )
    first_opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "position_seconds >= 0 AND furthest_seconds >= position_seconds",
            name="ck_course_lesson_progress_positions",
        ),
        Index("ix_course_lesson_progress_lesson", "lesson_id"),
    )
