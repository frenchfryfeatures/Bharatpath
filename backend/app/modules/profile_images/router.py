"""profile_images - HTTP layer

Everyone's own photo, and employer and college logos. Never the score.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Three surfaces, one service:**

* `router` -- `/profile/photo`, the caller's own photo. Any signed-in
  account: a student, an employer's or a college's member, our staff.
* `employer_router` -- `/employer/organisation/logo`. Every member reads
  it; only the owner changes it, as with the rest of the organisation.
* `college_router` -- `/college/organisation/logo`. Every member reads it;
  only the college admin changes it.

**Not paywalled**, like the organisation, team and KYB: an image is part of
setting an account up, and a lapsed subscriber keeps their own picture.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.deps import (
    COLLEGE_ADMIN,
    COLLEGE_STAFF,
    EMPLOYER_OWNER,
    EMPLOYER_RECRUITER,
    EMPLOYER_VIEWER,
    CurrentUser,
    DbSession,
    require_role,
)
from app.modules.profile_images import service
from app.modules.profile_images.schemas import (
    ConfirmUploadRequest,
    ImageResponse,
    UploadTicketResponse,
)

router = APIRouter()
employer_router = APIRouter()
college_router = APIRouter()

_CONFIRM_DOC = (
    "Call after PUTting the file to the ticket's `url`. The file is checked "
    "(size, then the type from its bytes), decoded and re-encoded with its "
    "metadata stripped -- including any GPS position -- and scaled to at most "
    "512px. The upload itself is deleted either way. `422 "
    "profile_image_rejected` says why in `params.reason`; `404 "
    "profile_image_upload_not_found` means nothing was uploaded under that id."
)


# ---------------------------------------------------------------------------
# The caller's own photo
# ---------------------------------------------------------------------------
@router.get("/photo", response_model=ImageResponse, summary="Your profile photo")
async def get_photo(user: CurrentUser, session: DbSession) -> ImageResponse:
    """Every field is null when you have none. Students: your photo is shown
    to you and to BharatPath staff, never to an employer or a college."""
    return await service.current(session, owner=service.person(user))


@router.post(
    "/photo/upload",
    response_model=UploadTicketResponse,
    status_code=201,
    summary="Start uploading a profile photo",
)
async def upload_photo(user: CurrentUser) -> UploadTicketResponse:
    """JPEG, PNG or WebP, up to `max_bytes`. Nothing changes until confirm."""
    return await service.issue_upload(service.person(user))


@router.post(
    "/photo/confirm",
    response_model=ImageResponse,
    summary="Finish uploading: the photo replaces any earlier one",
    description=_CONFIRM_DOC,
)
async def confirm_photo(
    payload: ConfirmUploadRequest, user: CurrentUser, session: DbSession
) -> ImageResponse:
    return await service.confirm_upload(
        session, owner=service.person(user), upload_id=payload.upload_id
    )


@router.delete("/photo", response_model=ImageResponse, summary="Remove your profile photo")
async def delete_photo(user: CurrentUser, session: DbSession) -> ImageResponse:
    return await service.remove(session, owner=service.person(user))


# ---------------------------------------------------------------------------
# Organisation logos: one set of routes per surface, each with its roles
# ---------------------------------------------------------------------------
def _logo_routes(target: APIRouter, *, readers: object, writers: object, who: str) -> None:
    @target.get(
        "",
        response_model=ImageResponse,
        dependencies=[readers],  # type: ignore[list-item]
        summary="The organisation's logo",
    )
    async def get_logo(user: CurrentUser, session: DbSession) -> ImageResponse:
        """Every field is null when there is none. Candidates see it beside
        the organisation's jobs."""
        return await service.current(session, owner=service.organisation(user))

    @target.post(
        "/upload",
        response_model=UploadTicketResponse,
        status_code=201,
        dependencies=[writers],  # type: ignore[list-item]
        summary=f"Start uploading the organisation's logo ({who})",
    )
    async def upload_logo(user: CurrentUser) -> UploadTicketResponse:
        return await service.issue_upload(service.organisation(user))

    @target.post(
        "/confirm",
        response_model=ImageResponse,
        dependencies=[writers],  # type: ignore[list-item]
        summary=f"Finish uploading: the logo replaces any earlier one ({who})",
        description=_CONFIRM_DOC + " A transparent PNG stays a PNG.",
    )
    async def confirm_logo(
        payload: ConfirmUploadRequest, user: CurrentUser, session: DbSession
    ) -> ImageResponse:
        return await service.confirm_upload(
            session, owner=service.organisation(user), upload_id=payload.upload_id
        )

    @target.delete(
        "",
        response_model=ImageResponse,
        dependencies=[writers],  # type: ignore[list-item]
        summary=f"Remove the organisation's logo ({who})",
    )
    async def delete_logo(user: CurrentUser, session: DbSession) -> ImageResponse:
        return await service.remove(session, owner=service.organisation(user))


_logo_routes(
    employer_router,
    readers=Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER, EMPLOYER_VIEWER)),
    writers=Depends(require_role(EMPLOYER_OWNER)),
    who="owner only",
)
_logo_routes(
    college_router,
    readers=Depends(require_role(COLLEGE_ADMIN, COLLEGE_STAFF)),
    writers=Depends(require_role(COLLEGE_ADMIN)),
    who="college admin only",
)
