"""applications - HTTP layer

Apply, stages, withdraw, expiry, hire confirm.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

Two surfaces, one module:

  * **`/candidate/applications`** -- the candidate's own. Applying is behind the
    subscription (R13); reading, withdrawing and answering a hire are not,
    because a lapsed subscriber loses access, not their data. Another
    candidate's application is a 404.
  * **`/employer/applications`** -- the organisation's pipeline (Day 12). Owners
    and recruiters move applications, book interviews and propose hires;
    viewers read. Another organisation's application is a 404. The employer
    subscription gate lands on these with the other employer routes on
    Day 15, when a subscription can be bought.
  * **`/employer/dashboard`** -- the same pipeline, counted, for the portal's
    landing page, and its recent activity across every job. Every role that
    reads the pipeline reads this; payment gates it like the pipeline.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.core.deps import (
    CANDIDATE,
    EMPLOYER_OWNER,
    EMPLOYER_RECRUITER,
    EMPLOYER_VIEWER,
    CurrentUser,
    DbSession,
    get_request_id,
    require_active_subscription,
    require_role,
)
from app.core.pagination import MAX_PAGE_SIZE, Page
from app.modules.applications import service
from app.modules.applications.domain import DEFAULT_TOP_JOBS, MAX_TOP_JOBS
from app.modules.applications.schemas import (
    ActivityItem,
    Actor,
    ApplicationDetailResponse,
    ApplicationResponse,
    ApplicationStage,
    ApplyRequest,
    CandidateMessageResponse,
    EmployerApplicationDetail,
    EmployerApplicationListItem,
    EmployerDashboard,
    EmployerMessageResponse,
    MoveStageRequest,
    ScheduleInterviewRequest,
    SendMessageRequest,
)

router = APIRouter()

#: The employer's pipeline, mounted at `/employer/applications` (see `__init__.py`).
employer_router = APIRouter()

#: The pipeline counted, mounted at `/employer/dashboard`.
dashboard_router = APIRouter()

CandidateOnly = Depends(require_role(CANDIDATE))
# The role guard first, so an employer is told 403 rather than asked to pay.
PayingCandidate = [CandidateOnly, Depends(require_active_subscription)]

Movers = Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER))
#: R15: working the pipeline needs an active subscription, after the role guard.
PayingEmployer = Depends(require_active_subscription)
Readers = Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER, EMPLOYER_VIEWER))


# ---------------------------------------------------------------------------
# The candidate's applications
# ---------------------------------------------------------------------------
@router.post(
    "",
    response_model=ApplicationResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=PayingCandidate,
    summary="Apply to a published job",
    responses={200: {"description": "Already applied; the existing application"}},
)
async def apply(
    payload: ApplyRequest, response: Response, user: CurrentUser, session: DbSession
) -> ApplicationResponse:
    """201 for a new application, 200 with the same one on a repeat.

    Refusals: 404 `job_not_found` (not on the board), 409 `score_pending`,
    409 `application_unavailable`, 403 `eligibility_below_threshold` -- the
    last one without any number, because the score is never explained.
    """
    application, created = await service.apply(session, ctx=user, job_id=payload.job_id)
    if not created:
        response.status_code = status.HTTP_200_OK
    return application


@router.get(
    "",
    response_model=Page[ApplicationResponse],
    dependencies=[CandidateOnly],
    summary="The candidate's applications, newest first",
)
async def list_mine(
    user: CurrentUser,
    session: DbSession,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[ApplicationResponse]:
    return await service.list_mine(session, ctx=user, cursor=cursor, limit=limit)


@router.get(
    "/{application_id}",
    response_model=ApplicationDetailResponse,
    dependencies=[CandidateOnly],
    summary="One of the candidate's applications, with its history",
)
async def get_mine(
    application_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ApplicationDetailResponse:
    return await service.get_mine(session, ctx=user, application_id=application_id)


@router.post(
    "/{application_id}/withdraw",
    response_model=ApplicationResponse,
    dependencies=[CandidateOnly],
    summary="Withdraw an application",
)
async def withdraw(
    application_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ApplicationResponse:
    """Any stage before the outcome. Repeating it returns the withdrawn
    application; 409 for one already hired, rejected or expired."""
    return await service.withdraw(session, ctx=user, application_id=application_id)


@router.post(
    "/{application_id}/hire/confirm",
    response_model=ApplicationResponse,
    dependencies=[CandidateOnly],
    summary="Confirm a hire the employer proposed",
)
async def confirm_hire(
    application_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ApplicationResponse:
    """Makes the hire final. Repeating it returns the hired application;
    409 `hire_confirmation_not_pending` when there is nothing to confirm."""
    return await service.confirm_hire(session, ctx=user, application_id=application_id)


@router.post(
    "/{application_id}/hire/dispute",
    response_model=ApplicationResponse,
    dependencies=[CandidateOnly],
    summary="Dispute a hire the employer proposed",
)
async def dispute_hire(
    application_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ApplicationResponse:
    return await service.dispute_hire(session, ctx=user, application_id=application_id)


# ---------------------------------------------------------------------------
# The employer's pipeline
# ---------------------------------------------------------------------------
@employer_router.get(
    "",
    response_model=Page[EmployerApplicationListItem],
    dependencies=[Readers, PayingEmployer],
    summary="The organisation's applications, oldest first, for one job or all of them",
)
async def list_applications(
    user: CurrentUser,
    session: DbSession,
    job_id: Annotated[uuid.UUID | None, Query()] = None,
    stage: Annotated[ApplicationStage | None, Query()] = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[EmployerApplicationListItem]:
    """Leave out `job_id` for every job's applications in one list -- the
    pipeline board fills from this one request. Each row carries `job_title`
    and `job_location`. Another organisation's `job_id` is `job_not_found`.

    Read-only: listing never records VIEWED. Opening one application
    (`GET /employer/applications/{id}`) does, so never open each row to draw
    a list."""
    return await service.list_for_employer(
        session, ctx=user, job_id=job_id, stage=stage, cursor=cursor, limit=limit
    )


@employer_router.get(
    "/{application_id}",
    response_model=EmployerApplicationDetail,
    dependencies=[Readers, PayingEmployer],
    summary="Open an application",
)
async def open_application(
    application_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> EmployerApplicationDetail:
    """Opening a SUBMITTED application moves it to VIEWED, once."""
    return await service.open_application(session, ctx=user, application_id=application_id)


@employer_router.post(
    "/{application_id}/stage",
    response_model=EmployerApplicationDetail,
    dependencies=[Movers, PayingEmployer],
    summary="Move an application to the next stage, or reject it",
)
async def move_stage(
    application_id: uuid.UUID, payload: MoveStageRequest, user: CurrentUser, session: DbSession
) -> EmployerApplicationDetail:
    """One stage forward, or REJECTED. 409 `application_invalid_transition`
    for anything else; moving to the current stage changes nothing."""
    return await service.move_stage(
        session, ctx=user, application_id=application_id, target=payload.stage, note=payload.note
    )


@employer_router.put(
    "/{application_id}/interview",
    response_model=EmployerApplicationDetail,
    dependencies=[Movers, PayingEmployer],
    summary="Book or rebook the interview",
)
async def schedule_interview(
    application_id: uuid.UUID,
    payload: ScheduleInterviewRequest,
    user: CurrentUser,
    session: DbSession,
) -> EmployerApplicationDetail:
    """At the INTERVIEW stage only (409 `interview_not_at_stage`). 422 for a
    link that is not an https meeting link or a time not in the next year."""
    return await service.schedule_interview(
        session,
        ctx=user,
        application_id=application_id,
        interview_at=payload.interview_at,
        meeting_url=payload.meeting_url,
    )


@employer_router.post(
    "/{application_id}/messages",
    response_model=EmployerMessageResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Movers, PayingEmployer],
    summary="Message the applicant: an interview or assessment invitation, or a note",
)
async def send_message(
    application_id: uuid.UUID,
    payload: SendMessageRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> EmployerMessageResponse:
    """Sent to the candidate by email and in the app; the employer never sees
    their address. 422 `message_invalid` with the reason as `code` (a time in
    the past, a link that is not https, a missing time or link); 409
    `message_not_allowed_at_stage` for a closed application; 429
    `message_limit_reached` after ten to one application in a day."""
    row = await service.send_message(
        session,
        ctx=user,
        application_id=application_id,
        kind=payload.kind,
        body=payload.body,
        scheduled_at=payload.scheduled_at,
        link=payload.link,
        request_id=get_request_id(request),
    )
    return EmployerMessageResponse.model_validate(row)


@employer_router.get(
    "/{application_id}/messages",
    response_model=list[EmployerMessageResponse],
    dependencies=[Readers, PayingEmployer],
    summary="Messages sent to this applicant, oldest first",
)
async def list_messages(
    application_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> list[EmployerMessageResponse]:
    rows = await service.messages_for_employer(session, ctx=user, application_id=application_id)
    return [EmployerMessageResponse.model_validate(r) for r in rows]


@employer_router.post(
    "/{application_id}/hire",
    response_model=EmployerApplicationDetail,
    dependencies=[Movers, PayingEmployer],
    summary="Mark as hired, pending the candidate's confirmation",
)
async def propose_hire(
    application_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> EmployerApplicationDetail:
    """At DECISION only (409 `hire_not_allowed`). Idempotent."""
    return await service.propose_hire(session, ctx=user, application_id=application_id)


# ---------------------------------------------------------------------------
# The employer dashboard
# ---------------------------------------------------------------------------
@dashboard_router.get(
    "",
    response_model=EmployerDashboard,
    dependencies=[Readers, PayingEmployer],
    summary="The organisation's jobs and pipeline, counted, for the portal's landing page",
)
async def employer_dashboard(
    user: CurrentUser,
    session: DbSession,
    top_jobs: Annotated[
        int,
        Query(ge=1, le=MAX_TOP_JOBS, description="How many of the busiest jobs to return"),
    ] = DEFAULT_TOP_JOBS,
) -> EmployerDashboard:
    """Live counts, one request. "Recent" is the last seven days throughout;
    days in `applications_per_day` are IST."""
    return await service.dashboard(session, ctx=user, top_jobs=top_jobs)


@dashboard_router.get(
    "/activity",
    response_model=Page[ActivityItem],
    dependencies=[Readers, PayingEmployer],
    summary="Recent pipeline activity across every job, newest first",
)
async def recent_activity(
    user: CurrentUser,
    session: DbSession,
    actor: Annotated[
        Actor | None,
        Query(description="Only what candidates, the team, or the system did"),
    ] = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[ActivityItem]:
    return await service.activity(session, ctx=user, actor=actor, cursor=cursor, limit=limit)


@router.get(
    "/{application_id}/messages",
    response_model=list[CandidateMessageResponse],
    dependencies=[CandidateOnly],
    summary="Messages the employer sent about this application, oldest first",
)
async def my_messages(
    application_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> list[CandidateMessageResponse]:
    """Not paywalled, like the application itself."""
    employer, rows = await service.messages_for_candidate(
        session, ctx=user, application_id=application_id
    )
    return [
        CandidateMessageResponse(
            id=r.id,
            kind=r.kind,
            body=r.body,
            scheduled_at=r.scheduled_at,
            link=r.link,
            employer_name=employer,
            created_at=r.created_at,
        )
        for r in rows
    ]
