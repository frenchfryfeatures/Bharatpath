import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps, UUIDPrimaryKey


class OptionFields(UUIDPrimaryKey, Timestamps):
    name: Mapped[str] = mapped_column(String(160))
    normalized_name: Mapped[str] = mapped_column(String(320))
    slug: Mapped[str] = mapped_column(String(120))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    is_user_added: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID, ForeignKey("users.id"))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(UUID, ForeignKey("users.id"))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Qualification(OptionFields, Base):
    __tablename__ = "qualifications"
    level_rank: Mapped[int] = mapped_column(Integer, server_default="1")
    __table_args__ = (
        CheckConstraint("level_rank BETWEEN 1 AND 9", name="ck_education_rank"),
        Index(
            "uq_edu_qualification",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class Course(OptionFields, Base):
    __tablename__ = "education_courses"
    qualification_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("qualifications.id"), index=True
    )
    __table_args__ = (
        Index(
            "uq_edu_course",
            "qualification_id",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class Specialization(OptionFields, Base):
    __tablename__ = "specializations"
    is_not_applicable: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), default=False
    )
    __table_args__ = (
        Index(
            "uq_edu_specialization",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class CourseSpecialization(OptionFields, Base):
    __tablename__ = "course_specializations"
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("education_courses.id"), index=True
    )
    specialization_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("specializations.id"), index=True
    )
    __table_args__ = (
        Index(
            "uq_edu_course_specialization",
            "course_id",
            "specialization_id",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class OtherSubmission(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "education_other_submissions"
    level: Mapped[str] = mapped_column(String(16), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID)
    parent_chain: Mapped[dict[str, str]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    context_key: Mapped[str] = mapped_column(String(64))
    raw_text: Mapped[str] = mapped_column(Text)
    normalized_text: Mapped[str] = mapped_column(String(320), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(
        String(16), default="pending", server_default="pending", index=True
    )
    resolved_option_id: Mapped[uuid.UUID | None] = mapped_column(UUID)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(UUID, ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    __table_args__ = (
        CheckConstraint(
            "level IN ('qualification','course','specialization')", name="ck_edu_other_level"
        ),
        CheckConstraint(
            "status IN ('pending','approved','rejected','merged')", name="ck_edu_other_status"
        ),
        Index(
            "uq_edu_other_user", "user_id", "level", "context_key", "normalized_text", unique=True
        ),
    )
