"""Career profile transactions and resume prefill, with no scoring side effects."""

from __future__ import annotations

import uuid
from contextlib import suppress

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.tenant import TenantContext
from app.modules.candidate import repository
from app.modules.candidate.career import (
    CareerDetails,
    CareerResponse,
    CareerSaveRequest,
    missing_required,
)
from app.modules.candidate.domain import normalise_city
from app.modules.candidate.extraction import extract_career
from app.modules.candidate.models import CandidateProfile
from app.modules.candidate.schemas import NameRequest
from app.modules.candidate.service import _candidate, set_full_name
from app.modules.resume import service as resume_service
from app.modules.resume.schemas import (
    ManualEducation,
    ManualExperience,
    ManualResumeRequest,
    ResumeEditRequest,
)


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


async def save_details(
    session: AsyncSession, *, ctx: TenantContext, payload: CareerSaveRequest
) -> CareerResponse:
    _candidate(ctx)
    old = await get_details(session, ctx=ctx)
    missing = missing_required(payload.details) if payload.complete else []
    profile = await repository.get_profile(session, user_id=ctx.user_id)
    if payload.complete and not (profile and profile.full_name):
        missing.append("full_name")
    if missing:
        raise CareerIncompleteError(params={"fields": missing})
    full_name = profile.full_name if profile and profile.full_name else ""
    version_id = payload.resume_version_id or old.resume_version_id
    file_id = old.resume_file_id
    if payload.complete and not version_id:
        facts = payload.details
        version = await resume_service.create_manual_version(
            session,
            user_id=ctx.user_id,
            payload=ManualResumeRequest(
                full_name=full_name,
                headline=facts.headline or None,
                skills=facts.key_skills,
                experience=[
                    ManualExperience(
                        employer=facts.company_name,
                        title=facts.job_title,
                        start_year=int(facts.employment_start[:4]),
                        end_year=int(facts.employment_end[:4]) if facts.employment_end else None,
                        summary=None,
                    )
                ]
                if facts.work_status == "EXPERIENCED"
                else [],
                education=[
                    ManualEducation(
                        institution=facts.institution,
                        qualification=(
                            f"{facts.highest_qualification} {facts.course} "
                            f"{facts.specialization_name}"
                        ).strip(),
                        completed_year=facts.passing_year,
                    )
                ],
            ),
        )
        version_id = version.id
    if version_id:
        version = await resume_service.get_version_for_profile(
            session, user_id=ctx.user_id, resume_version_id=version_id, current_only=True
        )
        file_id = version.resume_file_id
        if payload.complete and (not old.completed or payload.details != old.details):
            # A reviewed profile becomes an unconfirmed resume revision. Creating
            # it emits no scoring event; paid confirmation is a separate request.
            parsed = version.parsed or {}
            original = parsed.get("raw_text") or str(parsed)
            original = original.split("\n\nCandidate-reviewed career facts:\n", 1)[0]
            facts = payload.details
            reviewed = (
                f"\n\nCandidate-reviewed career facts:\n"
                f"Candidate-confirmed facts take precedence over earlier values.\n"
                f"Name: {full_name}\nHeadline: {facts.headline}\n"
                f"Work status: {facts.work_status}; total experience: "
                f"{facts.experience_years} years {facts.experience_months} months\n"
                f"Employer: {facts.company_name}; role: {facts.job_title}; "
                f"dates: {facts.employment_start} to {facts.employment_end or 'present'}\n"
                f"Education: {facts.highest_qualification}, {facts.course}, "
                f"{facts.specialization} {facts.specialization_name}, {facts.institution}, "
                f"{facts.starting_year} to {facts.passing_year}\n"
                f"Skills: {', '.join(facts.key_skills)}"
            )
            updated_version = await resume_service.edit_version(
                session,
                user_id=ctx.user_id,
                resume_version_id=version_id,
                payload=ResumeEditRequest(text=original + reviewed),
            )
            version_id = updated_version.id
    saved = {
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


async def prefill(
    session: AsyncSession, *, ctx: TenantContext, resume_version_id: uuid.UUID
) -> CareerResponse:
    _candidate(ctx)
    version = await resume_service.get_version_for_profile(
        session, user_id=ctx.user_id, resume_version_id=resume_version_id, current_only=True
    )
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
    current_profile = await repository.get_profile(session, user_id=ctx.user_id)
    if facts.full_name and not (current_profile and current_profile.full_name):
        with suppress(ValueError):
            await set_full_name(session, ctx=ctx, payload=NameRequest(full_name=facts.full_name))
    # Candidate-entered values win. A replacement CV never silently erases them.
    extracted = details.model_dump()
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
