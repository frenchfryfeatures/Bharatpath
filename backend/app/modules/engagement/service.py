"""engagement - business rules and transaction boundaries

Daily app-open streaks and engagement points. Never the score.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**This module imports nothing from `scoring`, and `scoring` imports nothing
from it** -- `.importlinter` contract `engagement-and-scoring-are-independent`.
Engagement points are a separate balance; `docs/streaks.md` §2 explains why
they cannot be the score.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ValidationError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.modules.engagement import repository
from app.modules.engagement.domain import (
    DEFAULT_RULES,
    CalendarPeriod,
    CalendarRangeError,
    CalendarView,
    PointsChange,
    StreakRules,
    StreakRulesError,
    StreakState,
    StreakView,
    calendar_view,
    check_in,
    resolve_range,
    rules_from_config,
    view,
)
from app.modules.engagement.events import MILESTONE_REACHED, MODULE, STREAK_BROKEN

logger = get_logger(__name__)

#: The `config_values` key holding the rules. Insert a higher `version` to
#: change a number; see `docs/streaks.md` §5.
RULES_CONFIG_KEY: Final = "engagement.streak_rules"

#: Which calendar day an app open belongs to. India Standard Time, as a fixed
#: offset rather than `ZoneInfo("Asia/Kolkata")`: IST has had no DST since
#: 1945, and ZoneInfo needs the `tzdata` package on Windows, where its absence
#: fails at runtime rather than at install.
#:
#: The day is the server's decision, never the client's. A client-supplied
#: date would let anyone keep a streak alive by sending yesterday.
STREAK_TIMEZONE: Final = timezone(timedelta(hours=5, minutes=30), "IST")


class StreakRulesInvalidError(AppError):
    """The configured rules cannot be applied. A 500, deliberately: falling
    back to code defaults would make a broken config row look applied."""

    code = "streak_rules_invalid"
    title = "Streak rules are misconfigured"


class CalendarRangeInvalidError(ValidationError):
    """A calendar request naming no usable range. `reason` is for developers;
    clients match on the code."""

    code = "streak_calendar_range_invalid"
    title = "The calendar range is not valid"


@dataclass(frozen=True, slots=True)
class StreakSummary:
    view: StreakView
    today: date
    rules: StreakRules


@dataclass(frozen=True, slots=True)
class CheckInResult:
    summary: StreakSummary
    counted: bool
    changes: tuple[PointsChange, ...]


def local_day(now: datetime) -> date:
    """The candidate's calendar day for an instant. Naive datetimes are refused:
    guessing their zone is how a streak breaks at 05:30 instead of midnight."""
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    return now.astimezone(STREAK_TIMEZONE).date()


async def load_rules(session: AsyncSession, *, now: datetime) -> StreakRules:
    """The rules in force at `now`: the latest config row, else the code default."""
    row = await repository.current_config(session, key=RULES_CONFIG_KEY, now=now)
    if row is None:
        return DEFAULT_RULES
    try:
        if not isinstance(row.value, dict):
            raise StreakRulesError("streak rules must be a JSON object")
        return rules_from_config(row.value, version=f"config-v{row.version}")
    except StreakRulesError as exc:
        logger.error("streak_rules_invalid", config_version=row.version, error=str(exc))
        raise StreakRulesInvalidError() from exc


def _state_of(row: Any) -> StreakState:
    if row is None:
        return StreakState()
    return StreakState(
        current_streak=row.current_streak,
        longest_streak=row.longest_streak,
        last_active_on=row.last_active_on,
        streak_started_on=row.streak_started_on,
        points_balance=row.points_balance,
        first_active_on=row.first_active_on,
    )


async def record_app_open(
    session: AsyncSession, *, user_id: uuid.UUID, now: datetime | None = None
) -> CheckInResult:
    """Count today for this candidate. Safe to call on every app open.

    The first call on a calendar day extends or restarts the streak and
    applies any deduction or milestone; every later call that day changes
    nothing and returns the same state. `now` exists for tests -- routes never
    pass it, so the clock is always the server's.
    """
    now = now or datetime.now(UTC)
    today = local_day(now)
    rules = await load_rules(session, now=now)

    row = await repository.lock_streak(session, user_id=user_id)
    outcome = check_in(_state_of(row), today=today, rules=rules)

    if outcome.counted:
        repository.apply_state(row, outcome.state)
        await repository.record_active_day(session, user_id=user_id, day=today)
        for change in outcome.changes:
            await repository.insert_point_event(
                session,
                user_id=user_id,
                kind=change.kind,
                points=change.points,
                requested_points=change.requested,
                balance_after=change.balance_after,
                streak_length=change.streak_length,
                streak_started_on=change.streak_started_on,
                milestone_days=change.milestone_days,
                activity_on=today,
                rules_version=rules.version,
            )
            await emit(
                session,
                event_type=STREAK_BROKEN
                if change.kind == "STREAK_BREAK_PENALTY"
                else MILESTONE_REACHED,
                aggregate_type="user_streak",
                aggregate_id=user_id,
                payload={
                    "user_id": str(user_id),
                    "streak_length": change.streak_length,
                    "points": change.points,
                    "rules_version": rules.version,
                },
            )
        await session.flush()
        logger.info(
            "streak_counted",
            module=MODULE,
            current_streak=outcome.state.current_streak,
            changes=len(outcome.changes),
        )

    return CheckInResult(
        summary=StreakSummary(
            view=view(outcome.state, today=today, rules=rules), today=today, rules=rules
        ),
        counted=outcome.counted,
        changes=outcome.changes,
    )


async def get_streak(
    session: AsyncSession, *, user_id: uuid.UUID, now: datetime | None = None
) -> StreakSummary:
    """Read-only. A break shows immediately but is applied at the next check-in."""
    now = now or datetime.now(UTC)
    today = local_day(now)
    rules = await load_rules(session, now=now)
    row = await repository.get_streak(session, user_id=user_id)
    current = view(_state_of(row), today=today, rules=rules)
    return StreakSummary(view=current, today=today, rules=rules)


async def list_point_history(session: AsyncSession, *, user_id: uuid.UUID, limit: int) -> list[Any]:
    """The candidate's ledger, newest first."""
    return await repository.list_point_events(session, user_id=user_id, limit=limit)


async def get_calendar(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    period: CalendarPeriod | None = None,
    anchor: date | None = None,
    start: date | None = None,
    end: date | None = None,
    now: datetime | None = None,
) -> CalendarView:
    """Which days in a range the candidate opened the app. Read-only.

    Every day carries a status, so a client never works out IST days, "today"
    or the retention window for itself.
    """
    today = local_day(now or datetime.now(UTC))
    try:
        start, end = resolve_range(today=today, period=period, anchor=anchor, start=start, end=end)
    except CalendarRangeError as exc:
        raise CalendarRangeInvalidError(params={"reason": str(exc)}) from exc
    row = await repository.get_streak(session, user_id=user_id)
    active = await repository.active_days_between(session, user_id=user_id, start=start, end=end)
    milestones = await repository.milestones_between(session, user_id=user_id, start=start, end=end)
    return calendar_view(
        start=start,
        end=end,
        today=today,
        first_active_on=row.first_active_on if row is not None else None,
        active=active,
        milestones=milestones,
    )


async def purge_expired_activity(session: AsyncSession, *, now: datetime) -> int:
    """Forget opened days older than the retention window. The sweep's job."""
    return await repository.purge_expired_activity_days(session, today=local_day(now))


async def users_who_opened_today(
    session: AsyncSession, *, user_ids: list[uuid.UUID], now: datetime
) -> set[uuid.UUID]:
    """Of these people, those who opened the app on today's IST day. Read by
    the end-of-day reminder; says nothing about points."""
    return await repository.users_active_on(session, user_ids=user_ids, day=local_day(now))
