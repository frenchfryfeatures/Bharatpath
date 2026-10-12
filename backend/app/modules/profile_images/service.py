"""profile_images - business rules and transaction boundaries

Everyone's own photo, and employer and college logos. Never the score.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**An upload is three calls**, the shape every upload here has:

  1. `issue_upload` -- a presigned PUT for a key built from the caller's own
     identity and a fresh upload id. Nothing is written.
  2. The client PUTs the file straight to S3.
  3. `confirm_upload` -- the key is rebuilt from the caller and the upload
     id (never taken from the client), the size read from S3 and the type
     sniffed from the bytes. Then the file is decoded and re-encoded
     (`imaging`), the result written under a new key, and the raw upload
     deleted whatever happened. A refused file is not kept: it is storage we
     pay for and, for a photo, personal data we have no reason to hold.

**Replacing or removing an image deletes the old object.** The key on the
row is the only record of where it is; an object left behind would survive
the person's erasure, which reads keys off rows.

**Images are read through presigned GETs that expire** (every bucket is
private). A client re-fetches the URL rather than caching it.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from app.core.logging import get_logger
from app.core.tenant import TenantContext
from app.modules.profile_images import repository
from app.modules.profile_images.domain import (
    ACCEPTED_IMAGE_TYPES,
    MAX_UPLOAD_BYTES,
    OwnerKind,
    is_from_upload,
    sniff_image,
    stored_key,
    upload_key,
    upload_rejection,
)
from app.modules.profile_images.imaging import ImageRejectedError, normalise
from app.modules.profile_images.models import OrganisationLogo, UserPhoto
from app.modules.profile_images.schemas import ImageResponse, UploadTicketResponse
from app.settings import get_settings

logger = get_logger(__name__)


class ProfileImageUploadNotFoundError(NotFoundError):
    code = "profile_image_upload_not_found"
    title = "Upload not found"


class ProfileImageRejectedError(ValidationError):
    """`params.reason`: `empty`, `too_large`, `unsupported_type`,
    `not_an_image` or `too_many_pixels`."""

    code = "profile_image_rejected"
    title = "This image could not be used"


@dataclass(frozen=True, slots=True)
class Owner:
    kind: OwnerKind
    id: uuid.UUID
    actor_id: uuid.UUID


def person(ctx: TenantContext) -> Owner:
    """The caller, for their own photo. Any signed-in account."""
    return Owner("USER", ctx.user_id, ctx.user_id)


def organisation(ctx: TenantContext) -> Owner:
    """The caller's organisation, from the resolved membership -- never from
    a path or a body. The router has already checked the role."""
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    return Owner("TENANT", ctx.tenant_id, ctx.user_id)


def _bucket() -> str:
    return get_settings().s3_bucket_profile_images


async def _url(key: str) -> str:
    return await storage.presign_get(
        bucket=_bucket(), key=key, expires_in=get_settings().presigned_url_ttl_seconds
    )


Stored = UserPhoto | OrganisationLogo


async def _view(row: Stored | None) -> ImageResponse:
    if row is None:
        return ImageResponse()
    return ImageResponse(
        url=await _url(row.s3_key),
        mime=row.mime,
        width=row.width,
        height=row.height,
        updated_at=row.updated_at,
        expires_in_seconds=get_settings().presigned_url_ttl_seconds,
    )


async def _row(session: AsyncSession, owner: Owner) -> Stored | None:
    if owner.kind == "USER":
        return await repository.photo(session, user_id=owner.id)
    return await repository.logo(session, tenant_id=owner.id)


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
async def issue_upload(owner: Owner) -> UploadTicketResponse:
    settings = get_settings()
    upload_id = uuid.uuid4()
    url = await storage.presign_put(
        bucket=_bucket(),
        key=upload_key(kind=owner.kind, owner_id=owner.id, upload_id=upload_id),
        expires_in=settings.presigned_url_ttl_seconds,
    )
    return UploadTicketResponse(
        upload_id=upload_id,
        url=url,
        expires_in_seconds=settings.presigned_url_ttl_seconds,
        max_bytes=MAX_UPLOAD_BYTES,
        accepted_types=list(ACCEPTED_IMAGE_TYPES),
    )


async def confirm_upload(
    session: AsyncSession, *, owner: Owner, upload_id: uuid.UUID, now: datetime | None = None
) -> ImageResponse:
    """Judge what landed, keep a clean copy of it, and make it the owner's
    image. Confirming the same upload twice answers with what the first
    confirm stored."""
    current = await _row(session, owner)
    if current is not None and is_from_upload(current.s3_key, upload_id=upload_id):
        return await _view(current)

    bucket = _bucket()
    raw_key = upload_key(kind=owner.kind, owner_id=owner.id, upload_id=upload_id)
    meta = await storage.head_object(bucket=bucket, key=raw_key)
    if meta is None:
        raise ProfileImageUploadNotFoundError()
    try:
        size = int(meta["size_bytes"])
        mime = sniff_image(await storage.read_head_bytes(bucket=bucket, key=raw_key, count=16))
        reason = upload_rejection(size=size, mime=mime)
        if reason is not None:
            raise ProfileImageRejectedError(params={"reason": reason})
        raw = await storage.read_whole_object(bucket=bucket, key=raw_key)
        try:
            image = await asyncio.to_thread(normalise, raw)
        except ImageRejectedError as exc:
            raise ProfileImageRejectedError(params={"reason": exc.reason}) from None
    finally:
        # The client's file is never kept, accepted or not.
        await storage.delete_object(bucket=bucket, key=raw_key)

    key = stored_key(kind=owner.kind, owner_id=owner.id, upload_id=upload_id, mime=image.mime)
    await storage.put_object(bucket=bucket, key=key, body=image.body, content_type=image.mime)
    now = now or datetime.now(UTC)
    if owner.kind == "USER":
        previous = await repository.put_photo(
            session,
            user_id=owner.id,
            s3_key=key,
            mime=image.mime,
            size_bytes=len(image.body),
            width=image.width,
            height=image.height,
            now=now,
        )
    else:
        previous = await repository.put_logo(
            session,
            tenant_id=owner.id,
            s3_key=key,
            mime=image.mime,
            size_bytes=len(image.body),
            width=image.width,
            height=image.height,
            updated_by=owner.actor_id,
            now=now,
        )
    if previous is not None and previous != key:
        await storage.delete_object(bucket=bucket, key=previous)
    logger.info("profile_image_set", kind=owner.kind, mime=image.mime)
    return await _view(await _row(session, owner))


# ---------------------------------------------------------------------------
# Read and remove
# ---------------------------------------------------------------------------
async def current(session: AsyncSession, *, owner: Owner) -> ImageResponse:
    """The owner's image, or every field null when there is none."""
    return await _view(await _row(session, owner))


async def remove(session: AsyncSession, *, owner: Owner) -> ImageResponse:
    """Delete the row, then the object. Removing nothing is not an error."""
    if owner.kind == "USER":
        key = await repository.delete_photo(session, user_id=owner.id)
    else:
        key = await repository.delete_logo(session, tenant_id=owner.id)
    if key is not None:
        await storage.delete_object(bucket=_bucket(), key=key)
    return ImageResponse()


async def logo_urls(session: AsyncSession, *, tenant_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """`tenant id -> presigned logo URL` for those organisations that have
    one. For any surface that names an organisation: to a candidate (the
    board, their applications, invitations, colleges, who viewed them), to a
    college (where its students applied and were hired), to the organisation
    itself, and to staff. A logo is the organisation's own face, shown on
    purpose; a person's photo is not (`photo_url`)."""
    rows = await repository.logos(session, tenant_ids=sorted(set(tenant_ids)))
    return {row.tenant_id: await _url(row.s3_key) for row in rows}


async def logo_url(session: AsyncSession, *, tenant_id: uuid.UUID | None) -> str | None:
    """One organisation's logo, or None. `logo_urls` for a list."""
    if tenant_id is None:
        return None
    return (await logo_urls(session, tenant_ids=[tenant_id])).get(tenant_id)


async def own_photo_url(session: AsyncSession, *, ctx: TenantContext) -> str | None:
    """The caller's own photo, for their own screens. The id is the verified
    caller's, so this cannot be pointed at anyone else."""
    row = await repository.photo(session, user_id=ctx.user_id)
    return await _url(row.s3_key) if row is not None else None


async def photo_url(session: AsyncSession, *, user_id: uuid.UUID) -> str | None:
    """A person's photo, for **staff only** (the admin console's candidate
    page, which audits the read). A student's photo is never shown to an
    employer or a college; see `domain`."""
    row = await repository.photo(session, user_id=user_id)
    return await _url(row.s3_key) if row is not None else None


async def photo_urls(session: AsyncSession, *, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """`user id -> photo URL`, for **staff only**: the console's lists that
    name a person, read inside the audited bypass session. The same rule as
    `photo_url`, and the same invariant test holds its callers."""
    rows = await repository.photos(session, user_ids=sorted(set(user_ids)))
    return {row.user_id: await _url(row.s3_key) for row in rows}
