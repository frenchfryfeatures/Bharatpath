"""Small append-only tracking writes; indexed, precomputed candidate reads."""

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class InsightEvent(Base):
    __tablename__ = "profile_insight_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("users.id", ondelete="CASCADE")
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID, ForeignKey("users.id", ondelete="SET NULL")
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID, ForeignKey("tenants.id", ondelete="SET NULL")
    )
    application_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID, ForeignKey("applications.id", ondelete="SET NULL")
    )
    metric: Mapped[str] = mapped_column(String(32))
    dedup_key: Mapped[str] = mapped_column(String(200), unique=True)
    terms: Mapped[list] = mapped_column(JSONB, default=list)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    aggregated: Mapped[bool] = mapped_column(Boolean, default=False)
    __table_args__ = (
        Index("ix_insights_pending", "aggregated", "occurred_at"),
        Index("ix_insights_candidate_time", "candidate_id", "occurred_at"),
    )


class SearchReceipt(Base):
    __tablename__ = "profile_insight_receipts"
    id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True, default=uuid.uuid4)
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("users.id", ondelete="CASCADE")
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("users.id", ondelete="CASCADE"))
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID, ForeignKey("tenants.id", ondelete="CASCADE"))
    terms: Mapped[list] = mapped_column(JSONB, default=list)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    shown_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class InsightDay(Base):
    __tablename__ = "profile_insight_days"
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    metric: Mapped[str] = mapped_column(String(32), primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(UUID, primary_key=True)
    keyword: Mapped[str] = mapped_column(String(100), primary_key=True, default="")
    count: Mapped[int] = mapped_column(Integer, default=0)


class InsightRollup(Base):
    __tablename__ = "profile_insight_rollup"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AnonymousTotal(Base):
    __tablename__ = "profile_insight_anonymous_totals"
    metric: Mapped[str] = mapped_column(String(32), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
