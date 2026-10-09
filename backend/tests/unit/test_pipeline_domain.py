"""The hiring pipeline, pure: the stage machine, interviews, hire confirmation, expiry."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import BaseModel, ValidationError

from app.modules.applications.domain import (
    DEFAULT_EXPIRY_RULES,
    EMPLOYER_TARGETS,
    PIPELINE,
    STAGES,
    TERMINAL_STAGES,
    ExpiryRules,
    ExpiryRulesError,
    allowed_transitions,
    candidate_confirm,
    candidate_dispute,
    employer_hire,
    employer_move,
    expires,
    expiry_rules_from_config,
    hire_state,
    refuse_meeting,
)
from app.modules.applications.schemas import (
    ApplicantCard,
    ApplicantProfile,
    ApplicationDetailResponse,
    ApplicationResponse,
    CandidateHistoryItem,
    EmployerApplicationDetail,
    EmployerApplicationListItem,
    EmployerApplicationSummary,
    EmployerTarget,
    MoveStageRequest,
    ScheduleInterviewRequest,
)

NOW = datetime(2026, 9, 15, 10, 0, tzinfo=UTC)


# --- the stage machine --------------------------------------------------------
def test_nothing_leaves_a_finished_stage() -> None:
    assert not [pair for pair in allowed_transitions() if pair[0] in TERMINAL_STAGES]


def test_a_hire_is_reached_only_from_a_decision() -> None:
    assert {a for a, b in allowed_transitions() if b == "HIRED"} == {"DECISION"}


def test_every_open_stage_can_be_rejected_withdrawn_and_expired() -> None:
    for stage in PIPELINE:
        for end in ("REJECTED", "WITHDRAWN", "EXPIRED"):
            assert (stage, end) in allowed_transitions(), (stage, end)


def test_the_employer_cannot_hire_withdraw_or_expire_on_its_own() -> None:
    assert not {"HIRED", "WITHDRAWN", "EXPIRED"} & set(EMPLOYER_TARGETS)
    for current in STAGES:
        for target in ("HIRED", "WITHDRAWN", "EXPIRED"):
            if target != current:
                assert employer_move(current, target) is None, (current, target)


def test_the_request_schema_offers_exactly_the_employers_targets() -> None:
    assert set(EmployerTarget.__args__) == set(EMPLOYER_TARGETS)  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("current", "target", "expected"),
    [
        ("SUBMITTED", "VIEWED", ("VIEWED",)),
        ("SUBMITTED", "SHORTLISTED", ("VIEWED", "SHORTLISTED")),
        ("SUBMITTED", "REJECTED", ("VIEWED", "REJECTED")),
        ("SUBMITTED", "INTERVIEW", None),
        ("VIEWED", "SHORTLISTED", ("SHORTLISTED",)),
        ("VIEWED", "INTERVIEW", None),
        ("VIEWED", "DECISION", None),
        ("SHORTLISTED", "INTERVIEW", ("INTERVIEW",)),
        ("SHORTLISTED", "VIEWED", None),
        ("INTERVIEW", "DECISION", ("DECISION",)),
        ("INTERVIEW", "SHORTLISTED", None),
        ("DECISION", "REJECTED", ("REJECTED",)),
        ("SHORTLISTED", "SHORTLISTED", ()),
        ("REJECTED", "REJECTED", ()),
        ("REJECTED", "VIEWED", None),
        ("WITHDRAWN", "SHORTLISTED", None),
        ("EXPIRED", "REJECTED", None),
        ("HIRED", "REJECTED", None),
    ],
)
def test_employer_moves(current: str, target: str, expected: tuple[str, ...] | None) -> None:
    assert employer_move(current, target) == expected


def test_every_move_the_employer_can_make_is_one_the_database_allows() -> None:
    """The service's rules and the database guard are built from the same
    module; this is what proves they agree, step by recorded step."""
    for current in STAGES:
        for target in STAGES:
            steps = employer_move(current, target)
            if not steps:
                continue
            at = current
            for step in steps:
                assert (at, step) in allowed_transitions(), (current, target, at, step)
                at = step


# --- interviews ---------------------------------------------------------------
@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://meet.google.com/abc-defg-hij", None),
        ("https://us02web.zoom.us/j/81234567890?pwd=abc", None),
        ("https://teams.microsoft.com/l/meetup-join/19%3ameeting", None),
        ("http://meet.google.com/abc", "meeting_url_invalid"),
        ("javascript:alert(1)", "meeting_url_invalid"),
        ("https://", "meeting_url_invalid"),
        ("https://localhost/room", "meeting_url_invalid"),
        ("https://user:pass@meet.example.com/room", "meeting_url_invalid"),
        ("https://meet.google.com@evil.example.com/", "meeting_url_invalid"),
        ("https://meet.google.com/abc def", "meeting_url_invalid"),
        ("https://meet.google.com/abc\n", "meeting_url_invalid"),
        ("https://[::1/", "meeting_url_invalid"),
        ("ftp://files.example.com/x", "meeting_url_invalid"),
        ("https://meet.example.com/" + "a" * 1024, "meeting_url_invalid"),
    ],
)
def test_meeting_links(url: str, expected: str | None) -> None:
    at = NOW + timedelta(days=2)
    assert refuse_meeting(meeting_url=url, interview_at=at, now=NOW) == expected


@pytest.mark.parametrize(
    ("at", "expected"),
    [
        (NOW + timedelta(minutes=1), None),
        (NOW + timedelta(days=365), None),
        (NOW, "interview_time_in_past"),
        (NOW - timedelta(days=1), "interview_time_in_past"),
        (NOW + timedelta(days=366), "interview_time_too_far"),
    ],
)
def test_interview_times(at: datetime, expected: str | None) -> None:
    assert refuse_meeting(meeting_url="https://meet.example.com/x", interview_at=at, now=NOW) == (
        expected
    )


def test_a_naive_time_is_a_bug_not_a_guess() -> None:
    with pytest.raises(ValueError):
        refuse_meeting(
            meeting_url="https://meet.example.com/x",
            interview_at=datetime(2027, 1, 1, 10, 0),
            now=NOW,
        )


# --- hire confirmation --------------------------------------------------------
def test_a_hire_is_proposed_at_decision_and_only_there() -> None:
    for stage in STAGES:
        outcome = employer_hire(stage=stage, employer_confirmed=False)
        if stage == "DECISION":
            assert outcome == "PROPOSE"
        elif stage == "HIRED":
            assert outcome == "ALREADY_PROPOSED"
        else:
            assert outcome == "REFUSE", stage
    assert employer_hire(stage="DECISION", employer_confirmed=True) == "ALREADY_PROPOSED"


def test_a_candidate_confirms_only_what_was_proposed() -> None:
    assert candidate_confirm(stage="DECISION", employer_confirmed=False) == "REFUSE"
    assert candidate_confirm(stage="DECISION", employer_confirmed=True) == "CONFIRM"
    assert candidate_confirm(stage="HIRED", employer_confirmed=True) == "ALREADY_CONFIRMED"
    for stage in ("SUBMITTED", "INTERVIEW", "REJECTED", "WITHDRAWN", "EXPIRED"):
        assert candidate_confirm(stage=stage, employer_confirmed=True) == "REFUSE", stage


def test_a_dispute_needs_a_proposal_and_happens_once() -> None:
    assert candidate_dispute(stage="DECISION", employer_confirmed=False, disputed=False) == (
        "REFUSE"
    )
    assert candidate_dispute(stage="DECISION", employer_confirmed=True, disputed=False) == (
        "DISPUTE"
    )
    assert candidate_dispute(stage="DECISION", employer_confirmed=True, disputed=True) == (
        "ALREADY_DISPUTED"
    )
    assert candidate_dispute(stage="HIRED", employer_confirmed=True, disputed=False) == "REFUSE"


def test_a_disputed_hire_can_still_be_confirmed() -> None:
    assert candidate_confirm(stage="DECISION", employer_confirmed=True) == "CONFIRM"


@pytest.mark.parametrize(
    ("stage", "employer", "candidate", "disputed", "expected"),
    [
        ("INTERVIEW", False, False, False, "NONE"),
        ("DECISION", False, False, False, "NONE"),
        ("DECISION", True, False, False, "PENDING"),
        ("DECISION", True, False, True, "DISPUTED"),
        ("HIRED", True, True, False, "CONFIRMED"),
        ("HIRED", True, True, True, "CONFIRMED"),
        ("REJECTED", True, False, True, "NONE"),
        ("WITHDRAWN", True, False, False, "NONE"),
    ],
)
def test_hire_state(
    stage: str, employer: bool, candidate: bool, disputed: bool, expected: str
) -> None:
    assert (
        hire_state(
            stage=stage,
            employer_confirmed=employer,
            candidate_confirmed=candidate,
            disputed=disputed,
        )
        == expected
    )


# --- expiry ---------------------------------------------------------------------
RULES = ExpiryRules(inactive_days=30, version="test")


def _expires(**overrides: object) -> bool:
    args: dict[str, object] = {
        "stage": "SHORTLISTED",
        "employer_active_at": NOW - timedelta(days=31),
        "interview_at": None,
        "employer_confirmed": False,
        "now": NOW,
        "rules": RULES,
    }
    args.update(overrides)
    return expires(**args)  # type: ignore[arg-type]


def test_an_employer_silent_past_the_period_releases_the_candidate() -> None:
    assert _expires()
    for stage in PIPELINE:
        assert _expires(stage=stage), stage


def test_the_period_is_not_up_until_it_has_passed() -> None:
    assert not _expires(employer_active_at=NOW - timedelta(days=30))
    assert _expires(employer_active_at=NOW - timedelta(days=30, seconds=1))


def test_a_finished_application_never_expires() -> None:
    for stage in TERMINAL_STAGES:
        assert not _expires(stage=stage), stage


def test_a_proposed_hire_never_expires() -> None:
    """The employer has acted; it is the candidate being waited on."""
    assert not _expires(stage="DECISION", employer_confirmed=True)


def test_a_booked_interview_holds_the_application_open() -> None:
    assert not _expires(stage="INTERVIEW", interview_at=NOW + timedelta(days=10))
    assert not _expires(stage="INTERVIEW", interview_at=NOW - timedelta(days=5))
    assert _expires(stage="INTERVIEW", interview_at=NOW - timedelta(days=31))


def test_expiry_rules_default_is_thirty_days() -> None:
    assert DEFAULT_EXPIRY_RULES.inactive_days == 30


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        {},
        {"inactive_days": "30"},
        {"inactive_days": 30.0},
        {"inactive_days": True},
        {"inactive_days": 6},
        {"inactive_days": 366},
        {"inactive_days": 30, "extra": 1},
        {"days": 30},
    ],
)
def test_bad_expiry_config_is_refused_not_defaulted(value: object) -> None:
    with pytest.raises(ExpiryRulesError):
        expiry_rules_from_config(value, version="config-v9")


def test_good_expiry_config() -> None:
    rules = expiry_rules_from_config({"inactive_days": 14}, version="config-v2")
    assert rules == ExpiryRules(inactive_days=14, version="config-v2")
    assert rules.period == timedelta(days=14)


# --- what each side is shown --------------------------------------------------
NEVER_SHOWN_TO_A_CANDIDATE = frozenset(
    {"note", "actor_id", "min_score", "score", "raw_value", "tenant_id", "candidate_id"}
)


@pytest.mark.parametrize(
    "model", [ApplicationResponse, ApplicationDetailResponse, CandidateHistoryItem]
)
def test_the_candidate_never_sees_an_employers_notes_or_recruiters(
    model: type[BaseModel],
) -> None:
    leaked = set(model.model_fields) & NEVER_SHOWN_TO_A_CANDIDATE
    assert not leaked, f"{model.__name__} exposes {sorted(leaked)}"


PII = {"name", "full_name", "phone", "email", "score", "raw_value", "display_value"}


@pytest.mark.parametrize(
    "model", [EmployerApplicationSummary, EmployerApplicationListItem, EmployerApplicationDetail]
)
def test_the_application_itself_names_nobody(model: type[BaseModel]) -> None:
    """Narrowed 2026-10-05 (was: the pipeline carries no identity at all). Who
    applied now rides in one `candidate` block, filled only by
    `discovery.applicant_cards` / `open_applicant`, which audit what they
    show -- so the application's own fields still name nobody."""
    assert not set(model.model_fields) & PII


def test_a_pipeline_list_names_an_applicant_without_revealing_them() -> None:
    """A list row carries a name and the band; contact and the score number
    are only on one opened application."""
    fields = set(ApplicantCard.model_fields)
    assert "full_name" in fields
    assert not fields & (PII - {"full_name"})
    assert EmployerApplicationListItem.model_fields["candidate"].annotation == ApplicantCard | None


def test_only_the_opened_application_carries_contact_and_score() -> None:
    assert EmployerApplicationDetail.model_fields["candidate"].annotation == ApplicantProfile | None
    assert {"phone", "email", "score", "resume"} <= set(ApplicantProfile.model_fields)
    assert not [f for f in ApplicantProfile.model_fields if "raw" in f]


@pytest.mark.parametrize("stage", ["HIRED", "WITHDRAWN", "EXPIRED", "SUBMITTED", "hired"])
def test_a_move_request_cannot_name_a_stage_the_employer_does_not_own(stage: str) -> None:
    with pytest.raises(ValidationError):
        MoveStageRequest.model_validate({"stage": stage})


def test_an_interview_time_must_carry_its_zone() -> None:
    with pytest.raises(ValidationError):
        ScheduleInterviewRequest.model_validate(
            {"interview_at": "2027-01-01T10:00:00", "meeting_url": "https://meet.example.com/x"}
        )
    ok = ScheduleInterviewRequest.model_validate(
        {"interview_at": "2027-01-01T10:00:00+05:30", "meeting_url": "https://meet.example.com/x"}
    )
    assert ok.interview_at.utcoffset() == timedelta(hours=5, minutes=30)
