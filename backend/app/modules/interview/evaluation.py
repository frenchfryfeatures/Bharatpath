"""Transcription and evaluation, each behind one interface.

**Sarvam for speech (`sarvam.py`), OpenAI for evaluation
(`openai_evaluator.py`)**, each selected by setting. Besides those, as for
payments and CV extraction, there are two more implementations of each:

* **Unconfigured** -- the default. Raises `EvaluationUnavailableError`; the
  session stays COMPLETED and the report says PENDING. **There is no fallback
  evaluator, deliberately**, for the same reason there is no fallback CV
  extractor: feedback invented by a heuristic is feedback nobody gave, and a
  candidate who paid for a rehearsal would act on it.
* **Stub** -- local development and CI only; `Settings` refuses it in staging
  and production. Deterministic from the audio bytes and transcript text, so a
  test can predict a report, and plainly labelled as a stub in what it writes.

What a real implementation must satisfy:

**`TranscriptionProvider`**
  * Accepts Opus (Ogg/WebM) and AAC (ADTS/MP4), mono, 16 kHz, up to
    `domain.MAX_ANSWER_MS`.
  * Handles the eight shipped locales and code-mixed speech (Hinglish is the
    common case, not the edge). Returns the words as spoken; **no translation**.
  * Returns an empty string for silence rather than hallucinated text, or the
    `no_speech` failure cannot be detected.
  * Runs in `ap-south-1`, or the region the audio goes to is recorded where a
    reviewer can find it (N2 allows it to leave India; say where it went).
  * Raises `EvaluationUnavailableError` on a transient failure so the task
    retries; never returns partial text.

**`EvaluationProvider`**
  * Receives each spoken answer's question, its `looking_for`, the transcript,
    and the rubric's dimensions **with their anchors** -- and nothing about the
    candidate: no name, no CV, no score, no language or region.
  * Returns exactly the shape `domain.parse_evaluation` reads. An evaluator
    that is sometimes malformed produces FAILED sessions, not repaired ones.
  * **Must not assess accent, pronunciation, fluency, vocabulary, pace, pitch
    or filler words** (`bank.py`). Put that in the prompt and test it on
    recordings from speakers of each supported language before launch.
  * `model_id` pinned exactly and `prompt_version` bumped on any prompt change;
    both are stored on every evaluation.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Final, Protocol

from fastapi import status

from app.core.errors import AppError
from app.modules.interview.bank import DIMENSIONS, RATING_MAX
from app.settings import get_settings


class EvaluationUnavailableError(AppError):
    """No provider, or a transient failure. The session stays COMPLETED and
    the evaluation is retried; nothing is recorded as failed."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "interview_evaluation_unavailable"
    title = "Interview feedback is not available yet"


@dataclass(frozen=True, slots=True)
class Transcript:
    text: str
    language: str | None


@dataclass(frozen=True, slots=True)
class AnswerForEvaluation:
    """One spoken answer, as an evaluator sees it. Nothing about the person."""

    question_code: str
    prompt: str
    looking_for: str
    transcript: str


class TranscriptionProvider(Protocol):
    name: str
    version: str

    async def transcribe(self, *, audio: bytes, mime: str) -> Transcript: ...


class EvaluationProvider(Protocol):
    name: str
    model_id: str
    prompt_version: str

    async def evaluate(self, *, answers: list[AnswerForEvaluation]) -> dict[str, Any]: ...


# ---------------------------------------------------------------------------
# Unconfigured -- the default
# ---------------------------------------------------------------------------
class UnconfiguredTranscriptionProvider:
    name = "none"
    version = "none"

    async def transcribe(self, *, audio: bytes, mime: str) -> Transcript:
        raise EvaluationUnavailableError()


class UnconfiguredEvaluationProvider:
    name = "none"
    model_id = "none"
    prompt_version = "none"

    async def evaluate(self, *, answers: list[AnswerForEvaluation]) -> dict[str, Any]:
        raise EvaluationUnavailableError()


# ---------------------------------------------------------------------------
# Stub -- local development and CI only
# ---------------------------------------------------------------------------
#: The stub's answer is this many bytes of audio or fewer: silence. Tests use
#: it to reach the `no_speech` path through real stored audio.
STUB_SILENCE_MAX_BYTES: Final = 2048


class StubTranscriptionProvider:
    """Turns bytes into a stable pseudo-transcript. An answer at or under
    `STUB_SILENCE_MAX_BYTES` is heard as silence."""

    name = "stub"
    version = "stub-1"

    async def transcribe(self, *, audio: bytes, mime: str) -> Transcript:
        if len(audio) <= STUB_SILENCE_MAX_BYTES:
            return Transcript(text="", language=None)
        digest = hashlib.sha256(audio).hexdigest()[:12]
        return Transcript(text=f"[stub transcript {digest}, {len(audio)} bytes]", language="en")


class StubEvaluationProvider:
    """Ratings derived from each transcript's hash, so they vary between
    answers and never between runs."""

    name = "stub"
    model_id = "stub-evaluator"
    prompt_version = "stub-1"

    async def evaluate(self, *, answers: list[AnswerForEvaluation]) -> dict[str, Any]:
        questions = []
        for answer in answers:
            digest = hashlib.sha256(answer.transcript.encode()).digest()
            ratings = {d.code: digest[i] % (RATING_MAX + 1) for i, d in enumerate(DIMENSIONS)}
            questions.append(
                {
                    "question_code": answer.question_code,
                    "ratings": ratings,
                    "comment": "Stub feedback: no evaluator is configured.",
                }
            )
        return {"questions": questions}


@lru_cache(maxsize=1)
def get_transcription_provider() -> TranscriptionProvider:
    settings = get_settings()
    if settings.interview_transcription_provider == "sarvam":
        # Imported here: `sarvam` imports this module.
        from app.modules.interview.sarvam import SarvamTranscriptionProvider

        return SarvamTranscriptionProvider()
    if "stub" in (
        settings.interview_transcription_provider,
        settings.interview_evaluation_provider,
    ):
        return StubTranscriptionProvider()
    return UnconfiguredTranscriptionProvider()


@lru_cache(maxsize=1)
def get_evaluation_provider() -> EvaluationProvider:
    settings = get_settings()
    if settings.interview_evaluation_provider == "openai":
        from app.modules.interview.openai_evaluator import OpenAIEvaluationProvider

        return OpenAIEvaluationProvider(model_id=settings.interview_evaluation_model_id)
    if settings.interview_evaluation_provider == "stub":
        return StubEvaluationProvider()
    return UnconfiguredEvaluationProvider()
