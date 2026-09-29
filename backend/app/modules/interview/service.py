"""interview - business rules and transaction boundaries

Audio sessions, chunk upload, evaluation, +20/session.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**The order a candidate goes through, and what each step refuses:**

  1. **Device check** (`record_device_check`) -- judged here from what the app
     measured. Runs before payment, so nobody pays and then cannot record.
  2. **Checkout** -- billing opens the payment; `checkout_terms` decides what
     may be sold first: a fresh passed check, a product on sale, and, when
     this session cannot move the score, the candidate's explicit
     acknowledgement. What they were told is written beside the payment
     (`record_checkout_notice`).
  3. **Purchase** (`record_purchase`) -- called by billing after a verified
     callback, and by nothing else. The database refuses it otherwise.
  4. **Session** (`start_session`) -- consumes one purchase, behind another
     fresh passed check. Asking again returns the open session: that is
     interrupted-session recovery (SRS 1.10.5). The session opens with one
     question the model wrote for this candidate; there are no fixed
     questions (client, 2026-09-29).
  5. **Answers** -- one presigned PUT per question, then `complete_answer`
     judges what was stored. Idempotent, so a client retrying from its local
     queue cannot double anything. Between answers, `next_question` hears the
     last answer and writes the next question (2026-09-29).
  6. **Completion** (`complete_session`) -- every answer stored. A score-moving
     write: audited, and announced to scoring through the outbox.
  7. **Evaluation** (`transcribe_session`, `evaluate_session`) -- a task after
     completion, and **feedback only**: the +20 was frozen at step 6 and the
     database refuses to change it. `get_report` reads it back in words.

**This module imports nothing from `scoring`** (invariant 4'). Scoring reads
`contributions_for` and applies the +60 cap itself.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.audit import AuditAction, audit_event
from app.core.deps import CANDIDATE
from app.core.errors import ConflictError, NotFoundError
from app.core.errors import ValidationError as AppValidationError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.modules.identity import service as identity_service
from app.modules.interview import repository
from app.modules.interview.bank import (
    DIMENSION_CODES,
    QUESTION_SETS,
    QUESTIONS_PER_SESSION,
    RUBRIC_VERSION,
    InterviewQuestion,
    QuestionSet,
)
from app.modules.interview.domain import (
    ACCEPTED_AUDIO_TYPES,
    ADAPTIVE_SET_CODE,
    ADAPTIVE_SET_TITLE,
    COMPLETED_STATES,
    CONTRIBUTION_VERSION,
    DEVICE_CHECK_VALID_FOR,
    EVALUATION_OUTCOMES,
    FAILURE_EVALUATION_INVALID,
    FAILURE_NO_SPEECH,
    MAX_ANSWER_BYTES,
    MAX_ANSWER_MS,
    MAX_DRAFT_ATTEMPTS,
    MAX_RESUME_CHARS_FOR_QUESTIONS,
    OPEN_STATES,
    POINTS_PER_SESSION,
    REPORT_VERSION,
    SOURCE_MODEL,
    DeviceReadings,
    EvaluationInvalid,
    InterviewReport,
    QuestionEvaluation,
    QuestionInvalid,
    answer_key,
    assemble_report,
    bank_questions_for,
    can_complete,
    device_check_is_fresh,
    evaluate_device_check,
    generated_question_code,
    is_spoken,
    parse_drafted_question,
    parse_evaluation,
    purchase_earns_points,
    redact_contacts,
    sniff_audio,
    valid_question_index,
    validate_answer,
)
from app.modules.interview.evaluation import (
    AnswerForEvaluation,
    EvaluationProvider,
    EvaluationUnavailableError,
    TranscriptionProvider,
    get_evaluation_provider,
    get_transcription_provider,
)
from app.modules.interview.events import ANSWER_STORED, SESSION_COMPLETED, SESSION_EVALUATED
from app.modules.interview.models import (
    DeviceCheck,
    InterviewAnswer,
    InterviewProduct,
    InterviewSession,
)
from app.modules.interview.questions import (
    AskedInThisSession,
    QuestionContext,
    QuestionProvider,
    QuestionUnavailableError,
    get_question_provider,
)
from app.modules.questionnaire import service as questionnaire_service
from app.modules.questionnaire.domain import answers_in_words
from app.modules.resume import service as resume_service
from app.modules.subscriptions.catalogue import INTERVIEW_SESSION_PRODUCT
from app.settings import Settings, get_settings

logger = get_logger(__name__)

#: Bytes read to identify a container. Every accepted format declares itself
#: in the first dozen.
_SNIFF_BYTES: Final = 64


class DeviceCheckRequiredError(ConflictError):
    """No passed device check inside `DEVICE_CHECK_VALID_FOR`. Run it again."""

    code = "interview_device_check_required"
    title = "Run the device check first"


class InterviewUnavailableError(NotFoundError):
    code = "interview_not_on_sale"
    title = "Mock interviews are not on sale"


class NoScoreIncreaseUnacknowledgedError(ConflictError):
    """This session cannot move the score, and the candidate has not said they
    understand that. Show "this session will not increase your score" and
    retry with the acknowledgement."""

    code = "interview_no_score_increase_unacknowledged"
    title = "This session will not increase your score"


class InterviewPurchaseRequiredError(ConflictError):
    code = "interview_purchase_required"
    title = "Buy a session first"


class InterviewSessionNotFoundError(NotFoundError):
    code = "interview_session_not_found"
    title = "Interview session not found"


class InterviewQuestionNotFoundError(NotFoundError):
    code = "interview_question_not_found"
    title = "No such question in this session"


class InterviewSessionNotOpenError(ConflictError):
    code = "interview_session_not_open"
    title = "This session is no longer being recorded"


class InterviewAnswerAlreadyStoredError(ConflictError):
    code = "interview_answer_already_stored"
    title = "This answer is already stored"


class InterviewAnswerNotUploadedError(ConflictError):
    code = "interview_answer_not_uploaded"
    title = "The answer has not been uploaded"


class InterviewAnswerRejectedError(AppValidationError):
    """`code` is the domain's rejection, e.g. `answer_not_audio`. The object
    was deleted; record the answer again."""

    code = "interview_answer_rejected"
    title = "The recording could not be accepted"


class InterviewQuestionNotReadyError(ConflictError):
    """This question has not been written yet. Ask for it with
    `POST .../next-question` once the previous answer is stored."""

    code = "interview_question_not_ready"
    title = "This question is not ready yet"


class InterviewPreviousAnswerMissingError(ConflictError):
    """`params.missing` lists the question indexes still to be stored. The
    next question follows what was said, so it waits for the answer."""

    code = "interview_previous_answer_not_stored"
    title = "Store the previous answer first"


class InterviewSessionNotCompletedError(ConflictError):
    code = "interview_session_not_completed"
    title = "Feedback exists only for a completed session"


class InterviewAnswersMissingError(ConflictError):
    """`params.missing` lists the question indexes with no stored answer."""

    code = "interview_answers_missing"
    title = "Some answers are not stored yet"


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


# ---------------------------------------------------------------------------
# 1. The device check
# ---------------------------------------------------------------------------
async def record_device_check(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    readings: DeviceReadings,
    now: datetime | None = None,
) -> DeviceCheck:
    """Every check is kept, passed or not: it is what we tell a candidate who
    says they could not start, and a failed one is the evidence they tried."""
    decision = evaluate_device_check(readings)
    row = await repository.insert_device_check(
        session,
        user_id=user_id,
        mic_ok=readings.mic_ok,
        audio_out_ok=readings.audio_out_ok,
        network_kbps=readings.network_kbps,
        storage_mb=readings.storage_mb,
        quiet_env_ok=readings.quiet_env_ok,
        passed=decision.passed,
        failures=list(decision.failures),
        rule_version=decision.rule_version,
        checked_at=_now(now),
    )
    logger.info("interview_device_check", passed=decision.passed, failures=decision.failures)
    return row


async def _fresh_passed_check(
    session: AsyncSession, *, user_id: uuid.UUID, now: datetime
) -> DeviceCheck | None:
    check = await repository.latest_passed_check(session, user_id=user_id)
    if check is None or not device_check_is_fresh(checked_at=check.checked_at, now=now):
        return None
    return check


def check_valid_until(check: DeviceCheck) -> datetime:
    return check.checked_at + DEVICE_CHECK_VALID_FOR


# ---------------------------------------------------------------------------
# 2-3. Buying a session
# ---------------------------------------------------------------------------
async def _sessions_held(session: AsyncSession, *, user_id: uuid.UUID) -> int:
    """Completed, in progress, and bought but not started. Not abandoned."""
    started = await repository.count_sessions(
        session, user_id=user_id, states=COMPLETED_STATES | OPEN_STATES
    )
    unstarted = await repository.count_unstarted_purchases(session, user_id=user_id)
    return started + unstarted


@dataclass(frozen=True, slots=True)
class Offer:
    product: InterviewProduct | None
    will_increase_score: bool
    device_check: DeviceCheck | None
    sessions_available: int
    open_session_id: uuid.UUID | None


async def offer(session: AsyncSession, *, user_id: uuid.UUID, now: datetime | None = None) -> Offer:
    """What the purchase screen needs, **including whether to warn**. The app
    must show "this session will not increase your score" when
    `will_increase_score` is false, before the payment screen."""
    now = _now(now)
    product = await repository.active_product(session, code=INTERVIEW_SESSION_PRODUCT.code)
    held = await _sessions_held(session, user_id=user_id)
    open_row = await repository.open_session(session, user_id=user_id)
    return Offer(
        product=product,
        will_increase_score=purchase_earns_points(sessions_held=held),
        device_check=await _fresh_passed_check(session, user_id=user_id, now=now),
        sessions_available=await repository.count_unstarted_purchases(session, user_id=user_id),
        open_session_id=open_row.id if open_row is not None else None,
    )


@dataclass(frozen=True, slots=True)
class CheckoutTerms:
    product: InterviewProduct
    device_check_id: uuid.UUID
    will_increase_score: bool
    acknowledged_no_increase: bool


async def checkout_terms(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    acknowledge_no_score_increase: bool,
    now: datetime | None = None,
) -> CheckoutTerms:
    """Whether a session may be sold to this candidate right now, and on what
    terms. Called by billing before it opens a payment; **refusing here means
    no payment exists**, so a candidate cannot be charged for a session they
    could not record, or for points they were not told they would not get."""
    now = _now(now)
    check = await _fresh_passed_check(session, user_id=user_id, now=now)
    if check is None:
        raise DeviceCheckRequiredError()
    product = await repository.active_product(session, code=INTERVIEW_SESSION_PRODUCT.code)
    if product is None:
        raise InterviewUnavailableError()
    earns = purchase_earns_points(sessions_held=await _sessions_held(session, user_id=user_id))
    if not earns and not acknowledge_no_score_increase:
        raise NoScoreIncreaseUnacknowledgedError(params={"will_increase_score": False})
    return CheckoutTerms(
        product=product,
        device_check_id=check.id,
        will_increase_score=earns,
        acknowledged_no_increase=acknowledge_no_score_increase and not earns,
    )


async def record_checkout_notice(
    session: AsyncSession, *, payment_id: uuid.UUID, user_id: uuid.UUID, terms: CheckoutTerms
) -> None:
    await repository.insert_checkout_notice(
        session,
        payment_id=payment_id,
        user_id=user_id,
        will_increase_score=terms.will_increase_score,
        acknowledged_no_increase=terms.acknowledged_no_increase,
        device_check_id=terms.device_check_id,
    )


async def record_purchase(
    session: AsyncSession, *, user_id: uuid.UUID, product_id: uuid.UUID, payment_id: uuid.UUID
) -> bool:
    """Called by billing after a verified callback. False if this payment
    already bought its session -- a redelivered callback buys nothing twice."""
    created = await repository.insert_purchase(
        session, user_id=user_id, product_id=product_id, payment_id=payment_id
    )
    if not created:
        logger.warning("interview_purchase_already_recorded", payment_id=str(payment_id))
    return created


# ---------------------------------------------------------------------------
# 4. The session
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class SessionView:
    session: InterviewSession
    question_set: QuestionSet
    answers: dict[int, InterviewAnswer]


def question_set_title(question_set_code: str) -> str:
    return next((s.title for s in QUESTION_SETS if s.code == question_set_code), ADAPTIVE_SET_TITLE)


async def _questions_of(session: AsyncSession, row: InterviewSession) -> QuestionSet:
    """What this session has asked so far, in order.

    Stored per session since 2026-09-29: all six for a bank session, one more
    after each answer for a written one. A session from before then has no
    rows and asked its bank set.
    """
    stored = await repository.questions_for(session, session_id=row.id)
    if not stored:
        questions = bank_questions_for(
            question_set_code=row.question_set_code, session_number=row.session_number
        )
    else:
        questions = tuple(
            InterviewQuestion(q.code, q.key or "", q.prompt, q.looking_for) for q in stored
        )
    return QuestionSet(row.question_set_code, question_set_title(row.question_set_code), questions)


async def _view(session: AsyncSession, row: InterviewSession) -> SessionView:
    answers = await repository.answers_for(session, session_id=row.id)
    return SessionView(
        row, await _questions_of(session, row), {a.question_index: a for a in answers}
    )


@dataclass(frozen=True, slots=True)
class StartedSession:
    view: SessionView
    created: bool


async def start_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    now: datetime | None = None,
    question_provider: QuestionProvider | None = None,
) -> StartedSession:
    """Consume the oldest unstarted purchase. **An open session is returned
    rather than a second started**: the client that crashed mid-interview
    calls this again and resumes, and no purchase is spent twice.

    The session opens with its first question written by the model for this
    candidate, and the rest come one at a time from `next_question`. **If the
    first question cannot be written the whole start rolls back** -- no
    purchase is spent -- and the app retries.
    """
    now = _now(now)
    provider = question_provider or get_question_provider()
    await repository.lock_candidate(session, user_id=user_id)
    existing = await repository.open_session(session, user_id=user_id)
    if existing is not None:
        return StartedSession(await _view(session, existing), created=False)

    check = await _fresh_passed_check(session, user_id=user_id, now=now)
    if check is None:
        raise DeviceCheckRequiredError()
    purchase = await repository.oldest_unstarted_purchase(session, user_id=user_id)
    if purchase is None:
        raise InterviewPurchaseRequiredError()

    # Every session ever started counts, abandoned ones included, so a
    # candidate who abandons one is not handed the same questions again.
    number = await repository.count_sessions(session, user_id=user_id) + 1
    row = await repository.insert_session(
        session,
        user_id=user_id,
        purchase_id=purchase.id,
        device_check_id=check.id,
        session_number=number,
        question_set_code=ADAPTIVE_SET_CODE,
        question_set_version=provider.prompt_version[:32],
    )
    await _write_question(session, row, index=0, provider=provider)
    logger.info("interview_session_started", session_number=number)
    return StartedSession(await _view(session, row), created=True)


# ---------------------------------------------------------------------------
# 4b. Questions written for the candidate (2026-09-29)
# ---------------------------------------------------------------------------
async def _earlier_questions(
    session: AsyncSession, row: InterviewSession
) -> list[InterviewQuestion]:
    """Every question this candidate was asked in any other session."""
    others = await repository.earlier_sessions(
        session, user_id=row.user_id, before_session_id=row.id
    )
    stored = await repository.questions_for_sessions(session, session_ids=[o.id for o in others])
    with_rows = {q.session_id for q in stored}
    asked = [InterviewQuestion(q.code, q.key or "", q.prompt, q.looking_for) for q in stored]
    for other in others:
        if other.id not in with_rows:
            asked.extend(
                bank_questions_for(
                    question_set_code=other.question_set_code,
                    session_number=other.session_number,
                )
            )
    return asked


def _structured_resume_text(parsed: dict[str, Any]) -> str:
    """A form-built CV has fields, not prose. Name and contact are left out."""
    lines: list[str] = []
    for key, value in parsed.items():
        if key in {"full_name", "name", "phone", "email", "raw_text"} or value in (None, "", []):
            continue
        lines.append(f"{key}: {value}")
    return "\n".join(lines)


async def _resume_for_questions(
    session: AsyncSession, *, user_id: uuid.UUID, known: tuple[str | None, ...]
) -> str | None:
    """The confirmed CV, contact details removed, cut to length. Through the
    confirm gate, like everything else that reads a CV: an unconfirmed parse
    is not something to interview a person about."""
    try:
        version = await resume_service.get_scorable_version(session, user_id=user_id)
    except resume_service.ResumeNotConfirmedError:
        return None
    parsed = version.parsed if isinstance(version.parsed, dict) else {}
    text = parsed.get("raw_text")
    if not isinstance(text, str) or not text.strip():
        text = _structured_resume_text(parsed)
    name = parsed.get("full_name")
    text = redact_contacts(text, known=(*known, name if isinstance(name, str) else None))
    return text[:MAX_RESUME_CHARS_FOR_QUESTIONS].strip() or None


async def _question_context(
    session: AsyncSession,
    row: InterviewSession,
    *,
    index: int,
    asked_here: list[InterviewQuestion],
    earlier: list[InterviewQuestion],
) -> QuestionContext:
    contact = (await identity_service.contacts(session, user_ids=[row.user_id])).get(row.user_id)
    known = (contact.phone, contact.email) if contact is not None else ()
    state = await questionnaire_service.get_state(session, user_id=row.user_id)
    # Not the free-text answer: it is promised to employers applied to, and
    # to nobody else.
    onboarding = tuple(
        (a.question, a.answer) for a in answers_in_words(state.answers, include_free_text=False)
    )
    heard = {
        t.question_index: t.text
        for t in await repository.transcripts_for(session, session_id=row.id)
    }
    return QuestionContext(
        session_number=row.session_number,
        index=index,
        total=QUESTIONS_PER_SESSION,
        language=contact.locale if contact is not None else "en",
        resume_text=await _resume_for_questions(session, user_id=row.user_id, known=known),
        onboarding=onboarding,
        earlier_questions=tuple(q.prompt for q in earlier),
        this_session=tuple(
            AskedInThisSession(q.prompt, (heard.get(i) or "").strip() or None)
            for i, q in enumerate(asked_here)
        ),
    )


async def _hear_stored_answers(
    session: AsyncSession,
    row: InterviewSession,
    *,
    transcriber: TranscriptionProvider,
    settings: Settings,
) -> None:
    """Transcribe this session's stored answers that have no transcript yet,
    so the next question can follow what was said. These are the rows the
    evaluation reads later (idempotent by answer), so nothing is paid twice.

    **Best effort.** A transcription that fails leaves that answer unheard and
    the next question is written without it; the candidate is never stopped
    mid-interview because speech-to-text failed.
    """
    if transcriber.name == "none":
        return
    done = {t.answer_id for t in await repository.transcripts_for(session, session_id=row.id)}
    for answer in await repository.answers_for(session, session_id=row.id):
        if answer.upload_state != "STORED" or answer.id in done or answer.s3_key is None:
            continue
        try:
            audio = await storage.read_whole_object(
                bucket=settings.s3_bucket_interview_audio, key=answer.s3_key
            )
            if not audio:
                continue
            heard = await transcriber.transcribe(audio=audio, mime=answer.mime or "")
        except EvaluationUnavailableError:
            logger.warning("interview_answer_not_heard_in_session", index=answer.question_index)
            continue
        await repository.insert_transcript(
            session,
            session_id=row.id,
            answer_id=answer.id,
            question_index=answer.question_index,
            provider=transcriber.name,
            provider_version=transcriber.version,
            language=heard.language,
            text_value=heard.text,
        )


async def _write_question(
    session: AsyncSession,
    row: InterviewSession,
    *,
    index: int,
    provider: QuestionProvider,
) -> None:
    """Write question `index` for this session, by the model. Exactly one row.

    A draft that may not be asked -- a repeat of anything the candidate has
    been asked, a kind this position cannot have, text out of bounds -- is
    refused and the model is asked again, told what was refused and why, up
    to `MAX_DRAFT_ATTEMPTS`. **There is no fixed-question fallback** (client,
    2026-09-29): if no usable question comes back, this raises
    `QuestionUnavailableError` (503), nothing is written, and the app retries.
    """
    asked_here = list((await _questions_of(session, row)).questions)
    if row.question_set_code != ADAPTIVE_SET_CODE or index < len(asked_here):
        return
    earlier = await _earlier_questions(session, row)
    every_prompt = [q.prompt for q in (*earlier, *asked_here)]
    context = await _question_context(
        session, row, index=index, asked_here=asked_here, earlier=earlier
    )
    refused: list[str] = []
    for attempt in range(1, MAX_DRAFT_ATTEMPTS + 1):
        try:
            raw = await provider.draft(context=replace(context, refused=tuple(refused)))
        except QuestionUnavailableError:
            logger.warning("interview_question_unavailable", index=index, attempt=attempt)
            continue
        try:
            drafted = parse_drafted_question(raw, index=index, already_asked=every_prompt)
        except QuestionInvalid as exc:
            logger.warning("interview_question_refused", index=index, attempt=attempt)
            prompt = raw.get("prompt") if isinstance(raw, dict) else None
            refused.append(f"{prompt!s} -- refused: {exc}")
            continue
        await repository.insert_question(
            session,
            session_id=row.id,
            question_index=index,
            code=generated_question_code(session_number=row.session_number, index=index),
            key=None,
            prompt=drafted.prompt,
            looking_for=drafted.looking_for,
            kind=drafted.kind,
            source=SOURCE_MODEL,
            model_id=provider.model_id,
            prompt_version=provider.prompt_version,
        )
        logger.info("interview_question_written", index=index, kind=drafted.kind)
        return
    raise QuestionUnavailableError()


async def next_question(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    question_provider: QuestionProvider | None = None,
    transcriber: TranscriptionProvider | None = None,
    settings: Settings | None = None,
) -> SessionView:
    """Write the next question, once every question so far has a stored
    answer, and return the session with it. **Idempotent**: asked again
    before that answer is stored, it returns the session unchanged, so a
    client retrying after a dropped response gets the same question rather
    than a second one or an error.

    The previous answers are transcribed first (`_hear_stored_answers`) so a
    follow-up can follow what was actually said. A bank session already holds
    all six questions and is returned as it is.
    """
    settings = settings or get_settings()
    row = await repository.get_session(session, user_id=user_id, session_id=session_id, lock=True)
    if row is None:
        raise InterviewSessionNotFoundError()
    if row.state not in OPEN_STATES:
        raise InterviewSessionNotOpenError()
    view = await _view(session, row)
    index = len(view.question_set.questions)
    if index >= QUESTIONS_PER_SESSION or row.question_set_code != ADAPTIVE_SET_CODE:
        return view
    missing = [
        i for i in range(index) if i not in view.answers or view.answers[i].upload_state != "STORED"
    ]
    if missing == [index - 1]:
        # The latest question is still waiting for its answer: this is a
        # retry, and the question to answer is the one already written.
        return view
    if missing:
        raise InterviewPreviousAnswerMissingError(params={"missing": missing})
    await _hear_stored_answers(
        session, row, transcriber=transcriber or get_transcription_provider(), settings=settings
    )
    await _write_question(
        session, row, index=index, provider=question_provider or get_question_provider()
    )
    return await _view(session, row)


async def get_session(
    session: AsyncSession, *, user_id: uuid.UUID, session_id: uuid.UUID
) -> SessionView:
    """The answer manifest. Someone else's session is a 404."""
    row = await repository.get_session(session, user_id=user_id, session_id=session_id)
    if row is None:
        raise InterviewSessionNotFoundError()
    return await _view(session, row)


async def list_sessions(session: AsyncSession, *, user_id: uuid.UUID) -> list[InterviewSession]:
    return await repository.list_sessions(session, user_id=user_id)


# ---------------------------------------------------------------------------
# 5. Answers
# ---------------------------------------------------------------------------
async def _open_session_for_write(
    session: AsyncSession, *, user_id: uuid.UUID, session_id: uuid.UUID, question_index: int
) -> tuple[InterviewSession, QuestionSet]:
    row = await repository.get_session(session, user_id=user_id, session_id=session_id, lock=True)
    if row is None:
        raise InterviewSessionNotFoundError()
    if not valid_question_index(question_index):
        raise InterviewQuestionNotFoundError()
    question_set = await _questions_of(session, row)
    if question_index >= len(question_set.questions):
        raise InterviewQuestionNotReadyError()
    return row, question_set


@dataclass(frozen=True, slots=True)
class AnswerUploadTicket:
    url: str
    expires_in_seconds: int
    max_bytes: int
    max_duration_ms: int
    accepted_types: tuple[str, ...]


async def issue_answer_upload(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    question_index: int,
    now: datetime | None = None,
    settings: Settings | None = None,
) -> AnswerUploadTicket:
    """A presigned PUT for one answer. The first one starts the session.

    Re-issuing for an answer whose upload never landed is the recovery path:
    the app still holds the recording locally and simply asks again.
    """
    settings = settings or get_settings()
    now = _now(now)
    row, question_set = await _open_session_for_write(
        session, user_id=user_id, session_id=session_id, question_index=question_index
    )
    if row.state not in OPEN_STATES:
        raise InterviewSessionNotOpenError()
    answer = await repository.get_answer(session, session_id=row.id, question_index=question_index)
    if answer is not None and answer.upload_state == "STORED":
        raise InterviewAnswerAlreadyStoredError()

    key = answer_key(user_id=user_id, session_id=row.id, question_index=question_index)
    await repository.mark_uploading(
        session,
        session_id=row.id,
        question_index=question_index,
        question_code=question_set.questions[question_index].code,
        s3_key=key,
    )
    if row.state == "CREATED":
        row.state = "IN_PROGRESS"
        row.started_at = now
        await repository.save_session(session, row)

    url = await storage.presign_put(
        bucket=settings.s3_bucket_interview_audio,
        key=key,
        expires_in=settings.presigned_url_ttl_seconds,
    )
    return AnswerUploadTicket(
        url=url,
        expires_in_seconds=settings.presigned_url_ttl_seconds,
        max_bytes=MAX_ANSWER_BYTES,
        max_duration_ms=MAX_ANSWER_MS,
        accepted_types=ACCEPTED_AUDIO_TYPES,
    )


async def complete_answer(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    question_index: int,
    duration_ms: int,
    now: datetime | None = None,
    settings: Settings | None = None,
) -> InterviewAnswer:
    """Judge what was stored, then record it. Idempotent: a stored answer is
    returned as it is, so a client retrying after a dropped response is fine.

    Nothing is trusted from the client but the duration, which is bounded:
    the key is rebuilt from ids we issued, the size is read from S3, and the
    format is sniffed from the stored bytes. A rejected object is deleted --
    audio of a person's voice we have decided not to keep is not ours to hold.
    """
    settings = settings or get_settings()
    now = _now(now)
    row, _question_set = await _open_session_for_write(
        session, user_id=user_id, session_id=session_id, question_index=question_index
    )
    answer = await repository.get_answer(
        session, session_id=row.id, question_index=question_index, lock=True
    )
    if answer is not None and answer.upload_state == "STORED":
        return answer
    if row.state not in OPEN_STATES:
        raise InterviewSessionNotOpenError()
    if answer is None:
        raise InterviewAnswerNotUploadedError()

    bucket = settings.s3_bucket_interview_audio
    key = answer_key(user_id=user_id, session_id=row.id, question_index=question_index)
    meta = await storage.head_object(bucket=bucket, key=key)
    if meta is None:
        raise InterviewAnswerNotUploadedError()
    head = await storage.read_head_bytes(bucket=bucket, key=key, count=_SNIFF_BYTES)
    rejection = validate_answer(head=head, size_bytes=meta["size_bytes"], duration_ms=duration_ms)
    if rejection is not None:
        await storage.delete_object(bucket=bucket, key=key)
        logger.info("interview_answer_rejected", reason=rejection.code)
        raise InterviewAnswerRejectedError(code=rejection.code, params={"detail": rejection.detail})

    stored = await repository.mark_stored(
        session,
        answer,
        mime=sniff_audio(head) or "application/octet-stream",
        size_bytes=meta["size_bytes"],
        duration_ms=duration_ms,
        uploaded_at=now,
    )
    await emit(
        session,
        event_type=ANSWER_STORED,
        aggregate_type="interview_answer",
        aggregate_id=stored.id,
        payload={
            "user_id": str(user_id),
            "session_id": str(row.id),
            "question_index": question_index,
        },
    )
    return stored


# ---------------------------------------------------------------------------
# 6. Completion -- a score-moving write
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CompletedSession:
    view: SessionView
    created: bool


async def complete_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    now: datetime | None = None,
    request_id: str | None = None,
) -> CompletedSession:
    """**A score-moving write** (invariant 3's blast radius). Every answer
    stored, then the +20 frozen on the row, an audit row and the outbox event
    scoring listens for -- all in this transaction, so a rolled-back completion
    never re-scores.

    Written by the candidate's own action, unlike a course completion, because
    what earns the points is the thing the candidate does: finishing. Quality
    never enters it (`bank.py`). What makes it safe is that the server decides
    "finished" from stored, validated audio, and the database refuses a
    COMPLETED row without it (`guard_interview_session_write`).

    Idempotent: completing a completed session writes, audits and emits nothing.
    """
    now = _now(now)
    row = await repository.get_session(session, user_id=user_id, session_id=session_id, lock=True)
    if row is None:
        raise InterviewSessionNotFoundError()
    if row.state in COMPLETED_STATES:
        return CompletedSession(await _view(session, row), created=False)
    if row.state not in OPEN_STATES:
        raise InterviewSessionNotOpenError()

    view = await _view(session, row)
    stored = {i for i, a in view.answers.items() if a.upload_state == "STORED"}
    if not can_complete(stored_indexes=stored):
        missing = sorted(set(range(QUESTIONS_PER_SESSION)) - stored)
        raise InterviewAnswersMissingError(params={"missing": missing})

    row.state = "COMPLETED"
    row.completed_at = now
    row.points_awarded = POINTS_PER_SESSION
    row.contribution_version = CONTRIBUTION_VERSION
    row = await repository.save_session(session, row)

    await audit_event(
        session,
        action=AuditAction.INTERVIEW_COMPLETION_RECORDED,
        actor_id=user_id,
        actor_role=CANDIDATE,
        target_type="interview_session",
        target_id=row.id,
        request_id=request_id,
        metadata={
            "candidate_id": str(user_id),
            "session_number": row.session_number,
            "points_awarded": POINTS_PER_SESSION,
            "contribution_version": CONTRIBUTION_VERSION,
        },
    )
    await emit(
        session,
        event_type=SESSION_COMPLETED,
        aggregate_type="interview_session",
        aggregate_id=row.id,
        payload={
            "user_id": str(user_id),
            "session_id": str(row.id),
            "points_awarded": POINTS_PER_SESSION,
        },
    )
    logger.info("interview_session_completed", session_number=row.session_number)
    return CompletedSession(SessionView(row, view.question_set, view.answers), created=True)


@dataclass(frozen=True, slots=True)
class InterviewContribution:
    """One completed session as scoring folds it in. Uncapped: the +60 is
    scoring's to apply."""

    session_id: uuid.UUID
    points: int
    contribution_version: str


async def contributions_for(
    session: AsyncSession, *, user_id: uuid.UUID
) -> list[InterviewContribution]:
    """Every completed session, at the points frozen on each, oldest first."""
    return [
        InterviewContribution(
            session_id=row.id,
            points=max(0, min(row.points_awarded or 0, POINTS_PER_SESSION)),
            contribution_version=row.contribution_version or CONTRIBUTION_VERSION,
        )
        for row in await repository.completed_sessions(session, user_id=user_id)
    ]


# ---------------------------------------------------------------------------
# 7. Evaluation -- feedback, and never a score-moving write
# ---------------------------------------------------------------------------
async def transcribe_session(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    provider: TranscriptionProvider | None = None,
    settings: Settings | None = None,
) -> int:
    """Transcribe every stored answer of a completed session not yet
    transcribed. Returns how many were written.

    **System use** (the evaluation task). Idempotent by answer, so a retried
    task pays for no answer twice. A session that is not COMPLETED is left
    alone: an open one is not finished, and an evaluated one needs nothing.
    """
    settings = settings or get_settings()
    provider = provider or get_transcription_provider()
    row = await repository.get_session_by_id(session, session_id=session_id)
    if row is None or row.state != "COMPLETED":
        return 0
    if provider.name == "none":
        # Before reading any audio: with nothing to hear it, a GET per answer
        # on every retry is spend for nothing.
        raise EvaluationUnavailableError()

    done = {t.answer_id for t in await repository.transcripts_for(session, session_id=row.id)}
    written = 0
    for answer in await repository.answers_for(session, session_id=row.id):
        if answer.upload_state != "STORED" or answer.id in done or answer.s3_key is None:
            continue
        audio = await storage.read_whole_object(
            bucket=settings.s3_bucket_interview_audio, key=answer.s3_key
        )
        if not audio:
            # The completion guard proved it was stored. Missing now means S3
            # is unreachable or the object was removed; neither is the
            # candidate's silence, so it must not become a `no_speech`.
            raise EvaluationUnavailableError()
        heard = await provider.transcribe(audio=audio, mime=answer.mime or "")
        await repository.insert_transcript(
            session,
            session_id=row.id,
            answer_id=answer.id,
            question_index=answer.question_index,
            provider=provider.name,
            provider_version=provider.version,
            language=heard.language,
            text_value=heard.text,
        )
        written += 1
    logger.info("interview_session_transcribed", written=written)
    return written


async def evaluate_session(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    provider: EvaluationProvider | None = None,
) -> str:
    """Rate a transcribed session against the rubric and record the outcome.

    Returns the session's state. **Idempotent**: an evaluated or failed
    session is returned as it is. Three ways out:

      * **EVALUATED** -- the evaluator's ratings fit the rubric exactly.
      * **FAILED** `no_speech` -- nothing was said in any answer. The evaluator
        is not called; there is nothing to rate. **The +20 stays** (E19).
      * **FAILED** `evaluation_invalid` -- the evaluator answered, and not in
        the rubric's shape. Recorded, never repaired.

    A provider that is missing or failing transiently raises
    `EvaluationUnavailableError` and records nothing, so the task retries.

    **Points are never touched here.** The session's contribution was frozen
    at completion and `guard_interview_session_write` refuses to change it.
    """
    provider = provider or get_evaluation_provider()
    row = await repository.get_session_by_id(session, session_id=session_id, lock=True)
    if row is None:
        raise InterviewSessionNotFoundError()
    if row.state in EVALUATION_OUTCOMES:
        return row.state
    if row.state != "COMPLETED":
        raise InterviewSessionNotCompletedError()

    question_set = await _questions_of(session, row)
    transcripts = await repository.transcripts_for(session, session_id=row.id)
    heard = {t.question_index: t.text for t in transcripts}
    if len(heard) < QUESTIONS_PER_SESSION:
        # Not transcribed yet. Retry after `transcribe_session`.
        raise EvaluationUnavailableError()
    spoken = [
        (index, question)
        for index, question in enumerate(question_set.questions)
        if is_spoken(heard.get(index))
    ]

    raw: dict[str, Any] | None = None
    ratings: list[dict[str, Any]] = []
    failure: str | None = None
    if not spoken:
        failure = FAILURE_NO_SPEECH
    else:
        if provider.name == "none":
            raise EvaluationUnavailableError()
        response = await provider.evaluate(
            answers=[
                AnswerForEvaluation(
                    question_code=question.code,
                    prompt=question.prompt,
                    looking_for=question.looking_for,
                    transcript=heard[index].strip(),
                )
                for index, question in spoken
            ]
        )
        raw = response if isinstance(response, dict) else None
        try:
            evaluations = parse_evaluation(
                response,
                question_codes=tuple(question.code for _, question in spoken),
                dimension_codes=DIMENSION_CODES,
            )
        except EvaluationInvalid as exc:
            logger.warning("interview_evaluation_invalid", error=str(exc))
            failure = FAILURE_EVALUATION_INVALID
        else:
            ratings = [
                {"question_code": e.question_code, "ratings": e.ratings, "comment": e.comment}
                for e in evaluations
            ]

    outcome = "FAILED" if failure else "EVALUATED"
    await repository.insert_evaluation(
        session,
        session_id=row.id,
        outcome=outcome,
        failure_reason=failure,
        provider=provider.name,
        model_id=provider.model_id,
        prompt_version=provider.prompt_version,
        rubric_version=RUBRIC_VERSION,
        report_version=REPORT_VERSION,
        ratings=ratings,
        raw_response=raw,
    )
    row.state = outcome
    row = await repository.save_session(session, row)
    await emit(
        session,
        event_type=SESSION_EVALUATED,
        aggregate_type="interview_session",
        aggregate_id=row.id,
        payload={"user_id": str(row.user_id), "session_id": str(row.id), "outcome": outcome},
    )
    logger.info("interview_session_evaluated", outcome=outcome, failure_reason=failure)
    return outcome


@dataclass(frozen=True, slots=True)
class ReportView:
    #: PENDING until evaluated; READY with a report; FAILED with a reason.
    status: str
    failure_reason: str | None
    report: InterviewReport | None
    evaluated_at: datetime | None


async def get_report(
    session: AsyncSession, *, user_id: uuid.UUID, session_id: uuid.UUID
) -> ReportView:
    """The candidate's feedback on their own session, assembled from the
    stored transcripts and ratings on every read. Someone else's is a 404."""
    row = await repository.get_session(session, user_id=user_id, session_id=session_id)
    if row is None:
        raise InterviewSessionNotFoundError()
    if row.state not in COMPLETED_STATES:
        raise InterviewSessionNotCompletedError()
    evaluation = await repository.get_evaluation(session, session_id=row.id)
    if evaluation is None:
        return ReportView("PENDING", None, None, None)
    if evaluation.outcome == "FAILED":
        return ReportView("FAILED", evaluation.failure_reason, None, evaluation.created_at)
    transcripts = await repository.transcripts_for(session, session_id=row.id)
    report = assemble_report(
        questions=(await _questions_of(session, row)).questions,
        transcripts={t.question_index: t.text for t in transcripts},
        evaluations=tuple(
            QuestionEvaluation(
                question_code=str(item["question_code"]),
                ratings={str(k): int(v) for k, v in dict(item["ratings"]).items()},
                comment=str(item.get("comment") or ""),
            )
            for item in evaluation.ratings
        ),
    )
    return ReportView("READY", None, report, evaluation.created_at)


# ---------------------------------------------------------------------------
# 8. History and recordings (2026-09-29)
# ---------------------------------------------------------------------------
# The client asked that a candidate can go back through every interview they
# sat and hear themselves, and that platform staff can hear them too. A
# recording is personal data of the most direct kind -- a person's voice -- so
# it is only ever handed out as a short-lived presigned GET, never a public
# link, and staff reach it through the console's audited bypass read.


@dataclass(frozen=True, slots=True)
class Recording:
    question_index: int
    question_code: str
    prompt: str
    url: str
    expires_in_seconds: int
    mime: str | None
    duration_ms: int | None
    uploaded_at: datetime | None
    #: What the speech model heard, once it has been transcribed.
    transcript: str | None


@dataclass(frozen=True, slots=True)
class HistoryItem:
    session: InterviewSession
    questions_asked: int
    answers_stored: int
    #: NOT_COMPLETED while being recorded or abandoned; then PENDING, READY
    #: or FAILED as `get_report` would say.
    report_status: str


async def _recordings(
    session: AsyncSession, row: InterviewSession, *, settings: Settings
) -> list[Recording]:
    questions = (await _questions_of(session, row)).questions
    heard = {
        t.question_index: t.text
        for t in await repository.transcripts_for(session, session_id=row.id)
    }
    ttl = settings.presigned_url_ttl_seconds
    out: list[Recording] = []
    for answer in await repository.answers_for(session, session_id=row.id):
        if answer.upload_state != "STORED" or answer.s3_key is None:
            continue
        index = answer.question_index
        question = questions[index] if index < len(questions) else None
        out.append(
            Recording(
                question_index=answer.question_index,
                question_code=answer.question_code,
                prompt=question.prompt if question is not None else "",
                url=await storage.presign_get(
                    bucket=settings.s3_bucket_interview_audio, key=answer.s3_key, expires_in=ttl
                ),
                expires_in_seconds=ttl,
                mime=answer.mime,
                duration_ms=answer.duration_ms,
                uploaded_at=answer.uploaded_at,
                transcript=heard.get(answer.question_index),
            )
        )
    return out


async def recordings(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    settings: Settings | None = None,
) -> list[Recording]:
    """The candidate's own answers, to play back. Someone else's is a 404."""
    row = await repository.get_session(session, user_id=user_id, session_id=session_id)
    if row is None:
        raise InterviewSessionNotFoundError()
    return await _recordings(session, row, settings=settings or get_settings())


async def _history(session: AsyncSession, rows: list[InterviewSession]) -> list[HistoryItem]:
    items: list[HistoryItem] = []
    for row in rows:
        view = await _view(session, row)
        if row.state not in COMPLETED_STATES:
            status = "NOT_COMPLETED"
        else:
            evaluation = await repository.get_evaluation(session, session_id=row.id)
            status = (
                "PENDING"
                if evaluation is None
                else ("FAILED" if evaluation.outcome == "FAILED" else "READY")
            )
        items.append(
            HistoryItem(
                session=row,
                questions_asked=len(view.question_set.questions),
                answers_stored=sum(1 for a in view.answers.values() if a.upload_state == "STORED"),
                report_status=status,
            )
        )
    return items


async def history(session: AsyncSession, *, user_id: uuid.UUID) -> list[HistoryItem]:
    """Every session the candidate has started, newest first."""
    return await _history(session, await repository.list_sessions(session, user_id=user_id))


async def history_for_staff(session: AsyncSession, *, candidate_id: uuid.UUID) -> list[HistoryItem]:
    """**Staff only, on the console's bypass reader.** The admin service has
    already written the audit row naming this candidate."""
    return await _history(session, await repository.list_sessions(session, user_id=candidate_id))


async def recordings_for_staff(
    session: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    session_id: uuid.UUID,
    settings: Settings | None = None,
) -> list[Recording]:
    """**Staff only, on the console's bypass reader**, after its audit row.
    Scoped to the candidate the member of staff opened, so a session id from
    somewhere else is a 404 rather than someone else's voice."""
    row = await repository.get_session(session, user_id=candidate_id, session_id=session_id)
    if row is None:
        raise InterviewSessionNotFoundError()
    return await _recordings(session, row, settings=settings or get_settings())


# ---------------------------------------------------------------------------
# The catalogue
# ---------------------------------------------------------------------------
async def sync_catalogue(session: AsyncSession) -> int:
    """Write the session price from `subscriptions/catalogue.py`. Returns rows
    written. A changed price is a new version and the old one is deactivated,
    never edited, as for plans and the course."""
    entry = INTERVIEW_SESSION_PRODUCT
    latest = await repository.latest_product_version(session, code=entry.code)
    if latest is not None and latest.price_minor == entry.price_minor and latest.active:
        return 0
    if latest is not None:
        latest.active = False
    await repository.insert_product(
        session,
        code=entry.code,
        price_minor=entry.price_minor,
        active=True,
        version=latest.version + 1 if latest is not None else 1,
    )
    return 1
