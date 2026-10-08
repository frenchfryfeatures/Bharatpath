"""jobs - business rules and transaction boundaries

Composer, validation, publish gate, lifecycle.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**Invariant 8 -- no job is published before KYB approval -- is held twice.**
Here, where the error can say what to do about it, and in the database trigger,
where nothing can route around it. The service check is for the message; the
trigger is for the guarantee. If the two ever disagree the trigger wins, and
its error is translated into the same `kyb_required` a client already handles.

**The subscription gate is the router's, not this file's.** Employers get the
portal on signup and can do nothing in it until they pay (R15); every employer
route here carries `require_active_subscription`, a second, independent gate
with its own error code.

**The candidate board** is the second half of this file. It reads
every employer's published jobs, which no tenant binding can express, so it
binds the candidate's own identity instead; see `set_transaction_user` and the
candidate policies in the baseline migration.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any, Final

from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import set_transaction_tenant, set_transaction_user
from app.core.errors import (
    ConflictError,
    KybRequiredError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.core.logging import get_logger
from app.core.outbox import emit
from app.core.pagination import (
    Page,
    clamp_limit,
    decode_cursor,
    encode_cursor,
    ist_day_range,
)
from app.core.ratelimit import STATIC_POLICIES, hit
from app.core.tenant import TenantContext
from app.modules.discovery import service as discovery_service
from app.modules.employer import service as employer_service
from app.modules.jobs import repository
from app.modules.jobs.details import check_against_columns, for_candidate, parse_stored
from app.modules.jobs.domain import coarse_count, eligibility, is_editable, refuse_transition
from app.modules.jobs.events import MODULE
from app.modules.jobs.schemas import (
    ApplicationStageCounts,
    BoardJobDetail,
    BoardJobSummary,
    CreateJobRequest,
    JobListItem,
    JobResponse,
    UpdateJobRequest,
)
from app.modules.scoring import service as scoring_service

logger = get_logger(__name__)

#: Threshold previews per organisation per hour. Enough for someone composing
#: several jobs and trying thresholds; far too few to binary-search a score.
#: The number lives in `app.core.ratelimit.STATIC_POLICIES`, beside
#: every other limit, so it can be held as one of the two tightest.
THRESHOLD_PREVIEWS_PER_HOUR: Final = STATIC_POLICIES["jobs.threshold_preview"].limit


class JobNotFoundError(NotFoundError):
    code = "job_not_found"
    title = "Job not found"


class JobTransitionError(ConflictError):
    code = "job_invalid_transition"
    title = "That change is not allowed for this job"


class JobNotEditableError(ConflictError):
    """A live or closed job. Pause it first, which takes it off the board
    while it changes."""

    code = "job_not_editable"
    title = "Pause the job before editing it"


class SalaryRangeError(ValidationError):
    code = "job_salary_range_invalid"
    title = "Salary maximum is below the minimum"


class JobDetailsError(ValidationError):
    code = "job_details_invalid"
    title = "The job's details do not agree with its requirements"


async def _bind(session: AsyncSession, ctx: TenantContext) -> uuid.UUID:
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, ctx.tenant_id)
    return ctx.tenant_id


async def _load(session: AsyncSession, ctx: TenantContext, job_id: uuid.UUID) -> Any:
    tenant_id = await _bind(session, ctx)
    job = await repository.get_job(session, tenant_id=tenant_id, job_id=job_id)
    if job is None:
        # Another organisation's job reads as absent: 404, never 403.
        raise JobNotFoundError()
    return job


async def create_job(
    session: AsyncSession, *, ctx: TenantContext, payload: CreateJobRequest
) -> Any:
    """A draft. Creating one needs no verification; publishing it does."""
    tenant_id = await _bind(session, ctx)
    fields = payload.model_dump()
    # Stored as JSON, so dates become ISO strings and the document reads back
    # through `JobDetails` exactly as it was validated.
    fields["details"] = payload.details.model_dump(mode="json")
    job = await repository.create_job(session, tenant_id=tenant_id, fields=fields)
    await emit(
        session,
        event_type=f"{MODULE}.job_created",
        aggregate_type="job",
        aggregate_id=job.id,
        payload={"tenant_id": str(tenant_id)},
    )
    return job


def _employer_job_cursor_of(job: Any) -> str:
    return encode_cursor({"c": job.created_at.isoformat(), "i": str(job.id)})


def _employer_jobs_after(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    payload = decode_cursor(cursor)
    try:
        return datetime.fromisoformat(str(payload["c"])), uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError) as exc:
        raise ValidationError(code="invalid_cursor") from exc


async def list_jobs(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    statuses: list[str] | None,
    query: str | None = None,
    work_mode: str | None = None,
    skill: str | None = None,
    created_from: date | None = None,
    created_to: date | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> Page[JobListItem]:
    """The organisation's jobs, newest first, each with its pipeline counts.
    Filters combine (AND); the dates are IST days, both ends inclusive.

    The counts are a second aggregate over the page, not a query per job. An
    employer's list is the screen every other employer screen is reached
    from, and it is the one place where reading the pipeline per row would
    turn one request into one per job.
    """
    tenant_id = await _bind(session, ctx)
    start, end = ist_day_range(created_from, created_to)
    page_size = clamp_limit(limit)
    rows = await repository.list_jobs(
        session,
        tenant_id=tenant_id,
        statuses=statuses,
        query=query.strip() or None if query is not None else None,
        work_mode=work_mode,
        skill=skill.strip() or None if skill is not None else None,
        created_from=start,
        created_before=end,
        after=_employer_jobs_after(cursor),
        limit=page_size + 1,
    )
    jobs, more = rows[:page_size], len(rows) > page_size
    counts = await repository.stage_counts(
        session, tenant_id=tenant_id, job_ids=[job.id for job in jobs]
    )
    return Page[JobListItem](
        items=[
            JobListItem(
                **JobResponse.model_validate(job).model_dump(),
                application_counts=ApplicationStageCounts(
                    total=sum(counts[job.id].values()), by_stage=counts[job.id]
                ),
            )
            for job in jobs
        ],
        next_cursor=_employer_job_cursor_of(jobs[-1]) if more and jobs else None,
    )


async def get_job(session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID) -> Any:
    return await _load(session, ctx, job_id)


async def status_counts(session: AsyncSession, *, ctx: TenantContext) -> dict[str, int]:
    """The organisation's jobs counted by state, for the employer dashboard."""
    tenant_id = await _bind(session, ctx)
    return await repository.status_counts(session, tenant_id=tenant_id)


async def titles(
    session: AsyncSession, *, ctx: TenantContext, job_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str]]:
    """`job id -> (title, status)` for the organisation's own jobs among `job_ids`."""
    tenant_id = await _bind(session, ctx)
    return await repository.titles(session, tenant_id=tenant_id, job_ids=job_ids)


async def labels(
    session: AsyncSession, *, ctx: TenantContext, job_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str | None]]:
    """`job id -> (title, location)` for the organisation's own jobs among
    `job_ids`, for the pipeline list's cards."""
    tenant_id = await _bind(session, ctx)
    return await repository.labels(session, tenant_id=tenant_id, job_ids=job_ids)


async def update_job(
    session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID, payload: UpdateJobRequest
) -> Any:
    job = await _load(session, ctx, job_id)
    if not is_editable(job.status):
        raise JobNotEditableError(params={"status": job.status})

    changes = payload.model_dump(exclude_unset=True)
    low = changes.get("salary_min_minor", job.salary_min_minor)
    high = changes.get("salary_max_minor", job.salary_max_minor)
    if high < low:
        # Checked against the merged values: an edit that sends only a new
        # minimum can still invert a range the database would then refuse.
        raise SalaryRangeError(params={"salary_min_minor": low, "salary_max_minor": high})

    if payload.details is not None:
        changes["details"] = payload.details.model_dump(mode="json")
    # The document and the columns beside it are checked together on the
    # merged values: an edit may change the required skills without resending
    # the details that name one of them as primary.
    problem = check_against_columns(
        parse_stored(changes.get("details", job.details)),
        skills=changes.get("skills", job.skills),
        experience_min_months=changes.get("experience_min_months", job.experience_min_months),
    )
    if problem:
        raise JobDetailsError(params={"reason": problem})

    return await repository.apply_changes(session, job=job, changes=changes)


async def _move(session: AsyncSession, ctx: TenantContext, job_id: uuid.UUID, target: str) -> Any:
    job = await _load(session, ctx, job_id)
    if refuse_transition(job.status, target) is not None:
        raise JobTransitionError(params={"from": job.status, "to": target})
    return job


async def publish_job(session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID) -> Any:
    """Put a job on the board. **Invariant 8.**

    Re-publishing a paused job re-checks verification: an employer whose KYB
    was revoked while the job was paused must not be able to bring it back.
    """
    job = await _move(session, ctx, job_id, "PUBLISHED")

    kyb_status = await employer_service.kyb_status(session, ctx=ctx)
    if kyb_status != "APPROVED":
        raise KybRequiredError(params={"kyb_status": kyb_status})

    try:
        await repository.set_status(
            session,
            job=job,
            status="PUBLISHED",
            published_at=job.published_at or datetime.now(UTC),
        )
    except DBAPIError as exc:
        # The trigger disagreed with the check above -- a status changed
        # between the read and the write. The database is the authority, and
        # the client gets the same error it would have had a moment earlier.
        if "KYB_REQUIRED" in str(exc):
            raise KybRequiredError(params={"kyb_status": "unverified"}) from exc
        raise

    await emit(
        session,
        event_type=f"{MODULE}.job_published",
        aggregate_type="job",
        aggregate_id=job.id,
        payload={"tenant_id": str(job.tenant_id)},
    )
    logger.info("job_published", job_id=str(job.id))
    return job


async def pause_job(session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID) -> Any:
    job = await _move(session, ctx, job_id, "PAUSED")
    await repository.set_status(session, job=job, status="PAUSED")
    await emit(
        session,
        event_type=f"{MODULE}.job_paused",
        aggregate_type="job",
        aggregate_id=job.id,
        payload={"tenant_id": str(job.tenant_id)},
    )
    return job


async def close_job(session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID) -> Any:
    """Terminal. A job that reopens is a new job."""
    job = await _move(session, ctx, job_id, "CLOSED")
    await repository.set_status(session, job=job, status="CLOSED", closed_at=datetime.now(UTC))
    await emit(
        session,
        event_type=f"{MODULE}.job_closed",
        aggregate_type="job",
        aggregate_id=job.id,
        payload={"tenant_id": str(job.tenant_id)},
    )
    return job


async def threshold_preview(
    session: AsyncSession, *, ctx: TenantContext, min_score: int
) -> dict[str, Any]:
    """How many visible candidates clear a threshold -- coarsely, and rarely.

    Rate-limited per organisation, not per user: a team of recruiters sharing
    one limit is the point, because the risk is the organisation learning a
    score, not one person asking too often.
    """
    tenant_id = await _bind(session, ctx)
    await hit(
        bucket="jobs:threshold_preview",
        subject=str(tenant_id),
        limit=THRESHOLD_PREVIEWS_PER_HOUR,
        window_seconds=3600,
    )
    count = await discovery_service.count_visible_at_or_above(session, min_score=min_score)
    approximate, fewer = coarse_count(count)
    return {"min_score": min_score, "approximate_count": approximate, "fewer_than_ten": fewer}


# ---------------------------------------------------------------------------
# The candidate board
# ---------------------------------------------------------------------------
async def bind_candidate(session: AsyncSession, ctx: TenantContext) -> uuid.UUID:
    """Bind `app.user_id` for a candidate's transaction, and refuse anyone else.

    Public because `applications` binds the same identity before reading its
    own table, and one definition of "this is a candidate transaction" is
    better than two.
    """
    if ctx.tenant_id is not None or ctx.role != "CANDIDATE":
        raise PermissionDeniedError()
    await set_transaction_user(session, ctx.user_id)
    return ctx.user_id


async def current_score(session: AsyncSession, *, user_id: uuid.UUID) -> int | None:
    """The candidate's stored score, the only value eligibility is judged on.

    `raw_value`, not a display value: the scale's CHECK keeps it within
    700-990, so the two agree today, and if a display rule ever diverged the
    decision should follow what was computed rather than what was drawn.
    """
    row = await scoring_service.get_latest(session, user_id=user_id)
    return None if row is None else int(row.raw_value)


def _cursor_of(job: Any) -> str:
    return encode_cursor({"p": job.published_at.isoformat(), "i": str(job.id)})


def _after(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    payload = decode_cursor(cursor)
    try:
        return datetime.fromisoformat(str(payload["p"])), uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError) as exc:
        raise ValidationError(code="invalid_cursor") from exc


def _summary(job: Any, *, employer_name: str | None, score: int | None) -> dict[str, Any]:
    return {
        "id": job.id,
        "title": job.title,
        "employer_name": employer_name,
        "skills": list(job.skills),
        "location": job.location,
        "work_mode": job.work_mode,
        "experience_min_months": job.experience_min_months,
        "salary_min_minor": job.salary_min_minor,
        "salary_max_minor": job.salary_max_minor,
        "salary_disclosed": parse_stored(job.details).compensation.disclosed,
        "published_at": job.published_at,
        "eligibility": eligibility(min_score=job.min_score, score=score),
    }


async def search_board(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    query: str | None = None,
    location: str | None = None,
    work_mode: str | None = None,
    skill: str | None = None,
    min_salary_minor: int | None = None,
    eligible_only: bool = False,
    cursor: str | None = None,
    limit: int | None = None,
) -> Page[BoardJobSummary]:
    """Published jobs from every employer, with eligibility against the stored score.

    One page past the limit is fetched to know whether there is a next page,
    so the last page never hands out a cursor that leads nowhere.
    """
    user_id = await bind_candidate(session, ctx)
    score = await current_score(session, user_id=user_id)
    page_size = clamp_limit(limit)

    rows = await repository.search_board(
        session,
        query=query,
        location=location,
        work_mode=work_mode,
        skill=skill,
        min_salary_minor=min_salary_minor,
        eligible_at_score=score,
        eligible_only=eligible_only,
        after=_after(cursor),
        limit=page_size + 1,
    )
    page, more = rows[:page_size], len(rows) > page_size
    names = await employer_service.public_names(
        session, tenant_ids=list({job.tenant_id for job in page})
    )
    return Page[BoardJobSummary](
        items=[
            BoardJobSummary(**_summary(job, employer_name=names.get(job.tenant_id), score=score))
            for job in page
        ],
        next_cursor=_cursor_of(page[-1]) if more and page else None,
    )


async def get_board_job(
    session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID
) -> BoardJobDetail:
    user_id = await bind_candidate(session, ctx)
    job = await repository.get_board_job(session, job_id=job_id)
    if job is None:
        raise JobNotFoundError()
    score = await current_score(session, user_id=user_id)
    names = await employer_service.public_names(session, tenant_ids=[job.tenant_id])
    # The two conditions `apply` checks, so the employer's own link is never
    # a way round them.
    eligible = eligibility(min_score=job.min_score, score=score) == "ELIGIBLE"
    may_apply = eligible and await discovery_service.is_candidate_visible(
        session, candidate_id=user_id
    )
    details = for_candidate(parse_stored(job.details), may_apply=may_apply)
    return BoardJobDetail(
        **_summary(job, employer_name=names.get(job.tenant_id), score=score),
        description=job.description,
        details=details,
        can_apply_externally=bool(details.application.external_url or details.application.email),
    )


async def open_job_for_application(
    session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID
) -> Any:
    """The published job a candidate is applying to, or `job_not_found`.

    Returns the row, threshold and owning tenant included, to the applications
    service -- which needs both and exposes neither.
    """
    await bind_candidate(session, ctx)
    job = await repository.get_board_job(session, job_id=job_id)
    if job is None:
        raise JobNotFoundError()
    return job


async def jobs_for_candidate(
    session: AsyncSession, *, ctx: TenantContext, job_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str | None]]:
    """`job id -> (title, employer name)` for jobs on the candidate's own board,
    including jobs that closed after they applied."""
    await bind_candidate(session, ctx)
    jobs = await repository.jobs_by_id(session, job_ids=job_ids)
    names = await employer_service.public_names(
        session, tenant_ids=list({job.tenant_id for job in jobs})
    )
    return {job.id: (job.title, names.get(job.tenant_id)) for job in jobs}
