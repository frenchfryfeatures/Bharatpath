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
from typing import Any, Final, NamedTuple

from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import set_transaction_tenant, set_transaction_user
from app.core.errors import (
    AppError,
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
from app.modules.jobs.domain import (
    DEFAULT_MATCH_WEIGHTS,
    RECOMMENDATIONS_DEFAULT,
    RECOMMENDATIONS_MAX,
    JobFacts,
    MatchTerms,
    MatchWeights,
    MatchWeightsError,
    coarse_count,
    eligibility,
    is_editable,
    match_weights_from_config,
    refuse_transition,
    rerank_board_score,
    score_job,
)
from app.modules.jobs.events import MODULE
from app.modules.jobs.schemas import (
    ApplicationStageCounts,
    BoardJobDetail,
    BoardJobSummary,
    CreateJobRequest,
    JobListItem,
    JobResponse,
    RecommendedJob,
    RecommendedJobs,
    UpdateJobRequest,
)
from app.modules.profile_images import service as profile_images_service
from app.modules.scoring import service as scoring_service

logger = get_logger(__name__)

#: Threshold previews per organisation per hour. Enough for someone composing
#: several jobs and trying thresholds; far too few to binary-search a score.
#: The number lives in `app.core.ratelimit.STATIC_POLICIES`, beside
#: every other limit, so it can be held as one of the two tightest.
THRESHOLD_PREVIEWS_PER_HOUR: Final = STATIC_POLICIES["jobs.threshold_preview"].limit

#: How many of the newest matching jobs are ranked. Generous beside the
#: section's length, and what bounds the work one request costs.
RECOMMENDATION_POOL: Final = 300
#: How many recent applications "similar to what you applied for" learns from.
RECENT_APPLICATIONS: Final = 20
#: A withdrawal says "not for me", so it is not a reason to show more of the
#: same. Every other outcome, rejection included, still says what they want.
NOT_A_PREFERENCE: Final = ("WITHDRAWN",)


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


def _summary(
    job: Any, *, employer_name: str | None, score: int | None, logos: dict[uuid.UUID, str]
) -> dict[str, Any]:
    return {
        "id": job.id,
        "title": job.title,
        "employer_name": employer_name,
        "employer_logo_url": logos.get(job.tenant_id),
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


def _rank_offset(cursor: str | None) -> int | None:
    if not cursor or not cursor.startswith("rank:"):
        return None
    try:
        offset = int(cursor.split(":", 1)[1])
        return offset if offset >= 0 else None
    except ValueError:
        return None


def _profile_terms_from_career(city: str | None, career: dict[str, Any]) -> MatchTerms | None:
    """Build MatchTerms from `candidate_profiles.career` (details + preferences)."""
    details = career.get("details") if isinstance(career.get("details"), dict) else {}
    prefs = career.get("preferences") if isinstance(career.get("preferences"), dict) else {}
    if not details and not prefs:
        return None

    work_status = str(details.get("work_status") or "").upper()
    exp_years = int(details.get("experience_years") or 0)
    exp_months = int(details.get("experience_months") or 0)
    if work_status == "FRESHER":
        experience: int | None = 0
    elif work_status == "EXPERIENCED" or exp_years or exp_months:
        experience = exp_years * 12 + exp_months
    else:
        experience = None

    pref_salary = details.get("preferred_salary")
    pref_currency = str(details.get("preferred_salary_currency") or "INR").upper()
    preferred_annual_minor = (
        int(pref_salary) * 100
        if isinstance(pref_salary, (int, float)) and pref_salary > 0 and pref_currency == "INR"
        else None
    )

    skills = [str(s) for s in (details.get("key_skills") or []) if isinstance(s, str)]
    titles = [
        *[str(r) for r in (prefs.get("preferred_roles") or []) if isinstance(r, str)],
        *[
            str(details.get(k))
            for k in ("job_role", "job_title", "role_category")
            if isinstance(details.get(k), str) and details.get(k)
        ],
    ]
    locations = [
        *[str(p) for p in (details.get("preferred_locations") or []) if isinstance(p, str)],
        *[str(p) for p in (prefs.get("preferred_locations") or []) if isinstance(p, str)],
        str(details.get("current_city") or city or ""),
    ]
    industries = [
        *[str(i) for i in (prefs.get("preferred_industries") or []) if isinstance(i, str)],
        *([str(details["industry"])] if isinstance(details.get("industry"), str) and details.get("industry") else []),
    ]
    work_modes = [str(m) for m in (prefs.get("work_modes") or []) if isinstance(m, str)]
    job_types = [str(t) for t in (prefs.get("job_types") or []) if isinstance(t, str)]
    open_to_relocation = bool(prefs.get("open_to_relocation", False))

    terms = MatchTerms.build(
        skills=skills,
        titles=titles,
        locations=locations,
        experience_months=experience,
        preferred_annual_salary_minor=preferred_annual_minor,
        industries=industries,
        fresher=work_status == "FRESHER",
        work_modes=work_modes,
        job_types=job_types,
        open_to_relocation=open_to_relocation,
    )
    return None if terms.is_empty else terms


async def _applied_terms_for_candidate(
    session: AsyncSession, *, candidate_id: uuid.UUID
) -> tuple[MatchTerms | None, int]:
    """Build behavioral MatchTerms from the candidate's recent non-withdrawn applications."""
    job_ids = await repository.recently_applied_job_ids(
        session, candidate_id=candidate_id, exclude_stages=NOT_A_PREFERENCE, limit=RECENT_APPLICATIONS
    )
    if not job_ids:
        return None, 0
    by_id = {job.id: job for job in await repository.jobs_by_id(session, job_ids=job_ids)}
    applied = [by_id[job_id] for job_id in job_ids if job_id in by_id]
    if not applied:
        return None, 0
    facts_list = [job_facts(job) for job in applied]
    terms = MatchTerms.build(
        skills=[skill for job in applied for skill in (job.skills or [])],
        titles=[job.title for job in applied],
        locations=[job.location for job in applied if job.location],
        work_modes=[f.work_mode for f in facts_list if f.work_mode],
        industries=[f.industry for f in facts_list if f.industry],
        job_types=[f.job_type for f in facts_list if f.job_type],
    )
    return (None if terms.is_empty else terms), len(applied)


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
    """Published jobs from every employer, re-ranked by the candidate's profile,
    Job Preferences, and recently applied jobs, with eligibility against the stored score.

    Hard filters (query, location, work_mode, skill, min_salary_minor, eligible_only)
    narrow the candidate pool first; the matching jobs are then ordered by
    `domain.rerank_board_score` (Preferences + Applied Behavior + Recency).
    """
    user_id = await bind_candidate(session, ctx)
    score = await current_score(session, user_id=user_id)
    page_size = clamp_limit(limit)

    rank_offset = _rank_offset(cursor)
    keyset_after = None if rank_offset is not None else _after(cursor)

    # Load personalization signals (profile + Job Preferences + recent applications).
    city, career = await repository.candidate_career_snapshot(session, candidate_id=user_id)
    profile_terms = _profile_terms_from_career(city, career)
    applied_terms, applied_count = await _applied_terms_for_candidate(session, candidate_id=user_id)
    should_rerank = keyset_after is None and (profile_terms is not None or applied_terms is not None)

    if should_rerank:
        offset = rank_offset or 0
        pool = await repository.search_board(
            session,
            query=query,
            location=location,
            work_mode=work_mode,
            skill=skill,
            min_salary_minor=min_salary_minor,
            eligible_at_score=score,
            eligible_only=eligible_only,
            after=None,
            limit=RECOMMENDATION_POOL,
        )
        weights = await load_match_weights(session)
        now = datetime.now(UTC)
        scored = [
            (
                rerank_board_score(
                    job_facts(job),
                    profile_terms=profile_terms,
                    applied_terms=applied_terms,
                    applied_count=applied_count,
                    age_days=max(0.0, (now - job.created_at).total_seconds() / 86400.0)
                    if job.created_at
                    else 0.0,
                    weights=weights,
                ),
                job,
            )
            for job in pool
        ]
        # Stable sort: pool is already newest-first, so equal scores keep newer jobs first.
        scored.sort(key=lambda entry: entry[0], reverse=True)
        ordered = [job for _, job in scored]
        page = ordered[offset : offset + page_size]
        more = len(ordered) > offset + page_size
        next_cursor = f"rank:{offset + page_size}" if more and page else None
    else:
        rows = await repository.search_board(
            session,
            query=query,
            location=location,
            work_mode=work_mode,
            skill=skill,
            min_salary_minor=min_salary_minor,
            eligible_at_score=score,
            eligible_only=eligible_only,
            after=keyset_after,
            limit=page_size + 1,
        )
        page, more = rows[:page_size], len(rows) > page_size
        next_cursor = _cursor_of(page[-1]) if more and page else None

    tenant_ids = list({job.tenant_id for job in page})
    names = await employer_service.public_names(session, tenant_ids=tenant_ids)
    logos = await profile_images_service.logo_urls(session, tenant_ids=tenant_ids)
    from app.modules.applications import service as applications_service

    application_states = await applications_service.states_for_jobs(
        session, ctx=ctx, job_ids=[job.id for job in page]
    )
    return Page[BoardJobSummary](
        items=[
            BoardJobSummary(
                **_summary(job, employer_name=names.get(job.tenant_id), score=score, logos=logos),
                **application_states.get(job.id, {}),
            )
            for job in page
        ],
        next_cursor=next_cursor,
    )


async def board_skills(
    session: AsyncSession, *, ctx: TenantContext, query: str | None, limit: int = 50
) -> list[str]:
    """The skill filter's options: skills live jobs ask for, under the same
    candidate binding and policy as the board itself."""
    await bind_candidate(session, ctx)
    return await repository.board_skills(session, query=query, limit=max(1, min(limit, 100)))


async def get_board_job(
    session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID
) -> BoardJobDetail:
    user_id = await bind_candidate(session, ctx)
    job = await repository.get_board_job(session, job_id=job_id)
    if job is None:
        raise JobNotFoundError()
    score = await current_score(session, user_id=user_id)
    names = await employer_service.public_names(session, tenant_ids=[job.tenant_id])
    logos = await profile_images_service.logo_urls(session, tenant_ids=[job.tenant_id])
    # The two conditions `apply` checks, so the employer's own link is never
    # a way round them.
    eligible = eligibility(min_score=job.min_score, score=score) == "ELIGIBLE"
    may_apply = eligible and await discovery_service.is_candidate_visible(
        session, candidate_id=user_id
    )
    details = for_candidate(parse_stored(job.details), may_apply=may_apply)
    from app.modules.applications import service as applications_service

    application_states = await applications_service.states_for_jobs(
        session, ctx=ctx, job_ids=[job.id]
    )
    return BoardJobDetail(
        **_summary(job, employer_name=names.get(job.tenant_id), score=score, logos=logos),
        **application_states.get(job.id, {}),
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


class CandidateJobRef(NamedTuple):
    """A job named on the candidate's own screens: its title and who posted it."""

    title: str | None = None
    employer_name: str | None = None
    #: A presigned link that expires; null when the employer has no logo.
    employer_logo_url: str | None = None


async def jobs_for_candidate(
    session: AsyncSession, *, ctx: TenantContext, job_ids: list[uuid.UUID]
) -> dict[uuid.UUID, CandidateJobRef]:
    """`job id -> (title, employer name, employer logo)` for jobs on the
    candidate's own board, including jobs that closed after they applied."""
    await bind_candidate(session, ctx)
    jobs = await repository.jobs_by_id(session, job_ids=job_ids)
    tenant_ids = list({job.tenant_id for job in jobs})
    names = await employer_service.public_names(session, tenant_ids=tenant_ids)
    logos = await profile_images_service.logo_urls(session, tenant_ids=tenant_ids)
    return {
        job.id: CandidateJobRef(job.title, names.get(job.tenant_id), logos.get(job.tenant_id))
        for job in jobs
    }


async def recommend(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    terms: MatchTerms,
    limit: int | None = None,
    eligible_only: bool = False,
    offset: int = 0,
) -> RecommendedJobs:
    """Board jobs ranked by the job engine (`domain.score_job`) against
    `terms`, best first, `offset` into the ranking for "see more".

    The candidate's home screen has two sections built on this: jobs like
    the ones they applied to (`similar_to_applied`, below) and jobs that fit
    their career profile (assembled by `candidate.service`, which owns the
    profile). Jobs already applied to are left out of both.

    `eligible_only` filters as the board's does. It never orders: see the
    note on recommendations in `domain`.
    """
    user_id = await bind_candidate(session, ctx)
    if terms.is_empty:
        return RecommendedJobs(items=[], has_basis=False)
    size = min(limit or RECOMMENDATIONS_DEFAULT, RECOMMENDATIONS_MAX)
    score = await current_score(session, user_id=user_id)
    pool = await repository.recommendation_pool(
        session, candidate_id=user_id, terms=terms, pool=RECOMMENDATION_POOL
    )
    if eligible_only:
        pool = [j for j in pool if eligibility(min_score=j.min_score, score=score) == "ELIGIBLE"]
    weights = await load_match_weights(session)
    ranked = _ranked(terms, pool, weights=weights)
    top = ranked[offset : offset + size]
    return RecommendedJobs(
        items=await _recommended(session, top, score=score),
        has_basis=True,
        next_offset=offset + size if len(ranked) > offset + size else None,
    )


MATCH_WEIGHTS_CONFIG_KEY: Final = "jobs.match_weights"


class MatchWeightsInvalidError(AppError):
    """A bad `jobs.match_weights` row is a 500, never the defaults: ranking on
    numbers nobody chose is the silent failure config rows exist to prevent."""

    status_code = 500
    code = "match_weights_invalid"
    title = "Job matching is misconfigured."


async def load_match_weights(session: AsyncSession, *, now: datetime | None = None) -> MatchWeights:
    row = await repository.current_config(
        session, key=MATCH_WEIGHTS_CONFIG_KEY, now=now or datetime.now(UTC)
    )
    if row is None:
        return DEFAULT_MATCH_WEIGHTS
    try:
        return match_weights_from_config(row.value)
    except MatchWeightsError as exc:
        raise MatchWeightsInvalidError() from exc


def job_facts(job: Any) -> JobFacts:
    """What the engine reads about a job: its columns and the parts of its
    `details` document a candidate may see anyway. A document that does not
    parse is read as empty rather than failing the whole list."""
    try:
        details = parse_stored(job.details)
    except Exception:  # one bad posting must not empty a list
        details = None
    return JobFacts(
        title=job.title,
        skills=list(job.skills or []),
        location=job.location,
        experience_min_months=job.experience_min_months,
        experience_max_months=details.compensation.experience_max_months if details else None,
        description=job.description or "",
        responsibilities=list(details.content.responsibilities) if details else [],
        preferred_skills=(
            [*details.skills.preferred, *details.content.nice_to_have_skills] if details else []
        ),
        work_mode=job.work_mode,
        salary_max_minor=job.salary_max_minor,
        salary_period=details.compensation.period if details else "",
        industry=details.basics.industry if details else "",
        minimum_education=details.education.minimum if details else "",
        job_type=details.basics.job_type if details else "",
    )


def _ranked(
    terms: MatchTerms, pool: list[Any], *, weights: MatchWeights = DEFAULT_MATCH_WEIGHTS
) -> list[tuple[Any, tuple[str, ...], tuple[str, ...]]]:
    """`(job, matched skills, reasons)` best match first, dropping jobs that
    share no term. The pool is newest first and the sort is stable, so equal
    relevance keeps the newer job first."""
    ranked: list[tuple[int, Any, tuple[str, ...], tuple[str, ...]]] = []
    for job in pool:
        found = score_job(terms, job_facts(job), weights=weights)
        if found is not None:
            ranked.append((found.relevance, job, found.matched_skills, found.reasons))
    ranked.sort(key=lambda entry: entry[0], reverse=True)
    return [(job, matched, reasons) for _, job, matched, reasons in ranked]


async def _recommended(
    session: AsyncSession,
    entries: list[tuple[Any, tuple[str, ...], tuple[str, ...]]],
    *,
    score: int | None,
) -> list[RecommendedJob]:
    tenant_ids = list({job.tenant_id for job, _, _ in entries})
    names = await employer_service.public_names(session, tenant_ids=tenant_ids)
    logos = await profile_images_service.logo_urls(session, tenant_ids=tenant_ids)
    return [
        RecommendedJob(
            **_summary(job, employer_name=names.get(job.tenant_id), score=score, logos=logos),
            matched_skills=list(matched),
            match_reasons=list(reasons),
        )
        for job, matched, reasons in entries
    ]


async def search_ranked(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    terms: MatchTerms,
    locations: tuple[str, ...] = (),
    work_mode: str | None = None,
    min_salary_minor: int | None = None,
    max_experience_months: int | None = None,
    eligible_only: bool = False,
    offset: int = 0,
    limit: int = RECOMMENDATIONS_DEFAULT,
) -> tuple[list[RecommendedJob], bool]:
    """The chat assistant's search (2026-10-13): one page of board jobs and
    whether there is another.

    Ranked by `domain.match` when there are terms, as recommendations are;
    newest first when there are none. The filters are the board's, and hard:
    asking for Pune is not asking for Pune first. Jobs already applied to
    are left out. Eligibility filters as the board's does and never orders.

    Paged by offset into the ranking, not by cursor: the ranking is computed
    over a bounded pool each time, so an offset into it is as stable as the
    pool, and a chat's "show me more" never goes far.
    """
    user_id = await bind_candidate(session, ctx)
    score = await current_score(session, user_id=user_id)
    pool = await repository.search_pool(
        session,
        candidate_id=user_id,
        terms=terms,
        locations=locations,
        work_mode=work_mode,
        min_salary_minor=min_salary_minor,
        max_experience_months=max_experience_months,
        eligible_at_score=score,
        eligible_only=eligible_only,
        pool=RECOMMENDATION_POOL,
    )
    ranked: list[tuple[Any, tuple[str, ...], tuple[str, ...]]] = (
        [(job, (), ()) for job in pool]
        if terms.is_empty
        else _ranked(terms, pool, weights=await load_match_weights(session))
    )
    page = ranked[offset : offset + limit]
    more = len(ranked) > offset + limit
    return await _recommended(session, page, score=score), more


async def board_jobs(
    session: AsyncSession, *, ctx: TenantContext, job_ids: list[uuid.UUID]
) -> list[BoardJobDetail]:
    """Several published jobs as `get_board_job` returns one, in the order
    asked, leaving out any no longer on the board. For the chat assistant's
    jobs in view, which may have been paused or closed since they were shown.
    """
    user_id = await bind_candidate(session, ctx)
    found = {
        job.id: job
        for job in await repository.jobs_by_id(session, job_ids=job_ids)
        if job.status == "PUBLISHED"
    }
    jobs = [found[job_id] for job_id in dict.fromkeys(job_ids) if job_id in found]
    if not jobs:
        return []
    score = await current_score(session, user_id=user_id)
    tenant_ids = list({job.tenant_id for job in jobs})
    names = await employer_service.public_names(session, tenant_ids=tenant_ids)
    logos = await profile_images_service.logo_urls(session, tenant_ids=tenant_ids)
    visible = await discovery_service.is_candidate_visible(session, candidate_id=user_id)
    from app.modules.applications import service as applications_service

    application_states = await applications_service.states_for_jobs(
        session, ctx=ctx, job_ids=job_ids
    )
    out = []
    for job in jobs:
        # The same two conditions as `get_board_job`, for the same reason.
        eligible = eligibility(min_score=job.min_score, score=score) == "ELIGIBLE"
        details = for_candidate(parse_stored(job.details), may_apply=eligible and visible)
        out.append(
            BoardJobDetail(
                **_summary(job, employer_name=names.get(job.tenant_id), score=score, logos=logos),
                **application_states.get(job.id, {}),
                description=job.description,
                details=details,
                can_apply_externally=bool(
                    details.application.external_url or details.application.email
                ),
            )
        )
    return out


async def similar_to_applied(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    limit: int | None = None,
    eligible_only: bool = False,
) -> RecommendedJobs:
    """Jobs like the ones the candidate recently applied to.

    The applied jobs' skills, title words and places are the terms. They are
    read through `jobs_by_id`, so a job that has since closed still says what
    the candidate was looking for. Experience is not a term here: an
    application says what someone wants, not what they have done.
    """
    user_id = await bind_candidate(session, ctx)
    job_ids = await repository.recently_applied_job_ids(
        session, candidate_id=user_id, exclude_stages=NOT_A_PREFERENCE, limit=RECENT_APPLICATIONS
    )
    by_id = {job.id: job for job in await repository.jobs_by_id(session, job_ids=job_ids)}
    applied = [by_id[job_id] for job_id in job_ids if job_id in by_id]
    terms = MatchTerms.build(
        skills=[skill for job in applied for skill in job.skills],
        titles=[job.title for job in applied],
        locations=[job.location for job in applied if job.location],
    )
    return await recommend(session, ctx=ctx, terms=terms, limit=limit, eligible_only=eligible_only)
