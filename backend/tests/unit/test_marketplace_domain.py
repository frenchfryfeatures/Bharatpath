"""The candidate marketplace, pure: eligibility, withdrawal, and what a candidate sees."""

from __future__ import annotations

import uuid

import pytest
from pydantic import BaseModel, ValidationError

from app.modules.applications.domain import STAGES, TERMINAL_STAGES, withdrawal
from app.modules.applications.schemas import ApplicationResponse, ApplyRequest
from app.modules.jobs.domain import eligibility
from app.modules.jobs.schemas import BoardJobDetail, BoardJobSummary


# --- eligibility ------------------------------------------------------------
@pytest.mark.parametrize(
    ("min_score", "score", "expected"),
    [
        (None, None, "SCORE_PENDING"),
        (800, None, "SCORE_PENDING"),
        (None, 700, "ELIGIBLE"),
        (800, 800, "ELIGIBLE"),
        (800, 799, "BELOW_THRESHOLD"),
        (700, 700, "ELIGIBLE"),
        (990, 990, "ELIGIBLE"),
        (990, 989, "BELOW_THRESHOLD"),
    ],
)
def test_eligibility(min_score: int | None, score: int | None, expected: str) -> None:
    assert eligibility(min_score=min_score, score=score) == expected


def test_a_threshold_is_met_exactly_when_the_score_reaches_it() -> None:
    """Every threshold and every score on the scale, not a few examples."""
    for threshold in range(700, 991):
        for score in range(700, 991):
            below = eligibility(min_score=threshold, score=score) == "BELOW_THRESHOLD"
            assert below == (score < threshold), (threshold, score)


# --- withdrawal -------------------------------------------------------------
def test_a_candidate_can_withdraw_at_any_point_before_the_outcome() -> None:
    for stage in STAGES:
        outcome = withdrawal(stage)
        if stage == "WITHDRAWN":
            assert outcome == "ALREADY_WITHDRAWN"
        elif stage in TERMINAL_STAGES:
            assert outcome == "REFUSE", stage
        else:
            assert outcome == "WITHDRAW", stage


def test_the_database_names_the_same_finished_stages_as_the_rules() -> None:
    """The duplicate-application index and the withdrawal rule must agree on
    what "finished" means, or a candidate could be refused a re-apply the
    rules allow -- or allowed a second active application the index misses."""
    from app.modules.applications.models import Application

    index = next(i for i in Application.__table__.indexes if i.name == "uq_application_active")
    where = str(index.dialect_options["postgresql"]["where"])
    assert all(f"'{stage}'" in where for stage in TERMINAL_STAGES)
    assert not [s for s in STAGES if s not in TERMINAL_STAGES and f"'{s}'" in where]


def test_an_application_is_keyed_to_its_jobs_tenant() -> None:
    from app.modules.applications.models import Application

    keys = {fk.name: fk for fk in Application.__table__.foreign_key_constraints}
    job_key = keys["fk_applications_job_tenant"]
    assert [c.name for c in job_key.columns] == ["job_id", "tenant_id"]
    assert [e.target_fullname for e in job_key.elements] == ["jobs.id", "jobs.tenant_id"]


# --- what a candidate is shown ------------------------------------------------
#: A threshold beside the candidate's own score is the gap, and the gap is the
#: explanation the client ruled out (R11). A tenant id is ours.
NEVER_SHOWN_TO_A_CANDIDATE = frozenset(
    {"min_score", "threshold", "score", "raw_value", "tenant_id", "kyb_status"}
)


@pytest.mark.parametrize("model", [BoardJobSummary, BoardJobDetail, ApplicationResponse])
def test_nothing_a_candidate_reads_carries_a_threshold_or_a_score(
    model: type[BaseModel],
) -> None:
    leaked = set(model.model_fields) & NEVER_SHOWN_TO_A_CANDIDATE
    assert not leaked, f"{model.__name__} exposes {sorted(leaked)}"


def test_an_apply_request_is_a_job_id_and_nothing_else() -> None:
    assert set(ApplyRequest.model_fields) == {"job_id"}
    for smuggled in ({"tenant_id": str(uuid.uuid4())}, {"stage": "HIRED"}, {"score": 990}):
        with pytest.raises(ValidationError):
            ApplyRequest.model_validate({"job_id": str(uuid.uuid4()), **smuggled})
