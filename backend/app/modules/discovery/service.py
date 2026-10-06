"""discovery - business rules and transaction boundaries

Masked search, access-window checks, reveal audit.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

Day 9 landed the rule everything here is built on: which candidates are
visible at all, with high-severity integrity suppression inside it. Day 13
adds masked search on top of it, and Day 14 the reveal: the view caps, the
view log and the audit row that make opening a profile safe to allow at all.

**Masked search writes no audit row, deliberately.** A card carries nothing
PRD rule 9 calls private: no name, no contact, no score. What it does expose
is the shape of the pool, which is why it is rate-limited per organisation and
returns no total.

**Opening a profile always writes one** (invariant 7'), in the same
transaction as the read. The profile itself is assembled by
`candidate.service.reveal_to_employer`, because it needs the display score and
this module may not import `scoring`; everything that decides whether the
reveal happens is here.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, audit_event
from app.core.db import set_transaction_tenant, set_transaction_user
from app.core.errors import (
    AppError,
    ConflictError,
    KybRequiredError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitedError,
    ValidationError,
)
from app.core.logging import get_logger
from app.core.outbox import emit
from app.core.pagination import Page, clamp_limit, decode_cursor, encode_cursor
from app.core.ratelimit import hit
from app.core.reference import INDIAN_STATES
from app.core.tenant import TenantContext
from app.modules.candidate.domain import STATE_CODES
from app.modules.discovery import repository
from app.modules.discovery.catalogue import CITIES, FILTER_CATALOGUE_VERSION, SKILLS
from app.modules.discovery.domain import (
    BADGE_LABELS,
    BAND_LABELS,
    DEFAULT_LIMITS,
    EXPERIENCE_STEPS,
    MAX_CITY_FILTERS,
    MAX_CITY_LABEL_LENGTH,
    MAX_EXPERIENCE_YEARS,
    MAX_FEATURED_OPTIONS,
    MAX_SKILL_FILTERS,
    MAX_SKILL_LENGTH,
    MAX_SUGGESTIONS,
    DiscoveryLimits,
    DiscoveryLimitsError,
    FilterKind,
    FilterOptionError,
    FilterOptionTerms,
    ViewCounts,
    anomalies,
    cap_refusal,
    clashing_keys,
    experience_years,
    filter_groups,
    filter_option_terms,
    limits_from_config,
    normalise_option_text,
    option_key,
    skill_key,
)
from app.modules.discovery.models import SearchFilterOption
from app.modules.discovery.schemas import (
    BadgeChoice,
    BandChoice,
    CityChoice,
    CitySuggestions,
    ExperienceChoice,
    FilterLimits,
    FilterPanel,
    MaskedCandidate,
    ProfileView,
    SkillChoice,
    SkillSuggestions,
    StateChoice,
)
from app.modules.employer import service as employer_service

logger = get_logger(__name__)

#: The `config_values` key holding `DiscoveryLimits`. Insert a higher
#: `version` to change a number.
LIMITS_CONFIG_KEY: Final = "discovery.limits"

#: Emitted when a view crosses a velocity or cap threshold, for the admin
#: console and notifications to consume.
VIEW_ANOMALY_FLAGGED: Final = "discovery.view_anomaly_flagged"

#: Months of view-log partitions the maintenance task keeps ahead of today.
PARTITION_MONTHS_AHEAD: Final = 3


class InvalidStateFilterError(ValidationError):
    code = "discovery_state_invalid"
    title = "Not a state or union territory code"


class InvalidSkillFilterError(ValidationError):
    code = "discovery_skill_invalid"
    title = "A skill filter is empty or too long"


class InvalidCityFilterError(ValidationError):
    code = "discovery_city_invalid"
    title = "A city filter is not a city name"


class DiscoveryLimitsInvalidError(AppError):
    """The configured limits cannot be applied. A 500, deliberately: falling
    back to the defaults would make a broken row look applied, and these are
    the controls in front of the whole candidate pool."""

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "discovery_limits_invalid"
    title = "Discovery limits are misconfigured"


class ViewCapReachedError(RateLimitedError):
    """The organisation has opened as many distinct candidates as its cap allows.

    `params.window` is `HOURLY` or `DAILY`. Distinct from `rate_limited`,
    which is one person clicking too fast and clears in a minute; this is the
    organisation's allowance and clears as the rolling window moves.
    """

    code = "view_cap_reached"
    title = "Candidate view limit reached"


class CandidateNotFoundError(NotFoundError):
    code = "candidate_not_found"
    title = "Candidate not found"


async def load_limits(session: AsyncSession, *, now: datetime) -> DiscoveryLimits:
    """The limits in force at `now`: the latest config row, else the defaults."""
    row = await repository.current_config(session, key=LIMITS_CONFIG_KEY, now=now)
    if row is None:
        return DEFAULT_LIMITS
    try:
        if not isinstance(row.value, dict):
            raise DiscoveryLimitsError("discovery limits must be a JSON object")
        return limits_from_config(row.value)
    except DiscoveryLimitsError as exc:
        logger.error("discovery_limits_invalid", config_version=row.version, error=str(exc))
        raise DiscoveryLimitsInvalidError() from exc


async def _verified_employer(session: AsyncSession, ctx: TenantContext) -> uuid.UUID:
    """Bind the caller's tenant and require approved KYB, for search and reveal alike.

    SRS 1.14.1 checks "KYB/search eligibility" before search. With approval
    switched off (R15) every employer is approved on creation, so this bites
    only when the client turns the switch on -- and then it must bite on the
    reveal as well as the search.
    """
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, ctx.tenant_id)
    kyb_status = await employer_service.kyb_status(session, ctx=ctx)
    if kyb_status != "APPROVED":
        raise KybRequiredError(params={"kyb_status": kyb_status})
    return ctx.tenant_id


async def revealed_counts(
    session: AsyncSession, *, ctx: TenantContext, since: datetime
) -> tuple[int, int]:
    """Distinct candidates the organisation has opened, ever and since `since`.

    For the employer dashboard. No KYB check: an organisation that may not
    reveal anyone has simply revealed nobody, and the dashboard should say so
    rather than refuse.
    """
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, ctx.tenant_id)
    return await repository.revealed_counts(session, tenant_id=ctx.tenant_id, since=since)


async def visible_candidate_ids(
    session: AsyncSession, *, limit: int | None = None, after: uuid.UUID | None = None
) -> list[uuid.UUID]:
    return await repository.visible_candidate_ids(session, limit=clamp_limit(limit), after=after)


async def is_candidate_visible(session: AsyncSession, *, candidate_id: uuid.UUID) -> bool:
    return await repository.is_candidate_visible(session, candidate_id=candidate_id)


async def count_visible_at_or_above(session: AsyncSession, *, min_score: int) -> int:
    return await repository.count_visible_at_or_above(session, min_score=min_score)


# ---------------------------------------------------------------------------
# Masked search (Day 13)
# ---------------------------------------------------------------------------
def _cursor_of(row: Any) -> str:
    return encode_cursor({"r": int(row.band_rank), "i": str(row.user_id)})


def _after(cursor: str | None) -> tuple[int, uuid.UUID] | None:
    if cursor is None:
        return None
    payload = decode_cursor(cursor)
    try:
        rank = payload["r"]
        if not isinstance(rank, int) or isinstance(rank, bool):
            raise ValueError("rank")
        return rank, uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError) as exc:
        raise ValidationError(code="invalid_cursor") from exc


def _card(row: Any) -> MaskedCandidate:
    return MaskedCandidate(
        candidate_id=row.user_id,
        band=row.band,
        experience_years=experience_years(int(row.experience_months)),
        skills=list(row.skills),
        badges=sorted(row.badges),
        city=row.city,
        state_code=row.state_code,
    )


async def search_candidates(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    bands: list[str] | None = None,
    skills: list[str] | None = None,
    badges: list[str] | None = None,
    min_experience_years: int | None = None,
    state_code: str | None = None,
    cities: list[str] | None = None,
    query: str | None = None,
    cursor: str | None = None,
    limit: int | None = None,
) -> Page[MaskedCandidate]:
    """Visible candidates as masked cards, filtered, keyset-paginated.

    Refusals, in order: no organisation (403), unverified organisation (403
    `kyb_required` -- SRS 1.14.1 checks "KYB/search eligibility" before search),
    a malformed filter (422), too many pages this hour (429).

    **No total**, on purpose (`app/core/pagination.py`): a count of candidates
    matching a narrow filter tells an employer whether one particular person is
    in the pool.

    A skill or city naming a catalogued option (by its label, key or an
    alias) searches every spelling of it; any other text searches itself.
    """
    tenant_id = await _verified_employer(session, ctx)

    if state_code is not None and state_code not in STATE_CODES:
        raise InvalidStateFilterError(params={"state": state_code})
    for skill in skills or []:
        key = skill_key(skill)
        if not key or len(key) > MAX_SKILL_LENGTH:
            raise InvalidSkillFilterError()
    city_values: list[str] = []
    for city in cities or []:
        if not city.strip():
            continue  # a blank box is no filter, as it always was
        try:
            city_values.append(normalise_option_text("CITY", city))
        except FilterOptionError as exc:
            raise InvalidCityFilterError(params={"reason": str(exc)}) from exc

    limits = await load_limits(session, now=datetime.now(UTC))
    await hit(
        bucket="discovery:search",
        subject=str(tenant_id),
        limit=limits.search_pages_per_hour,
        window_seconds=3600,
    )

    skill_groups = await _expanded(session, "SKILL", skills or [])
    city_groups = await _expanded(session, "CITY", city_values)

    page_size = clamp_limit(limit)
    rows = await repository.search_candidates(
        session,
        bands=sorted(set(bands or [])),
        skill_groups=skill_groups,
        badges=sorted(set(badges or [])),
        min_experience_months=None if min_experience_years is None else min_experience_years * 12,
        state_code=state_code,
        city_spellings=sorted({spelling for group in city_groups for spelling in group}),
        query=query.strip() or None if query is not None else None,
        after=_after(cursor),
        limit=page_size + 1,
    )
    page, more = rows[:page_size], len(rows) > page_size
    return Page[MaskedCandidate](
        items=[_card(row) for row in page],
        next_cursor=_cursor_of(page[-1]) if more and page else None,
    )


# ---------------------------------------------------------------------------
# The reveal (Day 14)
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class OpenedCandidate:
    """What discovery hands over once a reveal is allowed, logged and audited.

    It carries the score's id and not its value. The number an employer sees
    is `scoring.domain.display_value`, applied where the response is built.
    """

    candidate_id: uuid.UUID
    resume_version_id: uuid.UUID
    score_id: uuid.UUID
    phone: str | None
    email: str | None
    #: As given at sign-up; None if the candidate has not given one.
    full_name: str | None
    band: str
    experience_years: int
    skills: list[str]
    badges: list[str]
    city: str | None
    state_code: str | None


async def open_candidate(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    candidate_id: uuid.UUID,
    request_id: str | None = None,
) -> OpenedCandidate:
    """Allow, log and audit one employer opening one candidate's profile.

    The access window is checked before this is reached
    (`require_active_access_window`, on the route). Then, in order:

      1. an approved organisation (403 `kyb_required`);
      2. one person's burst limit, in Redis (429 `rate_limited`);
      3. the organisation's hourly and daily caps on distinct candidates
         (429 `view_cap_reached`) -- **before** looking the candidate up, so a
         capped organisation learns nothing, not even whether an id exists;
      4. the candidate is visible under the discovery rule (404
         `candidate_not_found`);
      5. the view event, the audit row and any anomaly alert, **on this
         session**: if any write fails, the reveal rolls back with it.

    Candidates only ever arrive one at a time. There is no batch form of this
    and there must not be one: export is not a feature (plan.md Day 14).
    """
    tenant_id = await _verified_employer(session, ctx)
    limits = await load_limits(session, now=datetime.now(UTC))

    await hit(
        bucket="discovery:reveal",
        subject=str(ctx.user_id),
        limit=limits.reveals_per_minute,
        window_seconds=60,
    )

    await repository.lock_tenant_views(session, tenant_id=tenant_id)
    row = await repository.view_counts(
        session,
        tenant_id=tenant_id,
        actor_id=ctx.user_id,
        candidate_id=candidate_id,
        velocity_minutes=limits.velocity_window_minutes,
    )
    counts = ViewCounts(
        tenant_last_hour=int(row.tenant_last_hour),
        tenant_last_day=int(row.tenant_last_day),
        actor_in_window=int(row.actor_in_window),
        seen_by_tenant_last_hour=bool(row.seen_by_tenant_last_hour),
        seen_by_tenant_last_day=bool(row.seen_by_tenant_last_day),
        seen_by_actor_in_window=bool(row.seen_by_actor_in_window),
    )
    refused = cap_refusal(limits, counts)
    if refused is not None:
        logger.warning("candidate_view_cap_reached", tenant_id=str(tenant_id), window=refused)
        raise ViewCapReachedError(params={"window": refused})

    revealed = await repository.revealed_candidate(session, candidate_id=candidate_id)
    if revealed is None or not await repository.record_view(
        session, tenant_id=tenant_id, actor_id=ctx.user_id, candidate_id=candidate_id
    ):
        raise CandidateNotFoundError()

    await audit_event(
        session,
        action=AuditAction.CANDIDATE_PROFILE_VIEWED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="candidate",
        target_id=candidate_id,
        tenant_id=tenant_id,
        request_id=request_id,
        # Identifiers only: which score and which CV the employer was shown.
        metadata={
            "score_id": str(revealed.score_id),
            "resume_version_id": str(revealed.resume_version_id),
        },
    )
    for kind in anomalies(limits, counts):
        await _flag_anomaly(
            session, ctx=ctx, tenant_id=tenant_id, kind=kind, limits=limits, request_id=request_id
        )

    return OpenedCandidate(
        candidate_id=revealed.user_id,
        resume_version_id=revealed.resume_version_id,
        score_id=revealed.score_id,
        phone=revealed.phone,
        email=revealed.email,
        full_name=revealed.full_name,
        band=revealed.band,
        experience_years=experience_years(int(revealed.experience_months)),
        skills=list(revealed.skills),
        badges=sorted(revealed.badges),
        city=revealed.city,
        state_code=revealed.state_code,
    )


# ---------------------------------------------------------------------------
# Applicants (2026-10-05)
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class ApplicantCard:
    """An applicant on the employer's pipeline: who they are, not how to reach
    them. No contact and no score -- the band is what a list shows."""

    #: None when the card is for a shortlist entry rather than an application.
    application_id: uuid.UUID | None
    candidate_id: uuid.UUID
    resume_version_id: uuid.UUID
    full_name: str | None
    band: str
    experience_years: int
    skills: list[str]
    badges: list[str]
    city: str | None
    state_code: str | None


@dataclass(frozen=True, slots=True)
class OpenedApplicant:
    card: ApplicantCard
    score_id: uuid.UUID
    phone: str | None
    email: str | None


def _applicant_card(row: Any) -> ApplicantCard:
    return ApplicantCard(
        application_id=row.application_id,
        candidate_id=row.user_id,
        resume_version_id=row.resume_version_id,
        full_name=row.full_name,
        band=row.band,
        experience_years=experience_years(int(row.experience_months)),
        skills=list(row.skills),
        badges=sorted(row.badges),
        city=row.city,
        state_code=row.state_code,
    )


async def applicant_cards(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    applications: list[tuple[uuid.UUID, uuid.UUID]],
    request_id: str | None = None,
) -> dict[uuid.UUID, ApplicantCard]:
    """Who is behind each of a page of this organisation's applications, by
    application id. **The page is audited** (ids only), as a college's
    student list is: a list that names people is a reveal of their names.

    The caller loaded `applications` (application id, candidate id) under
    the tenant's policy; the query joins them to the tenant again and to the
    visibility rule, so a candidate a HIGH signal is hiding is simply absent
    and their application is shown without them. No view caps: these people
    applied to this organisation, and the caps exist to stop trawling search.
    """
    if not applications or ctx.tenant_id is None:
        return {}
    rows = await repository.applicant_cards(
        session,
        tenant_id=ctx.tenant_id,
        application_ids=[a for a, _ in applications],
        candidate_ids=sorted({c for _, c in applications}),
    )
    cards = {row.application_id: _applicant_card(row) for row in rows}
    if cards:
        await audit_event(
            session,
            action=AuditAction.APPLICANTS_LISTED,
            actor_id=ctx.user_id,
            actor_role=ctx.role,
            target_type="tenant",
            target_id=ctx.tenant_id,
            tenant_id=ctx.tenant_id,
            request_id=request_id,
            metadata={
                "application_ids": [str(a) for a in cards],
                "candidate_ids": sorted({str(c.candidate_id) for c in cards.values()}),
            },
        )
    return cards


async def open_applicant(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    application_id: uuid.UUID,
    candidate_id: uuid.UUID,
    request_id: str | None = None,
) -> OpenedApplicant | None:
    """One applicant with contact details, **audited**, or None when the
    visibility rule hides them now. Every open is a row, re-opens included,
    as on the reveal. Not a view event: the candidate already sees VIEWED on
    their board, and a view event would spend the organisation's search caps
    on people who came to it."""
    if ctx.tenant_id is None:
        return None
    row = await repository.applicant_profile(
        session, tenant_id=ctx.tenant_id, application_id=application_id, candidate_id=candidate_id
    )
    if row is None:
        return None
    await audit_event(
        session,
        action=AuditAction.APPLICANT_PROFILE_VIEWED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="candidate",
        target_id=candidate_id,
        tenant_id=ctx.tenant_id,
        request_id=request_id,
        metadata={
            "application_id": str(application_id),
            "score_id": str(row.score_id),
            "resume_version_id": str(row.resume_version_id),
        },
    )
    return OpenedApplicant(
        card=_applicant_card(row), score_id=row.score_id, phone=row.phone, email=row.email
    )


# ---------------------------------------------------------------------------
# The shortlist's checks (2026-10-05)
# ---------------------------------------------------------------------------
async def require_shortlistable(
    session: AsyncSession, *, ctx: TenantContext, candidate_id: uuid.UUID
) -> uuid.UUID:
    """The reveal's gate, for keeping or inviting a candidate: approved KYB
    (403 `kyb_required`), and a candidate visible now **whom this
    organisation has opened** (else 404 `candidate_not_found`, which says
    nothing about whether the id exists). Binds and returns the tenant."""
    tenant_id = await _verified_employer(session, ctx)
    if not await repository.opened_and_visible(
        session, tenant_id=tenant_id, candidate_id=candidate_id
    ):
        raise CandidateNotFoundError()
    return tenant_id


async def shortlisted_cards(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    candidate_ids: list[uuid.UUID],
    request_id: str | None = None,
) -> dict[uuid.UUID, ApplicantCard]:
    """Who is behind a page of the organisation's shortlist, by candidate id,
    audited as one row (ids only). A hidden candidate is absent."""
    if not candidate_ids or ctx.tenant_id is None:
        return {}
    rows = await repository.shortlisted_cards(
        session, tenant_id=ctx.tenant_id, candidate_ids=sorted(set(candidate_ids))
    )
    cards = {
        row.user_id: ApplicantCard(
            application_id=None,
            candidate_id=row.user_id,
            resume_version_id=row.resume_version_id,
            full_name=row.full_name,
            band=row.band,
            experience_years=experience_years(int(row.experience_months)),
            skills=list(row.skills),
            badges=sorted(row.badges),
            city=row.city,
            state_code=row.state_code,
        )
        for row in rows
    }
    if cards:
        await audit_event(
            session,
            action=AuditAction.SHORTLIST_LISTED,
            actor_id=ctx.user_id,
            actor_role=ctx.role,
            target_type="tenant",
            target_id=ctx.tenant_id,
            tenant_id=ctx.tenant_id,
            request_id=request_id,
            metadata={"candidate_ids": sorted(str(c) for c in cards)},
        )
    return cards


async def _flag_anomaly(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    tenant_id: uuid.UUID,
    kind: str,
    limits: DiscoveryLimits,
    request_id: str | None,
) -> None:
    """Alert a human. **An alert blocks nothing**: the caps do the blocking,
    and an alert that also refused would be a cap nobody configured."""
    detail: dict[str, Any] = (
        {"views": limits.velocity_views, "window_minutes": limits.velocity_window_minutes}
        if kind == "ACTOR_VELOCITY"
        else {"views": limits.views_per_day, "window_minutes": 24 * 60}
    )
    await audit_event(
        session,
        action=AuditAction.CANDIDATE_VIEW_ANOMALY_FLAGGED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="tenant",
        target_id=tenant_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"kind": kind, **detail},
    )
    await emit(
        session,
        event_type=VIEW_ANOMALY_FLAGGED,
        aggregate_type="tenant",
        aggregate_id=tenant_id,
        payload={"tenant_id": str(tenant_id), "actor_id": str(ctx.user_id), "kind": kind, **detail},
    )
    logger.warning("candidate_view_anomaly_flagged", tenant_id=str(tenant_id), kind=kind)


# ---------------------------------------------------------------------------
# Who viewed my profile (2026-10-02)
# ---------------------------------------------------------------------------
def _views_after(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    payload = decode_cursor(cursor)
    try:
        viewed_at = datetime.fromisoformat(str(payload["t"]))
        if viewed_at.tzinfo is None:
            raise ValueError("naive")
        return viewed_at, uuid.UUID(str(payload["o"]))
    except (KeyError, ValueError) as exc:
        raise ValidationError(code="invalid_cursor") from exc


async def profile_views(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    cursor: str | None = None,
    limit: int | None = None,
) -> Page[ProfileView]:
    """Which organisations opened this candidate's profile, latest open first.

    The candidate's side of the view log the reveal writes. One entry per
    organisation, within `PROFILE_VIEWS_LOOKBACK_DAYS`: its name and when it
    last looked. Never the recruiter, never a count of opens.

    **Not paywalled**, like the rest of the profile: it is the candidate's own
    data. **No total**: the list is short and paging it is cheap, and a count
    of organisations is a number the screen does not need.

    `app.user_id` is bound here, because the function reads
    `current_candidate_id()` and nothing else -- forget it and the list comes
    back empty, which looks exactly like nobody having looked.
    """
    if ctx.tenant_id is not None or ctx.role != "CANDIDATE":
        raise PermissionDeniedError()
    await set_transaction_user(session, ctx.user_id)
    page_size = clamp_limit(limit)
    rows = await repository.profile_views(session, after=_views_after(cursor), limit=page_size + 1)
    page, more = rows[:page_size], len(rows) > page_size
    last = page[-1] if more and page else None
    return Page[ProfileView](
        items=[
            ProfileView(employer_name=row.employer_name, last_viewed_at=row.last_viewed_at)
            for row in page
        ],
        next_cursor=(
            encode_cursor({"t": last.last_viewed_at.isoformat(), "o": str(last.tenant_id)})
            if last is not None
            else None
        ),
    )


async def ensure_view_partitions(session: AsyncSession, *, now: datetime) -> int:
    """Keep the view log's monthly partitions `PARTITION_MONTHS_AHEAD` ahead."""
    first_month = now.astimezone(UTC).date().replace(day=1)
    return await repository.ensure_view_partitions(
        session, first_month=first_month, months=PARTITION_MONTHS_AHEAD + 1
    )


# ---------------------------------------------------------------------------
# Search filter options (2026-09-24)
# ---------------------------------------------------------------------------
class FilterOptionInvalidError(ValidationError):
    """`params.reason` says what is wrong; `params.index` which item of a bulk
    import, when there is one."""

    code = "search_filter_option_invalid"
    title = "Not a valid search filter option"


class FilterOptionConflictError(ConflictError):
    """`params.keys` are spellings another option already holds, as its key
    or an alias. One spelling leads to one option."""

    code = "search_filter_option_conflict"
    title = "Another option already has this spelling"


class FilterOptionNotFoundError(NotFoundError):
    code = "search_filter_option_not_found"
    title = "Search filter option not found"


async def _expanded(
    session: AsyncSession, kind: FilterKind, values: list[str]
) -> list[tuple[str, ...]]:
    """Each value as every spelling it should match (`domain.filter_groups`)."""
    if not values:
        return []
    keys = sorted({option_key(v) for v in values})
    options = await repository.options_naming(session, kind=kind, keys=keys)
    return filter_groups(values, [(o.key, o.aliases) for o in options])


def _skill_choice(option: SearchFilterOption) -> SkillChoice:
    return SkillChoice(key=option.key, label=option.label)


def _city_choice(option: SearchFilterOption) -> CityChoice:
    return CityChoice(key=option.key, label=option.label, state_code=option.state_code or "")


async def filter_panel(session: AsyncSession) -> FilterPanel:
    """Everything the employer's filter panel shows before anything is typed.

    Reads no candidate and depends on nobody's data: the same answer for
    every employer, so it is safe before KYB and needs no tenant binding.
    """
    skills = await repository.featured_filter_options(
        session, kind="SKILL", limit=MAX_FEATURED_OPTIONS
    )
    cities = await repository.featured_filter_options(
        session, kind="CITY", limit=MAX_FEATURED_OPTIONS
    )
    return FilterPanel(
        bands=[BandChoice(value=v, label=label) for v, label in BAND_LABELS.items()],
        badges=[BadgeChoice(value=v, label=label) for v, label in BADGE_LABELS.items()],
        experience=[ExperienceChoice(min_years=n, label=f"{n}+ yrs") for n in EXPERIENCE_STEPS],
        skills=[_skill_choice(o) for o in skills],
        cities=[_city_choice(o) for o in cities],
        states=[StateChoice(code=r.code, name=r.name) for r in INDIAN_STATES],
        limits=FilterLimits(
            max_skills=MAX_SKILL_FILTERS,
            max_cities=MAX_CITY_FILTERS,
            max_skill_length=MAX_SKILL_LENGTH,
            max_city_length=MAX_CITY_LABEL_LENGTH,
            max_experience_years=MAX_EXPERIENCE_YEARS,
        ),
        catalogue_version=FILTER_CATALOGUE_VERSION,
    )


async def suggest_skills(session: AsyncSession, *, query: str, limit: int) -> SkillSuggestions:
    """Catalogued skills matching what has been typed. Never the pool's own
    skills, and never a count -- see `domain`."""
    key = option_key(query)
    if not key:
        return SkillSuggestions(items=[])
    rows = await repository.suggest_filter_options(
        session, kind="SKILL", query=key, state_code=None, limit=min(limit, MAX_SUGGESTIONS)
    )
    return SkillSuggestions(items=[_skill_choice(o) for o in rows])


async def suggest_cities(
    session: AsyncSession, *, query: str, state_code: str | None, limit: int
) -> CitySuggestions:
    if state_code is not None and state_code not in STATE_CODES:
        raise InvalidStateFilterError(params={"state": state_code})
    key = option_key(query)
    if not key:
        return CitySuggestions(items=[])
    rows = await repository.suggest_filter_options(
        session, kind="CITY", query=key, state_code=state_code, limit=min(limit, MAX_SUGGESTIONS)
    )
    return CitySuggestions(items=[_city_choice(o) for o in rows])


# --- the console's side: staff curate the catalogue ------------------------
# Called by `admin.service`, which writes the audit row beside each change.


@dataclass(frozen=True, slots=True)
class NewFilterOption:
    kind: FilterKind
    label: str
    aliases: tuple[str, ...] = ()
    state_code: str | None = None
    featured: bool = False
    sort_order: int = 0


@dataclass(frozen=True, slots=True)
class FilterOptionChanges:
    """A partial update. None leaves a field as it is."""

    label: str | None = None
    aliases: tuple[str, ...] | None = None
    state_code: str | None = None
    featured: bool | None = None
    sort_order: int | None = None
    active: bool | None = None


def _terms(
    kind: FilterKind,
    *,
    label: str,
    aliases: tuple[str, ...] | list[str],
    state_code: str | None,
    index: int | None = None,
) -> FilterOptionTerms:
    try:
        return filter_option_terms(kind, label=label, aliases=aliases, state_code=state_code)
    except FilterOptionError as exc:
        params: dict[str, Any] = {"reason": str(exc)}
        if index is not None:
            params["index"] = index
        raise FilterOptionInvalidError(params=params) from exc


async def _refuse_taken(
    session: AsyncSession, terms: FilterOptionTerms, *, except_id: uuid.UUID | None = None
) -> None:
    taken = await repository.options_claiming(
        session, kind=terms.kind, keys=list(terms.keys), except_id=except_id
    )
    if taken:
        held = {key for option in taken for key in (option.key, *option.aliases)}
        raise FilterOptionConflictError(params={"keys": sorted(held & set(terms.keys))})


async def create_filter_options(
    session: AsyncSession, *, options: list[NewFilterOption], created_by: uuid.UUID | None
) -> list[SearchFilterOption]:
    """Add options, all or none. A bad item is 422 naming its index; a
    spelling another option (or another item) holds is 409 naming it."""
    terms = [
        _terms(o.kind, label=o.label, aliases=o.aliases, state_code=o.state_code, index=i)
        for i, o in enumerate(options)
    ]
    clashes = clashing_keys(terms)
    if clashes:
        raise FilterOptionConflictError(params={"keys": clashes})
    for kind in sorted({t.kind for t in terms}):
        await repository.lock_filter_catalogue(session, kind=kind)
    for term in terms:
        await _refuse_taken(session, term)

    rows = [
        SearchFilterOption(
            kind=term.kind,
            label=term.label,
            key=term.key,
            aliases=list(term.aliases),
            state_code=term.state_code,
            featured=option.featured,
            sort_order=option.sort_order,
            active=True,
            created_by=created_by,
            updated_by=created_by,
        )
        for term, option in zip(terms, options, strict=True)
    ]
    await repository.insert_filter_options(session, rows)
    logger.info("search_filter_options_created", count=len(rows))
    return rows


async def update_filter_option(
    session: AsyncSession,
    *,
    option_id: uuid.UUID,
    changes: FilterOptionChanges,
    updated_by: uuid.UUID,
) -> tuple[SearchFilterOption, list[str]]:
    """Change an option; returns it and the names of the fields that moved.

    Switching an option off hides it from the panel and the typeahead and
    stops its aliases being searched; the label still searches as plain text.
    A new label is a new key, so a link naming the old label then searches
    that old text alone -- keep it as an alias to avoid that.
    """
    row = await repository.get_filter_option(session, option_id=option_id)
    if row is None:
        raise FilterOptionNotFoundError()
    kind: FilterKind = "CITY" if row.kind == "CITY" else "SKILL"
    await repository.lock_filter_catalogue(session, kind=kind)
    await session.refresh(row)

    terms = _terms(
        kind,
        label=row.label if changes.label is None else changes.label,
        aliases=tuple(row.aliases) if changes.aliases is None else changes.aliases,
        state_code=row.state_code if changes.state_code is None else changes.state_code,
    )
    await _refuse_taken(session, terms, except_id=row.id)

    wanted: dict[str, Any] = {
        "label": terms.label,
        "key": terms.key,
        "aliases": list(terms.aliases),
        "state_code": terms.state_code,
        "featured": row.featured if changes.featured is None else changes.featured,
        "sort_order": row.sort_order if changes.sort_order is None else changes.sort_order,
        "active": row.active if changes.active is None else changes.active,
    }
    moved = sorted(name for name, value in wanted.items() if getattr(row, name) != value)
    if moved:
        for name in moved:
            setattr(row, name, wanted[name])
        row.updated_by = updated_by
        await repository.save_filter_option(session, row)
    return row, moved


async def get_filter_option(session: AsyncSession, *, option_id: uuid.UUID) -> SearchFilterOption:
    row = await repository.get_filter_option(session, option_id=option_id)
    if row is None:
        raise FilterOptionNotFoundError()
    return row


async def list_filter_options(
    session: AsyncSession,
    *,
    kind: FilterKind | None,
    query: str | None,
    include_inactive: bool,
    cursor: str | None,
    limit: int | None,
) -> tuple[list[SearchFilterOption], str | None]:
    after: tuple[str, str] | None = None
    if cursor is not None:
        payload = decode_cursor(cursor)
        try:
            after = (str(payload["k"]), str(payload["n"]))
        except KeyError as exc:
            raise ValidationError(code="invalid_cursor") from exc
    size = clamp_limit(limit)
    rows = await repository.list_filter_options(
        session,
        kind=kind,
        query=option_key(query) if query and query.strip() else None,
        include_inactive=include_inactive,
        after=after,
        limit=size,
    )
    next_cursor = (
        encode_cursor({"k": rows[-1].kind, "n": rows[-1].key}) if len(rows) == size else None
    )
    return rows, next_cursor


async def seed_filter_catalogue(session: AsyncSession) -> tuple[int, int]:
    """Write the starter catalogue (`catalogue.py`); returns (written, skipped).

    **Only where nothing is there.** An option any of whose spellings is
    already held -- by a seeded row or by one staff made or changed -- is
    skipped whole, so re-running never overwrites the console's work and
    never splits one spelling across two options.
    """
    written = skipped = 0
    for kind, seeds in (("SKILL", SKILLS), ("CITY", CITIES)):
        await repository.lock_filter_catalogue(session, kind=kind)
        fresh: list[SearchFilterOption] = []
        for order, seed in enumerate(seeds):
            terms = filter_option_terms(
                kind,  # type: ignore[arg-type]
                label=seed.label,
                aliases=seed.aliases,
                state_code=seed.state_code,
            )
            if await repository.options_claiming(session, kind=kind, keys=list(terms.keys)):
                skipped += 1
                continue
            fresh.append(
                SearchFilterOption(
                    kind=kind,
                    label=terms.label,
                    key=terms.key,
                    aliases=list(terms.aliases),
                    state_code=terms.state_code,
                    featured=seed.featured,
                    sort_order=order,
                    active=True,
                )
            )
        await repository.insert_filter_options(session, fresh)
        written += len(fresh)
    return written, skipped
