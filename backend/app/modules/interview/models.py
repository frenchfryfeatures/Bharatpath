"""interview - SQLAlchemy ORM models.

Audio sessions, chunk upload, evaluation, +20/session.

**Audio only. No video** (client, 2026-08-24, confirming SRS 2.7 over PRD 4.4's
"audio/video"). There is no camera field, no video field and no lighting field
anywhere below. The SRS device-check table still lists "Lighting" and that row
is dead - flag it to whoever maintains the SRS.

**In-app recording, not a phone call** (confirmed twice). Answers upload per
question, progressively, so a dropped connection mid-session does not lose
earlier answers. Opus/AAC mono at 16 kHz puts a 30-second answer at ~20 KB,
which is what makes that viable on 2G.

**A completed session contributes +20, capped at +60 across all sessions.** The
cap lives in `scoring/domain.py`, not here - this table only records that a
session finished and the +20 it records. Clamping the total is the scoring
module's job. A fourth session may be purchased and earns nothing, which is
confirmed explicitly before payment (`InterviewCheckoutNotice`) or it becomes
a refund request, and disputes cost more than the sale.

**Bought like a course, not through `entitlements`.** A session is bought by a
verified payment (`interview_purchases`, held by `guard_interview_purchase`)
and consumed by starting one (`interview_sessions.purchase_id`, unique). That
is the Day 15 shape for courses, and it keeps the purchase, its notice and the
session it became in one module rather than split across billing.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps, UUIDPrimaryKey
from app.modules.interview.bank import QUESTIONS_PER_SESSION
from app.modules.interview.domain import POINTS_PER_SESSION


class DeviceCheck(Base, UUIDPrimaryKey):
    """Runs BEFORE payment (SRS 1.10.1), so nobody pays then fails to start.

    Microphone, audio output, network, storage, quiet environment. No camera
    and no lighting - this is an audio product. `passed` is the server's
    judgment of the readings (`domain.evaluate_device_check`), never the
    client's. Insert-only: a check is evidence of what was measured.
    """

    __tablename__ = "device_checks"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    mic_ok: Mapped[bool] = mapped_column(nullable=False)
    audio_out_ok: Mapped[bool] = mapped_column(nullable=False)
    network_kbps: Mapped[int | None] = mapped_column(Integer)
    storage_mb: Mapped[int | None] = mapped_column(Integer)
    quiet_env_ok: Mapped[bool | None] = mapped_column()
    passed: Mapped[bool] = mapped_column(nullable=False)
    failures: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    rule_version: Mapped[str] = mapped_column(String(32), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class InterviewProduct(Base, UUIDPrimaryKey, Timestamps):
    """What a session costs. **Versioned, never edited**, like plans and courses:
    a payment names the row priced at checkout, so a price change between
    checkout and callback cannot change what the money bought."""

    __tablename__ = "interview_products"

    code: Mapped[str] = mapped_column(String(64), nullable=False)
    price_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(default=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    __table_args__ = (
        CheckConstraint("price_minor >= 0", name="ck_interview_products_price_non_negative"),
        UniqueConstraint("code", "version", name="uq_interview_product_code_version"),
    )


class InterviewCheckoutNotice(Base, UUIDPrimaryKey):
    """What the candidate was told before paying.

    **This is the dispute evidence** for the fourth session: whether the app
    was told this purchase would move the score, and whether the candidate
    acknowledged that it would not. Written in the checkout's transaction, so
    no payment for a session exists without one. Insert-only.

    More than one row per payment when it differs: a checkout retried inside
    the reuse window returns the same pending payment, and if a session was
    bought in between, what the candidate was told changed. Both are kept.
    """

    __tablename__ = "interview_checkout_notices"

    payment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("payments.id", ondelete="RESTRICT"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    will_increase_score: Mapped[bool] = mapped_column(nullable=False)
    acknowledged_no_increase: Mapped[bool] = mapped_column(nullable=False)
    device_check_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("device_checks.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # A purchase that cannot move the score is never sold unacknowledged.
        CheckConstraint(
            "will_increase_score OR acknowledged_no_increase",
            name="ck_interview_checkout_notices_acknowledged",
        ),
        UniqueConstraint(
            "payment_id",
            "will_increase_score",
            "acknowledged_no_increase",
            name="uq_interview_checkout_notice_terms",
        ),
    )


class InterviewPurchase(Base, UUIDPrimaryKey):
    """A session bought by a verified payment, not yet necessarily started.

    `guard_interview_purchase` (baseline migration) refuses a row whose payment
    is not this user's SUCCEEDED, signature-verified payment for this product,
    so a forged callback cannot reach a session, and so a score, even through a
    direct repository call. Insert-only.
    """

    __tablename__ = "interview_purchases"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("interview_products.id"), nullable=False
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payments.id", ondelete="RESTRICT"), nullable=False
    )
    purchased_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # One payment buys one session, however many times its callback lands.
        UniqueConstraint("payment_id", name="uq_interview_purchase_payment"),
        Index("ix_interview_purchases_user", "user_id", "purchased_at"),
    )


class InterviewSession(Base, UUIDPrimaryKey):
    """One rehearsal: a purchase consumed, a question set, six answers.

    **A score-moving row once completed** (invariant 3's blast radius). The
    app role cannot delete it, and `guard_interview_session_write` holds the
    state machine, the completion latch, and "completed means every answer is
    stored" for every writer.
    """

    __tablename__ = "interview_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    purchase_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("interview_purchases.id", ondelete="RESTRICT"),
        nullable=False,
    )
    device_check_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("device_checks.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    #: 1 for the candidate's first session, and so on. Picks the question set.
    session_number: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="CREATED", nullable=False)
    question_set_code: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The bank's `BANK_VERSION` when the session was created.
    question_set_version: Mapped[str] = mapped_column(String(32), nullable=False)
    contribution_version: Mapped[str | None] = mapped_column(String(32))
    #: Frozen at completion, as `course_completions.points_awarded` is.
    points_awarded: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "state IN ('CREATED', 'IN_PROGRESS', 'COMPLETED', 'EVALUATED', 'ABANDONED', 'FAILED')",
            name="ck_interview_sessions_state",
        ),
        CheckConstraint(
            f"points_awarded IS NULL OR points_awarded BETWEEN 0 AND {POINTS_PER_SESSION}",
            name="ck_interview_sessions_points_cap",
        ),
        # A completed session carries its contribution; nothing else does.
        CheckConstraint(
            "(state IN ('COMPLETED', 'EVALUATED', 'FAILED')) = "
            "(completed_at IS NOT NULL AND points_awarded IS NOT NULL "
            "AND contribution_version IS NOT NULL)",
            name="ck_interview_sessions_completion",
        ),
        CheckConstraint("session_number >= 1", name="ck_interview_sessions_number"),
        # One purchase, one session.
        UniqueConstraint("purchase_id", name="uq_interview_session_purchase"),
        UniqueConstraint("user_id", "session_number", name="uq_interview_session_number"),
        # One session being recorded at a time. Asking to start another returns
        # it, which is what makes an interrupted session recoverable.
        Index(
            "uq_interview_sessions_one_open",
            "user_id",
            unique=True,
            postgresql_where=text("state IN ('CREATED', 'IN_PROGRESS')"),
        ),
        Index(
            "ix_interview_sessions_completed",
            "user_id",
            postgresql_where=text("state IN ('COMPLETED', 'EVALUATED', 'FAILED')"),
        ),
    )


class InterviewSessionQuestion(Base, UUIDPrimaryKey):
    """One question a session asked, in order (2026-09-29).

    Since questions are written for each candidate (`questions.py`), the bank
    set a session names no longer says what was asked, so every question is
    stored as it was put to the candidate. That is what the evaluator is given,
    what the report shows, and what the next session is told not to repeat.

    **Insert-only.** A question is written once, when the candidate reaches it,
    and a later session reads it to avoid repeating it. `model_id` and
    `prompt_version` say which writer produced it; a BANK question has neither.
    Sessions started before 2026-09-29 have no rows and read their bank set.
    """

    __tablename__ = "interview_session_questions"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_index: Mapped[int] = mapped_column(Integer, nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    #: The bank's translation key, for a bank question. None for a written one,
    #: which is already in the candidate's language.
    key: Mapped[str | None] = mapped_column(String(128))
    prompt: Mapped[str] = mapped_column(String(1000), nullable=False)
    looking_for: Mapped[str] = mapped_column(String(1000), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    model_id: Mapped[str | None] = mapped_column(String(128))
    prompt_version: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            f"question_index >= 0 AND question_index < {QUESTIONS_PER_SESSION}",
            name="ck_interview_session_questions_index",
        ),
        CheckConstraint(
            "kind IN ('OPENING', 'FOLLOW_UP', 'NEW_TOPIC', 'BANK')",
            name="ck_interview_session_questions_kind",
        ),
        CheckConstraint(
            "source IN ('MODEL', 'BANK') AND (source = 'BANK') = (kind = 'BANK') AND "
            "(source = 'MODEL') = (model_id IS NOT NULL AND prompt_version IS NOT NULL)",
            name="ck_interview_session_questions_source",
        ),
        # A position is asked once; a retried "next question" returns it.
        UniqueConstraint("session_id", "question_index", name="uq_interview_session_question_slot"),
        UniqueConstraint("session_id", "code", name="uq_interview_session_question_code"),
    )


class InterviewAnswer(Base, UUIDPrimaryKey):
    """One recorded answer. Per-question upload, never one large file.

    `upload_state` supports interrupted-session recovery: the client keeps the
    answer locally, retries when connectivity returns, and the server accepts
    it idempotently (SRS 1.10.5). Once STORED an answer never changes
    (`guard_interview_answer_write`).
    """

    __tablename__ = "interview_answers"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_index: Mapped[int] = mapped_column(Integer, nullable=False)
    question_code: Mapped[str] = mapped_column(String(64), nullable=False)
    s3_key: Mapped[str | None] = mapped_column(String(512))
    mime: Mapped[str | None] = mapped_column(String(32))
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    upload_state: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False)
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "upload_state IN ('PENDING', 'UPLOADING', 'STORED', 'FAILED')",
            name="ck_interview_answers_upload_state",
        ),
        CheckConstraint(
            f"question_index >= 0 AND question_index < {QUESTIONS_PER_SESSION}",
            name="ck_interview_answers_index",
        ),
        CheckConstraint(
            "upload_state <> 'STORED' OR (s3_key IS NOT NULL AND size_bytes IS NOT NULL "
            "AND duration_ms IS NOT NULL AND uploaded_at IS NOT NULL)",
            name="ck_interview_answers_stored_is_complete",
        ),
        # Idempotent retry: re-uploading question 3 must not create a second row.
        UniqueConstraint("session_id", "question_index", name="uq_interview_answer_slot"),
    )


class InterviewTranscript(Base, UUIDPrimaryKey):
    """What a speech model heard in one stored answer (Day 17).

    **Insert-only, one per answer.** Transcription is paid per minute, so a
    re-run of the evaluation reads this rather than transcribing again, and a
    dispute about feedback can see exactly the text the evaluator was given.
    `provider` and `provider_version` are stored for the same reason
    `resume_extractions` stores its parser: a different engine hears different
    words, and the report was built from these.

    A candidate's own words: personal data, never shown to an employer or a
    college, and kept no longer than the audio it came from (blockers E22).
    """

    __tablename__ = "interview_transcripts"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    answer_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("interview_answers.id", ondelete="CASCADE"),
        nullable=False,
    )
    question_index: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    provider_version: Mapped[str] = mapped_column(String(64), nullable=False)
    #: BCP 47, as the provider detected it. Informational: the rubric is
    #: judged in whichever language the candidate chose (`bank.py`).
    language: Mapped[str | None] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(String(20_000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("answer_id", name="uq_interview_transcript_answer"),
        Index("ix_interview_transcripts_session", "session_id", "question_index"),
    )


class InterviewEvaluation(Base, UUIDPrimaryKey):
    """The outcome of evaluating one completed session (Day 17). Insert-only.

    **Feedback, not a contribution.** Nothing here reaches `scoring`, and the
    session's +20 was frozen at completion; `guard_interview_session_write`
    refuses any change to it, so an evaluation cannot move a score by any path.

    `ratings` holds the evaluator's 0-4 per question and dimension, validated
    against the rubric (`domain.parse_evaluation`), and **never leaves the
    service**: the candidate reads levels in words. `raw_response` is kept
    verbatim so a report can be re-assembled, and disputed, from what the
    evaluator actually said.

    One row per session. The session moves to `outcome` in the same
    transaction, and the guard refuses EVALUATED or FAILED without this row.
    """

    __tablename__ = "interview_evaluations"

    session_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    model_id: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(64), nullable=False)
    rubric_version: Mapped[str] = mapped_column(String(64), nullable=False)
    report_version: Mapped[str] = mapped_column(String(32), nullable=False)
    ratings: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    raw_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        CheckConstraint(
            "outcome IN ('EVALUATED', 'FAILED')", name="ck_interview_evaluations_outcome"
        ),
        # A failure says why; a success has nothing to explain.
        CheckConstraint(
            "(outcome = 'FAILED') = (failure_reason IS NOT NULL)",
            name="ck_interview_evaluations_failure_reason",
        ),
        UniqueConstraint("session_id", name="uq_interview_evaluation_session"),
    )
