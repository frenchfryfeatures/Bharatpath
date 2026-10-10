"""profile_images - data access

Everyone's own photo, and employer and college logos. Never the score.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

Neither table is under Row-Level Security (see `models`), so **every
function takes the owner's id** and filters on it. The service gets that id
from the verified token or the resolved membership, never from a request.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.profile_images.models import OrganisationLogo, UserPhoto


async def photo(
    session: AsyncSession, *, user_id: uuid.UUID, lock: bool = False
) -> UserPhoto | None:
    query = select(UserPhoto).where(UserPhoto.user_id == user_id)
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


async def logo(
    session: AsyncSession, *, tenant_id: uuid.UUID, lock: bool = False
) -> OrganisationLogo | None:
    query = select(OrganisationLogo).where(OrganisationLogo.tenant_id == tenant_id)
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


async def logos(session: AsyncSession, *, tenant_ids: list[uuid.UUID]) -> list[OrganisationLogo]:
    if not tenant_ids:
        return []
    result = await session.execute(
        select(OrganisationLogo).where(OrganisationLogo.tenant_id.in_(tenant_ids))
    )
    return list(result.scalars().all())


async def put_photo(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    s3_key: str,
    mime: str,
    size_bytes: int,
    width: int,
    height: int,
    now: datetime,
) -> str | None:
    """Write this person's photo. Returns the key it replaced, if any; call
    with the row locked (`photo(..., lock=True)`) so two uploads cannot both
    believe they replaced nothing."""
    row = await photo(session, user_id=user_id, lock=True)
    previous = row.s3_key if row is not None else None
    if row is None:
        row = UserPhoto(user_id=user_id)
        session.add(row)
    row.s3_key, row.mime, row.size_bytes = s3_key, mime, size_bytes
    row.width, row.height, row.updated_at = width, height, now
    await session.flush()
    return previous


async def put_logo(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    s3_key: str,
    mime: str,
    size_bytes: int,
    width: int,
    height: int,
    updated_by: uuid.UUID,
    now: datetime,
) -> str | None:
    row = await logo(session, tenant_id=tenant_id, lock=True)
    previous = row.s3_key if row is not None else None
    if row is None:
        row = OrganisationLogo(tenant_id=tenant_id)
        session.add(row)
    row.s3_key, row.mime, row.size_bytes = s3_key, mime, size_bytes
    row.width, row.height, row.updated_by, row.updated_at = width, height, updated_by, now
    await session.flush()
    return previous


async def delete_photo(session: AsyncSession, *, user_id: uuid.UUID) -> str | None:
    """Remove the row; returns the key of the object to delete."""
    result = await session.execute(
        delete(UserPhoto).where(UserPhoto.user_id == user_id).returning(UserPhoto.s3_key)
    )
    return result.scalar_one_or_none()


async def delete_logo(session: AsyncSession, *, tenant_id: uuid.UUID) -> str | None:
    result = await session.execute(
        delete(OrganisationLogo)
        .where(OrganisationLogo.tenant_id == tenant_id)
        .returning(OrganisationLogo.s3_key)
    )
    return result.scalar_one_or_none()
