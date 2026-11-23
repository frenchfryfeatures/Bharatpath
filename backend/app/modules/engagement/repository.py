"""engagement - data access

Daily app-open streaks and engagement points. Never the score.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

`streak_point_events` is append-only: there is an insert and a list here and
deliberately nothing else, and the app role holds no UPDATE or DELETE on it.
`streak_activity_days` likewise, except that a year on, its rows are deleted
by a SECURITY DEFINER function that picks the cut-off itself.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import ConfigValue
from app.modules.engagement.domain import StreakState
from app.modules.engagement.models import StreakActivityDay, StreakPointEvent, UserStreak


async def current_config(session: AsyncSession, *, key: str, now: datetime) -> ConfigValue | None:
    """The highest version of a config key that has taken effect by `now`.

    `effective_from` is honoured so a rules change can be written ahead of
    the day it applies, rather than someone having to insert it at midnight.
    """
    result = await session.execute(
        select(ConfigValue)
        .where(ConfigValue.key == key, ConfigValue.effective_from <= now)
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_streak(session: AsyncSession, *, user_id: uuid.UUID) -> UserStreak | None:
    return await session.get(UserStreak, user_id)


async def lock_streak(session: AsyncSession, *, user_id: uuid.UUID) -> UserStreak:
    """The candidate's streak row, created if absent, locked for this transaction.

    **The lock is the concurrency control.** A candidate with the app open on
    a phone and a laptop sends two check-ins at once; without `FOR UPDATE`
    both read yesterday's state, both extend it, and a break could deduct
    twice. `ON CONFLICT DO NOTHING` first means two first-ever check-ins
    racing still end on one row, which the second then waits to lock.

    `populate_existing` because an earlier read in the same session would
    otherwise hand back the identity-map copy rather than the locked row.
    """
    await session.execute(
        pg_insert(UserStreak)
        .values(user_id=user_id)
        .on_conflict_do_nothing(index_elements=["user_id"])
    )
    result = await session.execute(
        select(UserStreak)
        .where(UserStreak.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


def apply_state(row: UserStreak, state: StreakState) -> None:
    row.current_streak = state.current_streak
    row.longest_streak = state.longest_streak
    row.last_active_on = state.last_active_on
    row.streak_started_on = state.streak_started_on
    row.points_balance = state.points_balance
    row.first_active_on = state.first_active_on


async def insert_point_event(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    points: int,
    requested_points: int,
    balance_after: int,
    streak_length: int,
    streak_started_on: date | None,
    milestone_days: int | None,
    activity_on: date,
    rules_version: str,
) -> StreakPointEvent:
    """Append one ledger row. **The only write path to this table.**"""
    row = StreakPointEvent(
        user_id=user_id,
        kind=kind,
        points=points,
        requested_points=requested_points,
        balance_after=balance_after,
        streak_length=streak_length,
        streak_started_on=streak_started_on,
        milestone_days=milestone_days,
        activity_on=activity_on,
        rules_version=rules_version,
    )
    session.add(row)
    await session.flush()
    return row


async def list_point_events(
    session: AsyncSession, *, user_id: uuid.UUID, limit: int
) -> list[StreakPointEvent]:
    result = await session.execute(
        select(StreakPointEvent)
        .where(StreakPointEvent.user_id == user_id)
        .order_by(StreakPointEvent.created_at.desc(), StreakPointEvent.id.desc())
        .limit(limit)
    )
    return list(result.scalars())


async def record_active_day(session: AsyncSession, *, user_id: uuid.UUID, day: date) -> None:
    """Mark `day` opened. **The only write path to the calendar.** A no-op for
    a day already marked, behind the row lock that already makes it rare."""
    await session.execute(
        pg_insert(StreakActivityDay)
        .values(user_id=user_id, activity_on=day)
        .on_conflict_do_nothing(index_elements=["user_id", "activity_on"])
    )


async def active_days_between(
    session: AsyncSession, *, user_id: uuid.UUID, start: date, end: date
) -> frozenset[date]:
    result = await session.execute(
        select(StreakActivityDay.activity_on).where(
            StreakActivityDay.user_id == user_id,
            StreakActivityDay.activity_on.between(start, end),
        )
    )
    return frozenset(result.scalars())


async def milestones_between(
    session: AsyncSession, *, user_id: uuid.UUID, start: date, end: date
) -> dict[date, int]:
    """The milestone reached on each day in the range. At most one a day: a
    check-in reaches one streak length."""
    result = await session.execute(
        select(StreakPointEvent.activity_on, func.max(StreakPointEvent.milestone_days))
        .where(
            StreakPointEvent.user_id == user_id,
            StreakPointEvent.kind == "MILESTONE_AWARD",
            StreakPointEvent.activity_on.between(start, end),
        )
        .group_by(StreakPointEvent.activity_on)
    )
    return {day: days for day, days in result.tuples() if days is not None}


async def purge_expired_activity_days(session: AsyncSession, *, today: date) -> int:
    """Delete days past the retention window; how many went.

    The function clamps `today` to the database's own IST day, so a wrong
    clock here can only ever delete less.
    """
    result = await session.execute(
        text("SELECT purge_streak_activity_days(:today)"), {"today": today}
    )
    return int(result.scalar_one())


async def users_active_on(
    session: AsyncSession, *, user_ids: list[uuid.UUID], day: date
) -> set[uuid.UUID]:
    """Which of these people have a calendar row for `day`."""
    if not user_ids:
        return set()
    rows = await session.execute(
        select(StreakActivityDay.user_id).where(
            StreakActivityDay.user_id.in_(user_ids), StreakActivityDay.activity_on == day
        )
    )
    return set(rows.scalars().all())
