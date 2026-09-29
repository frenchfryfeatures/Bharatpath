"""interview - Pydantic request/response DTOs

Audio sessions, chunk upload, evaluation, +20/session.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**No field says how many points a session is worth, or earned** (R11, and the
"points for sale" reading `courses/schemas.py` warns about). The one thing the
candidate is told about the score is `will_increase_score`, a yes or no, and
that is required: without it a fourth session is a refund request.

**No camera, video or lighting field**, in a request or a response. Audio only.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import ApiSchema


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class DeviceCheckRequest(_Base):
    """What the app measured. The server decides whether it passes."""

    mic_ok: bool
    audio_out_ok: bool
    network_kbps: int | None = Field(default=None, ge=0, le=10_000_000)
    storage_mb: int | None = Field(default=None, ge=0, le=100_000_000)
    quiet_env_ok: bool


class DeviceCheckResponse(_Base):
    id: uuid.UUID
    passed: bool
    failures: list[str] = Field(description="Codes to render; empty when passed.")
    rule_version: str
    checked_at: datetime
    valid_until: datetime | None = Field(
        description="A passed check allows checkout and starting a session until then."
    )


class OfferResponse(_Base):
    on_sale: bool
    price_minor: int | None = Field(default=None, ge=0, description="Paise.")
    currency: str = "INR"
    will_increase_score: bool = Field(
        description="False when this session cannot move the score. The app must "
        "say so before the payment screen and send the acknowledgement."
    )
    requires_acknowledgement: bool
    device_check_passed: bool = Field(description="A passed check that is still valid.")
    device_check_valid_until: datetime | None = None
    sessions_available: int = Field(ge=0, description="Bought and not yet started.")
    open_session_id: uuid.UUID | None = Field(
        default=None, description="A session being recorded. Resume it."
    )


class InterviewCheckoutRequest(_Base):
    acknowledge_no_score_increase: bool = Field(
        default=False,
        description="The candidate confirmed that this session will not increase "
        "their score. Required when `will_increase_score` is false.",
    )


class QuestionSchema(_Base):
    index: int = Field(ge=0)
    code: str
    key: str | None = Field(
        description="Translation key of a bank question; `prompt` is the English fallback. "
        "None for a question written for this candidate, which is already in their language."
    )
    prompt: str
    preparation_seconds: int
    answer_seconds: int
    looking_for: str | None = Field(
        default=None,
        description="What a good answer contains. Present only once this answer is "
        "stored: shown first, it turns the exercise into reading aloud.",
    )


class AnswerSchema(_Base):
    question_index: int = Field(ge=0)
    upload_state: Literal["PENDING", "UPLOADING", "STORED", "FAILED"]
    duration_ms: int | None = None
    uploaded_at: datetime | None = None


class SessionSummary(_Base):
    id: uuid.UUID
    session_number: int
    state: Literal["CREATED", "IN_PROGRESS", "COMPLETED", "EVALUATED", "ABANDONED", "FAILED"]
    question_set_code: str
    created_at: datetime
    completed_at: datetime | None = None


class SessionResponse(SessionSummary):
    """The answer manifest: one entry per question, whatever its state, so a
    client recovering from a crash can see exactly which answers to resend."""

    question_set_title: str
    question_set_version: str
    started_at: datetime | None = None
    questions_total: int = Field(
        description="How many questions the session will ask. `questions` holds those asked "
        "so far: all of them for a bank session, one more after each answer for a session "
        "whose questions are written for the candidate (`question_set_code` ADAPTIVE)."
    )
    questions: list[QuestionSchema]
    answers: list[AnswerSchema]


class AnswerUploadResponse(_Base):
    """Where to PUT one answer. **No key**: it is derived server-side."""

    url: str
    method: Literal["PUT"] = "PUT"
    expires_in_seconds: int
    max_bytes: int = Field(description="Checked on the stored object, not trusted to the PUT.")
    max_duration_ms: int
    accepted_types: list[str]


class CompleteAnswerRequest(_Base):
    duration_ms: int = Field(ge=0, le=3_600_000)


class AnswerResponse(AnswerSchema):
    looking_for: str | None = None


class DimensionFeedbackSchema(_Base):
    code: str
    key: str = Field(description="Translation key. `label` is the English fallback.")
    label: str
    level: Literal["STRONG", "DEVELOPING", "FOCUS_AREA"] = Field(
        description="In words, deliberately. No number about the candidate is shown."
    )
    what_good_looks_like: str


class QuestionFeedbackSchema(_Base):
    index: int = Field(ge=0)
    code: str
    prompt: str
    looking_for: str
    transcript: str = Field(description="What the speech model heard. Empty when nothing was.")
    spoken: bool
    comment: str | None = None


class InterviewReportResponse(_Base):
    """Feedback on one completed session.

    **Nothing here moves or describes the score.** The session's contribution
    was fixed when it was completed, whatever this says. PENDING until an
    evaluator has run; FAILED with `failure_reason` (`no_speech`,
    `evaluation_invalid`) when it could not produce feedback.
    """

    session_id: uuid.UUID
    status: Literal["PENDING", "READY", "FAILED"]
    failure_reason: str | None = None
    evaluated_at: datetime | None = None
    report_version: str | None = None
    dimensions: list[DimensionFeedbackSchema] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list, description="Dimension codes.")
    focus_areas: list[str] = Field(default_factory=list, description="Dimension codes.")
    questions: list[QuestionFeedbackSchema] = Field(default_factory=list)


class SessionHistoryItem(SessionSummary):
    """One session on the history screen."""

    question_set_title: str
    questions_asked: int
    answers_stored: int
    report_status: Literal["NOT_COMPLETED", "PENDING", "READY", "FAILED"]


class RecordingSchema(_Base):
    """One stored answer, to play back. `url` is a presigned GET that expires."""

    question_index: int = Field(ge=0)
    question_code: str
    prompt: str
    url: str
    expires_in_seconds: int
    mime: str | None = None
    duration_ms: int | None = None
    uploaded_at: datetime | None = None
    transcript: str | None = Field(
        default=None, description="What the speech model heard, once transcribed."
    )
