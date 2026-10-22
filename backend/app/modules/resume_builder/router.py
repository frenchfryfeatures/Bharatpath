"""resume_builder - HTTP layer

Build a resume from the onboarding answers, before payment.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

Every route requires a candidate's token and none is paywalled: this is the
step between the onboarding questions and the subscription screen.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response

from app.core.deps import CANDIDATE, CurrentUser, DbSession, require_role
from app.modules.resume_builder import service
from app.modules.resume_builder.schemas import (
    DraftRequest,
    DraftResponse,
    PreviewRequest,
    PreviewResponse,
    PushResponse,
    TemplatesResponse,
)

router = APIRouter()

CandidateOnly = Depends(require_role(CANDIDATE))


@router.get(
    "/templates",
    response_model=TemplatesResponse,
    dependencies=[CandidateOnly],
    summary="The four resume layouts",
)
async def list_templates() -> TemplatesResponse:
    return service.templates()


@router.get(
    "/draft",
    response_model=DraftResponse,
    dependencies=[CandidateOnly],
    summary="The resume being built, or a first draft from the onboarding answers",
)
async def get_draft(user: CurrentUser, session: DbSession) -> DraftResponse:
    """`saved: false` means nothing is stored yet: the content is filled in
    from the career profile, field by field, and saving stores it."""
    return await service.get_draft(session, ctx=user)


@router.put(
    "/draft",
    response_model=DraftResponse,
    dependencies=[CandidateOnly],
    summary="Save the resume being built (autosave)",
)
async def save_draft(user: CurrentUser, session: DbSession, payload: DraftRequest) -> DraftResponse:
    return await service.save_draft(session, ctx=user, payload=payload)


@router.post(
    "/draft/reset",
    response_model=DraftResponse,
    dependencies=[CandidateOnly],
    summary="Start the draft again from the onboarding answers",
)
async def reset_draft(user: CurrentUser, session: DbSession) -> DraftResponse:
    """Keeps the template. Edits never write back to the profile, so this is
    how a changed profile reaches the draft."""
    return await service.reset_draft(session, ctx=user)


@router.post(
    "/draft/keep",
    response_model=DraftResponse,
    dependencies=[CandidateOnly],
    summary="Keep the draft as it is although a newer CV exists",
)
async def keep_draft(user: CurrentUser, session: DbSession) -> DraftResponse:
    """The other answer to `out_of_date` (the first is `/draft/reset`). The
    content is unchanged; the editor stops offering that CV."""
    return await service.keep_draft(session, ctx=user)


@router.post(
    "/preview",
    response_model=PreviewResponse,
    dependencies=[CandidateOnly],
    summary="Draw a draft in a template, without saving it",
)
async def preview(user: CurrentUser, payload: PreviewRequest) -> PreviewResponse:
    """The editor's right-hand pane. Pages come back as base64 PNG (or SVG);
    call it a moment after typing stops, not on every key."""
    return await service.preview(ctx=user, payload=payload)


@router.post(
    "/download",
    dependencies=[CandidateOnly],
    response_class=Response,
    responses={200: {"content": {"application/pdf": {}}, "description": "The resume as a PDF"}},
    summary="Download the saved draft as a PDF (counted)",
)
async def download(user: CurrentUser, session: DbSession) -> Response:
    """The saved draft, not the editor's state: save first. Each download is
    recorded for the console's follow-up list."""
    document, filename = await service.download(session, ctx=user)
    return Response(
        content=document,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.post(
    "/push",
    response_model=PushResponse,
    dependencies=[CandidateOnly],
    summary="Use the saved draft as my resume",
)
async def push(user: CurrentUser, session: DbSession) -> PushResponse:
    """Creates an unconfirmed resume version with the PDF as its file and
    links it from the career profile. Nothing is scored until the candidate
    pays and confirms the version
    (`POST /candidate/resume/versions/{id}/confirm`)."""
    return await service.push(session, ctx=user)
