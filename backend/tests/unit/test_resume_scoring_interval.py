"""How often a resume may go to scoring (2026-10-26), pure.

Uploads are unlimited; a confirmation is what sends a resume to scoring, and
a candidate gets one per `resume.scoring_interval`. The integration side is
in `tests/integration/test_resume_scoring_interval.py`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.modules.resume.domain import (
    DEFAULT_SCORING_INTERVAL,
    MAX_SCORING_INTERVAL_DAYS,
    ScoringInterval,
    ScoringIntervalError,
    next_scoring_at,
    scoring_interval_from_config,
)

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)
FIFTEEN = ScoringInterval(days=15, version="t")


def test_the_default_is_fifteen_days() -> None:
    assert DEFAULT_SCORING_INTERVAL.days == 15


def test_the_first_confirmation_is_always_allowed() -> None:
    assert next_scoring_at(last_confirmed_at=None, interval=FIFTEEN, now=NOW) is None


def test_inside_the_interval_the_answer_is_the_date_it_ends() -> None:
    last = NOW - timedelta(days=3)
    assert next_scoring_at(last_confirmed_at=last, interval=FIFTEEN, now=NOW) == last + timedelta(
        days=15
    )


def test_the_interval_ends_exactly_on_its_last_moment() -> None:
    last = NOW - timedelta(days=15)
    assert next_scoring_at(last_confirmed_at=last, interval=FIFTEEN, now=NOW) is None
    just_inside = NOW - timedelta(days=15) + timedelta(seconds=1)
    assert next_scoring_at(last_confirmed_at=just_inside, interval=FIFTEEN, now=NOW) is not None


def test_zero_days_switches_the_limit_off() -> None:
    off = ScoringInterval(days=0, version="t")
    assert next_scoring_at(last_confirmed_at=NOW, interval=off, now=NOW) is None


def test_the_reader_accepts_its_own_shape() -> None:
    assert scoring_interval_from_config({"days": 30}, version="config-v2") == ScoringInterval(
        days=30, version="config-v2"
    )
    assert scoring_interval_from_config({"days": 0}, version="v").days == 0
    assert (
        scoring_interval_from_config({"days": MAX_SCORING_INTERVAL_DAYS}, version="v").days
        == MAX_SCORING_INTERVAL_DAYS
    )


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        {},
        {"days": "15"},
        {"days": 15.0},
        {"days": True},
        {"days": -1},
        {"days": MAX_SCORING_INTERVAL_DAYS + 1},
        {"days": 15, "extra": 1},
        {"interval_days": 15},
    ],
)
def test_the_reader_refuses_anything_doubtful(value: object) -> None:
    """A bad row is a 500, never the default and never a number nobody meant."""
    with pytest.raises(ScoringIntervalError):
        scoring_interval_from_config(value, version="v")
