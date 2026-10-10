"""notifications - SQLAlchemy ORM models

Event to channel fan-out, templates.

Six tables, none of them tenant-scoped: a message belongs to the person it
was addressed to, and every read filters on that person.

* `notifications` -- **every message we decided to send, sent or not.** One
  row per recipient, channel and template, keyed by `dedupe_key` so an event
  delivered twice produces one message. A skipped row keeps its reason. The
  app role may move a row's delivery fields and nothing else, and may not
  delete one: "were they told?" must stay answerable.
* `notification_preferences` -- the person's choices, one row, absent means
  everything on.
* `notification_suppressions` -- *our* stops, not their choices: a bounced
  address, a complaint, a support request. Lifting is a timestamp.
* `profile_nudges` -- one row per incomplete-profile nudge, numbered per
  person. The unique number is what makes two sweeps at once send one nudge,
  and the count is the cadence cap. Insert-only.
* `push_devices` -- each installed app's Expo token, associated with its
  current account and disabled on sign-out or invalid-token receipts.
* `push_deliveries` -- one attempted device delivery per inbox message.
"""

from __future__ import annotations

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
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import UUIDPrimaryKey
from app.modules.notifications.domain import (
    CATEGORIES,
    CHANNELS,
    NOTIFICATION_STATES,
    SKIP_REASONS,
    SUPPRESSION_REASONS,
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Notification(Base, UUIDPrimaryKey):
    __tablename__ = "notifications"

    #: The account addressed. NULL only for a college invitation to a contact
    #: with no account, which names the roster entry instead.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    roster_entry_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("roster_entries.id", ondelete="CASCADE"), index=True
    )
    template_code: Mapped[str] = mapped_column(String(64), nullable=False)
    channel: Mapped[str] = mapped_column(String(8), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    locale: Mapped[str] = mapped_column(String(8), nullable=False)
    templates_version: Mapped[str] = mapped_column(String(64), nullable=False)
    subject: Mapped[str | None] = mapped_column(String(200))
    #: What was (or would have been) sent, rendered. Never a score: no
    #: template has a variable for one.
    body: Mapped[str] = mapped_column(Text, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    skip_reason: Mapped[str | None] = mapped_column(String(32))
    failure_code: Mapped[str | None] = mapped_column(String(64))
    provider: Mapped[str | None] = mapped_column(String(32))
    provider_ref: Mapped[str | None] = mapped_column(String(128))
    #: The outbox event that caused it; NULL for a nudge.
    source_event_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    dedupe_key: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(_in("channel", CHANNELS), name="ck_notifications_channel"),
        CheckConstraint(_in("category", CATEGORIES), name="ck_notifications_category"),
        CheckConstraint(_in("state", NOTIFICATION_STATES), name="ck_notifications_state"),
        CheckConstraint(
            f"skip_reason IS NULL OR {_in('skip_reason', SKIP_REASONS)}",
            name="ck_notifications_skip_reason_known",
        ),
        CheckConstraint(
            "(state = 'SKIPPED') = (skip_reason IS NOT NULL)", name="ck_notifications_skip_reason"
        ),
        CheckConstraint(
            "(user_id IS NULL) <> (roster_entry_id IS NULL)", name="ck_notifications_one_recipient"
        ),
        # The inbox is for accounts, and only in-app messages land in it.
        CheckConstraint(
            "channel <> 'IN_APP' OR (user_id IS NOT NULL AND state IN ('DELIVERED', 'SKIPPED'))",
            name="ck_notifications_in_app",
        ),
        CheckConstraint("read_at IS NULL OR channel = 'IN_APP'", name="ck_notifications_read"),
        Index("ix_notifications_inbox", "user_id", "channel", "created_at"),
        Index(
            "ix_notifications_pending",
            "created_at",
            postgresql_where="state = 'PENDING'",
        ),
    )


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    sms_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    email_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    push_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    #: Incomplete-profile reminders. Off is final until the person turns it
    #: back on; the sweep never asks again.
    nudges_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class PushDevice(Base, UUIDPrimaryKey):
    __tablename__ = "push_devices"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(String(256), nullable=False, unique=True)
    platform: Mapped[str] = mapped_column(String(8), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint("platform IN ('android', 'ios')", name="ck_push_devices_platform"),
    )


class PushDelivery(Base):
    __tablename__ = "push_deliveries"

    notification_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("notifications.id", ondelete="CASCADE"), primary_key=True
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("push_devices.id", ondelete="CASCADE"), primary_key=True
    )
    state: Mapped[str] = mapped_column(String(16), nullable=False, default="PENDING")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ticket_id: Mapped[str | None] = mapped_column(String(128))
    failure_code: Mapped[str | None] = mapped_column(String(64))
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    receipt_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("state IN ('PENDING', 'SENT', 'FAILED')", name="ck_push_deliveries_state"),
        Index("ix_push_deliveries_pending", "attempted_at", postgresql_where="state = 'PENDING'"),
    )


class NotificationSuppression(Base, UUIDPrimaryKey):
    __tablename__ = "notification_suppressions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    #: A channel, or ALL.
    channel: Mapped[str] = mapped_column(String(8), nullable=False)
    reason: Mapped[str] = mapped_column(String(32), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    lifted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            _in("channel", ("SMS", "EMAIL", "PUSH", "ALL")), name="ck_suppressions_channel"
        ),
        CheckConstraint(_in("reason", SUPPRESSION_REASONS), name="ck_suppressions_reason"),
        Index(
            "uq_suppressions_open",
            "user_id",
            "channel",
            unique=True,
            postgresql_where="lifted_at IS NULL",
        ),
    )


class ProfileNudge(Base, UUIDPrimaryKey):
    __tablename__ = "profile_nudges"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    #: The `notifications.nudges` config version the nudge was sent under.
    rules_version: Mapped[int] = mapped_column(Integer, nullable=False)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "sequence", name="uq_profile_nudges_sequence"),
        CheckConstraint("sequence >= 1", name="ck_profile_nudges_sequence"),
    )
