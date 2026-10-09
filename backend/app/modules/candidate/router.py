"""candidate - HTTP layer

Candidate profile, settings, language preference.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request

from app.core.deps import (
    CANDIDATE,
    EMPLOYER_OWNER,
    EMPLOYER_RECRUITER,
    CurrentUser,
    DbSession,
    get_request_id,
    require_active_access_window,
    require_active_subscription,
    require_role,
)
from app.core.pagination import MAX_PAGE_SIZE, Page
from app.modules.candidate import career_service, service
from app.modules.candidate.career import CareerResponse, CareerSaveRequest, form_fields
from app.modules.candidate.schemas import (
    CandidateProfileResponse,
    LocationRequest,
    NameRequest,
    RevealedCandidate,
)
from app.modules.discovery.schemas import ProfileView
from app.modules.jobs.domain import RECOMMENDATIONS_DEFAULT, RECOMMENDATIONS_MAX
from app.modules.jobs.schemas import RecommendedJobs

router = APIRouter()
#: Mounted at `/employer/discovery`, beside masked search (`__init__.py`).
employer_router = APIRouter()

CandidateOnly = Depends(require_role(CANDIDATE))


@router.get("/profile/form", dependencies=[CandidateOnly])
async def profile_form() -> list[dict[str, Any]]:
    return form_fields()


@router.get("/profile/details", response_model=CareerResponse, dependencies=[CandidateOnly])
async def career_details(user: CurrentUser, session: DbSession) -> CareerResponse:
    return await career_service.get_details(session, ctx=user)


@router.put("/profile/details", response_model=CareerResponse, dependencies=[CandidateOnly])
async def save_career_details(
    payload: CareerSaveRequest, user: CurrentUser, session: DbSession
) -> CareerResponse:
    return await career_service.save_details(session, ctx=user, payload=payload)


@router.post(
    "/profile/prefill/{resume_version_id}",
    response_model=CareerResponse,
    dependencies=[CandidateOnly],
)
async def prefill_career_details(
    resume_version_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> CareerResponse:
    return await career_service.prefill(session, ctx=user, resume_version_id=resume_version_id)


#: The same two roles as search, then the access window: one check, one place
#: (invariant 7). The window is the employer's subscription, read live.
Revealers = [
    Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER)),
    Depends(require_active_access_window),
]


@router.get(
    "/profile",
    response_model=CandidateProfileResponse,
    dependencies=[CandidateOnly],
    summary="The candidate's own profile",
)
async def get_profile(user: CurrentUser, session: DbSession) -> CandidateProfileResponse:
    return await service.get_profile(session, ctx=user)


@router.put(
    "/profile/location",
    response_model=CandidateProfileResponse,
    dependencies=[CandidateOnly],
    summary="Set where the candidate is",
)
async def set_location(
    payload: LocationRequest, user: CurrentUser, session: DbSession
) -> CandidateProfileResponse:
    """A city and a state, both optional. Employers see them on a masked card
    and filter by them, so a city carrying digits or `@` is refused (422)."""
    return await service.set_location(session, ctx=user, payload=payload)


@router.put(
    "/profile/name",
    response_model=CandidateProfileResponse,
    dependencies=[CandidateOnly],
    summary="Set the candidate's name",
)
async def set_name(
    payload: NameRequest, user: CurrentUser, session: DbSession
) -> CandidateProfileResponse:
    """Asked at sign-up. Only an employer who opens the profile sees it, never
    a masked card. Digits and `@` are refused (422)."""
    return await service.set_full_name(session, ctx=user, payload=payload)


@router.get(
    "/profile/views",
    response_model=Page[ProfileView],
    dependencies=[CandidateOnly],
    summary="Which organisations viewed the candidate's profile",
)
async def profile_views(
    user: CurrentUser,
    session: DbSession,
    cursor: str | None = None,
    limit: Annotated[int | None, Query(ge=1, le=MAX_PAGE_SIZE)] = None,
) -> Page[ProfileView]:
    """One entry per organisation that opened the profile in the last 90 days,
    latest first: its name and when it last looked. Never which recruiter,
    and no count of opens. Not paywalled. A bad cursor is 422
    `invalid_cursor`."""
    return await service.profile_views(session, ctx=user, cursor=cursor, limit=limit)


# ---------------------------------------------------------------------------
# Recommended jobs, the home screen's two sections (2026-10-09)
# ---------------------------------------------------------------------------
# Paywalled like the board they are drawn from (R13), role guard first so an
# employer hears 403 rather than "pay us".
PayingCandidate = [CandidateOnly, Depends(require_active_subscription)]
SectionLength = Annotated[
    int | None,
    Query(ge=1, le=RECOMMENDATIONS_MAX, description=f"Default {RECOMMENDATIONS_DEFAULT}"),
]


@router.get(
    "/recommended-jobs/similar-to-applied",
    response_model=RecommendedJobs,
    dependencies=PayingCandidate,
    summary="Jobs like the ones the candidate recently applied to",
)
async def jobs_similar_to_applied(
    user: CurrentUser,
    session: DbSession,
    limit: SectionLength = None,
    eligible_only: bool = False,
) -> RecommendedJobs:
    """Matched on the skills, title words and places of the candidate's
    latest applications (withdrawn ones aside). Best match first; jobs
    already applied to never appear. `has_basis: false` with no
    applications yet. Each job carries `eligibility` as on the board, and
    never the threshold."""
    return await service.jobs_similar_to_applied(
        session, ctx=user, limit=limit, eligible_only=eligible_only
    )


@router.get(
    "/recommended-jobs/matching-profile",
    response_model=RecommendedJobs,
    dependencies=PayingCandidate,
    summary="Jobs that fit the candidate's career profile",
)
async def jobs_matching_profile(
    user: CurrentUser,
    session: DbSession,
    limit: SectionLength = None,
    eligible_only: bool = False,
) -> RecommendedJobs:
    """Matched on the profile's key skills, desired role, current title,
    preferred locations and experience (`PUT /candidate/profile/details`).
    Best match first; jobs already applied to never appear. `has_basis:
    false` until the profile names a skill or a role."""
    return await career_service.jobs_matching_profile(
        session, ctx=user, limit=limit, eligible_only=eligible_only
    )


@employer_router.get(
    "/candidates/{candidate_id}",
    response_model=RevealedCandidate,
    dependencies=Revealers,
    summary="Open one candidate's profile",
)
async def reveal_candidate(
    candidate_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> RevealedCandidate:
    """Name, contact details and the display score of one candidate, **audited**.

    Every call writes an audit row, re-opens included. Refusals: no access
    window (402 `access_window_expired`), unverified organisation (403
    `kyb_required`), too fast (429 `rate_limited`), the organisation's view
    cap (429 `view_cap_reached`, `params.window`), and a candidate employers
    cannot see (404 `candidate_not_found`). One candidate per request; there
    is no list form.
    """
    return await service.reveal_to_employer(
        session, ctx=user, candidate_id=candidate_id, request_id=get_request_id(request)
    )
