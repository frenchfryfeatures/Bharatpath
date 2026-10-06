"""jobs - HTTP layer

Composer, validation, publish gate, lifecycle.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Roles.** Owners and recruiters compose, edit and move jobs; viewers read
them. Publishing needs approved KYB (invariant 8), enforced in the service and
by a database trigger. Every job belongs to the caller's organisation and
another organisation's job is a 404.

**Route order matters.** `/threshold-preview` is declared before `/{job_id}`,
or the literal path would be matched as a job id and answered with a 422.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import (
    CANDIDATE,
    EMPLOYER_OWNER,
    EMPLOYER_RECRUITER,
    EMPLOYER_VIEWER,
    CurrentUser,
    DbSession,
    require_active_subscription,
    require_role,
)
from app.core.pagination import MAX_PAGE_SIZE, Page
from app.modules.jobs import service
from app.modules.jobs.domain import THRESHOLD_STEP
from app.modules.jobs.schemas import (
    BoardJobDetail,
    BoardJobSummary,
    CreateJobRequest,
    JobListItem,
    JobResponse,
    JobStatus,
    ThresholdPreviewResponse,
    UpdateJobRequest,
    WorkMode,
)

router = APIRouter()

#: The candidate job board, mounted at `/candidate/jobs` (see `jobs/__init__.py`).
candidate_router = APIRouter()

Composers = Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER))
#: R15: an employer sees the portal without paying, and does nothing in it.
#: After the role guard, so the wrong role hears 403 rather than "pay us".
PayingEmployer = Depends(require_active_subscription)
Readers = Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER, EMPLOYER_VIEWER))


def _job(row: object) -> JobResponse:
    return JobResponse.model_validate(row)


@router.post(
    "",
    response_model=JobResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Composers, PayingEmployer],
    summary="Create a draft job",
)
async def create_job(
    payload: CreateJobRequest, user: CurrentUser, session: DbSession
) -> JobResponse:
    return _job(await service.create_job(session, ctx=user, payload=payload))


@router.get(
    "",
    response_model=Page[JobListItem],
    dependencies=[Readers, PayingEmployer],
    summary="The organisation's jobs, cursor-paginated, each with its pipeline counts",
)
async def list_jobs(
    user: CurrentUser,
    session: DbSession,
    status_filter: Annotated[
        list[JobStatus] | None,
        Query(alias="status", description="Repeat for several: `?status=DRAFT&status=PAUSED`"),
    ] = None,
    q: Annotated[
        str | None, Query(max_length=100, description="Part of the title or location")
    ] = None,
    work_mode: Annotated[WorkMode | None, Query()] = None,
    skill: Annotated[
        str | None, Query(max_length=80, description="One skill the job asks for, whole")
    ] = None,
    created_from: Annotated[
        date | None, Query(description="Created on or after this IST day")
    ] = None,
    created_to: Annotated[
        date | None, Query(description="Created on or before this IST day")
    ] = None,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[JobListItem]:
    """`application_counts` is where each job's applications stand now, so the
    list draws its funnel without a request per row.

    Filters combine (AND). A range that ends before it starts is 422
    `invalid_date_range`. A cursor belongs to the filters it was issued
    under; keep them the same while paging."""
    return await service.list_jobs(
        session,
        ctx=user,
        statuses=list(status_filter) if status_filter else None,
        query=q,
        work_mode=work_mode,
        skill=skill,
        created_from=created_from,
        created_to=created_to,
        cursor=cursor,
        limit=limit,
    )


@router.get(
    "/threshold-preview",
    response_model=ThresholdPreviewResponse,
    dependencies=[Composers, PayingEmployer],
    summary="Roughly how many visible candidates clear a score threshold",
)
async def threshold_preview(
    user: CurrentUser,
    session: DbSession,
    min_score: Annotated[int, Query(ge=700, le=990, multiple_of=THRESHOLD_STEP)],
) -> ThresholdPreviewResponse:
    """A coarse count only, in steps of ten, rate-limited per organisation. An
    exact count would let an employer binary-search one candidate's score."""
    return ThresholdPreviewResponse(
        **await service.threshold_preview(session, ctx=user, min_score=min_score)
    )


@router.get(
    "/{job_id}",
    response_model=JobResponse,
    dependencies=[Readers, PayingEmployer],
    summary="One job",
)
async def get_job(job_id: uuid.UUID, user: CurrentUser, session: DbSession) -> JobResponse:
    return _job(await service.get_job(session, ctx=user, job_id=job_id))


@router.patch(
    "/{job_id}",
    response_model=JobResponse,
    dependencies=[Composers, PayingEmployer],
    summary="Edit a draft or paused job",
)
async def update_job(
    job_id: uuid.UUID, payload: UpdateJobRequest, user: CurrentUser, session: DbSession
) -> JobResponse:
    """409 for a published or closed job. A live job is paused before it
    changes, so nobody applies on terms that are then altered."""
    return _job(await service.update_job(session, ctx=user, job_id=job_id, payload=payload))


@router.post(
    "/{job_id}/publish",
    response_model=JobResponse,
    dependencies=[Composers, PayingEmployer],
    summary="Put a job on the board (requires approved KYB)",
)
async def publish_job(job_id: uuid.UUID, user: CurrentUser, session: DbSession) -> JobResponse:
    """403 `kyb_required` until the organisation is verified. Invariant 8."""
    return _job(await service.publish_job(session, ctx=user, job_id=job_id))


@router.post(
    "/{job_id}/pause",
    response_model=JobResponse,
    dependencies=[Composers, PayingEmployer],
    summary="Take a published job off the board",
)
async def pause_job(job_id: uuid.UUID, user: CurrentUser, session: DbSession) -> JobResponse:
    return _job(await service.pause_job(session, ctx=user, job_id=job_id))


@router.post(
    "/{job_id}/close",
    response_model=JobResponse,
    dependencies=[Composers, PayingEmployer],
    summary="Close a job for good",
)
async def close_job(job_id: uuid.UUID, user: CurrentUser, session: DbSession) -> JobResponse:
    return _job(await service.close_job(session, ctx=user, job_id=job_id))


# ---------------------------------------------------------------------------
# The candidate board
# ---------------------------------------------------------------------------
# Pay-first (R13): the role guard runs first, so an employer is told 403
# rather than asked to pay for a surface they cannot use.
PayingCandidate = [Depends(require_role(CANDIDATE)), Depends(require_active_subscription)]


@candidate_router.get(
    "",
    response_model=Page[BoardJobSummary],
    dependencies=PayingCandidate,
    summary="Search published jobs",
)
async def search_board(
    user: CurrentUser,
    session: DbSession,
    q: Annotated[
        str | None, Query(max_length=100, description="Words in the title or description")
    ] = None,
    location: Annotated[str | None, Query(max_length=100)] = None,
    work_mode: WorkMode | None = None,
    skill: Annotated[str | None, Query(max_length=80)] = None,
    min_salary_minor: Annotated[int | None, Query(ge=0, description="Paise")] = None,
    eligible_only: bool = False,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[BoardJobSummary]:
    """Every employer's published jobs, newest first.

    Each carries `eligibility` against the candidate's **stored** score -- no
    request parameter can stand in for it. The threshold itself is never
    shown: beside the candidate's own score it would tell them the gap, and
    the score is never explained.
    """
    return await service.search_board(
        session,
        ctx=user,
        query=q,
        location=location,
        work_mode=work_mode,
        skill=skill,
        min_salary_minor=min_salary_minor,
        eligible_only=eligible_only,
        cursor=cursor,
        limit=limit,
    )


@candidate_router.get(
    "/{job_id}",
    response_model=BoardJobDetail,
    dependencies=PayingCandidate,
    summary="One published job",
)
async def get_board_job(job_id: uuid.UUID, user: CurrentUser, session: DbSession) -> BoardJobDetail:
    """404 for anything not on the board -- a draft, a paused or closed job, or
    no job at all look the same."""
    return await service.get_board_job(session, ctx=user, job_id=job_id)
