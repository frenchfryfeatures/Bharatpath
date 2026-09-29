"""Questions written for the candidate (2026-09-29): the rules that decide
whether what the model wrote may be asked, and what is asked when it may not.

The client's requirement, in their words: a second paid interview must not
repeat the first, "because if the questions repeat then the payment of the
user to the platform will feel like a waste of money". The model is told every
earlier question; `parse_drafted_question` refuses an exact repeat anyway, and
a refused draft is asked for again, never replaced by a fixed question.
"""

from __future__ import annotations

import pytest

from app.modules.interview.bank import QUESTION_SETS, QUESTIONS_PER_SESSION, SET_TWO
from app.modules.interview.domain import (
    KIND_FOLLOW_UP,
    KIND_NEW_TOPIC,
    KIND_OPENING,
    MAX_PROMPT_CHARS,
    QuestionInvalid,
    allowed_kinds,
    bank_questions_for,
    generated_question_code,
    normalise_prompt,
    parse_drafted_question,
    redact_contacts,
)
from app.modules.interview.questions import (
    AskedInThisSession,
    QuestionContext,
    StubQuestionProvider,
)

GOOD = {
    "kind": KIND_OPENING,
    "prompt": "Tell me about the warehouse you ran in Pune.",
    "looking_for": "What you were responsible for, and one thing you changed.",
}


def test_the_session_length_is_one_constant() -> None:
    """Six for now; the client expects to change it, so nothing else may
    hard-code it."""
    assert QUESTIONS_PER_SESSION == 6
    assert all(len(s.questions) == QUESTIONS_PER_SESSION for s in QUESTION_SETS)


# --- what may be asked ------------------------------------------------------------
def test_the_first_question_opens_and_every_later_one_follows_up_or_moves_on() -> None:
    assert allowed_kinds(0) == (KIND_OPENING,)
    for index in range(1, QUESTIONS_PER_SESSION):
        assert set(allowed_kinds(index)) == {KIND_FOLLOW_UP, KIND_NEW_TOPIC}


def test_a_well_formed_question_is_accepted_as_written() -> None:
    drafted = parse_drafted_question(GOOD, index=0, already_asked=())
    assert (drafted.kind, drafted.prompt) == (KIND_OPENING, GOOD["prompt"])


@pytest.mark.parametrize(
    "raw",
    [
        None,
        "a question",
        {**GOOD, "kind": KIND_FOLLOW_UP},
        {**GOOD, "prompt": 42},
        {**GOOD, "prompt": "Why?"},
        {**GOOD, "prompt": "x" * (MAX_PROMPT_CHARS + 1)},
        {**GOOD, "looking_for": ""},
        {"prompt": GOOD["prompt"], "looking_for": GOOD["looking_for"]},
    ],
)
def test_anything_else_is_refused_never_repaired(raw: object) -> None:
    with pytest.raises(QuestionInvalid):
        parse_drafted_question(raw, index=0, already_asked=())


def test_a_question_asked_in_an_earlier_session_is_refused_however_it_is_punctuated() -> None:
    earlier = ["tell me about the Warehouse you ran in Pune!!"]
    with pytest.raises(QuestionInvalid, match="asked this before"):
        parse_drafted_question(GOOD, index=0, already_asked=earlier)


def test_a_question_on_a_similar_theme_is_allowed() -> None:
    """The client allowed "similar lines"; only the same question is refused."""
    earlier = ["Tell me about the warehouse you ran in Nashik."]
    assert parse_drafted_question(GOOD, index=0, already_asked=earlier)


def test_normalising_ignores_case_punctuation_and_spacing_only() -> None:
    assert normalise_prompt("  Why THIS   work? ") == normalise_prompt("why this work")
    assert normalise_prompt("Why this work?") != normalise_prompt("Why that work?")


# --- what the model is shown ----------------------------------------------------------
def test_contact_details_are_removed_from_the_cv_before_it_leaves() -> None:
    cv = (
        "Asha Verma\nasha.verma@example.com | +91 98765 43210 | linkedin.com/in/asha\n"
        "https://asha.dev\nForklift operator, 2019-2024, 400 pallets a shift."
    )
    cleaned = redact_contacts(cv, known=("Asha Verma", "+919876543210", None))
    for leaked in ("asha.verma@example.com", "98765 43210", "https://asha.dev", "Asha Verma"):
        assert leaked not in cleaned
    assert "400 pallets a shift" in cleaned and "2019-2024" in cleaned


# --- the model writes every question ----------------------------------------------------
def test_the_default_is_the_model_and_there_is_no_fixed_question_option() -> None:
    """Client, 2026-09-29: "only ai and not fixed questions"."""
    from typing import get_args

    from app.settings import Settings

    field = Settings.model_fields["interview_question_provider"]
    assert field.default == "openai"
    assert set(get_args(field.annotation)) == {"openai", "stub"}
    assert Settings.model_fields["interview_question_model_id"].default.startswith("gpt-")


@pytest.mark.parametrize("environment", ["staging", "prod"])
def test_the_stub_is_refused_where_candidates_are(environment: str) -> None:
    from pydantic import ValidationError

    from app.settings import Settings

    with pytest.raises(ValidationError, match="INTERVIEW_QUESTION_PROVIDER=stub"):
        Settings(
            environment=environment,  # type: ignore[arg-type]
            interview_question_provider="stub",
            interview_evaluation_provider="none",
            payments_provider="none",
            database_url="postgresql+asyncpg://u:p@localhost/db",  # type: ignore[arg-type]
            redis_url="redis://localhost:6379/0",  # type: ignore[arg-type]
            auth_allow_local_tokens=False,
            cognito_candidate_pool_id="ap-south-1_x",
        )


def test_a_session_from_before_stored_questions_reads_its_bank_set() -> None:
    assert bank_questions_for(question_set_code=SET_TWO.code, session_number=9) == SET_TWO.questions
    assert bank_questions_for(question_set_code="UNKNOWN", session_number=2) == SET_TWO.questions


def test_a_written_session_with_nothing_stored_has_asked_nothing() -> None:
    """Not the bank set: that would make the writer think every question is
    already written."""
    assert bank_questions_for(question_set_code="ADAPTIVE", session_number=2) == ()


def test_written_codes_are_unique_within_a_session() -> None:
    codes = {generated_question_code(session_number=3, index=i) for i in range(6)}
    assert len(codes) == 6 and "S3Q1" in codes


# --- providers -----------------------------------------------------------------------
def _context(**overrides: object) -> QuestionContext:
    values: dict[str, object] = {
        "session_number": 1,
        "index": 0,
        "total": QUESTIONS_PER_SESSION,
        "language": "hi",
        "resume_text": "Forklift operator.",
        "onboarding": (("Which shifts could you work?", "Night shift"),),
        "earlier_questions": (),
        "this_session": (),
    }
    values.update(overrides)
    return QuestionContext(**values)  # type: ignore[arg-type]


async def test_the_stub_opens_follows_up_what_it_heard_and_otherwise_moves_on() -> None:
    stub = StubQuestionProvider()
    opening = await stub.draft(context=_context())
    assert opening["kind"] == KIND_OPENING
    heard = _context(index=1, this_session=(AskedInThisSession("Q1", "I ran the night shift."),))
    assert (await stub.draft(context=heard))["kind"] == KIND_FOLLOW_UP
    unheard = _context(index=1, this_session=(AskedInThisSession("Q1", None),))
    assert (await stub.draft(context=unheard))["kind"] == KIND_NEW_TOPIC
    assert parse_drafted_question(opening, index=0, already_asked=())
