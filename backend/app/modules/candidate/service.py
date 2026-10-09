"""candidate - business rules and transaction boundaries

Candidate profile, settings, language preference.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**The profile is not paywalled**, like reading and withdrawing applications:
a lapsed subscriber loses access, not the ability to keep their own details
right.

**An employer opening a profile is assembled here**, because it needs
three modules' answers and `discovery` may not import `scoring`: discovery
decides whether the reveal happens and writes its log and audit row, scoring
supplies the stored score, and resume the declared name.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PermissionDeniedError
from app.core.pagination import Page
from app.core.tenant import TenantContext
from app.modules.applications import service as applications_service
from app.modules.candidate import repository
from app.modules.candidate.schemas import (
    CandidateProfileResponse,
    LocationRequest,
    NameRequest,
    RevealedCandidate,
)
from app.modules.discovery import service as discovery_service
from app.modules.discovery.schemas import ProfileView
from app.modules.resume import service as resume_service
from app.modules.scoring import service as scoring_service
from app.modules.scoring.domain import display_value


def _candidate(ctx: TenantContext) -> None:
    if ctx.tenant_id is not None or ctx.role != "CANDIDATE":
        raise PermissionDeniedError()


async def get_profile(session: AsyncSession, *, ctx: TenantContext) -> CandidateProfileResponse:
    """The candidate's own profile. Empty, not 404, before anything is saved."""
    _candidate(ctx)
    profile = await repository.get_profile(session, user_id=ctx.user_id)
    if profile is None:
        return CandidateProfileResponse()
    return CandidateProfileResponse.model_validate(profile)


async def set_location(
    session: AsyncSession, *, ctx: TenantContext, payload: LocationRequest
) -> CandidateProfileResponse:
    """Replace the location. It reaches masked search on the next query --
    search reads the profile live rather than copying it anywhere."""
    _candidate(ctx)
    profile = await repository.set_location(
        session, user_id=ctx.user_id, city=payload.city, state_code=payload.state_code
    )
    # Older clients still use this location endpoint. Keep the expanded
    # profile's city consistent with discovery instead of creating two values.
    if isinstance(profile.career, dict) and isinstance(profile.career.get("details"), dict):
        career = {
            **profile.career,
            "details": {**profile.career["details"], "current_city": payload.city or ""},
        }
        profile = await repository.set_career(
            session, user_id=ctx.user_id, career=career, city=payload.city
        )
    return CandidateProfileResponse.model_validate(profile)


async def set_full_name(
    session: AsyncSession, *, ctx: TenantContext, payload: NameRequest
) -> CandidateProfileResponse:
    """Replace the candidate's name. Not paywalled, like the location."""
    _candidate(ctx)
    profile = await repository.set_full_name(
        session, user_id=ctx.user_id, full_name=payload.full_name
    )
    return CandidateProfileResponse.model_validate(profile)


async def prefill_profile(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    name: NameRequest | None,
    location: LocationRequest | None,
) -> None:
    """Staff enter a candidate's name and location when they create the
    account (2026-10-03), so the app shows them at first sign-in. The
    candidate can change either, as always. Never a CV, a questionnaire
    answer or a college link: those are the candidate's own acts.

    `user_id` is the account this transaction just created, not a caller."""
    if name is not None:
        await repository.set_full_name(session, user_id=user_id, full_name=name.full_name)
    if location is not None and (location.city or location.state_code):
        await repository.set_location(
            session, user_id=user_id, city=location.city, state_code=location.state_code
        )


async def profile_views(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    cursor: str | None = None,
    limit: int | None = None,
) -> Page[ProfileView]:
    """Which organisations opened the candidate's profile. Discovery owns the
    view log and decides what of it the candidate sees."""
    _candidate(ctx)
    return await discovery_service.profile_views(session, ctx=ctx, cursor=cursor, limit=limit)


async def reveal_to_employer(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    candidate_id: uuid.UUID,
    request_id: str | None = None,
) -> RevealedCandidate:
    """One candidate's profile for an employer inside their access window.

    `discovery_service.open_candidate` runs first and does everything that
    decides whether this happens -- caps, visibility, the view event and the
    audit row. Nothing here reads a candidate before it has returned, and an
    error after it rolls its audit row back with the reveal it would have
    recorded, because nothing was revealed.

    The score shown is the one the band on the search card came from, run
    through `display_value` here, at the boundary, and nowhere else.
    """
    opened = await discovery_service.open_candidate(
        session, ctx=ctx, candidate_id=candidate_id, request_id=request_id
    )
    score = await scoring_service.get_score(session, score_id=opened.score_id)
    if score is None:  # the search document's foreign key makes this unreachable
        raise discovery_service.CandidateNotFoundError()
    # The name given at sign-up first; the structured form's for anyone who
    # signed up before it was asked.
    full_name = opened.full_name or await resume_service.declared_name(
        session, user_id=opened.candidate_id, resume_version_id=opened.resume_version_id
    )
    return RevealedCandidate(
        candidate_id=opened.candidate_id,
        full_name=full_name,
        phone=opened.phone,
        email=opened.email,
        score=display_value(int(score.raw_value)),
        band=opened.band,
        experience_years=opened.experience_years,
        skills=opened.skills,
        badges=opened.badges,
        city=opened.city,
        state_code=opened.state_code,
        resume=await resume_service.shared_resume(
            session, user_id=opened.candidate_id, resume_version_id=opened.resume_version_id
        ),
        shortlist=await applications_service.shortlist_state(
            session, ctx=ctx, candidate_id=opened.candidate_id
        ),
    )
