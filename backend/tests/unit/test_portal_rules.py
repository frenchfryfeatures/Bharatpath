"""The pure rules behind the 2026-09-29 portal work: an employer's message to
an applicant, how it is delivered, a candidate's application analytics, and
the console's score timeline."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.modules.admin.service import score_timeline
from app.modules.applications.domain import (
    MAX_MESSAGE_CHARS,
    MESSAGEABLE_STAGES,
    PIPELINE,
    STAGES,
    TERMINAL_STAGES,
    refuse_message,
    stage_summary,
)
from app.modules.notifications.domain import format_moment, plan_for
from app.modules.notifications.templates import template_by_code
from app.modules.scoring.domain import band_for, display_value

NOW = datetime(2026, 9, 29, 6, 0, tzinfo=UTC)
LATER = NOW + timedelta(days=2)
LINK = "https://meet.example.com/abc"


# --- messages -------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("kind", "body", "scheduled_at", "link", "refusal"),
    [
        ("INTERVIEW", "Please join.", LATER, None, None),
        ("INTERVIEW", "Please join.", LATER, LINK, None),
        ("INTERVIEW", "Please join.", None, LINK, "message_time_required"),
        ("INTERVIEW", "Please join.", NOW - timedelta(minutes=1), None, "message_time_in_past"),
        ("INTERVIEW", "Please join.", NOW + timedelta(days=400), None, "message_time_too_far"),
        ("ASSESSMENT", "Take this test.", None, LINK, None),
        ("ASSESSMENT", "Take this test.", LATER, LINK, None),
        ("ASSESSMENT", "Take this test.", LATER, None, "message_link_required"),
        ("ASSESSMENT", "Take this test.", None, "http://test.example.com", "message_link_invalid"),
        ("ASSESSMENT", "Take this.", None, "javascript:alert(1)", "message_link_invalid"),
        (
            "ASSESSMENT",
            "Take this.",
            None,
            "https://me:pw@test.example.com",
            "message_link_invalid",
        ),
        ("GENERAL", "Thanks for applying.", None, None, None),
        ("GENERAL", "   ", None, None, "message_body_invalid"),
        ("GENERAL", "x" * (MAX_MESSAGE_CHARS + 1), None, None, "message_body_invalid"),
        ("OFFER", "You are hired.", None, None, "message_kind_invalid"),
    ],
)
def test_what_a_message_needs(
    kind: str, body: str, scheduled_at: datetime | None, link: str | None, refusal: str | None
) -> None:
    assert (
        refuse_message(kind=kind, body=body, scheduled_at=scheduled_at, link=link, now=NOW)
        == refusal
    )


def test_only_an_open_application_can_be_written_to() -> None:
    assert set(MESSAGEABLE_STAGES) == set(PIPELINE)
    assert not set(MESSAGEABLE_STAGES) & set(TERMINAL_STAGES)


@pytest.mark.parametrize(
    ("payload", "templates"),
    [
        (
            {"kind": "INTERVIEW", "has_time": True},
            ("EMAIL_INTERVIEW_INVITATION", "IN_APP_INTERVIEW_INVITATION"),
        ),
        (
            {"kind": "ASSESSMENT", "has_time": False},
            ("EMAIL_ASSESSMENT_INVITATION", "IN_APP_ASSESSMENT_INVITATION"),
        ),
        (
            {"kind": "ASSESSMENT", "has_time": True},
            ("EMAIL_ASSESSMENT_INVITATION_DEADLINE", "IN_APP_ASSESSMENT_INVITATION"),
        ),
        (
            {"kind": "GENERAL", "has_time": False},
            ("EMAIL_EMPLOYER_MESSAGE", "IN_APP_EMPLOYER_MESSAGE"),
        ),
    ],
)
def test_a_message_reaches_the_candidate_by_email_and_in_the_app(
    payload: dict[str, Any], templates: tuple[str, ...]
) -> None:
    [plan] = plan_for("applications.message_sent", payload)
    assert plan.audience == "CANDIDATE" and plan.templates == templates
    for code in templates:
        template = template_by_code(code)
        assert template is not None and template.channel in ("EMAIL", "IN_APP")
        # Every variable the template uses is one the plan resolves.
        assert set(template.variables) <= set(plan.variables), code


def test_an_interview_time_is_written_as_the_time_in_india() -> None:
    assert format_moment(datetime(2026, 10, 3, 5, 0, tzinfo=UTC)) == "03 Oct 2026, 10:30 AM IST"


# --- application analytics ---------------------------------------------------------------
def test_the_summary_counts_every_stage_and_what_each_application_reached() -> None:
    summary = stage_summary(
        current=["SUBMITTED", "INTERVIEW", "REJECTED", "HIRED"],
        reached={"SHORTLISTED": 3, "INTERVIEW": 3, "DECISION": 1},
    )
    assert summary.total == 4 and summary.open == 2
    assert set(summary.by_stage) == set(STAGES)
    assert summary.by_stage["REJECTED"] == 1 and summary.by_stage["VIEWED"] == 0
    # A hire always counts as reaching HIRED, event or not.
    assert summary.reached == {"SHORTLISTED": 3, "INTERVIEW": 3, "DECISION": 1, "HIRED": 1}


def test_a_candidate_with_no_applications_has_an_empty_summary() -> None:
    summary = stage_summary(current=[], reached={})
    assert summary.total == 0 and summary.open == 0
    assert set(summary.reached.values()) == {0}


# --- the console's score timeline ---------------------------------------------------------
def _score(raw: int, version: str, addon: int, minutes: int) -> dict[str, Any]:
    return {
        "raw_value": raw,
        "resume_version_id": version,
        "addon_value": addon,
        "computed_at": NOW + timedelta(minutes=minutes),
    }


def test_the_timeline_shows_what_the_candidate_saw_and_why_it_moved() -> None:
    points = score_timeline(
        [
            _score(760, "v1", 0, 0),
            _score(780, "v2", 0, 10),
            _score(800, "v2", 20, 20),
            _score(800, "v2", 20, 30),
        ]
    )
    assert [p.cause for p in points] == ["FIRST_SCORE", "RESUME_CHANGED", "ADD_ON", "RECOMPUTED"]
    assert [p.change for p in points] == [None, 20, 20, 0]
    for point, raw in zip(points, (760, 780, 800, 800), strict=True):
        assert point.display_value == display_value(raw)
        assert point.band == band_for(display_value(raw))


def test_the_timeline_never_carries_the_stored_number() -> None:
    [point] = score_timeline([_score(701, "v1", 0, 0)])
    assert not any("raw" in name for name in type(point).model_fields)


# --- a college's application funnel ---------------------------------------------------------
def test_the_funnel_says_nothing_below_the_cohort_floor() -> None:
    from app.modules.analytics.domain import (
        DEFAULT_FLOORS,
        CohortApplication,
        build_application_funnel,
    )

    funnel = build_application_funnel(
        DEFAULT_FLOORS.min_cohort_size - 1,
        [CohortApplication("HIRED", ("INTERVIEW",))],
        DEFAULT_FLOORS,
    )
    assert funnel.below_floor and funnel.total is None
    assert set(funnel.by_stage.values()) == {None} and set(funnel.reached.values()) == {None}


def test_the_funnel_withholds_small_cells_and_counts_what_was_reached() -> None:
    from app.modules.analytics.domain import (
        APPLICATION_STAGES,
        DEFAULT_FLOORS,
        CohortApplication,
        build_application_funnel,
    )

    rows = (
        [CohortApplication("SUBMITTED", ())] * 12
        + [CohortApplication("REJECTED", ("SHORTLISTED", "INTERVIEW"))] * 6
        + [CohortApplication("HIRED", ("SHORTLISTED", "INTERVIEW", "DECISION"))]
    )
    funnel = build_application_funnel(40, rows, DEFAULT_FLOORS)
    assert funnel.total == 19 and set(funnel.by_stage) == set(APPLICATION_STAGES)
    assert funnel.by_stage["SUBMITTED"] == 12
    assert funnel.by_stage["HIRED"] is None, "one hire is one person"
    assert funnel.by_stage["REJECTED"] is None, "withheld with it, or the total gives it back"
    assert funnel.reached["INTERVIEW"] == 7 and funnel.reached["SHORTLISTED"] == 7
    assert funnel.reached["HIRED"] is None and funnel.reached["DECISION"] is None
