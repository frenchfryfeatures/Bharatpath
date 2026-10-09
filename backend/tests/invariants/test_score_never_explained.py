"""The score is never explained to the candidate.

Client, 2026-08-27, re-confirmed 2026-09-11: no breakdown screen,
no category detail, no improvement suggestions. The breakdown is still
computed and stored — admin drill-down and dispute handling need it — but no
candidate-facing schema may expose it.

**This contradicts PRD section 4.2**, which promises a category-by-category
breakdown and top improvement suggestions, and PRD 4.5, which promises to tell
a candidate what would need to improve to meet a job's threshold. Both are
rescinded (`questions.txt` Q12). Eligibility messaging stays generic.

The rule is enforced by reading the schemas rather than by remembering,
because the failure mode is somebody adding a helpful field to a response
model six months from now and every other test still passing.
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest
from pydantic import BaseModel

from app.modules.scoring import schemas as scoring_schemas
from app.modules.scoring.domain import BASE_SCORE, MAX_SCORE

pytestmark = pytest.mark.invariant

#: Field names that would explain a score, or let a client reconstruct the
#: explanation. Each is a distinct way the same promise gets broken.
FORBIDDEN_FIELDS: frozenset[str] = frozenset(
    {
        # The breakdown itself, under any of the names it would plausibly take.
        "breakdown",
        "categories",
        "category_scores",
        "dimensions",
        "components",
        "detail",
        "details",
        # Improvement advice. PRD 4.2 and 4.5, both rescinded.
        "suggestions",
        "improvements",
        "recommendations",
        "next_steps",
        "how_to_improve",
        "gap",
        "gaps",
        # The split. `base_value` and `addon_value` are a breakdown by
        # subtraction: a candidate who sees both learns exactly what their
        # course purchase was worth.
        "base_value",
        "addon_value",
        "contributing_events",
        "contribution_version",
        # The reproducibility chain. It exists for disputes, not for display.
        "model_id",
        "prompt_version",
        "prompt_hash",
        "raw_model_response",
        "extracted_features",
        "taxonomy_version",
        "rubric_version",
        # Internal identifiers a client could correlate into the improvement
        # history the client declined to show.
        "resume_version_id",
    }
)


def _response_models() -> list[type[BaseModel]]:
    """Every schema defined in the scoring module.

    All of them, not a candidate-facing subset — because there is no reliable
    way to tell from a class name who will end up reading it. The admin
    drill-down view therefore does not belong in this module; it belongs in
    `admin`, behind the role guard that makes it lawful.
    """
    return [
        obj
        for _, obj in inspect.getmembers(scoring_schemas, inspect.isclass)
        if issubclass(obj, BaseModel)
        and obj is not BaseModel
        and obj.__module__ == scoring_schemas.__name__
        and not obj.__name__.startswith("_")
    ]


def test_the_module_actually_defines_schemas() -> None:
    """A scan that finds nothing passes vacuously. This is the guard on the
    guard: if the schemas move, this test fails rather than falling silent."""
    assert _response_models(), "no scoring schemas found — has the module moved?"


@pytest.mark.parametrize("model", _response_models(), ids=lambda m: m.__name__)
def test_no_scoring_schema_explains_the_score(model: type[BaseModel]) -> None:
    """The invariant. One assertion, and the message names the field."""
    offending = set(model.model_fields) & FORBIDDEN_FIELDS
    assert not offending, (
        f"{model.__name__} exposes {sorted(offending)}. The score is never "
        "explained to the candidate (client, 2026-08-27). The breakdown is "
        "stored for admin drill-down and disputes; it does not go in a "
        "response model here."
    )


@pytest.mark.parametrize("model", _response_models(), ids=lambda m: m.__name__)
def test_no_scoring_schema_accepts_unknown_fields(model: type[BaseModel]) -> None:
    """`extra="forbid"` is what stops a breakdown arriving as loose keys on a
    dict field and slipping past the name check above."""
    assert model.model_config.get("extra") == "forbid", (
        f"{model.__name__} accepts extra fields, so the name check above can "
        "be bypassed by passing a breakdown under any other key."
    )


def test_no_scoring_schema_carries_a_free_form_payload() -> None:
    """A `dict[str, Any]` field is a breakdown waiting to happen — it would
    satisfy every check above while carrying exactly what they forbid."""
    for model in _response_models():
        for name, field in model.model_fields.items():
            annotation = str(field.annotation)
            assert "dict" not in annotation.lower(), (
                f"{model.__name__}.{name} is a free-form mapping. Anything can "
                "travel in one, including the breakdown."
            )


def test_the_candidate_response_carries_the_number_and_the_band_only() -> None:
    """Stated positively, so the intent survives someone deleting a name from
    the forbidden list above."""
    allowed = {"status", "value", "band", "computed_at"}
    assert set(scoring_schemas.CandidateScoreResponse.model_fields) == allowed


def test_the_candidate_response_bounds_the_score_to_the_scale() -> None:
    """Invariant 2 at the serialization boundary. A number outside 700-990
    would have escaped a CHECK constraint, and the schema is the last place
    that can refuse to show it."""
    field = scoring_schemas.CandidateScoreResponse.model_fields["value"]
    bounds = {type(m).__name__: getattr(m, "ge", getattr(m, "le", None)) for m in field.metadata}
    assert BASE_SCORE in bounds.values()
    assert MAX_SCORE in bounds.values()


def test_a_pending_score_carries_no_number_at_all() -> None:
    """Every failure resolves to PENDING, and PENDING must not be dressed up
    as a zero or a 700 — a plausible wrong number is the thing
    `scoring-approach.md` section 11 exists to prevent."""
    pending = scoring_schemas.CandidateScoreResponse(status="PENDING")
    assert pending.value is None
    assert pending.band is None


def test_the_replay_response_does_not_explain_either() -> None:
    """A replay answers a dispute about the number. The number is what is in
    dispute; the breakdown reaches a human through admin, behind a role."""
    fields: dict[str, Any] = dict(scoring_schemas.ScoreReplayResponse.model_fields)
    assert "breakdown" not in fields
