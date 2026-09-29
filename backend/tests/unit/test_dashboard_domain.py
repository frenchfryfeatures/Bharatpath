"""The employer dashboard's pure rules: IST days and the expiry horizon."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.modules.applications.domain import (
    DASHBOARD_WINDOW,
    IST,
    TREND_DAYS,
    ExpiryRules,
    daily_series,
    expires,
    expiry_horizon,
    trend_start,
)

RULES = ExpiryRules(inactive_days=30, version="test")


def test_a_day_is_an_indian_day() -> None:
    """00:30 IST on the 23rd is still the 22nd in UTC. The recruiter's today
    is the 23rd, so that is the series' last point."""
    now = datetime(2026, 9, 22, 19, 0, tzinfo=UTC)
    assert now.astimezone(IST).date() == date(2026, 9, 23)

    series = daily_series({}, now=now)
    assert series[-1][0] == date(2026, 9, 23)
    assert trend_start(now) == datetime(2026, 8, 25, 0, 0, tzinfo=IST)
    assert series[0][0] == trend_start(now).date()


def test_the_series_has_every_day_oldest_first_zeros_included() -> None:
    now = datetime(2026, 9, 23, 6, 0, tzinfo=UTC)
    today = date(2026, 9, 23)
    series = daily_series({today: 4, today - timedelta(days=2): 1}, now=now)

    assert len(series) == TREND_DAYS
    assert [d for d, _ in series] == sorted(d for d, _ in series)
    assert len({d for d, _ in series}) == TREND_DAYS
    assert series[-1] == (today, 4) and series[-2] == (today - timedelta(days=1), 0)
    assert series[-3] == (today - timedelta(days=2), 1)


def test_a_day_before_the_trend_is_not_drawn() -> None:
    now = datetime(2026, 9, 23, 6, 0, tzinfo=UTC)
    too_old = trend_start(now).date() - timedelta(days=1)
    assert sum(count for _, count in daily_series({too_old: 9}, now=now)) == 0


def test_a_naive_clock_is_refused() -> None:
    with pytest.raises(ValueError):
        trend_start(datetime(2026, 9, 23, 6, 0))


@pytest.mark.parametrize("nudge", [timedelta(seconds=-1), timedelta(seconds=1)])
def test_the_horizon_is_the_sweeps_own_rule_a_week_ahead(nudge: timedelta) -> None:
    """Quiet since just before the horizon: the sweep a week from now expires
    it. Just after: it does not. The tile cannot disagree with the sweep."""
    now = datetime(2026, 9, 23, 6, 0, tzinfo=UTC)
    last = expiry_horizon(now=now, rules=RULES, within=DASHBOARD_WINDOW) + nudge
    will_expire = expires(
        stage="VIEWED",
        employer_active_at=last,
        interview_at=None,
        employer_confirmed=False,
        now=now + DASHBOARD_WINDOW,
        rules=RULES,
    )
    assert will_expire is (nudge < timedelta(0))
