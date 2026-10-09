"""Data-subject requests, pure: dates, the request machine, and the archive."""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime, timedelta, timezone

from app.modules.privacy.domain import (
    DSR_STATES,
    EXPORT_SECTIONS,
    STATE_TRANSITIONS,
    due_at,
    erasable_at,
    may_transition,
)
from app.modules.privacy.service import build_archive, strip_forbidden

NOW = datetime(2026, 9, 17, 22, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))


def test_dates_are_computed_from_the_passed_clock_in_utc() -> None:
    assert due_at(requested_at=NOW) == NOW.astimezone(UTC) + timedelta(days=30)
    assert due_at(requested_at=NOW).tzinfo == UTC
    assert erasable_at(requested_at=NOW) - NOW == timedelta(hours=24)


def test_terminal_states_go_nowhere_and_every_state_is_named() -> None:
    assert set(STATE_TRANSITIONS) == set(DSR_STATES)
    for terminal in ("COMPLETED", "REJECTED"):
        assert STATE_TRANSITIONS[terminal] == ()
        assert not any(may_transition(current=terminal, target=s) for s in DSR_STATES)
    assert may_transition(current="RECEIVED", target="PROCESSING")
    assert not may_transition(current="RECEIVED", target="COMPLETED"), "nothing finishes unclaimed"
    assert may_transition(current="PROCESSING", target="RECEIVED"), "a failed run is retried"


def test_forbidden_fields_are_stripped_at_any_depth() -> None:
    dirty = {
        "score": 812,
        "breakdown": {"x": 1},
        "nested": [{"cognito_sub": "abc", "keep": True, "deeper": {"raw_model_response": {}}}],
    }
    assert strip_forbidden(dirty) == {"score": 812, "nested": [{"keep": True, "deeper": {}}]}


def test_the_archive_holds_every_section_and_no_explanation() -> None:
    raw = build_archive(
        sections={"scores": [{"score": 812, "breakdown": {"experience": 90}}]},
        generated_at=NOW,
    )
    archive = zipfile.ZipFile(io.BytesIO(raw))
    assert set(archive.namelist()) == {"README.txt", *(f"{s}.json" for s in EXPORT_SECTIONS)}
    assert json.loads(archive.read("scores.json")) == [{"score": 812}]
    assert json.loads(archive.read("streaks.json")) == []
    assert "never explains a score" in archive.read("README.txt").decode()
