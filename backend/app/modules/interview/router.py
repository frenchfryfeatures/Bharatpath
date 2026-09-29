"""interview - HTTP layer

Audio sessions, chunk upload, evaluation, +20/session.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

Pay-first (R13): the mock interview is a candidate tool, so every route needs
an active subscription behind the role check -- and a session also needs its
own purchase. Checkout is here, beside what it sells, as the course checkout
is; billing opens the payment and grants nothing until a verified callback.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Path, Request, status

from app.core.deps import (
    CANDIDATE,
    CurrentUser,
    DbSession,
    get_request_id,
    require_active_subscription,
    require_role,
)
from app.modules.billing import service as billing_service
from app.modules.billing.schemas import CheckoutResponse
from app.modules.interview import service
from app.modules.interview.bank import ANSWER_SECONDS, PREPARATION_SECONDS, QUESTIONS_PER_SESSION
from app.modules.interview.domain import DeviceReadings
from app.modules.interview.schemas import (
    AnswerResponse,
    AnswerSchema,
    AnswerUploadResponse,
    CompleteAnswerRequest,
    DeviceCheckRequest,
    DeviceCheckResponse,
    DimensionFeedbackSchema,
    InterviewCheckoutRequest,
    InterviewReportResponse,
    OfferResponse,
    QuestionFeedbackSchema,
    QuestionSchema,
    RecordingSchema,
    SessionHistoryItem,
    SessionResponse,
    SessionSummary,
)

router = APIRouter()

PayingCandidate = [Depends(require_role(CANDIDATE)), Depends(require_active_subscription)]

QuestionIndex = Path(ge=0, lt=QUESTIONS_PER_SESSION)


def _session_response(view: service.SessionView) -> SessionResponse:
    row = view.session
    return SessionResponse(
        id=row.id,
        session_number=row.session_number,
        state=row.state,
        question_set_code=row.question_set_code,
        question_set_title=view.question_set.title,
        question_set_version=row.question_set_version,
        created_at=row.created_at,
        started_at=row.started_at,
        completed_at=row.completed_at,
        questions_total=QUESTIONS_PER_SESSION,
        questions=[
            QuestionSchema(
                index=i,
                code=q.code,
                key=q.key or None,
                prompt=q.prompt,
                preparation_seconds=PREPARATION_SECONDS,
                answer_seconds=ANSWER_SECONDS,
                looking_for=(
                    q.looking_for
                    if i in view.answers and view.answers[i].upload_state == "STORED"
                    else None
                ),
            )
            for i, q in enumerate(view.question_set.questions)
        ],
        answers=[
            AnswerSchema(
                question_index=i,
                upload_state=view.answers[i].upload_state if i in view.answers else "PENDING",
                duration_ms=view.answers[i].duration_ms if i in view.answers else None,
                uploaded_at=view.answers[i].uploaded_at if i in view.answers else None,
            )
            for i in range(QUESTIONS_PER_SESSION)
        ],
    )


@router.get(
    "/offer",
    response_model=OfferResponse,
    dependencies=PayingCandidate,
    summary="Price, the device check, and whether a session would increase the score",
)
async def get_offer(user: CurrentUser, session: DbSession) -> OfferResponse:
    offer = await service.offer(session, user_id=user.user_id)
    return OfferResponse(
        on_sale=offer.product is not None,
        price_minor=offer.product.price_minor if offer.product is not None else None,
        will_increase_score=offer.will_increase_score,
        requires_acknowledgement=not offer.will_increase_score,
        device_check_passed=offer.device_check is not None,
        device_check_valid_until=(
            service.check_valid_until(offer.device_check)
            if offer.device_check is not None
            else None
        ),
        sessions_available=offer.sessions_available,
        open_session_id=offer.open_session_id,
    )


@router.post(
    "/device-checks",
    response_model=DeviceCheckResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=PayingCandidate,
    summary="Record a device check (before payment)",
)
async def create_device_check(
    payload: DeviceCheckRequest, user: CurrentUser, session: DbSession
) -> DeviceCheckResponse:
    """Microphone, audio output, network, storage, quiet environment. No camera
    and no lighting. 201 whether it passed or not: a failed check is recorded."""
    row = await service.record_device_check(
        session,
        user_id=user.user_id,
        readings=DeviceReadings(
            mic_ok=payload.mic_ok,
            audio_out_ok=payload.audio_out_ok,
            network_kbps=payload.network_kbps,
            storage_mb=payload.storage_mb,
            quiet_env_ok=payload.quiet_env_ok,
        ),
    )
    return DeviceCheckResponse(
        id=row.id,
        passed=row.passed,
        failures=list(row.failures),
        rule_version=row.rule_version,
        checked_at=row.checked_at,
        valid_until=service.check_valid_until(row) if row.passed else None,
    )


@router.post(
    "/checkout",
    response_model=CheckoutResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=PayingCandidate,
    summary="Buy a mock interview session",
)
async def checkout_session(
    payload: InterviewCheckoutRequest, user: CurrentUser, session: DbSession
) -> CheckoutResponse:
    """Refused before any payment exists without a passed device check (409
    `interview_device_check_required`), or, when the session cannot move the
    score, without the acknowledgement (409
    `interview_no_score_increase_unacknowledged`). Nothing is granted here."""
    payment = await billing_service.checkout_interview_session(
        session,
        user_id=user.user_id,
        acknowledge_no_score_increase=payload.acknowledge_no_score_increase,
    )
    return CheckoutResponse.of(payment)


@router.post(
    "/sessions",
    response_model=SessionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=PayingCandidate,
    summary="Start a session, or resume the one in progress",
)
async def start_session(user: CurrentUser, session: DbSession) -> SessionResponse:
    started = await service.start_session(session, user_id=user.user_id)
    return _session_response(started.view)


@router.get(
    "/sessions",
    response_model=list[SessionSummary],
    dependencies=PayingCandidate,
    summary="The candidate's sessions, newest first",
)
async def list_sessions(user: CurrentUser, session: DbSession) -> list[SessionSummary]:
    rows = await service.list_sessions(session, user_id=user.user_id)
    return [SessionSummary.model_validate(row) for row in rows]


@router.get(
    "/history",
    response_model=list[SessionHistoryItem],
    dependencies=PayingCandidate,
    summary="Every session the candidate has sat, newest first, for the history screen",
)
async def get_history(user: CurrentUser, session: DbSession) -> list[SessionHistoryItem]:
    items = await service.history(session, user_id=user.user_id)
    return [
        SessionHistoryItem(
            id=item.session.id,
            session_number=item.session.session_number,
            state=item.session.state,
            question_set_code=item.session.question_set_code,
            created_at=item.session.created_at,
            completed_at=item.session.completed_at,
            question_set_title=service.question_set_title(item.session.question_set_code),
            questions_asked=item.questions_asked,
            answers_stored=item.answers_stored,
            report_status=item.report_status,
        )
        for item in items
    ]


@router.get(
    "/sessions/{session_id}",
    response_model=SessionResponse,
    dependencies=PayingCandidate,
    summary="One session and its answer manifest",
)
async def get_session(
    session_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> SessionResponse:
    view = await service.get_session(session, user_id=user.user_id, session_id=session_id)
    return _session_response(view)


@router.post(
    "/sessions/{session_id}/next-question",
    response_model=SessionResponse,
    dependencies=PayingCandidate,
    summary="Write the next question, once the previous answer is stored",
)
async def next_question(
    session_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> SessionResponse:
    """For a session whose questions are written for the candidate
    (`question_set_code` ADAPTIVE): hears the answers so far and writes the
    next question, which is the last entry of `questions`. Takes a few seconds;
    show the candidate that the interviewer is thinking. Called before the
    latest question's answer is stored it returns the session unchanged, so a
    retry gets the same question. 409 `interview_previous_answer_not_stored`
    only if an earlier answer is missing. A bank session already holds every
    question and is returned unchanged."""
    view = await service.next_question(session, user_id=user.user_id, session_id=session_id)
    return _session_response(view)


@router.get(
    "/sessions/{session_id}/recordings",
    response_model=list[RecordingSchema],
    dependencies=PayingCandidate,
    summary="Play back the candidate's own answers",
)
async def get_recordings(
    session_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> list[RecordingSchema]:
    """One presigned GET per stored answer, expiring in `expires_in_seconds`.
    Ask again for fresh links rather than storing them."""
    rows = await service.recordings(session, user_id=user.user_id, session_id=session_id)
    return [RecordingSchema.model_validate(r, from_attributes=True) for r in rows]


@router.post(
    "/sessions/{session_id}/answers/{question_index}/upload",
    response_model=AnswerUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=PayingCandidate,
    summary="Get a presigned URL to upload one answer",
)
async def upload_answer(
    session_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    question_index: int = QuestionIndex,
) -> AnswerUploadResponse:
    ticket = await service.issue_answer_upload(
        session, user_id=user.user_id, session_id=session_id, question_index=question_index
    )
    return AnswerUploadResponse(
        url=ticket.url,
        expires_in_seconds=ticket.expires_in_seconds,
        max_bytes=ticket.max_bytes,
        max_duration_ms=ticket.max_duration_ms,
        accepted_types=list(ticket.accepted_types),
    )


@router.post(
    "/sessions/{session_id}/answers/{question_index}/complete",
    response_model=AnswerResponse,
    dependencies=PayingCandidate,
    summary="Validate an uploaded answer and store it",
)
async def complete_answer(
    session_id: uuid.UUID,
    payload: CompleteAnswerRequest,
    user: CurrentUser,
    session: DbSession,
    question_index: int = QuestionIndex,
) -> AnswerResponse:
    answer = await service.complete_answer(
        session,
        user_id=user.user_id,
        session_id=session_id,
        question_index=question_index,
        duration_ms=payload.duration_ms,
    )
    view = await service.get_session(session, user_id=user.user_id, session_id=session_id)
    return AnswerResponse(
        question_index=answer.question_index,
        upload_state=answer.upload_state,
        duration_ms=answer.duration_ms,
        uploaded_at=answer.uploaded_at,
        looking_for=view.question_set.questions[answer.question_index].looking_for,
    )


@router.post(
    "/sessions/{session_id}/complete",
    response_model=SessionResponse,
    dependencies=PayingCandidate,
    summary="Finish a session once every answer is stored",
)
async def complete_session(
    session_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> SessionResponse:
    completed = await service.complete_session(
        session,
        user_id=user.user_id,
        session_id=session_id,
        request_id=get_request_id(request),
    )
    return _session_response(completed.view)


@router.get(
    "/sessions/{session_id}/report",
    response_model=InterviewReportResponse,
    dependencies=PayingCandidate,
    summary="Feedback on a completed session",
)
async def get_report(
    session_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> InterviewReportResponse:
    """409 while the session is still being recorded. `PENDING` until the
    evaluation has run -- poll. Levels are words, never numbers."""
    view = await service.get_report(session, user_id=user.user_id, session_id=session_id)
    report = view.report
    if report is None:
        return InterviewReportResponse(
            session_id=session_id,
            status=view.status,
            failure_reason=view.failure_reason,
            evaluated_at=view.evaluated_at,
        )
    return InterviewReportResponse(
        session_id=session_id,
        status="READY",
        evaluated_at=view.evaluated_at,
        report_version=report.report_version,
        dimensions=[
            DimensionFeedbackSchema(
                code=d.code,
                key=d.key,
                label=d.label,
                level=d.level,
                what_good_looks_like=d.what_good_looks_like,
            )
            for d in report.dimensions
        ],
        strengths=list(report.strengths),
        focus_areas=list(report.focus_areas),
        questions=[
            QuestionFeedbackSchema(
                index=q.index,
                code=q.code,
                prompt=q.prompt,
                looking_for=q.looking_for,
                transcript=q.transcript,
                spoken=q.spoken,
                comment=q.comment,
            )
            for q in report.questions
        ],
    )
