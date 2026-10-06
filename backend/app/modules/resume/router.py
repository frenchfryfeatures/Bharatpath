"""resume - HTTP layer

Upload, parse jobs, versions, review and confirm.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Every route here requires a verified candidate.** There is no guest upload
path: the client reversed that on 2026-08-27 -- *"Without login the user cannot
parse the resume"* -- so `tests/invariants/test_route_authorisation.py` fails
the build if any route below becomes reachable without a token.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, UploadFile, status

from app.core.deps import (
    CANDIDATE,
    CurrentUser,
    DbSession,
    require_active_subscription,
    require_role,
)
from app.modules.resume import service
from app.modules.resume.domain import PARSE_TERMINAL
from app.modules.resume.schemas import (
    ManualResumeRequest,
    PasteTextRequest,
    ResumeConfirmResponse,
    ResumeEditRequest,
    ResumeFileStatusResponse,
    ResumeSection,
    ResumeSectionItem,
    ResumeVersionDetailResponse,
    ResumeVersionResponse,
    ResumeVersionSummary,
    UploadCompleteResponse,
    UploadTicketResponse,
)
from app.modules.resume.sections import section_items, split_sections
from app.modules.resume.structuring import STORED_KEY as STRUCTURED_KEY
from app.modules.resume.structuring import structured_view
from app.settings import get_settings

router = APIRouter()

#: A resume belongs to a candidate. An employer or college user has no resume
#: of their own, so this is a role check and not merely an authentication one.
CandidateOnly = Depends(require_role(CANDIDATE))


@router.post(
    "/intake", response_model=ResumeVersionResponse, dependencies=[CandidateOnly], status_code=201
)
async def direct_intake(
    user: CurrentUser, session: DbSession, file: UploadFile = File(...)
) -> ResumeVersionResponse:
    from app.modules.resume import onboarding_service

    content = await file.read(get_settings().resume_max_upload_bytes + 1)
    await file.close()
    row = await onboarding_service.intake(session, user_id=user.user_id, content=content)
    return ResumeVersionResponse(
        resume_version_id=row.id, source="UPLOAD", confirmed=False, created_at=row.created_at
    )


@router.post(
    "/uploads",
    response_model=UploadTicketResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CandidateOnly],
    summary="Get a presigned URL to upload a CV",
)
async def create_upload(user: CurrentUser) -> UploadTicketResponse:
    """Issue a presigned PUT. **Nothing is written to the database here.**

    That is the point: an upload that is abandoned or fails midway leaves no
    partial `resume_files` row to clean up, because the row is created only
    once the bytes are there and have passed validation.

    The bucket is private and the URL expires, so this is the only way the
    object can be written -- there is no public write path to get wrong.
    """
    settings = get_settings()
    upload_id, url, ttl = await service.issue_upload_ticket(user_id=user.user_id)
    return UploadTicketResponse(
        upload_id=upload_id,
        url=url,
        expires_in_seconds=ttl,
        max_bytes=settings.resume_max_upload_bytes,
        accepted_types=settings.resume_allowed_mime_types,
    )


@router.post(
    "/uploads/{upload_id}/complete",
    response_model=UploadCompleteResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[CandidateOnly],
    summary="Validate a finished upload and queue parsing",
)
async def complete_upload(
    upload_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> UploadCompleteResponse:
    """202, not 200: the file is accepted, parsing has not happened yet.

    The server re-derives the object key from the caller's id rather than
    accepting one, reads the size from S3 rather than believing the client,
    and sniffs the type from the stored bytes. A client that lies about any of
    the three changes nothing.
    """
    resume_file_id, scan_status, parse_status = await service.complete_upload(
        session, user_id=user.user_id, upload_id=upload_id
    )
    return UploadCompleteResponse(
        resume_file_id=resume_file_id,
        scan_status=scan_status,
        parse_status=parse_status,
    )


@router.get(
    "/files/{resume_file_id}",
    response_model=ResumeFileStatusResponse,
    dependencies=[CandidateOnly],
    summary="Poll an upload's scan and parse state",
)
async def file_status(
    resume_file_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ResumeFileStatusResponse:
    """404 for a file belonging to someone else, never 403 -- a 403 would
    confirm that it exists."""
    row, version = await service.get_file_status(
        session, user_id=user.user_id, resume_file_id=resume_file_id
    )
    return ResumeFileStatusResponse(
        resume_file_id=row.id,
        scan_status=row.scan_status,
        parse_status=row.parse_status,
        parse_error_code=row.parse_error_code,
        # Computed rather than stored: which states are final is a property of
        # the state machine, and duplicating it in a column would let the two
        # disagree the first time a state is added.
        terminal=row.parse_status in PARSE_TERMINAL,
        uploaded_at=row.uploaded_at,
        resume_version_id=version.id if version is not None else None,
    )


@router.post(
    "/text",
    response_model=ResumeVersionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CandidateOnly],
    summary="Submit a CV as pasted text",
)
async def paste_text(
    payload: PasteTextRequest, user: CurrentUser, session: DbSession
) -> ResumeVersionResponse:
    """No file, so no upload, no scan and no OCR. 201 rather than 202: this
    path has nothing to do asynchronously."""
    row = await service.create_pasted_version(session, user_id=user.user_id, text=payload.text)
    return ResumeVersionResponse(
        resume_version_id=row.id,
        source="PASTE",
        confirmed=row.confirmed_at is not None,
        created_at=row.created_at,
    )


@router.post(
    "/manual",
    response_model=ResumeVersionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CandidateOnly],
    summary="Submit a CV through the structured form",
)
async def manual_entry(
    payload: ManualResumeRequest, user: CurrentUser, session: DbSession
) -> ResumeVersionResponse:
    """PRD 4.2, for candidates with no document to upload.

    The form carries no date of birth and no age: invariant 5 forbids
    age-gating, and `scripts/check_no_age_fields.py` fails the build on one.
    """
    row = await service.create_manual_version(session, user_id=user.user_id, payload=payload)
    return ResumeVersionResponse(
        resume_version_id=row.id,
        source="MANUAL",
        confirmed=row.confirmed_at is not None,
        created_at=row.created_at,
    )


# ---------------------------------------------------------------------------
# Review, edit, confirm (SRS 1.4.4)
#
# Route order matters below: `/versions` must be declared before
# `/versions/{resume_version_id}`, or the literal path is matched by the
# parameterised route and answered with a 422 for a malformed UUID.
# ---------------------------------------------------------------------------
@router.get(
    "/versions",
    response_model=list[ResumeVersionSummary],
    dependencies=[CandidateOnly],
    summary="List this candidate's resume versions, newest first",
)
async def list_versions(user: CurrentUser, session: DbSession) -> list[ResumeVersionSummary]:
    """The version chain. No content -- the list screen shows dates and
    states, and every CV in full is a large response for a small view."""
    rows = await service.list_versions(session, user_id=user.user_id)
    return [
        ResumeVersionSummary(
            resume_version_id=row.id,
            source=row.source,
            confirmed=row.confirmed_at is not None,
            confirmed_at=row.confirmed_at,
            supersedes_id=row.supersedes_id,
            superseded=superseded,
            created_at=row.created_at,
        )
        for row, superseded in rows
    ]


@router.get(
    "/versions/{resume_version_id}",
    response_model=ResumeVersionDetailResponse,
    dependencies=[CandidateOnly],
    summary="Review one version in full",
)
async def review_version(
    resume_version_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ResumeVersionDetailResponse:
    """**The review screen.** The only response that returns `parsed` whole.

    Parsing is not accurate enough to attach a number to without showing the
    candidate what was read -- which is the entire argument for the confirm
    gate, and this is the read that makes confirming an informed act rather
    than a button.

    404 for another candidate's version, never 403.
    """
    row, superseded = await service.get_version_for_review(
        session, user_id=user.user_id, resume_version_id=resume_version_id
    )
    structured, structured_status = structured_view(row.parsed)
    return ResumeVersionDetailResponse(
        resume_version_id=row.id,
        source=row.source,
        # The stored structured document is returned once, below, not twice.
        parsed={k: v for k, v in row.parsed.items() if k != STRUCTURED_KEY},
        sections=_sections_of(row.parsed),
        structured_resume=structured,
        structured_status=structured_status,
        confirmed=row.confirmed_at is not None,
        confirmed_at=row.confirmed_at,
        supersedes_id=row.supersedes_id,
        superseded=superseded,
        created_at=row.created_at,
    )


def _sections_of(parsed: object) -> list[ResumeSection] | None:
    raw_text = parsed.get("raw_text") if isinstance(parsed, dict) else None
    if not isinstance(raw_text, str):
        return None
    return [
        ResumeSection(
            kind=section.kind,
            heading=section.heading,
            body=section.body,
            items=(
                None
                if (items := section_items(section.kind, section.body)) is None
                else [
                    ResumeSectionItem(text=i.text, unclear=i.unclear, suggestion=i.suggestion)
                    for i in items
                ]
            ),
        )
        for section in split_sections(raw_text)
    ]


@router.post(
    "/versions/{resume_version_id}/edit",
    response_model=ResumeVersionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CandidateOnly],
    summary="Correct a version, creating a new one",
)
async def edit_version(
    resume_version_id: uuid.UUID,
    payload: ResumeEditRequest,
    user: CurrentUser,
    session: DbSession,
) -> ResumeVersionResponse:
    """**201, not 200** -- a correction creates a version, it never updates
    one. The response id is the new version's, not the one that was edited.

    The new version arrives unconfirmed even if the one it replaces was
    confirmed, so a correction has to go back through review. 409 if this
    version has already been superseded.
    """
    row = await service.edit_version(
        session,
        user_id=user.user_id,
        resume_version_id=resume_version_id,
        payload=payload,
    )
    return ResumeVersionResponse(
        resume_version_id=row.id,
        source="EDIT",
        confirmed=row.confirmed_at is not None,
        created_at=row.created_at,
    )


@router.post(
    "/versions/{resume_version_id}/confirm",
    response_model=ResumeConfirmResponse,
    dependencies=[CandidateOnly, Depends(require_active_subscription)],
    summary="Confirm a reviewed version so it can be scored",
)
async def confirm_version(
    resume_version_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> ResumeConfirmResponse:
    """**The mandatory confirm gate** (SRS 1.4.4). Until this succeeds, the
    version cannot reach scoring at all.

    200 rather than 201: nothing is created, and confirming twice is a retry
    that returns the original timestamp rather than a second confirmation.
    """
    row, already = await service.confirm_version(
        session, user_id=user.user_id, resume_version_id=resume_version_id
    )
    return ResumeConfirmResponse(
        resume_version_id=row.id,
        confirmed_at=row.confirmed_at,
        already_confirmed=already,
    )


@router.get("/versions/{resume_version_id}/document", dependencies=[CandidateOnly])
async def resume_document(
    resume_version_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> dict[str, str | None]:
    return {
        "url": await service.profile_resume_url(
            session, user_id=user.user_id, resume_version_id=resume_version_id
        )
    }


@router.get("/versions/{resume_version_id}/preview", dependencies=[CandidateOnly])
async def resume_preview(
    resume_version_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> dict[str, Any]:
    return await service.profile_resume_preview(
        session, user_id=user.user_id, resume_version_id=resume_version_id
    )
