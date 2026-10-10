"""applications - HTTP layer

Apply, stages, withdraw, expiry, hire confirm.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

Two surfaces, one module:

  * **`/candidate/applications`** -- the candidate's own. Applying is behind the
    subscription (R13); reading, withdrawing and answering a hire are not,
    because a lapsed subscriber loses access, not their data. Another
    candidate's application is a 404.
  * **`/employer/applications`** -- the organisation's pipeline. Owners
    and recruiters move applications, book interviews and propose hires;
    viewers read. Another organisation's application is a 404. Every route
    needs a live employer subscription (R15).
  * **`/employer/dashboard`** -- the same pipeline, counted, for the portal's
    landing page, and its recent activity across every job. Every role that
    reads the pipeline reads this; payment gates it like the pipeline.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal

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
    ApplicationStatus,
    ApplyRequest,
    CandidateMessageResponse,
    EmployerApplicationDetail,
    EmployerApplicationListItem,
    EmployerDashboard,
    EmployerMessageResponse,
    InvitationStatus,
    MoveStageRequest,
    ScheduleInterviewRequest,
    SendMessageRequest,
    ShortlistEntry,
    ShortlistInvitation,
    ShortlistRequest,
    ShortlistStatus,
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
    status: Annotated[
        ApplicationStatus | None,
        Query(
            description="ACTIVE: still in the pipeline (SUBMITTED to DECISION). "
            "CLOSED: hired, rejected, withdrawn or expired. Leave out for both."
        ),
    ] = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[ApplicationResponse]:
    """A cursor belongs to the filter it was issued under; keep `status` the
    same while paging."""
    return await service.list_mine(session, ctx=user, cursor=cursor, limit=limit, status=status)


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
    summary="The organisation's applications, filtered, for one job or all of them",
)
async def list_applications(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    job_id: Annotated[uuid.UUID | None, Query()] = None,
    stage: Annotated[
        list[ApplicationStage] | None,
        Query(description="Repeat for several: `?stage=VIEWED&stage=SHORTLISTED`"),
    ] = None,
    status_: Annotated[
        ApplicationStatus | None,
        Query(
            alias="status",
            description="ACTIVE: still in the pipeline (SUBMITTED to DECISION). "
            "CLOSED: hired, rejected, withdrawn or expired.",
        ),
    ] = None,
    q: Annotated[
        str | None, Query(max_length=100, description="Part of the applicant's name")
    ] = None,
    applied_from: Annotated[
        date | None, Query(description="Applied on or after this IST day")
    ] = None,
    applied_to: Annotated[
        date | None, Query(description="Applied on or before this IST day")
    ] = None,
    order: Annotated[
        Literal["oldest", "newest"], Query(description="By when they applied")
    ] = "oldest",
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[EmployerApplicationListItem]:
    """Leave out `job_id` for every job's applications in one list -- the
    pipeline board fills from this one request. Each row carries `job_title`
    and `job_location`. Another organisation's `job_id` is `job_not_found`.

    Filters combine (AND). `q` matches the applicant's profile name and never
    finds one an integrity review is hiding. A range that ends before it
    starts is 422 `invalid_date_range`. A cursor belongs to the filters and
    `order` it was issued under; keep them the same while paging.

    Each row's `candidate` names who applied (name, band, experience,
    skills, city), or is null while an integrity review hides them. No
    contact and no score: those are on the opened application. Each page
    that names anyone is one audit row.

    Read-only: listing never records VIEWED. Opening one application
    (`GET /employer/applications/{id}`) does, so never open each row to draw
    a list."""
    return await service.list_for_employer(
        session,
        ctx=user,
        job_id=job_id,
        stages=list(stage) if stage else None,
        status=status_,
        name=q,
        applied_from=applied_from,
        applied_to=applied_to,
        newest_first=order == "newest",
        cursor=cursor,
        limit=limit,
        request_id=get_request_id(request),
    )


@employer_router.get(
    "/{application_id}",
    response_model=EmployerApplicationDetail,
    dependencies=[Readers, PayingEmployer],
    summary="Open an application",
)
async def open_application(
    application_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> EmployerApplicationDetail:
    """Opening a SUBMITTED application moves it to VIEWED, once.

    `candidate` is the applicant in full -- name, phone, email, display
    score, band, experience, skills, badges, city and the CV their score was
    built from (`resume`: text, sections and a presigned link to the file).
    Every response carrying it is audited, this one and the moves below.
    Null while an integrity review hides the candidate from employers."""
    return await service.open_application(
        session, ctx=user, application_id=application_id, request_id=get_request_id(request)
    )


@employer_router.post(
    "/{application_id}/stage",
    response_model=EmployerApplicationDetail,
    dependencies=[Movers, PayingEmployer],
    summary="Move an application to the next stage, or reject it",
)
async def move_stage(
    application_id: uuid.UUID,
    payload: MoveStageRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> EmployerApplicationDetail:
    """One stage forward, or REJECTED. 409 `application_invalid_transition`
    for anything else; moving to the current stage changes nothing."""
    return await service.move_stage(
        session,
        ctx=user,
        application_id=application_id,
        target=payload.stage,
        note=payload.note,
        request_id=get_request_id(request),
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
    request: Request,
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
        request_id=get_request_id(request),
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
    application_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> EmployerApplicationDetail:
    """At DECISION only (409 `hire_not_allowed`). Idempotent."""
    return await service.propose_hire(
        session, ctx=user, application_id=application_id, request_id=get_request_id(request)
    )


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
    application, rows = await service.messages_for_candidate(
        session, ctx=user, application_id=application_id
    )
    return [
        CandidateMessageResponse(
            id=r.id,
            kind=r.kind,
            body=r.body,
            scheduled_at=r.scheduled_at,
            link=r.link,
            employer_name=application.employer_name,
            employer_logo_url=application.employer_logo_url,
            created_at=r.created_at,
        )
        for r in rows
    ]


# ---------------------------------------------------------------------------
# The shortlist (2026-10-05)
# ---------------------------------------------------------------------------
#: Mounted at `/employer/shortlist`.
shortlist_router = APIRouter()

#: Mounted at `/candidate/shortlist-invitations`.
invitations_router = APIRouter()


@shortlist_router.post(
    "",
    response_model=ShortlistEntry,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Movers, PayingEmployer],
    summary="Shortlist a candidate you have opened: save them, or invite them to a job",
    responses={200: {"description": "Already saved or invited; the existing entry"}},
)
async def shortlist_candidate(
    payload: ShortlistRequest,
    request: Request,
    response: Response,
    user: CurrentUser,
    session: DbSession,
) -> ShortlistEntry:
    """The Shortlist button on an opened profile
    (`GET /employer/discovery/candidates/{id}`, whose `shortlist` says what
    the button should show).

    * **With `job_id`**: an invitation. The candidate is emailed and told in
      the app; on accepting, the application is filed and lands in your
      pipeline at **SHORTLISTED** -- the Submitted and Viewed steps recorded
      for you. They may decline; that answer stands for this job.
    * **Without**: saved privately for later. The candidate is not told.

    201 for a new entry, 200 for a repeat. Refusals: 404
    `candidate_not_found` (not visible, or never opened by your
    organisation), 404 `job_not_found`, 409 `shortlist_job_not_open` (not
    PUBLISHED), 409 `already_applied` (`params.application_id`), 409
    `already_hired` (`params.application_id`), 409 `shortlist_declined` /
    `shortlist_already_accepted`, 403 `kyb_required`, 429 `rate_limited`
    (60 invitations an hour per organisation).
    """
    entry, created = await service.shortlist_candidate(
        session,
        ctx=user,
        candidate_id=payload.candidate_id,
        job_id=payload.job_id,
        request_id=get_request_id(request),
    )
    if not created:
        response.status_code = status.HTTP_200_OK
    return entry


@shortlist_router.get(
    "",
    response_model=Page[ShortlistEntry],
    dependencies=[Readers, PayingEmployer],
    summary="Your organisation's shortlist, newest first",
)
async def list_shortlist(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    job_id: Annotated[uuid.UUID | None, Query(description="Invitations to one job")] = None,
    status_: Annotated[
        ShortlistStatus | None, Query(alias="status", description="One state only")
    ] = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[ShortlistEntry]:
    """Each row names who it is (`candidate`: name, band, experience, skills,
    city -- no contact, no score) and the job. A page that names anyone is one
    audit row. `candidate` is null while an integrity review hides them."""
    return await service.list_shortlist(
        session,
        ctx=user,
        job_id=job_id,
        status=status_,
        cursor=cursor,
        limit=limit,
        request_id=get_request_id(request),
    )


@shortlist_router.post(
    "/{shortlist_id}/cancel",
    response_model=ShortlistEntry,
    dependencies=[Movers, PayingEmployer],
    summary="Withdraw an invitation the candidate has not answered",
)
async def cancel_invitation(
    shortlist_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ShortlistEntry:
    """Repeating it returns the cancelled entry. 409 `shortlist_not_pending`
    once the candidate has answered. You may invite them again later."""
    return await service.cancel_invitation(session, ctx=user, shortlist_id=shortlist_id)


@shortlist_router.delete(
    "/{shortlist_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Movers, PayingEmployer],
    summary="Remove a saved candidate",
)
async def remove_saved(shortlist_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    """SAVED entries only; an invitation is cancelled instead (409
    `shortlist_not_pending`)."""
    await service.remove_saved(session, ctx=user, shortlist_id=shortlist_id)


@invitations_router.get(
    "",
    response_model=Page[ShortlistInvitation],
    dependencies=[CandidateOnly],
    summary="Employers who shortlisted you for a job, newest first",
)
async def my_invitations(
    user: CurrentUser,
    session: DbSession,
    status_: Annotated[
        InvitationStatus | None, Query(alias="status", description="One state only")
    ] = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[ShortlistInvitation]:
    """Not paywalled. `job_title` is null once a job has left the board."""
    return await service.my_invitations(
        session, ctx=user, status=status_, cursor=cursor, limit=limit
    )


@invitations_router.post(
    "/{shortlist_id}/accept",
    response_model=ShortlistInvitation,
    dependencies=[CandidateOnly],
    summary="Accept: your application is filed, already shortlisted",
)
async def accept_invitation(
    shortlist_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ShortlistInvitation:
    """`application_id` is the new application, at SHORTLISTED on your board.
    No subscription needed and no minimum score: the employer chose you.
    Repeating it returns the accepted invitation. 409
    `shortlist_not_pending` (cancelled or declined), 409
    `shortlist_job_not_open`, 409 `application_unavailable`."""
    return await service.accept_invitation(session, ctx=user, shortlist_id=shortlist_id)


@invitations_router.post(
    "/{shortlist_id}/decline",
    response_model=ShortlistInvitation,
    dependencies=[CandidateOnly],
    summary="Decline: the employer cannot invite you to this job again",
)
async def decline_invitation(
    shortlist_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ShortlistInvitation:
    return await service.decline_invitation(session, ctx=user, shortlist_id=shortlist_id)
