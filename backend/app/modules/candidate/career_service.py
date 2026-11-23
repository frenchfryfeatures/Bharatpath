"""Career profile transactions and resume prefill, with no scoring side effects."""

from __future__ import annotations

import uuid

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ValidationError
from app.core.tenant import TenantContext
from app.modules.candidate import repository
from app.modules.candidate.career import (
    CareerDetails,
    CareerResponse,
    CareerSaveRequest,
    employment_dates_ordered,
    match_terms,
    missing_required,
)
from app.modules.candidate.domain import normalise_city
from app.modules.candidate.extraction import extract_career
from app.modules.candidate.models import CandidateProfile
from app.modules.candidate.onboarding_policy import EDUCATION_MAX_YEARS
from app.modules.candidate.preferences import (
    JOB_TYPE_OPTIONS,
    WORK_MODE_OPTIONS,
    JobPreferences,
    Option,
    PreferenceOptions,
    PreferencesPayload,
    PreferencesResponse,
    stored_preferences,
)
from app.modules.candidate.service import _candidate
from app.modules.jobs import service as jobs_service
from app.modules.jobs.schemas import RecommendedJobs
from app.modules.resume import service as resume_service

#: Blocks of `career` that live beside the onboarding answers and must survive
#: every save of them (2026-11-23: job preferences).
KEPT_CAREER_BLOCKS: tuple[str, ...] = ("preferences",)


def _kept_blocks(profile: CandidateProfile | None) -> dict[str, object]:
    career = (profile.career if profile else None) or {}
    return {key: career[key] for key in KEPT_CAREER_BLOCKS if key in career}


class ProfileIncompleteError(AppError):
    """Preferences are asked once the profile exists, from the profile."""

    status_code = status.HTTP_409_CONFLICT
    code = "profile_incomplete"
    title = "Finish your profile before setting job preferences."


class CareerIncompleteError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "career_profile_incomplete"
    title = "Complete the required profile details"


def _response(profile: CandidateProfile | None) -> CareerResponse:
    saved = profile.career if profile else {}
    saved = saved or {}
    details = CareerDetails.model_validate(saved.get("details", {}))
    if profile and not details.current_city:
        details.current_city = profile.city or ""
    return CareerResponse(
        details=details,
        resume_version_id=saved.get("resume_version_id"),
        resume_file_id=saved.get("resume_file_id"),
        resume_filename=saved.get("resume_filename"),
        completed=saved.get("completed", False),
        updated_at=profile.updated_at.isoformat() if profile else None,
    )


async def get_details(session: AsyncSession, *, ctx: TenantContext) -> CareerResponse:
    _candidate(ctx)
    return _response(await repository.get_profile(session, user_id=ctx.user_id))


async def jobs_matching_profile(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    limit: int | None = None,
    eligible_only: bool = False,
    offset: int = 0,
) -> RecommendedJobs:
    """Board jobs that fit the candidate's career profile, ranked by the job
    engine; `offset` pages further into the same ranking. The profile is read
    as saved, finished or not: a half-filled form with skills in it is
    already something to match on."""
    _candidate(ctx)
    profile = await repository.get_profile(session, user_id=ctx.user_id)
    terms = match_terms(
        _response(profile).details,
        city=profile.city if profile else None,
        preferences=stored_preferences(profile.career if profile else None),
    )
    return await jobs_service.recommend(
        session, ctx=ctx, terms=terms, limit=limit, eligible_only=eligible_only, offset=offset
    )


async def save_details(
    session: AsyncSession, *, ctx: TenantContext, payload: CareerSaveRequest
) -> CareerResponse:
    _candidate(ctx)
    old = await get_details(session, ctx=ctx)
    from app.modules.taxonomy.service import validate_profile

    if (payload.details.starting_year and payload.details.passing_year
            and payload.details.passing_year > payload.details.starting_year + EDUCATION_MAX_YEARS):
        raise ValidationError(code="education_years_invalid", title="Graduation must be within seven years of the starting year.", params={"fields": ["passing_year"]})
    if not employment_dates_ordered(payload.details):
        raise ValidationError(code="employment_dates_invalid", title="The ending month must be after the starting month.", params={"fields": ["employment_end"]})
    await validate_profile(session, payload.details, old.details, ctx.user_id)
    from app.modules.education_taxonomy.domain import missing_custom_fields
    from app.modules.education_taxonomy.service import validate_profile as validate_education
    await validate_education(session, payload.details, old.details, ctx.user_id)
    missing = missing_required(payload.details) if payload.complete else []
    if payload.complete:
        missing = list(dict.fromkeys([*missing, *missing_custom_fields(payload.details)]))
    profile = await repository.get_profile(session, user_id=ctx.user_id)
    if payload.complete and not (profile and profile.full_name):
        missing.append("full_name")
    if missing:
        raise CareerIncompleteError(params={"fields": missing})
    # Profile editing is independent of resume editing. Linking an owned resume
    # is allowed, but saving profile facts never creates or rewrites a CV.
    version_id = payload.resume_version_id or old.resume_version_id
    file_id = old.resume_file_id
    if version_id:
        version = await resume_service.latest_version_for_profile(
            session, user_id=ctx.user_id, resume_version_id=version_id
        )
        version_id = version.id
        file_id = version.resume_file_id
    saved = {
        **_kept_blocks(profile),
        "details": payload.details.model_dump(mode="json"),
        "resume_version_id": str(version_id) if version_id else None,
        "resume_file_id": str(file_id) if file_id else None,
        "resume_filename": payload.resume_filename or old.resume_filename,
        "completed": payload.complete
        or (
            old.completed and payload.details == old.details and version_id == old.resume_version_id
        ),
    }
    row = await repository.set_career(
        session,
        user_id=ctx.user_id,
        career=saved,
        city=normalise_city(payload.details.current_city) if payload.details.current_city else None,
    )
    return _response(row)


async def attach_resume(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    resume_version_id: uuid.UUID,
    resume_file_id: uuid.UUID | None,
    resume_filename: str,
) -> CareerResponse:
    """Link the profile to a resume the candidate made in the resume builder.

    Only the resume link moves. Profile answers and completion stay unchanged;
    resume content is edited exclusively in the resume editor.
    """
    _candidate(ctx)
    old = await get_details(session, ctx=ctx)
    saved = {
        **_kept_blocks(await repository.get_profile(session, user_id=ctx.user_id)),
        "details": old.details.model_dump(mode="json"),
        "resume_version_id": str(resume_version_id),
        "resume_file_id": str(resume_file_id) if resume_file_id else None,
        "resume_filename": resume_filename,
        "completed": old.completed,
    }
    city = old.details.current_city
    row = await repository.set_career(
        session,
        user_id=ctx.user_id,
        career=saved,
        city=normalise_city(city) if city else None,
    )
    return _response(row)


#: Fields a CV may never fill on the automatic prefill path: who the account
#: holder is and how to reach them.
CV_NEVER_SUPPLIES: tuple[str, ...] = ("phone",)


async def prefill(
    session: AsyncSession, *, ctx: TenantContext, resume_version_id: uuid.UUID
) -> CareerResponse:
    _candidate(ctx)
    # The newest version of this CV, as in `save_details`: prefilling from an
    # older version of the CV already linked is the no-op below, not a 409.
    version = await resume_service.latest_version_for_profile(
        session, user_id=ctx.user_id, resume_version_id=resume_version_id
    )
    resume_version_id = version.id
    old = await get_details(session, ctx=ctx)
    if old.resume_version_id == resume_version_id:
        return old
    parsed = version.parsed or {}
    text = parsed.get("raw_text") or str(
        {key: value for key, value in parsed.items() if key not in ("hidden_text", "extractor")}
    )
    facts = await extract_career(text, parsed)
    details = CareerDetails.model_validate(
        {
            key: value
            for key, value in facts.model_dump().items()
            if key in CareerDetails.model_fields
        }
    )
    # **Identity never comes from a CV here** (2026-11-23). This runs without
    # a review step, and the file may be someone else's: it used to save the
    # CV's name as the account's name (which employers see on cards) and its
    # phone as the contact number. The name is asked at sign-up and the phone
    # is the candidate's own; both stay as the candidate entered them.
    extracted = details.model_dump()
    for identity_field in CV_NEVER_SUPPLIES:
        extracted[identity_field] = ""
    # Candidate-entered values win. A replacement CV never silently erases them.
    extracted.update(
        {
            key: value
            for key, value in old.details.model_dump().items()
            if value not in ("", None, [], 0)
        }
    )
    if extracted["work_status"] == "FRESHER":
        extracted.update(experience_years=0, experience_months=0)
    result = await save_details(
        session,
        ctx=ctx,
        payload=CareerSaveRequest(
            details=CareerDetails.model_validate(extracted), resume_version_id=resume_version_id
        ),
    )
    return result


# ---------------------------------------------------------------------------
# Job preferences (2026-11-23)
# ---------------------------------------------------------------------------
def _preferences_response(profile: CandidateProfile | None) -> PreferencesResponse:
    career = (profile.career if profile else None) or {}
    details = _response(profile).details
    return PreferencesResponse(
        **stored_preferences(career).model_dump(),
        preferred_locations=details.preferred_locations,
        preferred_salary=details.preferred_salary,
        preferred_salary_currency=details.preferred_salary_currency,
        profile_completed=bool(career.get("completed")),
        updated_at=profile.updated_at.isoformat() if profile else None,
    )


async def get_preferences(session: AsyncSession, *, ctx: TenantContext) -> PreferencesResponse:
    _candidate(ctx)
    return _preferences_response(await repository.get_profile(session, user_id=ctx.user_id))


async def save_preferences(
    session: AsyncSession, *, ctx: TenantContext, payload: PreferencesPayload
) -> PreferencesResponse:
    """Replace the preferences. Locations and salary are written into the
    profile details they already belong to; nothing else in the profile, its
    completion or its resume link moves. Only a completed profile."""
    _candidate(ctx)
    profile = await repository.get_profile(session, user_id=ctx.user_id)
    career = dict((profile.career if profile else None) or {})
    if not career.get("completed"):
        raise ProfileIncompleteError()
    details = _response(profile).details.model_copy(
        update={
            "preferred_locations": payload.preferred_locations,
            "preferred_salary": payload.preferred_salary,
            "preferred_salary_currency": payload.preferred_salary_currency,
        }
    )
    block = JobPreferences.model_validate(
        payload.model_dump(include=set(JobPreferences.model_fields))
    )
    career["details"] = details.model_dump(mode="json")
    career["preferences"] = block.model_dump(mode="json")
    assert profile is not None
    row = await repository.set_career(
        session, user_id=ctx.user_id, career=career, city=profile.city
    )
    return _preferences_response(row)


async def preference_options(session: AsyncSession, *, ctx: TenantContext) -> PreferenceOptions:
    """Every dropdown on the tab, so both apps show the full list."""
    _candidate(ctx)
    from app.modules.taxonomy import service as taxonomy_service

    industries = await taxonomy_service.visible_names(session, "industry")
    roles = await taxonomy_service.visible_names(session, "role")
    return PreferenceOptions(
        work_modes=[Option(value=v, label=label) for v, label in WORK_MODE_OPTIONS],
        job_types=[Option(value=v, label=label) for v, label in JOB_TYPE_OPTIONS],
        industries=[Option(value=name, label=name) for name in industries],
        roles=[Option(value=name, label=name) for name in roles],
        salary_currencies=[
            Option(value="INR", label="₹ INR"),
            Option(value="USD", label="$ USD"),
        ],
    )
