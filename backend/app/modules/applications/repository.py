"""applications - data access

Apply, stages, withdraw, expiry, hire confirm.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**`applications` is under Row-Level Security twice over.** Employers read it
through the tenant policy, with `app.tenant_id` bound by the service;
candidates through the candidate policies, with `app.user_id` bound. The
`tenant_id` and `candidate_id` predicates here are belt and braces on top of
those, not instead of them.

**`application_events` is not under RLS** -- it has no tenant column. It is
only ever read by application id, for an application the caller has already
been shown under the policies above.

**The stage machine is not enforced here, and cannot be bypassed from here.**
`save` writes what it is given; `guard_application_write` refuses a transition
the pipeline does not allow on the flush.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Date,
    cast,
    delete,
    distinct,
    func,
    insert,
    literal,
    or_,
    select,
    text,
    tuple_,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import ConfigValue
from app.modules.applications.domain import INTERVIEW_STAGE, STAGES, TERMINAL_STAGES
from app.modules.applications.models import (
    Application,
    ApplicationEvent,
    ApplicationMessage,
    EmployerShortlist,
)


async def insert_if_absent(
    session: AsyncSession, *, tenant_id: uuid.UUID, job_id: uuid.UUID, candidate_id: uuid.UUID
) -> uuid.UUID | None:
    """Create a SUBMITTED application, or do nothing if one is already active.

    Returns the new id, or None when `uq_application_active` said no. **The
    index is the duplicate check, not a read before the write**: two
    simultaneous applies both see no application, and only the index can make
    one of them lose. `ON CONFLICT DO NOTHING` turns that loss into an
    ordinary outcome rather than an exception that aborts the transaction.
    """
    result = await session.execute(
        pg_insert(Application)
        .values(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            job_id=job_id,
            candidate_id=candidate_id,
            stage="SUBMITTED",
        )
        .on_conflict_do_nothing()
        .returning(Application.id)
    )
    return result.scalar_one_or_none()


async def active_for(
    session: AsyncSession, *, job_id: uuid.UUID, candidate_id: uuid.UUID
) -> Application | None:
    result = await session.execute(
        select(Application).where(
            Application.job_id == job_id,
            Application.candidate_id == candidate_id,
            Application.stage.not_in(TERMINAL_STAGES),
        )
    )
    return result.scalar_one_or_none()


async def hired_for(
    session: AsyncSession, *, job_id: uuid.UUID, candidate_id: uuid.UUID
) -> Application | None:
    """The candidate's HIRED application for this job, if there is one.
    HIRED is terminal, so `active_for` does not see it."""
    result = await session.execute(
        select(Application)
        .where(
            Application.job_id == job_id,
            Application.candidate_id == candidate_id,
            Application.stage == "HIRED",
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_for_candidate(
    session: AsyncSession,
    *,
    application_id: uuid.UUID,
    candidate_id: uuid.UUID,
    for_update: bool = False,
) -> Application | None:
    stmt = select(Application).where(
        Application.id == application_id, Application.candidate_id == candidate_id
    )
    if for_update:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(stmt)).scalar_one_or_none()


async def get_for_tenant(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    application_id: uuid.UUID,
    for_update: bool = False,
) -> Application | None:
    """One application in the tenant's pipeline.

    `populate_existing` with the lock: a row read a moment earlier in this
    session is already in the identity map, and without it the locked read
    would hand back those stale attributes rather than what the lock waited
    for.
    """
    stmt = select(Application).where(
        Application.id == application_id, Application.tenant_id == tenant_id
    )
    if for_update:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(stmt)).scalar_one_or_none()


def _keyset(after: tuple[datetime, uuid.UUID], *, descending: bool) -> Any:
    left = tuple_(Application.created_at, Application.id)
    right = tuple_(
        literal(after[0], Application.created_at.type), literal(after[1], Application.id.type)
    )
    return left < right if descending else left > right


async def list_for_candidate(
    session: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
    stages: tuple[str, ...] | None = None,
) -> list[Application]:
    """Newest first, keyset-paginated on `(created_at, id)`; `ix_applications_candidate`.
    `stages` narrows to one tab of the board; None is every stage."""
    stmt = select(Application).where(Application.candidate_id == candidate_id)
    if stages is not None:
        stmt = stmt.where(Application.stage.in_(stages))
    if after is not None:
        stmt = stmt.where(_keyset(after, descending=True))
    result = await session.execute(
        stmt.order_by(Application.created_at.desc(), Application.id.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def list_for_employer(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    job_id: uuid.UUID | None,
    stages: tuple[str, ...] | None,
    candidate_ids: list[uuid.UUID] | None = None,
    applied_from: datetime | None = None,
    applied_before: datetime | None = None,
    newest_first: bool = False,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[Application]:
    """**Oldest first** by default, unlike the candidate's board: a pipeline is
    worked in the order people applied, and the oldest are the ones nearest
    expiry. `newest_first` turns it round for a list that wants the latest.

    One job (`ix_applications_job_stage`) or, with `job_id` None, every job
    the organisation has (`ix_applications_tenant_created`). `candidate_ids`
    is a name search already resolved by discovery; an empty list is no one."""
    stmt = select(Application).where(Application.tenant_id == tenant_id)
    if job_id is not None:
        stmt = stmt.where(Application.job_id == job_id)
    if stages is not None:
        stmt = stmt.where(Application.stage.in_(stages))
    if candidate_ids is not None:
        stmt = stmt.where(Application.candidate_id.in_(candidate_ids))
    if applied_from is not None:
        stmt = stmt.where(Application.created_at >= applied_from)
    if applied_before is not None:
        stmt = stmt.where(Application.created_at < applied_before)
    if after is not None:
        stmt = stmt.where(_keyset(after, descending=newest_first))
    order = (
        (Application.created_at.desc(), Application.id.desc())
        if newest_first
        else (Application.created_at.asc(), Application.id.asc())
    )
    result = await session.execute(stmt.order_by(*order).limit(limit))
    return list(result.scalars().all())


async def save(session: AsyncSession, *, application: Application, **changes: Any) -> Application:
    """Write `changes` in one UPDATE. The database guard judges it on the flush.

    One call is one statement, which matters twice: confirming a hire sets the
    confirmation and HIRED together, because the CHECK refuses either alone;
    and a two-stage move is two calls, because the guard sees each step.
    """
    for field, value in changes.items():
        setattr(application, field, value)
    await session.flush()
    await session.refresh(application, attribute_names=["updated_at"])
    return application


async def record_event(
    session: AsyncSession,
    *,
    application_id: uuid.UUID,
    from_stage: str | None,
    to_stage: str,
    actor_type: str,
    actor_id: uuid.UUID | None,
    kind: str = "STAGE_CHANGED",
    note: str | None = None,
) -> None:
    """Append one event. `application_events` has no UPDATE or DELETE grant."""
    await session.execute(
        insert(ApplicationEvent).values(
            id=uuid.uuid4(),
            application_id=application_id,
            kind=kind,
            from_stage=from_stage,
            to_stage=to_stage,
            actor_type=actor_type,
            actor_id=actor_id,
            note=note,
        )
    )


async def events_for(session: AsyncSession, *, application_id: uuid.UUID) -> list[ApplicationEvent]:
    result = await session.execute(
        select(ApplicationEvent)
        .where(ApplicationEvent.application_id == application_id)
        .order_by(ApplicationEvent.occurred_at.asc(), ApplicationEvent.id.asc())
    )
    return list(result.scalars().all())


async def lock_expirable(
    session: AsyncSession, *, tenant_id: uuid.UUID, cutoff: datetime, limit: int
) -> list[Application]:
    """Open applications in one tenant whose employer has been quiet since `cutoff`.

    The index-assisted half of `domain.expires`; the service re-checks each row
    against the rule itself. **`SKIP LOCKED`**: a row an employer is moving
    right now is left for the next sweep rather than waited on, and when that
    employer commits it is no longer quiet.
    """
    result = await session.execute(
        select(Application)
        .where(
            Application.tenant_id == tenant_id,
            Application.stage.not_in(TERMINAL_STAGES),
            Application.employer_confirmed_at.is_(None),
            Application.employer_active_at < cutoff,
            or_(Application.interview_at.is_(None), Application.interview_at < cutoff),
        )
        .order_by(Application.employer_active_at.asc())
        .limit(limit)
        .with_for_update(skip_locked=True)
    )
    return list(result.scalars().all())


async def current_config(session: AsyncSession, *, key: str, now: datetime) -> ConfigValue | None:
    """The highest version of a config key in effect at `now`."""
    result = await session.execute(
        select(ConfigValue)
        .where(ConfigValue.key == key, ConfigValue.effective_from <= now)
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# The employer dashboard
# ---------------------------------------------------------------------------
# Every query here runs with `app.tenant_id` bound, and reads nothing about a
# candidate but the id the pipeline already shows. Aggregates, not rows, except
# for the upcoming interviews and the activity feed, which are the employer's
# own pipeline in another order.
_OPEN = Application.stage.not_in(TERMINAL_STAGES)


async def dashboard_counts(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    now: datetime,
    recent_since: datetime,
    trend_since: datetime,
    interviews_until: datetime,
    expiry_horizon: datetime,
) -> dict[str, int]:
    """Every headline number in one pass over the organisation's applications.

    `FILTER` clauses rather than a query per tile, so the tiles are counted
    from the same snapshot and always add up.
    """
    last_activity = func.greatest(
        Application.employer_active_at,
        func.coalesce(Application.interview_at, Application.employer_active_at),
    )
    proposed = Application.employer_confirmed_at.is_not(None)
    at_decision = Application.stage == "DECISION"
    at_interview = Application.stage == INTERVIEW_STAGE
    row = (
        await session.execute(
            select(
                func.count().label("total"),
                func.count().filter(_OPEN).label("open"),
                func.count(distinct(Application.candidate_id)).label("distinct_candidates"),
                func.count().filter(Application.created_at >= recent_since).label("new_recent"),
                func.count().filter(Application.created_at >= trend_since).label("new_trend"),
                func.count()
                .filter(
                    at_interview,
                    Application.interview_at >= now,
                    Application.interview_at < interviews_until,
                )
                .label("interviews_upcoming"),
                func.count()
                .filter(at_interview, Application.interview_at.is_(None))
                .label("interviews_to_schedule"),
                func.count()
                .filter(at_decision, proposed, Application.hire_disputed_at.is_(None))
                .label("hires_awaiting_candidate"),
                func.count()
                .filter(at_decision, proposed, Application.hire_disputed_at.is_not(None))
                .label("hires_disputed"),
                func.count()
                .filter(_OPEN, Application.employer_confirmed_at.is_(None))
                .filter(last_activity < expiry_horizon)
                .label("expiring"),
            ).where(Application.tenant_id == tenant_id)
        )
    ).one()
    return dict(row._mapping)


async def stage_totals(session: AsyncSession, *, tenant_id: uuid.UUID) -> dict[str, int]:
    """Where the organisation's applications stand now, every stage present."""
    counts = dict.fromkeys(STAGES, 0)
    rows = await session.execute(
        select(Application.stage, func.count())
        .where(Application.tenant_id == tenant_id)
        .group_by(Application.stage)
    )
    for stage, at_stage in rows:
        counts[stage] = at_stage
    return counts


async def top_jobs(
    session: AsyncSession, *, tenant_id: uuid.UUID, recent_since: datetime, limit: int
) -> list[Any]:
    """The jobs with the most applications, busiest first.

    Ties go to the job applied to most recently, then to the id, so the order
    is stable between two loads of the same page.
    """
    last_applied = func.max(Application.created_at)
    total = func.count()
    result = await session.execute(
        select(
            Application.job_id,
            total.label("applications"),
            func.count().filter(_OPEN).label("open"),
            func.count().filter(Application.created_at >= recent_since).label("new_recent"),
            last_applied.label("last_applied_at"),
        )
        .where(Application.tenant_id == tenant_id)
        .group_by(Application.job_id)
        .order_by(total.desc(), last_applied.desc(), Application.job_id)
        .limit(limit)
    )
    return list(result.all())


async def submissions_by_day(
    session: AsyncSession, *, tenant_id: uuid.UUID, since: datetime, zone: str
) -> dict[date, int]:
    """Applications received per calendar day in `zone`, from `since`."""
    day = cast(func.timezone(zone, Application.created_at), Date)
    rows = await session.execute(
        select(day, func.count())
        .where(Application.tenant_id == tenant_id, Application.created_at >= since)
        .group_by(day)
    )
    return dict(rows.tuples().all())


async def upcoming_interviews(
    session: AsyncSession, *, tenant_id: uuid.UUID, now: datetime, limit: int
) -> list[Application]:
    """The next interviews booked, soonest first."""
    result = await session.execute(
        select(Application)
        .where(
            Application.tenant_id == tenant_id,
            Application.stage == INTERVIEW_STAGE,
            Application.interview_at >= now,
        )
        .order_by(Application.interview_at.asc(), Application.id.asc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def recent_events(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_type: str | None,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[Any]:
    """The organisation's pipeline history, newest first, across every job.

    **`application_events` has no RLS of its own**, and this is still only a
    read of events for applications the caller has been shown: the join to
    `applications` runs under the tenant policy, so another organisation's
    applications -- and with them their events -- are not there to join to.
    The tenant predicate is belt and braces, as everywhere in this file.
    """
    query = (
        select(
            ApplicationEvent.id,
            ApplicationEvent.application_id,
            Application.job_id,
            ApplicationEvent.kind,
            ApplicationEvent.from_stage,
            ApplicationEvent.to_stage,
            ApplicationEvent.actor_type,
            ApplicationEvent.actor_id,
            ApplicationEvent.occurred_at,
        )
        .join(Application, Application.id == ApplicationEvent.application_id)
        .where(Application.tenant_id == tenant_id)
    )
    if actor_type is not None:
        query = query.where(ApplicationEvent.actor_type == actor_type)
    if after is not None:
        query = query.where(
            tuple_(ApplicationEvent.occurred_at, ApplicationEvent.id)
            < tuple_(
                literal(after[0], ApplicationEvent.occurred_at.type),
                literal(after[1], ApplicationEvent.id.type),
            )
        )
    result = await session.execute(
        query.order_by(ApplicationEvent.occurred_at.desc(), ApplicationEvent.id.desc()).limit(limit)
    )
    return list(result.all())


# --- messages (2026-09-29) --------------------------------------------------------
# Read only by application id, after the application was loaded under the
# caller's policy -- the same rule as `application_events`.
async def insert_message(
    session: AsyncSession,
    *,
    application_id: uuid.UUID,
    sender_id: uuid.UUID,
    kind: str,
    body: str,
    scheduled_at: datetime | None,
    link: str | None,
) -> ApplicationMessage:
    row = ApplicationMessage(
        application_id=application_id,
        sender_id=sender_id,
        kind=kind,
        body=body,
        scheduled_at=scheduled_at,
        link=link,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def messages_for(
    session: AsyncSession, *, application_id: uuid.UUID
) -> list[ApplicationMessage]:
    result = await session.execute(
        select(ApplicationMessage)
        .where(ApplicationMessage.application_id == application_id)
        .order_by(ApplicationMessage.created_at, ApplicationMessage.id)
    )
    return list(result.scalars())


async def count_messages_since(
    session: AsyncSession, *, application_id: uuid.UUID, since: datetime
) -> int:
    result = await session.execute(
        select(func.count(ApplicationMessage.id)).where(
            ApplicationMessage.application_id == application_id,
            ApplicationMessage.created_at >= since,
        )
    )
    return int(result.scalar_one())


async def message_by_id(
    session: AsyncSession, *, message_id: uuid.UUID
) -> ApplicationMessage | None:
    """**For notification dispatch only**, which binds no tenant -- so it
    must not touch `applications`, whose policy would hide the row. The
    event payload already names the tenant."""
    return await session.get(ApplicationMessage, message_id)


# ---------------------------------------------------------------------------
# The shortlist (2026-10-05)
#
# `employer_shortlists` is under RLS like `applications`: the tenant policy
# for the organisation, two candidate policies for the person (read an
# invitation, decline one). The predicates here are belt and braces.
# ---------------------------------------------------------------------------
async def shortlist_entry(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID | None,
    for_update: bool = False,
) -> EmployerShortlist | None:
    """The organisation's row for this candidate and job (the SAVED row when
    `job_id` is None), if any."""
    stmt = select(EmployerShortlist).where(
        EmployerShortlist.tenant_id == tenant_id,
        EmployerShortlist.candidate_id == candidate_id,
        EmployerShortlist.job_id.is_(None)
        if job_id is None
        else EmployerShortlist.job_id == job_id,
    )
    if for_update:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(stmt)).scalar_one_or_none()


async def insert_shortlist(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    candidate_id: uuid.UUID,
    job_id: uuid.UUID | None,
    status: str,
    created_by: uuid.UUID,
) -> EmployerShortlist | None:
    """None when a simultaneous request made the same row first."""
    stmt = (
        pg_insert(EmployerShortlist)
        .values(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            candidate_id=candidate_id,
            job_id=job_id,
            status=status,
            created_by=created_by,
        )
        .on_conflict_do_nothing(index_elements=["tenant_id", "candidate_id", "job_id"])
        .returning(EmployerShortlist.id)
    )
    new_id = (await session.execute(stmt)).scalar_one_or_none()
    if new_id is None:
        return None
    return await session.get(EmployerShortlist, new_id)


async def shortlist_for_tenant(
    session: AsyncSession, *, tenant_id: uuid.UUID, shortlist_id: uuid.UUID, for_update: bool
) -> EmployerShortlist | None:
    stmt = select(EmployerShortlist).where(
        EmployerShortlist.id == shortlist_id, EmployerShortlist.tenant_id == tenant_id
    )
    if for_update:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(stmt)).scalar_one_or_none()


async def set_shortlist_status(
    session: AsyncSession, *, entry: EmployerShortlist, status: str, answered: bool = False
) -> EmployerShortlist:
    """`guard_shortlist_write` refuses a move that is not this party's."""
    entry.status = status
    if answered:
        entry.answered_at = func.now()
    entry.updated_at = func.now()
    await session.flush()
    await session.refresh(entry)
    return entry


async def delete_saved(session: AsyncSession, *, entry: EmployerShortlist) -> None:
    """A SAVED row only; the guard refuses anything else."""
    await session.execute(delete(EmployerShortlist).where(EmployerShortlist.id == entry.id))


async def shortlists_for_tenant(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    job_id: uuid.UUID | None,
    status: str | None,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[EmployerShortlist]:
    """Newest first, `ix_shortlists_tenant_created`."""
    stmt = select(EmployerShortlist).where(EmployerShortlist.tenant_id == tenant_id)
    if job_id is not None:
        stmt = stmt.where(EmployerShortlist.job_id == job_id)
    if status is not None:
        stmt = stmt.where(EmployerShortlist.status == status)
    if after is not None:
        stmt = stmt.where(
            tuple_(EmployerShortlist.created_at, EmployerShortlist.id)
            < tuple_(
                literal(after[0], EmployerShortlist.created_at.type),
                literal(after[1], EmployerShortlist.id.type),
            )
        )
    result = await session.execute(
        stmt.order_by(EmployerShortlist.created_at.desc(), EmployerShortlist.id.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def shortlists_of_candidate_in_tenant(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_id: uuid.UUID
) -> list[EmployerShortlist]:
    """Every row this organisation has for one candidate: the reveal's button state."""
    result = await session.execute(
        select(EmployerShortlist)
        .where(
            EmployerShortlist.tenant_id == tenant_id,
            EmployerShortlist.candidate_id == candidate_id,
        )
        .order_by(EmployerShortlist.created_at)
    )
    return list(result.scalars().all())


async def invitations_for_candidate(
    session: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    status: str | None,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[EmployerShortlist]:
    """Newest first. The candidate policy hides SAVED rows; so does this."""
    stmt = select(EmployerShortlist).where(
        EmployerShortlist.candidate_id == candidate_id, EmployerShortlist.status != "SAVED"
    )
    if status is not None:
        stmt = stmt.where(EmployerShortlist.status == status)
    if after is not None:
        stmt = stmt.where(
            tuple_(EmployerShortlist.created_at, EmployerShortlist.id)
            < tuple_(
                literal(after[0], EmployerShortlist.created_at.type),
                literal(after[1], EmployerShortlist.id.type),
            )
        )
    result = await session.execute(
        stmt.order_by(EmployerShortlist.created_at.desc(), EmployerShortlist.id.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def invitation_for_candidate(
    session: AsyncSession, *, candidate_id: uuid.UUID, shortlist_id: uuid.UUID, for_update: bool
) -> EmployerShortlist | None:
    """Always re-read (`populate_existing`): the accept function writes the row
    behind the ORM's back. **A lock reaches only an INVITED row** -- `FOR
    UPDATE` must pass the candidate's UPDATE policy, which admits nothing
    else -- so lock only to answer one."""
    stmt = (
        select(EmployerShortlist)
        .where(
            EmployerShortlist.id == shortlist_id,
            EmployerShortlist.candidate_id == candidate_id,
            EmployerShortlist.status != "SAVED",
        )
        .execution_options(populate_existing=True)
    )
    if for_update:
        stmt = stmt.with_for_update()
    return (await session.execute(stmt)).scalar_one_or_none()


async def accept_invitation(session: AsyncSession, *, shortlist_id: uuid.UUID) -> uuid.UUID | None:
    """`accept_shortlist_invitation` (migration 0010): the application filed
    and walked to SHORTLISTED, the invitation marked ACCEPTED, in one call."""
    result = await session.execute(
        text("SELECT accept_shortlist_invitation(CAST(:s AS uuid))"), {"s": str(shortlist_id)}
    )
    return result.scalar_one_or_none()
