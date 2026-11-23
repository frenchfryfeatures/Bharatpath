"""jobs - data access

Composer, validation, publish gate, lifecycle.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**`jobs` is under Row-Level Security**, and every function assumes the service
has bound `app.tenant_id` first. The `tenant_id` predicates are belt and
braces, not the isolation.

**The publish gate does not live here, and cannot be bypassed from here.**
`set_status` writes whatever it is given; the Postgres trigger
`enforce_kyb_before_publish` refuses `PUBLISHED` for an unverified employer on
the flush. Invariant 8 requires exactly that: a direct repository call fails
too.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Final

from sqlalchemy import (
    DateTime,
    String,
    Text,
    and_,
    bindparam,
    column,
    exists,
    false,
    func,
    literal,
    or_,
    select,
    table,
    text,
    true,
    tuple_,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import ConfigValue
from app.modules.applications.domain import STAGES
from app.modules.jobs.domain import MatchTerms
from app.modules.jobs.models import JOB_STATES, Job

#: The fields an edit may change. `status`, `published_at` and `closed_at` are
#: absent: they move only through `set_status`, the one path the lifecycle
#: rules and the publish gate sit in front of.
EDITABLE_FIELDS: Final[frozenset[str]] = frozenset(
    {
        "title",
        "description",
        "skills",
        "location",
        "work_mode",
        "experience_min_months",
        "salary_min_minor",
        "salary_max_minor",
        "min_score",
        "details",
    }
)


async def create_job(session: AsyncSession, *, tenant_id: uuid.UUID, fields: dict[str, Any]) -> Job:
    unexpected = set(fields) - EDITABLE_FIELDS
    if unexpected:
        raise ValueError(f"not settable on creation: {sorted(unexpected)}")
    job = Job(tenant_id=tenant_id, status="DRAFT", **fields)
    session.add(job)
    await session.flush()
    return job


async def get_job(session: AsyncSession, *, tenant_id: uuid.UUID, job_id: uuid.UUID) -> Job | None:
    result = await session.execute(select(Job).where(Job.id == job_id, Job.tenant_id == tenant_id))
    return result.scalar_one_or_none()


def _has_skill(skill: str) -> Any:
    """The job asks for `skill` (or any of comma-separated skills), compared
    case-insensitively and whole."""
    skills = [part.strip().lower() for part in skill.split(",") if part.strip()]
    if len(skills) <= 1:
        target = skills[0] if skills else skill.lower()
        return text(
            "EXISTS (SELECT 1 FROM jsonb_array_elements_text(jobs.skills) AS s(name) "
            "WHERE lower(s.name) = :skill)"
        ).bindparams(skill=target)
    return text(
        "EXISTS (SELECT 1 FROM jsonb_array_elements_text(jobs.skills) AS s(name) "
        "WHERE lower(s.name) = ANY(:skills))"
    ).bindparams(bindparam("skills", value=skills, type_=ARRAY(Text)))


def _employer_job_filters(
    *,
    tenant_id: uuid.UUID,
    statuses: Sequence[str] | None,
    query: str | None,
    work_mode: str | None = None,
    skill: str | None = None,
    created_from: datetime | None = None,
    created_before: datetime | None = None,
) -> list[Any]:
    filters: list[Any] = [Job.tenant_id == tenant_id]
    if statuses:
        filters.append(Job.status.in_(list(statuses)))
    if query:
        pattern = _contains(query)
        filters.append(
            or_(
                Job.title.ilike(pattern, escape="\\"),
                Job.location.ilike(pattern, escape="\\"),
            )
        )
    if work_mode is not None:
        filters.append(Job.work_mode == work_mode)
    if skill:
        filters.append(_has_skill(skill))
    if created_from is not None:
        filters.append(Job.created_at >= created_from)
    if created_before is not None:
        filters.append(Job.created_at < created_before)
    return filters


async def list_jobs(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    statuses: Sequence[str] | None,
    query: str | None,
    work_mode: str | None = None,
    skill: str | None = None,
    created_from: datetime | None = None,
    created_before: datetime | None = None,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[Job]:
    stmt = select(Job).where(
        *_employer_job_filters(
            tenant_id=tenant_id,
            statuses=statuses,
            query=query,
            work_mode=work_mode,
            skill=skill,
            created_from=created_from,
            created_before=created_before,
        )
    )
    if after is not None:
        stmt = stmt.where(tuple_(Job.created_at, Job.id) < after)
    result = await session.execute(stmt.order_by(Job.created_at.desc(), Job.id.desc()).limit(limit))
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# The pipeline counts beside each job
# ---------------------------------------------------------------------------
# `applications` is the applications module's table, so it is read here as a
# table rather than through its ORM model, and the stage names come from that
# module's pure `domain` rather than being retyped. The dependency cannot run
# the other way round: `applications.service` already imports `jobs.service`,
# and a mutual import is what makes a module unextractable later.
_applications = table(
    "applications",
    column("tenant_id", PGUUID(as_uuid=True)),
    column("job_id", PGUUID(as_uuid=True)),
    column("stage", String),
    column("candidate_id", PGUUID(as_uuid=True)),
    column("created_at", DateTime(timezone=True)),
)

# Read-only view of `candidate_profiles` for re-ranking the candidate's own
# job board without importing the `candidate` module (same boundary rule as
# `_applications` and `_employers`).
_candidate_profiles = table(
    "candidate_profiles",
    column("user_id", PGUUID(as_uuid=True)),
    column("city", String),
    column("career", JSONB),
)


async def candidate_career_snapshot(
    session: AsyncSession, *, candidate_id: uuid.UUID
) -> tuple[str | None, dict[str, Any]]:
    """Return `(city, career_json)` for the signed-in candidate, or `(None, {})`."""
    row = (
        await session.execute(
            select(_candidate_profiles.c.city, _candidate_profiles.c.career)
            .where(_candidate_profiles.c.user_id == candidate_id)
            .limit(1)
        )
    ).first()
    if row is None:
        return None, {}
    career = row.career if isinstance(row.career, dict) else {}
    return row.city, career

#: Every stage at zero. A stage missing from the map would leave a caller
#: guessing whether nobody is at it or it has stopped existing.
NO_APPLICATIONS: Final[dict[str, int]] = dict.fromkeys(STAGES, 0)


async def stage_counts(
    session: AsyncSession, *, tenant_id: uuid.UUID, job_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, dict[str, int]]:
    """How many of each job's applications sit at each stage.

    **One aggregate for the whole page, not one query per job.** The list is
    what an employer lands on and it draws a funnel on every row, so a query
    per row would make the page cost grow with the number of jobs they have.

    The tenant predicate is belt and braces beside the RLS policy on
    `applications`, in the same way every query in this file is.
    """
    counts = {job_id: dict(NO_APPLICATIONS) for job_id in job_ids}
    if not counts:
        return counts
    rows = await session.execute(
        select(_applications.c.job_id, _applications.c.stage, func.count())
        .where(
            _applications.c.tenant_id == tenant_id,
            _applications.c.job_id.in_(list(counts)),
        )
        .group_by(_applications.c.job_id, _applications.c.stage)
    )
    for job_id, stage, at_stage in rows:
        counts[job_id][stage] = at_stage
    return counts


# ---------------------------------------------------------------------------
# The employer dashboard
# ---------------------------------------------------------------------------
async def status_counts(session: AsyncSession, *, tenant_id: uuid.UUID) -> dict[str, int]:
    """How many of the organisation's jobs are in each state, every state present."""
    counts = dict.fromkeys(JOB_STATES, 0)
    rows = await session.execute(
        select(Job.status, func.count()).where(Job.tenant_id == tenant_id).group_by(Job.status)
    )
    for state, in_state in rows:
        counts[state] = in_state
    return counts


async def titles(
    session: AsyncSession, *, tenant_id: uuid.UUID, job_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str]]:
    """`job id -> (title, status)` for this organisation's jobs among `job_ids`."""
    if not job_ids:
        return {}
    rows = await session.execute(
        select(Job.id, Job.title, Job.status).where(
            Job.tenant_id == tenant_id, Job.id.in_(list(job_ids))
        )
    )
    return {job_id: (title, state) for job_id, title, state in rows}


async def labels(
    session: AsyncSession, *, tenant_id: uuid.UUID, job_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, str | None]]:
    """`job id -> (title, location)` for this organisation's jobs among `job_ids`."""
    if not job_ids:
        return {}
    rows = await session.execute(
        select(Job.id, Job.title, Job.location).where(
            Job.tenant_id == tenant_id, Job.id.in_(list(job_ids))
        )
    )
    return {job_id: (title, location) for job_id, title, location in rows}


async def apply_changes(session: AsyncSession, *, job: Job, changes: dict[str, Any]) -> Job:
    unexpected = set(changes) - EDITABLE_FIELDS
    if unexpected:
        raise ValueError(f"not editable: {sorted(unexpected)}")
    for field, value in changes.items():
        setattr(job, field, value)
    await session.flush()
    return job


async def set_status(
    session: AsyncSession,
    *,
    job: Job,
    status: str,
    published_at: datetime | None = None,
    closed_at: datetime | None = None,
) -> Job:
    """Move a job. The trigger checks KYB on the flush when `status` is PUBLISHED."""
    job.status = status
    if published_at is not None:
        job.published_at = published_at
    if closed_at is not None:
        job.closed_at = closed_at
    await session.flush()
    return job


# ---------------------------------------------------------------------------
# The candidate board
# ---------------------------------------------------------------------------
# These run with `app.user_id` bound and no tenant, under the
# `jobs_candidate_board` policy. That policy also shows jobs the candidate has
# applied to, whatever their status -- so every board query below says
# `status = 'PUBLISHED'` itself rather than trusting the policy to.


def _contains(value: str) -> str:
    """An ILIKE pattern matching `value` literally, wildcards and all."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


#: Read-only, three columns: the name a candidate searches by. `jobs` may
#: not import `employer`'s models, and needs nothing else of the row.
_employers = table(
    "employers",
    column("tenant_id", PGUUID(as_uuid=True)),
    column("legal_name", String),
    column("trade_name", String),
)


def _matches_query(query: str) -> Any:
    """The board's search box (widened 2026-11-23): every word must appear in
    the title, description, location, a skill, or the employer's name.

    Before, `q` read only the title and description, so typing a company, a
    city or a skill found nothing whenever the description did not repeat
    it. The employer name is read through `employers` under whatever policy
    the caller bound -- for a candidate, `employers_candidate_board`, which
    shows only employers with a job they can see.
    """
    clauses: list[Any] = []
    for word in query.split()[:8]:
        pattern = _contains(word)
        skill = func.jsonb_array_elements_text(Job.skills).table_valued("value").alias("qs")
        clauses.append(
            or_(
                Job.title.ilike(pattern, escape="\\"),
                Job.description.ilike(pattern, escape="\\"),
                Job.location.ilike(pattern, escape="\\"),
                exists(
                    select(literal(1))
                    .select_from(skill)
                    .where(skill.c.value.ilike(pattern, escape="\\"))
                ),
                exists(
                    select(literal(1))
                    .where(
                        _employers.c.tenant_id == Job.tenant_id,
                        or_(
                            _employers.c.legal_name.ilike(pattern, escape="\\"),
                            _employers.c.trade_name.ilike(pattern, escape="\\"),
                        ),
                    )
                    .correlate(Job)
                ),
            )
        )
    return and_(*clauses) if clauses else true()


def _listed() -> Any:
    """Only PUBLIC jobs are searchable. PRIVATE and INVITE_ONLY jobs are
    published but unlisted: reachable by id (a shared link, an invitation),
    never by browsing. A row written before `details` existed is `{}` and
    therefore public, which is what every job was then."""
    return func.coalesce(Job.details["settings"]["visibility"].astext, "PUBLIC") == "PUBLIC"


async def search_board(
    session: AsyncSession,
    *,
    query: str | None,
    location: str | None,
    work_mode: str | None,
    skill: str | None,
    min_salary_minor: int | None,
    eligible_at_score: int | None,
    eligible_only: bool,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[Job]:
    """A page of published jobs, newest first, keyset-paginated.

    `eligible_only` with no score returns nothing: a candidate without a score
    can apply to nothing yet, so there is nothing eligible to show.

    Substring matching is enough for a board this size and is honest about
    what it is. The indexed search is for candidates, which is the
    query that grows; this one is bounded by how many jobs are live.
    """
    stmt = select(Job).where(Job.status == "PUBLISHED", _listed())
    if query:
        stmt = stmt.where(_matches_query(query))
    if location:
        cities = [part.strip() for part in location.split(",") if part.strip()]
        if len(cities) == 1:
            stmt = stmt.where(Job.location.ilike(_contains(cities[0]), escape="\\"))
        elif len(cities) > 1:
            stmt = stmt.where(or_(*[Job.location.ilike(_contains(c), escape="\\") for c in cities]))
    if work_mode:
        stmt = stmt.where(Job.work_mode == work_mode)
    if skill:
        stmt = stmt.where(_has_skill(skill))
    if min_salary_minor is not None:
        # A range that reaches the asked-for figure, not one that starts at it.
        stmt = stmt.where(Job.salary_max_minor >= min_salary_minor)
    if eligible_only:
        if eligible_at_score is None:
            stmt = stmt.where(false())
        else:
            stmt = stmt.where(or_(Job.min_score.is_(None), Job.min_score <= eligible_at_score))
    if after is not None:
        stmt = stmt.where(
            tuple_(Job.published_at, Job.id)
            < tuple_(literal(after[0], Job.published_at.type), literal(after[1], Job.id.type))
        )
    result = await session.execute(
        stmt.order_by(Job.published_at.desc(), Job.id.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def board_skills(session: AsyncSession, *, query: str | None, limit: int) -> list[str]:
    """Skills that listed, published jobs ask for, most asked-for first
    (2026-11-23). For the candidate's filter: every option leads to at
    least one job. One spelling per skill, compared case-insensitively.
    Job skills are what employers published; nothing here is a candidate's.
    """
    skill = func.jsonb_array_elements_text(Job.skills).table_valued("value").alias("bs")
    key = func.lower(func.btrim(skill.c.value))
    stmt = (
        select(func.min(func.btrim(skill.c.value)).label("label"))
        .select_from(Job)
        .join(skill, true())
        .where(Job.status == "PUBLISHED", _listed(), func.btrim(skill.c.value) != "")
        .group_by(key)
        .order_by(func.count(func.distinct(Job.id)).desc(), key)
        .limit(limit)
    )
    if query:
        stmt = stmt.where(skill.c.value.ilike(_contains(query.strip()), escape="\\"))
    return [str(row) for row in (await session.execute(stmt)).scalars().all()]


async def get_board_job(session: AsyncSession, *, job_id: uuid.UUID) -> Job | None:
    """One published job, or None -- a draft, paused or closed job reads as absent."""
    result = await session.execute(select(Job).where(Job.id == job_id, Job.status == "PUBLISHED"))
    return result.scalar_one_or_none()


async def jobs_by_id(session: AsyncSession, *, job_ids: list[uuid.UUID]) -> list[Job]:
    """Jobs by id, **whatever their status**, as far as the policy allows.

    For the candidate's Application Board, which must still name a job that
    closed after they applied. The policy limits this to published jobs and
    jobs the candidate applied to.
    """
    if not job_ids:
        return []
    result = await session.execute(select(Job).where(Job.id.in_(job_ids)))
    return list(result.scalars().all())


# ---------------------------------------------------------------------------
# Recommendations
# ---------------------------------------------------------------------------
# Same binding and same policy as the board above. The database narrows the
# board to jobs sharing a skill or a title word; `domain.match` ranks what
# comes back. Ranking in Python keeps the rule pure and tested in one place,
# and the pool bound keeps it cheap: the board is bounded by how many jobs are
# live, and the newest `pool` of the matching ones are the ones worth showing.


def _shares_a_term(terms: MatchTerms) -> Any:
    """The job asks for one of the skills, or its title has one of the words.

    The words are letters and digits only (`domain.title_words`), so they go
    inside the word-boundary pattern without escaping.
    """
    clauses: list[Any] = []
    if terms.skills:
        clauses.append(
            text(
                "EXISTS (SELECT 1 FROM jsonb_array_elements_text(jobs.skills) AS s(name) "
                "WHERE lower(btrim(s.name)) = ANY(:rec_skills))"
            ).bindparams(bindparam("rec_skills", sorted(terms.skills), type_=ARRAY(Text)))
        )
    if terms.narrowing_words:
        pattern = r"\m(" + "|".join(sorted(terms.narrowing_words)) + r")\M"
        clauses.append(func.lower(Job.title).regexp_match(pattern))
    return or_(*clauses) if clauses else false()


async def recommendation_pool(
    session: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    terms: MatchTerms,
    pool: int,
) -> list[Job]:
    """Listed, published jobs that share a term, newest first, leaving out
    every job the candidate already applied to -- whatever became of it."""
    applied = select(_applications.c.job_id).where(
        _applications.c.candidate_id == candidate_id,
        _applications.c.job_id == Job.id,
    )
    stmt = (
        select(Job)
        .where(Job.status == "PUBLISHED", _listed(), _shares_a_term(terms), ~applied.exists())
        .order_by(Job.published_at.desc(), Job.id.desc())
        .limit(pool)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def search_pool(
    session: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    terms: MatchTerms,
    locations: Sequence[str],
    work_mode: str | None,
    min_salary_minor: int | None,
    max_experience_months: int | None,
    eligible_at_score: int | None,
    eligible_only: bool,
    pool: int,
) -> list[Job]:
    """The chat assistant's search (2026-10-13): the recommendation pool with
    the board's filters on it, newest first.

    Terms narrow only when there are some; with none this is the board's
    newest jobs under the filters. Locations are any-of, each a substring of
    the job's location as the board's filter matches one. Jobs already
    applied to are left out, as in `recommendation_pool`.
    """
    applied = select(_applications.c.job_id).where(
        _applications.c.candidate_id == candidate_id,
        _applications.c.job_id == Job.id,
    )
    stmt = select(Job).where(Job.status == "PUBLISHED", _listed(), ~applied.exists())
    if not terms.is_empty:
        stmt = stmt.where(_shares_a_term(terms))
    if locations:
        stmt = stmt.where(
            or_(*(Job.location.ilike(_contains(place), escape="\\") for place in locations))
        )
    if work_mode:
        stmt = stmt.where(Job.work_mode == work_mode)
    if min_salary_minor is not None:
        stmt = stmt.where(Job.salary_max_minor >= min_salary_minor)
    if max_experience_months is not None:
        stmt = stmt.where(
            or_(
                Job.experience_min_months.is_(None),
                Job.experience_min_months <= max_experience_months,
            )
        )
    if eligible_only:
        if eligible_at_score is None:
            stmt = stmt.where(false())
        else:
            stmt = stmt.where(or_(Job.min_score.is_(None), Job.min_score <= eligible_at_score))
    result = await session.execute(
        stmt.order_by(Job.published_at.desc(), Job.id.desc()).limit(pool)
    )
    return list(result.scalars().all())


async def recently_applied_job_ids(
    session: AsyncSession, *, candidate_id: uuid.UUID, exclude_stages: Sequence[str], limit: int
) -> list[uuid.UUID]:
    """The jobs behind the candidate's latest applications, newest first.

    The `candidate_id` predicate is belt and braces beside
    `applications_candidate_read`, as the tenant predicates are above.
    """
    rows = await session.execute(
        select(_applications.c.job_id)
        .where(
            _applications.c.candidate_id == candidate_id,
            _applications.c.stage.not_in(list(exclude_stages)),
        )
        .order_by(_applications.c.created_at.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


async def current_config(session: AsyncSession, *, key: str, now: datetime) -> ConfigValue | None:
    """The highest version of a config key in effect by `now`."""
    result = await session.execute(
        select(ConfigValue)
        .where(ConfigValue.key == key, ConfigValue.effective_from <= now)
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
