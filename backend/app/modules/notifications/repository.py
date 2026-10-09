"""notifications - data access

Event to channel fan-out, templates.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

No table here is tenant-scoped. **Every read of a message filters on the
person it was addressed to**, taken from the verified caller, never from a
request.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import ConfigValue, OutboxEvent
from app.modules.notifications.models import (
    Notification,
    NotificationPreference,
    NotificationSuppression,
    ProfileNudge,
)


async def current_config(session: AsyncSession, *, key: str, now: datetime) -> ConfigValue | None:
    result = await session.execute(
        select(ConfigValue)
        .where(ConfigValue.key == key, ConfigValue.effective_from <= now)
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def outbox_event(session: AsyncSession, *, event_id: uuid.UUID) -> OutboxEvent | None:
    result = await session.execute(select(OutboxEvent).where(OutboxEvent.id == event_id))
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------
async def insert_notification(session: AsyncSession, **values: Any) -> uuid.UUID | None:
    """None when `dedupe_key` already exists: the event was delivered twice,
    and the first delivery's row is the message."""
    return await session.scalar(
        pg_insert(Notification)
        .values(id=uuid.uuid4(), **values)
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
        .returning(Notification.id)
    )


async def claim_pending(
    session: AsyncSession, *, notification_id: uuid.UUID
) -> Notification | None:
    """Lock one PENDING row for sending. `SKIP LOCKED`: a second worker on the
    same row moves on rather than sending it again."""
    result = await session.execute(
        select(Notification)
        .where(Notification.id == notification_id, Notification.state == "PENDING")
        .with_for_update(skip_locked=True)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def orphaned_pending(
    session: AsyncSession, *, cutoff: datetime, limit: int
) -> list[Notification]:
    """PENDING rows decided a while ago and never handed to a provider.

    **How a message is orphaned.** `dispatch_event` decides every message in
    one transaction and commits; `send_all` then sends each in its own. A
    worker that dies in between leaves committed PENDING rows that no longer
    have anybody to send them.

    An event-sourced message gets another chance when the outbox redelivers
    it -- `send` finds the row still PENDING and sends it. **A nudge does
    not**: its sequence number is already claimed
    (`uq_profile_nudges_sequence`), so the sweep will not generate it again
    and nothing will ever pick the row up. This is the only path back for
    those.

    `cutoff` keeps the sweep away from messages a live worker is mid-way
    through: a row decided seconds ago is far more likely to be in flight
    than abandoned, and racing it wastes a provider call. Oldest first, so a
    backlog drains in the order people were meant to hear.

    **Account-addressed messages only.** A roster invitation addresses a
    contact a college uploaded, and re-resolving it needs that college's
    tenant bound -- which this row does not carry, and which would mean a new
    cross-tenant read path for a case that already has a way back: an
    invitation is event-sourced, so the outbox redelivers it. The nudge is
    the one with no second chance, and the nudge has a `user_id`.
    """
    result = await session.execute(
        select(Notification)
        .where(
            Notification.state == "PENDING",
            Notification.created_at < cutoff,
            Notification.user_id.is_not(None),
        )
        .order_by(Notification.created_at)
        .limit(limit)
    )
    return list(result.scalars().all())


async def pending_by_key(session: AsyncSession, *, dedupe_key: str) -> uuid.UUID | None:
    result = await session.execute(
        select(Notification.id).where(
            Notification.dedupe_key == dedupe_key, Notification.state == "PENDING"
        )
    )
    return result.scalar_one_or_none()


async def pending_ids(session: AsyncSession, *, limit: int) -> list[uuid.UUID]:
    result = await session.execute(
        select(Notification.id)
        .where(Notification.state == "PENDING")
        .order_by(Notification.created_at)
        .limit(limit)
    )
    return list(result.scalars().all())


async def mark(session: AsyncSession, *, notification_id: uuid.UUID, **values: Any) -> None:
    await session.execute(
        update(Notification).where(Notification.id == notification_id).values(**values)
    )


async def get_notification(
    session: AsyncSession, *, notification_id: uuid.UUID
) -> Notification | None:
    result = await session.execute(
        select(Notification)
        .where(Notification.id == notification_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def inbox(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[Notification]:
    stmt = select(Notification).where(
        Notification.user_id == user_id,
        Notification.channel == "IN_APP",
        Notification.state == "DELIVERED",
    )
    if after is not None:
        stmt = stmt.where(
            (Notification.created_at < after[0])
            | ((Notification.created_at == after[0]) & (Notification.id < after[1]))
        )
    stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)
    return list((await session.execute(stmt)).scalars().all())


async def unread_count(session: AsyncSession, *, user_id: uuid.UUID) -> int:
    return int(
        await session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.channel == "IN_APP",
                Notification.state == "DELIVERED",
                Notification.read_at.is_(None),
            )
        )
        or 0
    )


async def mark_read(
    session: AsyncSession, *, user_id: uuid.UUID, notification_id: uuid.UUID, now: datetime
) -> Notification | None:
    """The reader's own in-app message, or None. Reading twice keeps the
    first time."""
    await session.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
            Notification.channel == "IN_APP",
            Notification.read_at.is_(None),
        )
        .values(read_at=now)
    )
    result = await session.execute(
        select(Notification)
        .where(
            Notification.id == notification_id,
            Notification.user_id == user_id,
            Notification.channel == "IN_APP",
            Notification.state == "DELIVERED",
        )
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Preferences and suppressions
# ---------------------------------------------------------------------------
async def preferences_for(
    session: AsyncSession, *, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, NotificationPreference]:
    if not user_ids:
        return {}
    result = await session.execute(
        select(NotificationPreference).where(NotificationPreference.user_id.in_(user_ids))
    )
    return {row.user_id: row for row in result.scalars().all()}


async def upsert_preferences(
    session: AsyncSession, *, user_id: uuid.UUID, values: dict[str, bool]
) -> NotificationPreference:
    await session.execute(
        pg_insert(NotificationPreference)
        .values(user_id=user_id, **values)
        .on_conflict_do_update(
            index_elements=["user_id"], set_={**values, "updated_at": func.now()}
        )
    )
    result = await session.execute(
        select(NotificationPreference)
        .where(NotificationPreference.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def open_suppressions(
    session: AsyncSession, *, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, frozenset[str]]:
    if not user_ids:
        return {}
    result = await session.execute(
        select(NotificationSuppression.user_id, NotificationSuppression.channel).where(
            NotificationSuppression.user_id.in_(user_ids),
            NotificationSuppression.lifted_at.is_(None),
        )
    )
    found: dict[uuid.UUID, set[str]] = {}
    for user_id, channel in result.tuples():
        found.setdefault(user_id, set()).add(channel)
    return {user_id: frozenset(channels) for user_id, channels in found.items()}


async def suppress(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    channel: str,
    reason: str,
    created_by: uuid.UUID | None,
) -> bool:
    """False when that channel is already suppressed for this person."""
    row_id = await session.scalar(
        pg_insert(NotificationSuppression)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            channel=channel,
            reason=reason,
            created_by=created_by,
        )
        .on_conflict_do_nothing(
            index_elements=["user_id", "channel"],
            index_where=NotificationSuppression.lifted_at.is_(None),
        )
        .returning(NotificationSuppression.id)
    )
    return row_id is not None


# ---------------------------------------------------------------------------
# Nudges
# ---------------------------------------------------------------------------
async def nudge_history(
    session: AsyncSession, *, user_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, datetime]]:
    """`user_id -> (nudges sent, last sent)`, for those nudged at least once."""
    if not user_ids:
        return {}
    result = await session.execute(
        select(
            ProfileNudge.user_id, func.max(ProfileNudge.sequence), func.max(ProfileNudge.sent_at)
        )
        .where(ProfileNudge.user_id.in_(user_ids))
        .group_by(ProfileNudge.user_id)
    )
    return {user_id: (int(sent), last) for user_id, sent, last in result.tuples()}


async def record_nudge(
    session: AsyncSession, *, user_id: uuid.UUID, sequence: int, rules_version: int, now: datetime
) -> uuid.UUID | None:
    """None when this person's nudge number `sequence` exists already: another
    sweep got there first, and one nudge is what the person should receive."""
    return await session.scalar(
        pg_insert(ProfileNudge)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            sequence=sequence,
            rules_version=rules_version,
            sent_at=now,
        )
        .on_conflict_do_nothing(constraint="uq_profile_nudges_sequence")
        .returning(ProfileNudge.id)
    )
