"""Who writes the interview questions (2026-09-29), behind one interface.

The client asked for questions drawn from the candidate's CV and onboarding
answers: a first question that opens, then each next one either following up
what they just said or moving to something new -- and never a repeat of a
question from an earlier session, because a second paid rehearsal that asks
the same things is money wasted.

**Every question is written by the model; there are no fixed questions**
(client, 2026-09-29: "only ai and not fixed questions"). A question the model
cannot write is a 503 the app retries, never a stock question in its place.
Two implementations:

* **OpenAI** (`openai_questioner.py`) -- the default.
* **Stub** -- tests and local work without a key; `Settings` refuses it in
  staging and production. Deterministic from its inputs, so a test can
  predict it.

What a real implementation must satisfy:

  * It is given the CV **with contact details removed** (`domain.redact_contacts`),
    the onboarding answers except the accessibility one, the language to ask
    in, every question the candidate has been asked before, and this session's
    questions with what the candidate said. Nothing else: no score, no band,
    no name.
  * It returns exactly `{"kind", "prompt", "looking_for"}`, which
    `domain.parse_drafted_question` accepts or refuses. A refused draft is
    never repaired: the writer is asked again, told what was refused and why
    (`QuestionContext.refused`).
  * **It never asks about age, marital status, family plans, caste, religion,
    health or disability** -- the same line `bank.py` holds for its own sets.
  * `model_id` pinned exactly and `prompt_version` bumped on any change to the
    instructions; both are stored on every question it writes.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

from fastapi import status

from app.core.errors import AppError
from app.modules.interview.domain import KIND_FOLLOW_UP, KIND_NEW_TOPIC, KIND_OPENING
from app.settings import get_settings


class QuestionUnavailableError(AppError):
    """The model could not be reached, or wrote nothing usable in
    `MAX_DRAFT_ATTEMPTS` tries. Nothing was written; retry the request."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "interview_question_unavailable"
    title = "A question could not be written"


@dataclass(frozen=True, slots=True)
class AskedInThisSession:
    prompt: str
    #: What the candidate said, when it could be transcribed in time.
    transcript: str | None


@dataclass(frozen=True, slots=True)
class QuestionContext:
    """Everything the question writer is shown. Nothing that names or scores
    the person."""

    session_number: int
    index: int
    total: int
    #: The language to ask in, as a BCP 47 code from the account's locale.
    language: str
    #: Contact details already removed. None when there is no confirmed CV.
    resume_text: str | None
    #: `(question, answer)` from the onboarding questionnaire, in words.
    onboarding: tuple[tuple[str, str], ...]
    #: Every question from earlier sessions. Not to be asked again.
    earlier_questions: tuple[str, ...]
    #: This session so far, in order.
    this_session: tuple[AskedInThisSession, ...]
    #: Drafts for this position already refused, with the reason. Empty on
    #: the first attempt.
    refused: tuple[str, ...] = ()


class QuestionProvider(Protocol):
    name: str
    model_id: str
    prompt_version: str

    async def draft(self, *, context: QuestionContext) -> dict[str, Any]: ...


class StubQuestionProvider:
    """A question derived from a hash of what it was shown, so it differs
    between sessions and positions and never between runs. Follows up when the
    previous answer was transcribed."""

    name = "stub"
    model_id = "stub-questioner"
    prompt_version = "stub-1"

    async def draft(self, *, context: QuestionContext) -> dict[str, Any]:
        seed = "|".join(
            (
                str(context.session_number),
                str(context.index),
                context.resume_text or "",
                *context.earlier_questions,
                *(q.prompt for q in context.this_session),
            )
        )
        digest = hashlib.sha256(seed.encode()).hexdigest()[:10]
        if context.index == 0:
            kind = KIND_OPENING
        elif context.this_session and context.this_session[-1].transcript:
            kind = KIND_FOLLOW_UP
        else:
            kind = KIND_NEW_TOPIC
        return {
            "kind": kind,
            "prompt": f"Stub question {context.index + 1} ({digest}): describe some of your work.",
            "looking_for": "Stub guidance: one specific example, your own part, and what happened.",
        }


@lru_cache(maxsize=1)
def get_question_provider() -> QuestionProvider:
    settings = get_settings()
    if settings.interview_question_provider == "openai":
        # Imported here: `openai_questioner` imports this module.
        from app.modules.interview.openai_questioner import OpenAIQuestionProvider

        return OpenAIQuestionProvider(model_id=settings.interview_question_model_id)
    if settings.interview_question_provider == "stub":
        return StubQuestionProvider()
    # Unreachable while `Settings` allows only the two above.
    raise QuestionUnavailableError()
