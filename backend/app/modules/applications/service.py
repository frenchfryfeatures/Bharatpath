"""applications - business rules and transaction boundaries

Apply, stages, withdraw, expiry, hire confirm.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**The candidate's side: apply, read, withdraw.** Four rules decide
whether an application can be made, checked in this order:

  1. **An active application already exists** -> return it. Applying is
     idempotent, so a retry after a dropped connection is not an error, and
     it is checked first so a retry gets the same answer whatever changed in
     between.
  2. **The job is on the board** -> otherwise `job_not_found`. A paused, closed
     or draft job reads as absent, exactly as it does in search.
  3. **The candidate is visible to employers** -> otherwise
     `application_unavailable` (or `score_pending` with no score at all).
     Applying puts a candidate in front of an employer, so it passes the same
     rule as discovery -- the one CTE. Without this, a CV held back by a HIGH
     integrity signal would reach employers through the apply button, which
     is the same bypass the CTE closes for search.
  4. **The stored score meets the threshold** -> otherwise
     `eligibility_below_threshold`, with no number attached (R11).

**Payment gates applying and searching, not leaving.** A lapsed subscriber
keeps their account and their history (R13): reading, withdrawing, and
confirming or disputing a hire stay open, because an outcome someone cannot
answer without paying is their data held in an employer's pipeline for a fee.

**The employer's side: the pipeline.** The employer moves an application forward, books
an interview and proposes a hire; the candidate confirms or disputes it; the
clock expires what an employer has abandoned. Every change locks the row first
and appends to `application_events` on the same transaction, so a withdrawal
and a stage change cannot both read SHORTLISTED and both write, and the board
never shows a state its history does not explain.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any, Final

from fastapi import status
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, audit_event
from app.core.db import set_transaction_tenant
from app.core.deps import EMPLOYER_OWNER, EMPLOYER_RECRUITER
from app.core.errors import (
    AppError,
    ConflictError,
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
from app.core.ratelimit import enforce
from app.core.tenant import TenantContext
from app.modules.applications import repository
from app.modules.applications.domain import (
    DASHBOARD_WINDOW,
    DEFAULT_EXPIRY_RULES,
    DEFAULT_TOP_JOBS,
    INTERVIEW_STAGE,
    IST_ZONE_NAME,
    MAX_MESSAGES_PER_APPLICATION_PER_DAY,
    MESSAGEABLE_STAGES,
    STATUS_STAGES,
    UPCOMING_INTERVIEWS,
    ExpiryRules,
    ExpiryRulesError,
    HireState,
    candidate_confirm,
    candidate_dispute,
    daily_series,
    employer_hire,
    employer_move,
    expires,
    expiry_horizon,
    expiry_rules_from_config,
    hire_state,
    refuse_meeting,
    refuse_message,
    shortlist_invite_refusal,
    trend_start,
    withdrawal,
)
from app.modules.applications.events import (
    APPLICATION_EXPIRED,
    APPLICATION_STAGE_CHANGED,
    APPLICATION_SUBMITTED,
    APPLICATION_WITHDRAWN,
    HIRE_CONFIRMED,
    HIRE_DISPUTED,
    HIRE_PROPOSED,
    INTERVIEW_SCHEDULED,
    MESSAGE_SENT,
    SHORTLIST_ANSWERED,
    SHORTLIST_INVITED,
)
from app.modules.applications.models import ApplicationMessage
from app.modules.applications.schemas import (
    ActivityItem,
    ApplicantCard,
    ApplicantProfile,
    ApplicationCounts,
    ApplicationDetailResponse,
    ApplicationResponse,
    CandidateHistoryItem,
    CandidateShortlistState,
    DailyApplications,
    EmployerApplicationDetail,
    EmployerApplicationListItem,
    EmployerApplicationSummary,
    EmployerDashboard,
    EmployerHistoryItem,
    InterviewDetails,
    JobCounts,
    NeedsAttention,
    RevealCounts,
    ShortlistEntry,
    ShortlistInvitation,
    ShortlistInvitationState,
    TopJob,
    UpcomingInterview,
)
from app.modules.discovery import service as discovery_service
from app.modules.jobs import service as jobs_service
from app.modules.jobs.domain import eligibility
from app.modules.resume import service as resume_service
from app.modules.scoring import service as scoring_service
from app.modules.scoring.domain import display_value

logger = get_logger(__name__)

#: The `config_values` key replacing `DEFAULT_EXPIRY_RULES`:
#: `{"inactive_days": n}`, 7 to 365.
EXPIRY_CONFIG_KEY: Final = "applications.expiry"
#: Applications expired per tenant per sweep. The rest wait for the next one;
#: a lock held over thousands of rows would stall that employer's pipeline.
EXPIRY_BATCH: Final = 500


class ApplicationNotFoundError(NotFoundError):
    """Another candidate's -- or another organisation's -- application reads
    as absent, never as forbidden."""

    code = "application_not_found"
    title = "Application not found"


class ScorePendingError(ConflictError):
    code = "score_pending"
    title = "Your score is not ready yet"


class ApplicationUnavailableError(ConflictError):
    """Deliberately says nothing about why. The two causes are a check that has
    not run yet (seconds) and an integrity review (a human), and naming the
    second tells someone gaming a CV that they were caught."""

    code = "application_unavailable"
    title = "Applications are not available right now"


class BelowThresholdError(PermissionDeniedError):
    """`eligibility.below_threshold` in every locale. No params, ever: a
    number here is the explanation the client ruled out."""

    code = "eligibility_below_threshold"
    title = "This employer's requirement is not met"


class ApplicationTransitionError(ConflictError):
    code = "application_invalid_transition"
    title = "That change is not allowed for this application"


class InterviewNotAtStageError(ConflictError):
    """An interview is booked for an application at INTERVIEW. Move it there
    first; that move is what tells the candidate an interview is coming."""

    code = "interview_not_at_stage"
    title = "Move the application to the interview stage first"


class InterviewInvalidError(ValidationError):
    """`code` is the domain's: `meeting_url_invalid`, `interview_time_in_past`
    or `interview_time_too_far`."""

    code = "interview_invalid"
    title = "The interview details are not valid"


class HireNotAllowedError(ConflictError):
    """A hire is proposed at DECISION, and only there."""

    code = "hire_not_allowed"
    title = "A hire can only be proposed at the decision stage"


class HireNotPendingError(ConflictError):
    code = "hire_confirmation_not_pending"
    title = "There is no hire waiting for your confirmation"


class ExpiryRulesInvalidError(AppError):
    """The configured expiry period cannot be applied. A 500 that stops the
    sweep, deliberately: falling back to the default would make a broken row
    look applied, and guessing short releases candidates nobody meant to."""

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "application_expiry_rules_invalid"
    title = "Application expiry rules are misconfigured"


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------
def _hire(row: Any) -> HireState:
    return hire_state(
        stage=row.stage,
        employer_confirmed=row.employer_confirmed_at is not None,
        candidate_confirmed=row.candidate_confirmed_at is not None,
        disputed=row.hire_disputed_at is not None,
    )


def _interview(row: Any) -> InterviewDetails | None:
    if row.interview_at is None or row.meeting_url is None:
        return None
    return InterviewDetails(interview_at=row.interview_at, meeting_url=row.meeting_url)


def _payload(row: Any, **extra: str) -> dict[str, Any]:
    """Identifiers only. The candidate id is here so notifications can reach
    them; names and contacts are resolved at dispatch."""
    return {
        "tenant_id": str(row.tenant_id),
        "job_id": str(row.job_id),
        "candidate_id": str(row.candidate_id),
        **extra,
    }


async def _change_stage(
    session: AsyncSession,
    *,
    row: Any,
    stage: str,
    actor_type: str,
    actor_id: uuid.UUID | None,
    event_type: str,
    now: datetime,
    note: str | None = None,
    **changes: Any,
) -> Any:
    """Move one stage, append its event and emit it -- on the caller's transaction.

    An employer's move also restarts the expiry clock: acting on an
    application is the opposite of abandoning it.
    """
    previous = row.stage
    if actor_type == "EMPLOYER":
        changes["employer_active_at"] = now
    row = await repository.save(session, application=row, stage=stage, **changes)
    await repository.record_event(
        session,
        application_id=row.id,
        from_stage=previous,
        to_stage=stage,
        actor_type=actor_type,
        actor_id=actor_id,
        note=note,
    )
    await emit(
        session,
        event_type=event_type,
        aggregate_type="application",
        aggregate_id=row.id,
        payload=_payload(row, from_stage=previous, to_stage=stage),
    )
    logger.info(
        "application_stage_changed",
        application_id=str(row.id),
        from_stage=previous,
        to_stage=stage,
        actor_type=actor_type,
    )
    return row


def _after(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    payload = decode_cursor(cursor)
    try:
        return datetime.fromisoformat(str(payload["c"])), uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError) as exc:
        raise ValidationError(code="invalid_cursor") from exc


def _cursor(rows: list[Any], more: bool) -> str | None:
    if not (more and rows):
        return None
    return encode_cursor({"c": rows[-1].created_at.isoformat(), "i": str(rows[-1].id)})


# ---------------------------------------------------------------------------
# The candidate's side
# ---------------------------------------------------------------------------
async def _respond(
    session: AsyncSession, ctx: TenantContext, applications: list[Any]
) -> list[ApplicationResponse]:
    jobs = await jobs_service.jobs_for_candidate(
        session, ctx=ctx, job_ids=list({a.job_id for a in applications})
    )
    out = []
    for application in applications:
        job = jobs.get(application.job_id) or jobs_service.CandidateJobRef()
        out.append(
            ApplicationResponse(
                id=application.id,
                job_id=application.job_id,
                job_title=job.title,
                employer_name=job.employer_name,
                employer_logo_url=job.employer_logo_url,
                stage=application.stage,
                hire_confirmation=_hire(application),
                interview=_interview(application),
                created_at=application.created_at,
                updated_at=application.updated_at,
            )
        )
    return out


async def apply(
    session: AsyncSession, *, ctx: TenantContext, job_id: uuid.UUID
) -> tuple[ApplicationResponse, bool]:
    """Apply to a published job. Returns the application and whether it is new."""
    candidate_id = await jobs_service.bind_candidate(session, ctx)

    existing = await repository.active_for(session, job_id=job_id, candidate_id=candidate_id)
    if existing is not None:
        return (await _respond(session, ctx, [existing]))[0], False

    job = await jobs_service.open_job_for_application(session, ctx=ctx, job_id=job_id)

    score = await jobs_service.current_score(session, user_id=candidate_id)
    if score is None:
        raise ScorePendingError()
    if not await discovery_service.is_candidate_visible(session, candidate_id=candidate_id):
        raise ApplicationUnavailableError()
    if eligibility(min_score=job.min_score, score=score) != "ELIGIBLE":
        raise BelowThresholdError()

    new_id = await repository.insert_if_absent(
        session, tenant_id=job.tenant_id, job_id=job.id, candidate_id=candidate_id
    )
    if new_id is None:
        # Lost the race to a simultaneous apply. The winner has committed --
        # ON CONFLICT waited for it -- so its row is there to return.
        winner = await repository.active_for(session, job_id=job_id, candidate_id=candidate_id)
        if winner is None:  # pragma: no cover - only if the winner withdrew in between
            raise ApplicationTransitionError()
        return (await _respond(session, ctx, [winner]))[0], False

    await repository.record_event(
        session,
        application_id=new_id,
        from_stage=None,
        to_stage="SUBMITTED",
        actor_type="CANDIDATE",
        actor_id=candidate_id,
    )
    await emit(
        session,
        event_type=APPLICATION_SUBMITTED,
        aggregate_type="application",
        aggregate_id=new_id,
        payload={
            "tenant_id": str(job.tenant_id),
            "job_id": str(job.id),
            "candidate_id": str(candidate_id),
        },
    )
    logger.info("application_submitted", application_id=str(new_id), job_id=str(job.id))
    created = await repository.get_for_candidate(
        session, application_id=new_id, candidate_id=candidate_id
    )
    return (await _respond(session, ctx, [created]))[0], True


async def list_mine(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    cursor: str | None,
    limit: int | None,
    status: str | None = None,
) -> Page[ApplicationResponse]:
    """`status` is a tab of the board (`domain.STATUS_STAGES`); None is all."""
    candidate_id = await jobs_service.bind_candidate(session, ctx)
    page_size = clamp_limit(limit)
    rows = await repository.list_for_candidate(
        session,
        candidate_id=candidate_id,
        after=_after(cursor),
        limit=page_size + 1,
        stages=STATUS_STAGES[status] if status is not None else None,
    )
    page, more = rows[:page_size], len(rows) > page_size
    return Page[ApplicationResponse](
        items=await _respond(session, ctx, page), next_cursor=_cursor(page, more)
    )


async def _mine(
    session: AsyncSession, ctx: TenantContext, application_id: uuid.UUID, *, for_update: bool
) -> Any:
    candidate_id = await jobs_service.bind_candidate(session, ctx)
    row = await repository.get_for_candidate(
        session, application_id=application_id, candidate_id=candidate_id, for_update=for_update
    )
    if row is None:
        raise ApplicationNotFoundError()
    return row


async def get_mine(
    session: AsyncSession, *, ctx: TenantContext, application_id: uuid.UUID
) -> ApplicationDetailResponse:
    """One application with its history -- the stages, and who moved it, as a
    party. The employer's notes and which recruiter acted stay with the
    employer."""
    row = await _mine(session, ctx, application_id, for_update=False)
    summary = (await _respond(session, ctx, [row]))[0]
    events = await repository.events_for(session, application_id=row.id)
    return ApplicationDetailResponse(
        **summary.model_dump(),
        history=[
            CandidateHistoryItem(
                kind=e.kind,
                from_stage=e.from_stage,
                to_stage=e.to_stage,
                by=e.actor_type,
                occurred_at=e.occurred_at,
            )
            for e in events
        ],
    )


async def withdraw(
    session: AsyncSession, *, ctx: TenantContext, application_id: uuid.UUID
) -> ApplicationResponse:
    """Withdraw one of the candidate's applications. Withdrawing twice is a retry.

    The row is locked first, so a withdrawal and an employer's stage change
    cannot both read SHORTLISTED and both write.
    """
    row = await _mine(session, ctx, application_id, for_update=True)
    outcome = withdrawal(row.stage)
    if outcome == "REFUSE":
        raise ApplicationTransitionError(params={"from": row.stage, "to": "WITHDRAWN"})
    if outcome == "WITHDRAW":
        row = await _change_stage(
            session,
            row=row,
            stage="WITHDRAWN",
            actor_type="CANDIDATE",
            actor_id=row.candidate_id,
            event_type=APPLICATION_WITHDRAWN,
            now=datetime.now(UTC),
        )
    return (await _respond(session, ctx, [row]))[0]


async def confirm_hire(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    application_id: uuid.UUID,
    now: datetime | None = None,
) -> ApplicationResponse:
    """The second confirmation, which makes the hire final (SRS 1.13.3).

    The confirmation and HIRED are written in one statement: the CHECK on the
    table refuses either one without the other. `HIRE_CONFIRMED` is the final
    hire event; nothing is billed on it (deferred by the client).
    """
    now = now or datetime.now(UTC)
    row = await _mine(session, ctx, application_id, for_update=True)
    decision = candidate_confirm(
        stage=row.stage, employer_confirmed=row.employer_confirmed_at is not None
    )
    if decision == "REFUSE":
        raise HireNotPendingError(params={"stage": row.stage})
    if decision == "CONFIRM":
        row = await _change_stage(
            session,
            row=row,
            stage="HIRED",
            actor_type="CANDIDATE",
            actor_id=row.candidate_id,
            event_type=HIRE_CONFIRMED,
            now=now,
            candidate_confirmed_at=now,
        )
    return (await _respond(session, ctx, [row]))[0]


async def dispute_hire(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    application_id: uuid.UUID,
    now: datetime | None = None,
) -> ApplicationResponse:
    """Record that the candidate says the hire did not happen. See
    `domain.candidate_dispute` for how a disputed hire closes."""
    now = now or datetime.now(UTC)
    row = await _mine(session, ctx, application_id, for_update=True)
    decision = candidate_dispute(
        stage=row.stage,
        employer_confirmed=row.employer_confirmed_at is not None,
        disputed=row.hire_disputed_at is not None,
    )
    if decision == "REFUSE":
        raise HireNotPendingError(params={"stage": row.stage})
    if decision == "DISPUTE":
        row = await repository.save(session, application=row, hire_disputed_at=now)
        await repository.record_event(
            session,
            application_id=row.id,
            kind="HIRE_DISPUTED",
            from_stage=row.stage,
            to_stage=row.stage,
            actor_type="CANDIDATE",
            actor_id=row.candidate_id,
        )
        await emit(
            session,
            event_type=HIRE_DISPUTED,
            aggregate_type="application",
            aggregate_id=row.id,
            payload=_payload(row),
        )
        logger.info("hire_disputed", application_id=str(row.id))
    return (await _respond(session, ctx, [row]))[0]


# ---------------------------------------------------------------------------
# The employer's pipeline
# ---------------------------------------------------------------------------
#: Who sees an applicant's phone, email and CV: the roles the reveal admits.
CONTACT_ROLES: Final = frozenset({EMPLOYER_OWNER, EMPLOYER_RECRUITER})


async def _bind_tenant(session: AsyncSession, ctx: TenantContext) -> uuid.UUID:
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, ctx.tenant_id)
    return ctx.tenant_id


async def _theirs(
    session: AsyncSession, ctx: TenantContext, application_id: uuid.UUID, *, for_update: bool
) -> Any:
    tenant_id = await _bind_tenant(session, ctx)
    row = await repository.get_for_tenant(
        session, tenant_id=tenant_id, application_id=application_id, for_update=for_update
    )
    if row is None:
        raise ApplicationNotFoundError()
    return row


def _summary(row: Any) -> EmployerApplicationSummary:
    return EmployerApplicationSummary(
        id=row.id,
        job_id=row.job_id,
        candidate_id=row.candidate_id,
        stage=row.stage,
        hire_confirmation=_hire(row),
        interview=_interview(row),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _detail(
    session: AsyncSession, row: Any, ctx: TenantContext, request_id: str | None = None
) -> EmployerApplicationDetail:
    """The application, its history and the applicant in full. Every
    response carrying the applicant writes its audit row (in
    `discovery.open_applicant`), the moves included: each shows the person
    again."""
    events = await repository.events_for(session, application_id=row.id)
    return EmployerApplicationDetail(
        **_summary(row).model_dump(),
        history=[
            EmployerHistoryItem(
                kind=e.kind,
                from_stage=e.from_stage,
                to_stage=e.to_stage,
                by=e.actor_type,
                actor_id=e.actor_id if e.actor_type == "EMPLOYER" else None,
                note=e.note,
                occurred_at=e.occurred_at,
            )
            for e in events
        ],
        candidate=await _applicant_profile(session, row, ctx, request_id),
    )


async def _name(session: AsyncSession, card: discovery_service.ApplicantCard) -> str | None:
    """The name given at sign-up, else the structured form's -- as on the
    reveal. Never guessed from a CV."""
    return card.full_name or await resume_service.declared_name(
        session, user_id=card.candidate_id, resume_version_id=card.resume_version_id
    )


async def _card(session: AsyncSession, card: discovery_service.ApplicantCard) -> dict[str, Any]:
    return {
        "full_name": await _name(session, card),
        "band": card.band,
        "experience_years": card.experience_years,
        "skills": card.skills,
        "badges": card.badges,
        "city": card.city,
        "state_code": card.state_code,
    }


async def _applicant_profile(
    session: AsyncSession, row: Any, ctx: TenantContext, request_id: str | None
) -> ApplicantProfile | None:
    """Null when the visibility rule hides the candidate now. The score shown
    is `display_value` of the score the search document names, applied here.

    **Contact and the CV are for owners and recruiters**, the roles that may
    open a profile from search; a viewer sees who it is and the score, as a
    viewer is refused the reveal."""
    opened = await discovery_service.open_applicant(
        session,
        ctx=ctx,
        application_id=row.id,
        candidate_id=row.candidate_id,
        request_id=request_id,
    )
    if opened is None:
        return None
    score = await scoring_service.get_score(session, score_id=opened.score_id)
    if score is None:  # the search document's foreign key makes this unreachable
        return None
    full = ctx.role in CONTACT_ROLES
    return ApplicantProfile(
        **await _card(session, opened.card),
        phone=opened.phone if full else None,
        email=opened.email if full else None,
        score=display_value(int(score.raw_value)),
        resume=(
            await resume_service.shared_resume(
                session,
                user_id=opened.card.candidate_id,
                resume_version_id=opened.card.resume_version_id,
            )
            if full
            else None
        ),
    )


async def list_for_employer(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    job_id: uuid.UUID | None,
    stages: list[str] | None = None,
    status: str | None = None,
    name: str | None = None,
    applied_from: date | None = None,
    applied_to: date | None = None,
    newest_first: bool = False,
    cursor: str | None,
    limit: int | None,
    request_id: str | None = None,
) -> Page[EmployerApplicationListItem]:
    """The organisation's applications, oldest first unless `newest_first`.
    Each row names its job. Every filter narrows; together they intersect,
    so `stages` and `status` both given is the stages inside that tab.

    Without `job_id` the page spans every job, so a pipeline board fills from
    one request rather than one per job. With it, the job is looked up first,
    so another organisation's job id is `job_not_found` rather than an empty
    page that confirms nothing and explains nothing.

    `name` searches the applicant's profile name through discovery's
    visibility rule, so a hidden candidate is never found by name. The dates
    are IST days, both ends inclusive.
    """
    tenant_id = await _bind_tenant(session, ctx)
    if job_id is not None:
        await jobs_service.get_job(session, ctx=ctx, job_id=job_id)
    start, end = ist_day_range(applied_from, applied_to)
    wanted: tuple[str, ...] | None = tuple(dict.fromkeys(stages)) if stages else None
    if status is not None:
        tab = STATUS_STAGES[status]
        wanted = tab if wanted is None else tuple(s for s in wanted if s in tab)
    candidate_ids: list[uuid.UUID] | None = None
    if name is not None and name.strip():
        candidate_ids = await discovery_service.applicants_named(
            session, ctx=ctx, name=name.strip()
        )
    if wanted == () or candidate_ids == []:
        return Page[EmployerApplicationListItem](items=[], next_cursor=None)
    page_size = clamp_limit(limit)
    rows = await repository.list_for_employer(
        session,
        tenant_id=tenant_id,
        job_id=job_id,
        stages=wanted,
        candidate_ids=candidate_ids,
        applied_from=start,
        applied_before=end,
        newest_first=newest_first,
        after=_after(cursor),
        limit=page_size + 1,
    )
    page, more = rows[:page_size], len(rows) > page_size
    labels = await jobs_service.labels(session, ctx=ctx, job_ids=list({r.job_id for r in page}))
    cards = await discovery_service.applicant_cards(
        session,
        ctx=ctx,
        applications=[(r.id, r.candidate_id) for r in page],
        request_id=request_id,
    )
    items = []
    for row in page:
        title, location = labels.get(row.job_id, (None, None))
        card = cards.get(row.id)
        items.append(
            EmployerApplicationListItem(
                **_summary(row).model_dump(),
                job_title=title,
                job_location=location,
                candidate=ApplicantCard(**await _card(session, card)) if card else None,
            )
        )
    return Page[EmployerApplicationListItem](items=items, next_cursor=_cursor(page, more))


async def open_application(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    application_id: uuid.UUID,
    now: datetime | None = None,
    request_id: str | None = None,
) -> EmployerApplicationDetail:
    """An application, with its history. **Opening a submitted one records VIEWED.**

    That is what VIEWED means to the candidate watching their board: someone
    at the employer has looked. Any role counts, a viewer included -- it is a
    fact about the organisation, not a decision. Only the first opening
    records it; the lock and the re-check make two recruiters opening it at
    once record it once.
    """
    row = await _theirs(session, ctx, application_id, for_update=False)
    if row.stage == "SUBMITTED":
        row = await _theirs(session, ctx, application_id, for_update=True)
        if row.stage == "SUBMITTED":
            row = await _change_stage(
                session,
                row=row,
                stage="VIEWED",
                actor_type="EMPLOYER",
                actor_id=ctx.user_id,
                event_type=APPLICATION_STAGE_CHANGED,
                now=now or datetime.now(UTC),
            )
    return await _detail(session, row, ctx, request_id)


async def move_stage(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    application_id: uuid.UUID,
    target: str,
    note: str | None = None,
    now: datetime | None = None,
    request_id: str | None = None,
) -> EmployerApplicationDetail:
    """Move an application one stage forward, or reject it (`domain.employer_move`).

    Moving it to where it already is changes nothing and is not an error. The
    note, if any, goes on the last event the move records.
    """
    now = now or datetime.now(UTC)
    row = await _theirs(session, ctx, application_id, for_update=True)
    steps = employer_move(row.stage, target)
    if steps is None:
        raise ApplicationTransitionError(params={"from": row.stage, "to": target})
    for i, step in enumerate(steps):
        row = await _change_stage(
            session,
            row=row,
            stage=step,
            actor_type="EMPLOYER",
            actor_id=ctx.user_id,
            event_type=APPLICATION_STAGE_CHANGED,
            now=now,
            note=note if i == len(steps) - 1 else None,
        )
    return await _detail(session, row, ctx, request_id)


async def schedule_interview(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    application_id: uuid.UUID,
    interview_at: datetime,
    meeting_url: str,
    now: datetime | None = None,
    request_id: str | None = None,
) -> EmployerApplicationDetail:
    """Book or rebook the interview (SRS 1.13.2). The link is the employer's own.

    The details are checked before the application is looked up: they are
    wrong whoever's application it is, so checking first reveals nothing.
    Sending the same details again is a retry and records nothing new.
    """
    now = now or datetime.now(UTC)
    refused = refuse_meeting(meeting_url=meeting_url, interview_at=interview_at, now=now)
    if refused is not None:
        raise InterviewInvalidError(code=refused)

    row = await _theirs(session, ctx, application_id, for_update=True)
    if row.stage != INTERVIEW_STAGE:
        raise InterviewNotAtStageError(params={"stage": row.stage})
    if row.meeting_url == meeting_url and row.interview_at == interview_at:
        return await _detail(session, row, ctx, request_id)

    row = await repository.save(
        session,
        application=row,
        meeting_url=meeting_url,
        interview_at=interview_at,
        employer_active_at=now,
    )
    await repository.record_event(
        session,
        application_id=row.id,
        kind="INTERVIEW_SCHEDULED",
        from_stage=row.stage,
        to_stage=row.stage,
        actor_type="EMPLOYER",
        actor_id=ctx.user_id,
    )
    # The link stays off the event: the candidate reads it from their board,
    # behind their own authentication, and not from a queue message.
    await emit(
        session,
        event_type=INTERVIEW_SCHEDULED,
        aggregate_type="application",
        aggregate_id=row.id,
        payload=_payload(row, interview_at=interview_at.isoformat()),
    )
    logger.info("interview_scheduled", application_id=str(row.id))
    return await _detail(session, row, ctx, request_id)


async def propose_hire(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    application_id: uuid.UUID,
    now: datetime | None = None,
    request_id: str | None = None,
) -> EmployerApplicationDetail:
    """Mark as hired: the first of two confirmations. Idempotent.

    Nothing is final until the candidate confirms, and the stage stays at
    DECISION until they do.
    """
    now = now or datetime.now(UTC)
    row = await _theirs(session, ctx, application_id, for_update=True)
    decision = employer_hire(
        stage=row.stage, employer_confirmed=row.employer_confirmed_at is not None
    )
    if decision == "REFUSE":
        raise HireNotAllowedError(params={"stage": row.stage})
    if decision == "PROPOSE":
        row = await repository.save(
            session, application=row, employer_confirmed_at=now, employer_active_at=now
        )
        await repository.record_event(
            session,
            application_id=row.id,
            kind="HIRE_PROPOSED",
            from_stage=row.stage,
            to_stage=row.stage,
            actor_type="EMPLOYER",
            actor_id=ctx.user_id,
        )
        await emit(
            session,
            event_type=HIRE_PROPOSED,
            aggregate_type="application",
            aggregate_id=row.id,
            payload=_payload(row),
        )
        logger.info("hire_proposed", application_id=str(row.id))
    return await _detail(session, row, ctx, request_id)


# ---------------------------------------------------------------------------
# Expiry (system)
# ---------------------------------------------------------------------------
async def load_expiry_rules(session: AsyncSession, *, now: datetime) -> ExpiryRules:
    """The period in force at `now`: the latest config row, else the code default."""
    row = await repository.current_config(session, key=EXPIRY_CONFIG_KEY, now=now)
    if row is None:
        return DEFAULT_EXPIRY_RULES
    try:
        return expiry_rules_from_config(row.value, version=f"config-v{row.version}")
    except ExpiryRulesError as exc:
        logger.error("application_expiry_rules_invalid", config_version=row.version, error=str(exc))
        raise ExpiryRulesInvalidError() from exc


async def expire_for_tenant(session: AsyncSession, *, tenant_id: uuid.UUID, now: datetime) -> int:
    """Expire one employer's abandoned applications (SRS 1.9.3). Returns how many.

    **The tenant here comes from the `tenants` table, not a membership**, and
    that is the one sanctioned exception to SRS 2.24.7's rule: this is the
    system acting, with no caller whose input could name a tenant. Binding it
    keeps the sweep under the same policy as everything else -- it can only
    ever touch the tenant it was handed, one transaction per tenant.

    The expired application's candidate is free to apply to the job again.
    """
    await set_transaction_tenant(session, tenant_id)
    rules = await load_expiry_rules(session, now=now)
    rows = await repository.lock_expirable(
        session, tenant_id=tenant_id, cutoff=now - rules.period, limit=EXPIRY_BATCH
    )
    expired = 0
    for row in rows:
        if not expires(
            stage=row.stage,
            employer_active_at=row.employer_active_at,
            interview_at=row.interview_at,
            employer_confirmed=row.employer_confirmed_at is not None,
            now=now,
            rules=rules,
        ):
            continue
        await _change_stage(
            session,
            row=row,
            stage="EXPIRED",
            actor_type="SYSTEM",
            actor_id=None,
            event_type=APPLICATION_EXPIRED,
            now=now,
            note=f"expiry_rules={rules.version}",
        )
        expired += 1
    if expired:
        logger.info(
            "applications_expired", tenant_id=str(tenant_id), count=expired, rules=rules.version
        )
    return expired


# ---------------------------------------------------------------------------
# The employer dashboard
# ---------------------------------------------------------------------------
async def dashboard(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    top_jobs: int = DEFAULT_TOP_JOBS,
    now: datetime | None = None,
) -> EmployerDashboard:
    """The landing page of the employer portal: the organisation's pipeline, counted.

    **Read live, never cached.** Every number is something a recruiter acts on
    and then looks for the change -- a cached count that still says three
    unreviewed after they opened all three reads as a bug.

    Counted the way the rest of the pipeline counts: an application whose
    candidate is later held back from search is still in the employer's
    pipeline and still counted, exactly as `list_for_employer` lists it.

    `expiring_within_7_days` uses the expiry rules in force, so a malformed
    `applications.expiry` row is a 500 here as it is in the sweep, rather than
    a count against a period nobody configured.
    """
    now = now or datetime.now(UTC)
    tenant_id = await _bind_tenant(session, ctx)
    rules = await load_expiry_rules(session, now=now)
    trend_since = trend_start(now)
    recent_since = now - DASHBOARD_WINDOW

    counts = await repository.dashboard_counts(
        session,
        tenant_id=tenant_id,
        now=now,
        recent_since=recent_since,
        trend_since=trend_since,
        interviews_until=now + DASHBOARD_WINDOW,
        expiry_horizon=expiry_horizon(now=now, rules=rules, within=DASHBOARD_WINDOW),
    )
    by_stage = await repository.stage_totals(session, tenant_id=tenant_id)
    busiest = await repository.top_jobs(
        session, tenant_id=tenant_id, recent_since=recent_since, limit=top_jobs
    )
    interviews = await repository.upcoming_interviews(
        session, tenant_id=tenant_id, now=now, limit=UPCOMING_INTERVIEWS
    )
    per_day = await repository.submissions_by_day(
        session, tenant_id=tenant_id, since=trend_since, zone=IST_ZONE_NAME
    )
    jobs = await jobs_service.status_counts(session, ctx=ctx)
    revealed, revealed_recently = await discovery_service.revealed_counts(
        session, ctx=ctx, since=recent_since
    )
    titles = await jobs_service.titles(
        session,
        ctx=ctx,
        job_ids=list({row.job_id for row in busiest} | {row.job_id for row in interviews}),
    )

    return EmployerDashboard(
        generated_at=now,
        jobs=JobCounts(
            total=sum(jobs.values()),
            active=jobs["PUBLISHED"],
            draft=jobs["DRAFT"],
            paused=jobs["PAUSED"],
            closed=jobs["CLOSED"],
        ),
        applications=ApplicationCounts(
            total=counts["total"],
            open=counts["open"],
            distinct_candidates=counts["distinct_candidates"],
            new_last_7_days=counts["new_recent"],
            new_last_30_days=counts["new_trend"],
            by_stage=by_stage,
        ),
        needs_attention=NeedsAttention(
            unreviewed=by_stage["SUBMITTED"],
            interviews_to_schedule=counts["interviews_to_schedule"],
            interviews_next_7_days=counts["interviews_upcoming"],
            hires_awaiting_candidate=counts["hires_awaiting_candidate"],
            hires_disputed=counts["hires_disputed"],
            expiring_within_7_days=counts["expiring"],
        ),
        candidates_revealed=RevealCounts(total=revealed, last_7_days=revealed_recently),
        top_jobs=[
            TopJob(
                job_id=row.job_id,
                title=titles[row.job_id][0],
                status=titles[row.job_id][1],
                applications=row.applications,
                open=row.open,
                new_last_7_days=row.new_recent,
                last_applied_at=row.last_applied_at,
            )
            for row in busiest
        ],
        upcoming_interviews=[
            UpcomingInterview(
                application_id=row.id,
                job_id=row.job_id,
                job_title=titles[row.job_id][0],
                interview_at=row.interview_at,
                meeting_url=row.meeting_url,
            )
            for row in interviews
        ],
        applications_per_day=[
            DailyApplications(date=day, count=count)
            for day, count in daily_series(per_day, now=now)
        ],
    )


def _activity_after(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    payload = decode_cursor(cursor)
    try:
        return datetime.fromisoformat(str(payload["o"])), uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError) as exc:
        raise ValidationError(code="invalid_cursor") from exc


async def activity(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    actor: str | None,
    cursor: str | None,
    limit: int | None,
) -> Page[ActivityItem]:
    """The organisation's pipeline history across every job, newest first.

    `actor` narrows it to what candidates did, what the team did, or what the
    clock did. Paged by `(occurred_at, id)`, which is the order the events
    were written in.
    """
    tenant_id = await _bind_tenant(session, ctx)
    page_size = clamp_limit(limit)
    rows = await repository.recent_events(
        session,
        tenant_id=tenant_id,
        actor_type=actor,
        after=_activity_after(cursor),
        limit=page_size + 1,
    )
    page, more = rows[:page_size], len(rows) > page_size
    titles = await jobs_service.titles(session, ctx=ctx, job_ids=list({r.job_id for r in page}))
    next_cursor = (
        encode_cursor({"o": page[-1].occurred_at.isoformat(), "i": str(page[-1].id)})
        if more and page
        else None
    )
    return Page[ActivityItem](
        items=[
            ActivityItem(
                id=r.id,
                application_id=r.application_id,
                job_id=r.job_id,
                job_title=titles.get(r.job_id, (None, None))[0],
                kind=r.kind,
                from_stage=r.from_stage,
                to_stage=r.to_stage,
                by=r.actor_type,
                actor_id=r.actor_id if r.actor_type == "EMPLOYER" else None,
                occurred_at=r.occurred_at,
            )
            for r in page
        ],
        next_cursor=next_cursor,
    )


# ---------------------------------------------------------------------------
# Messages to an applicant (2026-09-29)
# ---------------------------------------------------------------------------
class MessageInvalidError(ValidationError):
    """`code` is the domain's refusal, e.g. `message_time_required`."""

    code = "message_invalid"
    title = "The message cannot be sent"


class MessageNotAllowedError(ConflictError):
    """The application is finished: hired, rejected, withdrawn or expired."""

    code = "message_not_allowed_at_stage"
    title = "This application is closed"


class MessageLimitError(AppError):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    code = "message_limit_reached"
    title = "Too many messages to this candidate today"


async def send_message(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    application_id: uuid.UUID,
    kind: str,
    body: str,
    scheduled_at: datetime | None,
    link: str | None,
    now: datetime | None = None,
    request_id: str | None = None,
) -> ApplicationMessage:
    """Write to an applicant. **The platform sends it**, by email and in the
    app, so the employer never learns the candidate's address.

    Checked before the application is looked up, as for an interview: a bad
    message is bad whoever it is for. Audited without its words, and counted
    as employer activity so the application does not expire under a live
    conversation.
    """
    now = now or datetime.now(UTC)
    body = body.strip()
    refused = refuse_message(kind=kind, body=body, scheduled_at=scheduled_at, link=link, now=now)
    if refused is not None:
        raise MessageInvalidError(code=refused)
    await enforce("applications.message", subject=str(ctx.tenant_id))

    row = await _theirs(session, ctx, application_id, for_update=True)
    if row.stage not in MESSAGEABLE_STAGES:
        raise MessageNotAllowedError(params={"stage": row.stage})
    sent_today = await repository.count_messages_since(
        session, application_id=row.id, since=now - timedelta(days=1)
    )
    if sent_today >= MAX_MESSAGES_PER_APPLICATION_PER_DAY:
        raise MessageLimitError()

    message = await repository.insert_message(
        session,
        application_id=row.id,
        sender_id=ctx.user_id,
        kind=kind,
        body=body,
        scheduled_at=scheduled_at,
        link=link,
    )
    await repository.save(session, application=row, employer_active_at=now)
    await audit_event(
        session,
        action=AuditAction.APPLICATION_MESSAGE_SENT,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="application",
        target_id=row.id,
        tenant_id=row.tenant_id,
        request_id=request_id,
        metadata={"message_id": str(message.id), "kind": kind},
    )
    await emit(
        session,
        event_type=MESSAGE_SENT,
        aggregate_type="application_message",
        aggregate_id=message.id,
        payload={
            **_payload(row, message_id=str(message.id), kind=kind),
            "has_time": scheduled_at is not None,
        },
    )
    logger.info("application_message_sent", application_id=str(row.id), kind=kind)
    return message


async def messages_for_employer(
    session: AsyncSession, *, ctx: TenantContext, application_id: uuid.UUID
) -> list[ApplicationMessage]:
    row = await _theirs(session, ctx, application_id, for_update=False)
    return await repository.messages_for(session, application_id=row.id)


async def messages_for_candidate(
    session: AsyncSession, *, ctx: TenantContext, application_id: uuid.UUID
) -> tuple[ApplicationResponse, list[ApplicationMessage]]:
    """The candidate's own messages, with the application they are about
    (for the employer's name and logo). Not paywalled, like reading their
    applications: a lapsed subscriber keeps what was sent to them."""
    row = await _mine(session, ctx, application_id, for_update=False)
    summary = (await _respond(session, ctx, [row]))[0]
    return summary, await repository.messages_for(session, application_id=row.id)


@dataclass(frozen=True, slots=True)
class MessageForDelivery:
    kind: str
    body: str
    scheduled_at: datetime | None
    link: str | None


async def message_for_delivery(
    session: AsyncSession, *, message_id: uuid.UUID
) -> MessageForDelivery | None:
    """**Notifications only**, resolving a `message_sent` event's words at
    dispatch -- the outbox payload carries ids, never content."""
    message = await repository.message_by_id(session, message_id=message_id)
    if message is None:
        return None
    return MessageForDelivery(message.kind, message.body, message.scheduled_at, message.link)


# ---------------------------------------------------------------------------
# The shortlist (2026-10-05)
# ---------------------------------------------------------------------------
class ShortlistNotFoundError(NotFoundError):
    code = "shortlist_not_found"
    title = "Shortlist entry not found"


class ShortlistJobNotOpenError(ConflictError):
    """An invitation is to a PUBLISHED job, and is accepted only while it is."""

    code = "shortlist_job_not_open"
    title = "This job is not open for applications"


class AlreadyAppliedError(ConflictError):
    """The candidate is already in the pipeline for this job. `params`
    carries the application's id, for the employer to open it there."""

    code = "already_applied"
    title = "This candidate has already applied to this job"


class AlreadyHiredError(ConflictError):
    """The candidate was hired into this job. HIRED is terminal, so it is not
    "in the pipeline" and `AlreadyAppliedError` does not cover it."""

    code = "already_hired"
    title = "This candidate has already been hired for this job"


class ShortlistRefusedError(ConflictError):
    """`code` is the domain's: `shortlist_declined` (the candidate said no to
    this job; their answer stands) or `shortlist_already_accepted`."""

    code = "shortlist_refused"
    title = "This candidate cannot be invited to this job again"


class ShortlistNotPendingError(ConflictError):
    code = "shortlist_not_pending"
    title = "This invitation is no longer open"


def _shortlist_entry(
    row: Any, *, job_title: str | None = None, candidate: ApplicantCard | None = None
) -> ShortlistEntry:
    return ShortlistEntry(
        id=row.id,
        candidate_id=row.candidate_id,
        job_id=row.job_id,
        job_title=job_title,
        status=row.status,
        application_id=row.application_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
        answered_at=row.answered_at,
        candidate=candidate,
    )


async def shortlist_candidate(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID | None,
    request_id: str | None = None,
) -> tuple[ShortlistEntry, bool]:
    """Save a candidate the organisation has opened, or invite them to one of
    its PUBLISHED jobs. Returns the entry and whether anything changed.

    Repeating either is a retry and returns the same row. A CANCELLED
    invitation is re-opened; a DECLINED one is refused, because the
    candidate's answer to this job stands. A candidate already in the
    pipeline for the job is 409 `already_applied`, naming the application; one
    already HIRED into it is 409 `already_hired`.
    """
    tenant_id = await discovery_service.require_shortlistable(
        session, ctx=ctx, candidate_id=candidate_id
    )
    title: str | None = None
    if job_id is not None:
        job = await jobs_service.get_job(session, ctx=ctx, job_id=job_id)
        if job.status != "PUBLISHED":
            raise ShortlistJobNotOpenError()
        title = job.title
        active = await repository.active_for(session, job_id=job_id, candidate_id=candidate_id)
        if active is not None:
            raise AlreadyAppliedError(params={"application_id": str(active.id)})
        hired = await repository.hired_for(session, job_id=job_id, candidate_id=candidate_id)
        if hired is not None:
            raise AlreadyHiredError(params={"application_id": str(hired.id)})

    existing = await repository.shortlist_entry(
        session, tenant_id=tenant_id, candidate_id=candidate_id, job_id=job_id, for_update=True
    )
    if existing is not None and existing.status in ("SAVED", "INVITED"):
        return _shortlist_entry(existing, job_title=title), False
    refused = shortlist_invite_refusal(existing.status if existing else None)
    if refused is not None:
        raise ShortlistRefusedError(code=refused)

    if job_id is not None:
        await enforce("applications.shortlist_invite", subject=str(tenant_id))
    if existing is not None:  # CANCELLED: invite again
        row = await repository.set_shortlist_status(session, entry=existing, status="INVITED")
    else:
        inserted = await repository.insert_shortlist(
            session,
            tenant_id=tenant_id,
            candidate_id=candidate_id,
            job_id=job_id,
            status="SAVED" if job_id is None else "INVITED",
            created_by=ctx.user_id,
        )
        if inserted is None:  # a simultaneous request made it first
            winner = await repository.shortlist_entry(
                session, tenant_id=tenant_id, candidate_id=candidate_id, job_id=job_id
            )
            if winner is None:  # pragma: no cover - only if it was removed in between
                raise ShortlistNotFoundError()
            return _shortlist_entry(winner, job_title=title), False
        row = inserted

    await audit_event(
        session,
        action=AuditAction.CANDIDATE_SHORTLISTED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="candidate",
        target_id=candidate_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"shortlist_id": str(row.id), "job_id": str(job_id) if job_id else None},
    )
    if row.status == "INVITED":
        await emit(
            session,
            event_type=SHORTLIST_INVITED,
            aggregate_type="shortlist",
            aggregate_id=row.id,
            payload={
                "tenant_id": str(tenant_id),
                "job_id": str(job_id),
                "candidate_id": str(candidate_id),
            },
        )
    logger.info("candidate_shortlisted", shortlist_id=str(row.id), status=row.status)
    return _shortlist_entry(row, job_title=title), True


async def _tenant_entry(
    session: AsyncSession, ctx: TenantContext, shortlist_id: uuid.UUID
) -> tuple[uuid.UUID, Any]:
    tenant_id = await _bind_tenant(session, ctx)
    row = await repository.shortlist_for_tenant(
        session, tenant_id=tenant_id, shortlist_id=shortlist_id, for_update=True
    )
    if row is None:
        raise ShortlistNotFoundError()
    return tenant_id, row


async def cancel_invitation(
    session: AsyncSession, *, ctx: TenantContext, shortlist_id: uuid.UUID
) -> ShortlistEntry:
    """Withdraw an invitation the candidate has not answered. Repeating it
    returns the cancelled row; an answered one is 409 `shortlist_not_pending`."""
    _, row = await _tenant_entry(session, ctx, shortlist_id)
    if row.status == "CANCELLED":
        return _shortlist_entry(row)
    if row.status != "INVITED":
        raise ShortlistNotPendingError(params={"status": row.status})
    row = await repository.set_shortlist_status(session, entry=row, status="CANCELLED")
    return _shortlist_entry(row)


async def remove_saved(
    session: AsyncSession, *, ctx: TenantContext, shortlist_id: uuid.UUID
) -> None:
    """Forget a saved candidate. An invitation is cancelled, never removed:
    the candidate has seen it, and their answer is part of the record."""
    _, row = await _tenant_entry(session, ctx, shortlist_id)
    if row.status != "SAVED":
        raise ShortlistNotPendingError(params={"status": row.status})
    await repository.delete_saved(session, entry=row)


async def list_shortlist(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    job_id: uuid.UUID | None,
    status: str | None,
    cursor: str | None,
    limit: int | None,
    request_id: str | None = None,
) -> Page[ShortlistEntry]:
    """The organisation's shortlist, newest first, each row naming who it is
    (audited, one row per page) and the job."""
    tenant_id = await _bind_tenant(session, ctx)
    page_size = clamp_limit(limit)
    rows = await repository.shortlists_for_tenant(
        session,
        tenant_id=tenant_id,
        job_id=job_id,
        status=status,
        after=_after(cursor),
        limit=page_size + 1,
    )
    page, more = rows[:page_size], len(rows) > page_size
    job_ids = list({r.job_id for r in page if r.job_id is not None})
    labels = await jobs_service.labels(session, ctx=ctx, job_ids=job_ids) if job_ids else {}
    cards = await discovery_service.shortlisted_cards(
        session, ctx=ctx, candidate_ids=[r.candidate_id for r in page], request_id=request_id
    )
    items = []
    for row in page:
        card = cards.get(row.candidate_id)
        title = labels.get(row.job_id, (None, None))[0] if row.job_id is not None else None
        items.append(
            _shortlist_entry(
                row,
                job_title=title,
                candidate=ApplicantCard(**await _card(session, card)) if card else None,
            )
        )
    return Page[ShortlistEntry](items=items, next_cursor=_cursor(page, more))


async def shortlist_state(
    session: AsyncSession, *, ctx: TenantContext, candidate_id: uuid.UUID
) -> CandidateShortlistState:
    """The opened profile's Shortlist button: saved or not, and each invitation."""
    tenant_id = await _bind_tenant(session, ctx)
    rows = await repository.shortlists_of_candidate_in_tenant(
        session, tenant_id=tenant_id, candidate_id=candidate_id
    )
    return CandidateShortlistState(
        saved_id=next((r.id for r in rows if r.status == "SAVED"), None),
        invitations=[
            ShortlistInvitationState(
                id=r.id, job_id=r.job_id, status=r.status, application_id=r.application_id
            )
            for r in rows
            if r.job_id is not None
        ],
    )


# --- the candidate's side -------------------------------------------------------
async def _invitations(
    session: AsyncSession, ctx: TenantContext, rows: list[Any]
) -> list[ShortlistInvitation]:
    jobs = await jobs_service.jobs_for_candidate(
        session, ctx=ctx, job_ids=list({r.job_id for r in rows})
    )
    out = []
    for row in rows:
        job = jobs.get(row.job_id) or jobs_service.CandidateJobRef()
        out.append(
            ShortlistInvitation(
                id=row.id,
                job_id=row.job_id,
                job_title=job.title,
                employer_name=job.employer_name,
                employer_logo_url=job.employer_logo_url,
                status=row.status,
                application_id=row.application_id,
                created_at=row.created_at,
                answered_at=row.answered_at,
            )
        )
    return out


async def my_invitations(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    status: str | None,
    cursor: str | None,
    limit: int | None,
) -> Page[ShortlistInvitation]:
    """Invitations addressed to the candidate, newest first. Not paywalled:
    being asked is not something a candidate pays to see."""
    candidate_id = await jobs_service.bind_candidate(session, ctx)
    page_size = clamp_limit(limit)
    rows = await repository.invitations_for_candidate(
        session,
        candidate_id=candidate_id,
        status=status,
        after=_after(cursor),
        limit=page_size + 1,
    )
    page, more = rows[:page_size], len(rows) > page_size
    return Page[ShortlistInvitation](
        items=await _invitations(session, ctx, page), next_cursor=_cursor(page, more)
    )


async def _my_invitation(
    session: AsyncSession, ctx: TenantContext, shortlist_id: uuid.UUID, *, for_update: bool
) -> tuple[uuid.UUID, Any]:
    candidate_id = await jobs_service.bind_candidate(session, ctx)
    row = await repository.invitation_for_candidate(
        session, candidate_id=candidate_id, shortlist_id=shortlist_id, for_update=for_update
    )
    if row is None:
        raise ShortlistNotFoundError()
    return candidate_id, row


async def _answered(session: AsyncSession, ctx: TenantContext, row: Any, *, answer: str) -> None:
    await audit_event(
        session,
        action=AuditAction.SHORTLIST_ANSWERED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="shortlist",
        target_id=row.id,
        tenant_id=row.tenant_id,
        metadata={"answer": answer, "job_id": str(row.job_id)},
    )
    await emit(
        session,
        event_type=SHORTLIST_ANSWERED,
        aggregate_type="shortlist",
        aggregate_id=row.id,
        payload={
            "tenant_id": str(row.tenant_id),
            "job_id": str(row.job_id),
            "candidate_id": str(row.candidate_id),
            "answer": answer,
            "application_id": str(row.application_id) if row.application_id else None,
        },
    )


async def accept_invitation(
    session: AsyncSession, *, ctx: TenantContext, shortlist_id: uuid.UUID
) -> ShortlistInvitation:
    """Say yes: the application is filed and lands at SHORTLISTED, the
    employer's choice already made. Repeating it returns the accepted
    invitation.

    Not behind the candidate's subscription, and the job's minimum score is
    not applied: the employer chose this person. The discovery rule is
    applied, as on applying (409 `application_unavailable`), and the job must
    still be on the board (409 `shortlist_job_not_open`). An application the
    candidate already had for the job is used and moved up to SHORTLISTED.
    """
    candidate_id, row = await _my_invitation(session, ctx, shortlist_id, for_update=False)
    if row.status == "ACCEPTED":
        return (await _invitations(session, ctx, [row]))[0]
    if row.status != "INVITED":
        raise ShortlistNotPendingError(params={"status": row.status})
    if not await discovery_service.is_candidate_visible(session, candidate_id=candidate_id):
        raise ApplicationUnavailableError()
    had = await repository.active_for(session, job_id=row.job_id, candidate_id=candidate_id)

    try:
        async with session.begin_nested():
            application_id = await repository.accept_invitation(session, shortlist_id=row.id)
    except DBAPIError as exc:
        if "SHORTLIST_JOB_CLOSED" in str(exc.orig):
            raise ShortlistJobNotOpenError() from exc
        if "SHORTLIST_NOT_PENDING" in str(exc.orig):
            raise ShortlistNotPendingError() from exc
        raise
    if application_id is None:  # pragma: no cover - the read above found it
        raise ShortlistNotFoundError()

    _, row = await _my_invitation(session, ctx, shortlist_id, for_update=False)
    if had is None:
        await emit(
            session,
            event_type=APPLICATION_SUBMITTED,
            aggregate_type="application",
            aggregate_id=application_id,
            payload={
                "tenant_id": str(row.tenant_id),
                "job_id": str(row.job_id),
                "candidate_id": str(candidate_id),
            },
        )
    await _answered(session, ctx, row, answer="ACCEPTED")
    logger.info("shortlist_accepted", shortlist_id=str(row.id), application_id=str(application_id))
    return (await _invitations(session, ctx, [row]))[0]


async def decline_invitation(
    session: AsyncSession, *, ctx: TenantContext, shortlist_id: uuid.UUID
) -> ShortlistInvitation:
    """Say no. Final for this job: the employer cannot ask again. Repeating
    it returns the declined invitation."""
    candidate_id, row = await _my_invitation(session, ctx, shortlist_id, for_update=False)
    if row.status == "DECLINED":
        return (await _invitations(session, ctx, [row]))[0]
    if row.status != "INVITED":
        raise ShortlistNotPendingError(params={"status": row.status})
    row = await repository.invitation_for_candidate(
        session, candidate_id=candidate_id, shortlist_id=shortlist_id, for_update=True
    )
    if row is None:  # answered or cancelled a moment ago
        raise ShortlistNotPendingError()
    row = await repository.set_shortlist_status(
        session, entry=row, status="DECLINED", answered=True
    )
    await _answered(session, ctx, row, answer="DECLINED")
    return (await _invitations(session, ctx, [row]))[0]
