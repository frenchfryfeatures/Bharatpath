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


class Industry(OptionFields, Base):
    __tablename__ = "industries"
    __table_args__ = (
        Index(
            "uq_tax_industry_name",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class Department(OptionFields, Base):
    __tablename__ = "departments"
    type: Mapped[str] = mapped_column(String(16), default="Non-tech", server_default="Non-tech")
    __table_args__ = (
        CheckConstraint("type IN ('Tech','Non-tech')", name="ck_tax_department_type"),
        Index(
            "uq_tax_department_name",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class RoleCategory(OptionFields, Base):
    __tablename__ = "role_categories"
    department_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("departments.id"), index=True)
    __table_args__ = (
        Index(
            "uq_tax_category_name",
            "department_id",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class JobRole(OptionFields, Base):
    __tablename__ = "job_roles"
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("role_categories.id"), index=True
    )
    __table_args__ = (
        Index(
            "uq_tax_role_name",
            "category_id",
            "normalized_name",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )


class IndustryDepartmentPriority(Base):
    __tablename__ = "industry_department_priority"
    industry_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("industries.id"), primary_key=True
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("departments.id"), primary_key=True
    )
    rank: Mapped[int] = mapped_column(Integer)
    __table_args__ = (CheckConstraint("rank >= 0", name="ck_tax_priority_rank"),)


class TaxonomyRevision(Base):
    __tablename__ = "taxonomy_revision"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, server_default="0")


class OtherSubmission(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "other_submissions"
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
            "level IN ('industry','department','category','role')", name="ck_tax_other_level"
        ),
        CheckConstraint(
            "status IN ('pending','approved','rejected','merged')", name="ck_tax_other_status"
        ),
        Index(
            "uq_tax_other_user", "user_id", "level", "context_key", "normalized_text", unique=True
        ),
    )
