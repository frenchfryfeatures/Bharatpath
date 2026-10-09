"""Interview evaluation -- the evaluator's output, the report, the stubs.

The report is feedback, never a number: `parse_evaluation` refuses anything
that does not fit the rubric exactly, and `assemble_report` turns ratings into
words before anything leaves the service.
"""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest

from app.modules.interview.bank import DIMENSION_CODES, DIMENSIONS, SET_ONE
from app.modules.interview.domain import (
    LEVEL_DEVELOPING,
    LEVEL_FOCUS_AREA,
    LEVEL_STRONG,
    EvaluationInvalid,
    QuestionEvaluation,
    assemble_report,
    is_spoken,
    level_for,
    parse_evaluation,
)
from app.modules.interview.evaluation import (
    STUB_SILENCE_MAX_BYTES,
    AnswerForEvaluation,
    EvaluationUnavailableError,
    StubEvaluationProvider,
    StubTranscriptionProvider,
    UnconfiguredEvaluationProvider,
    UnconfiguredTranscriptionProvider,
)

CODES = tuple(q.code for q in SET_ONE.questions[:2])


def _ratings(value: int = 2) -> dict[str, int]:
    return dict.fromkeys(DIMENSION_CODES, value)


def _response(**overrides: Any) -> dict[str, Any]:
    questions = [
        {"question_code": code, "ratings": _ratings(), "comment": "Fine."} for code in CODES
    ]
    return {"questions": questions, **overrides}


# ---------------------------------------------------------------------------
# The evaluator's output is read exactly, or refused
# ---------------------------------------------------------------------------
def test_a_well_formed_response_is_read_in_question_order() -> None:
    raw = _response()
    raw["questions"].reverse()
    parsed = parse_evaluation(raw, question_codes=CODES, dimension_codes=DIMENSION_CODES)
    assert tuple(e.question_code for e in parsed) == CODES
    assert parsed[0].ratings == _ratings() and parsed[0].comment == "Fine."


def _broken(mutate: Any) -> dict[str, Any]:
    raw = _response()
    mutate(raw)
    return raw


@pytest.mark.parametrize(
    "raw",
    [
        None,
        [],
        {"questions": "no"},
        _broken(lambda r: r["questions"].pop()),
        _broken(lambda r: r["questions"].append(dict(r["questions"][0]))),
        _broken(lambda r: r["questions"][0].update(question_code="Q9_UNKNOWN")),
        _broken(lambda r: r["questions"][0]["ratings"].pop("CLARITY")),
        _broken(lambda r: r["questions"][0]["ratings"].update(ACCENT=2)),
        _broken(lambda r: r["questions"][0]["ratings"].update(CLARITY=5)),
        _broken(lambda r: r["questions"][0]["ratings"].update(CLARITY=-1)),
        _broken(lambda r: r["questions"][0]["ratings"].update(CLARITY=2.5)),
        _broken(lambda r: r["questions"][0]["ratings"].update(CLARITY=True)),
        _broken(lambda r: r["questions"][0].update(comment="x" * 601)),
        _broken(lambda r: r["questions"][0].update(comment=7)),
    ],
    ids=lambda raw: "case",
)
def test_anything_that_does_not_fit_the_rubric_is_refused_whole(raw: Any) -> None:
    """Never repaired. An `ACCENT` dimension is refused on sight: the rubric
    does not assess it, and an evaluator that tries is not one to trust."""
    with pytest.raises(EvaluationInvalid):
        parse_evaluation(raw, question_codes=CODES, dimension_codes=DIMENSION_CODES)


def test_accent_fluency_and_pace_are_not_rubric_dimensions() -> None:
    assert not DIMENSION_CODES & {"ACCENT", "FLUENCY", "PRONUNCIATION", "PACE", "VOCABULARY"}


# ---------------------------------------------------------------------------
# Levels are words, decided in integers
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("ratings", "level"),
    [
        ([3, 3, 3], LEVEL_STRONG),
        ([4, 2, 3], LEVEL_STRONG),
        ([3, 3, 2], LEVEL_DEVELOPING),
        ([2, 2], LEVEL_DEVELOPING),
        ([2, 1], LEVEL_FOCUS_AREA),
        ([0], LEVEL_FOCUS_AREA),
        ([], LEVEL_FOCUS_AREA),
    ],
)
def test_a_level_is_the_mean_against_whole_number_boundaries(
    ratings: list[int], level: str
) -> None:
    assert level_for(ratings) == level


def test_silence_and_a_cough_are_not_an_answer() -> None:
    assert not is_spoken(None) and not is_spoken("") and not is_spoken("  hm ")
    assert is_spoken("I led the migration.")


def test_the_report_carries_no_number_about_the_candidate() -> None:
    evaluations = (
        QuestionEvaluation(CODES[0], _ratings(4), "Clear and specific."),
        QuestionEvaluation(CODES[1], _ratings(1), ""),
    )
    report = assemble_report(
        questions=SET_ONE.questions,
        transcripts={0: "I built the billing system.", 1: "We did many things.", 2: ""},
        evaluations=evaluations,
    )

    assert {d.level for d in report.dimensions} == {LEVEL_DEVELOPING}  # mean 2.5
    assert report.strengths == () and report.focus_areas == ()
    assert [q.spoken for q in report.questions] == [True, True, False, False, False, False]
    assert report.questions[0].comment == "Clear and specific."
    assert report.questions[1].comment is None
    assert report.questions[2].transcript == "" and report.questions[2].comment is None
    assert len(report.dimensions) == len(DIMENSIONS)

    def numbers(value: Any) -> list[str]:
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            found = []
            for f in dataclasses.fields(value):
                inner = getattr(value, f.name)
                if (
                    isinstance(inner, int | float)
                    and not isinstance(inner, bool)
                    and f.name != "index"
                ):
                    found.append(f.name)
                found += numbers(inner)
            return found
        if isinstance(value, tuple | list):
            return [n for item in value for n in numbers(item)]
        return []

    assert numbers(report) == []


def test_strengths_and_focus_areas_follow_the_levels() -> None:
    strong = {d.code: 4 for d in DIMENSIONS} | {"CLARITY": 0}
    report = assemble_report(
        questions=SET_ONE.questions,
        transcripts={0: "An answer."},
        evaluations=(QuestionEvaluation(SET_ONE.questions[0].code, strong, ""),),
    )
    assert report.focus_areas == ("CLARITY",)
    assert set(report.strengths) == DIMENSION_CODES - {"CLARITY"}


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------
async def test_with_nothing_configured_nothing_is_heard_or_rated() -> None:
    with pytest.raises(EvaluationUnavailableError):
        await UnconfiguredTranscriptionProvider().transcribe(audio=b"x" * 9000, mime="audio/ogg")
    with pytest.raises(EvaluationUnavailableError):
        await UnconfiguredEvaluationProvider().evaluate(answers=[])


async def test_the_stub_hears_silence_below_its_threshold_and_is_deterministic() -> None:
    stub = StubTranscriptionProvider()
    assert (await stub.transcribe(audio=b"\0" * STUB_SILENCE_MAX_BYTES, mime="")).text == ""
    first = await stub.transcribe(audio=b"a" * 5000, mime="audio/ogg")
    again = await stub.transcribe(audio=b"a" * 5000, mime="audio/ogg")
    assert first == again and is_spoken(first.text)


async def test_the_stub_evaluator_answers_in_the_shape_the_parser_reads() -> None:
    answers = [
        AnswerForEvaluation(q.code, q.prompt, q.looking_for, f"transcript {i}")
        for i, q in enumerate(SET_ONE.questions)
    ]
    raw = await StubEvaluationProvider().evaluate(answers=answers)
    codes = tuple(q.code for q in SET_ONE.questions)
    parsed = parse_evaluation(raw, question_codes=codes, dimension_codes=DIMENSION_CODES)
    assert len(parsed) == len(codes)
    assert raw == await StubEvaluationProvider().evaluate(answers=answers)


@pytest.mark.parametrize("environment", ["staging", "prod"])
def test_the_stub_evaluator_is_refused_outside_development(environment: str) -> None:
    from pydantic import ValidationError

    from app.settings import Settings

    with pytest.raises(ValidationError, match="INTERVIEW_EVALUATION_PROVIDER"):
        Settings(
            environment=environment,  # type: ignore[arg-type]
            interview_evaluation_provider="stub",
            payments_provider="none",
            database_url="postgresql+asyncpg://u:p@localhost/db",  # type: ignore[arg-type]
            redis_url="redis://localhost:6379/0",  # type: ignore[arg-type]
            auth_allow_local_tokens=False,
            cognito_candidate_pool_id="ap-south-1_x",
        )
