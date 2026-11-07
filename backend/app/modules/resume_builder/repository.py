"""resume_builder - data access

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

The table is not under Row-Level Security (see `models`), so **every
function takes the owner's id** and filters on it. The service takes that id
from the verified token, never from a request.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.resume_builder.models import ResumeBuilderDraft


async def get_draft(
    session: AsyncSession, *, user_id: uuid.UUID, lock: bool = False
) -> ResumeBuilderDraft | None:
    query = (
        select(ResumeBuilderDraft)
        .where(ResumeBuilderDraft.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


async def save_draft(
    session: AsyncSession, *, user_id: uuid.UUID, template_key: str, content: dict[str, Any]
) -> ResumeBuilderDraft:
    """Upsert, so the first save and every autosave after it are one
    statement, and two concurrent saves cannot both try to insert.

    The first save sets `synced_at` (its default); an autosave leaves it, so
    typing never hides that a newer CV arrived."""
    await session.execute(
        insert(ResumeBuilderDraft)
        .values(user_id=user_id, template_key=template_key, content=content)
        .on_conflict_do_update(
            index_elements=[ResumeBuilderDraft.user_id],
            set_={"template_key": template_key, "content": content, "updated_at": func.now()},
        )
    )
    row = await get_draft(session, user_id=user_id)
    assert row is not None  # just written in this transaction
    return row


async def record_download(session: AsyncSession, *, user_id: uuid.UUID) -> None:
    await session.execute(
        update(ResumeBuilderDraft)
        .where(ResumeBuilderDraft.user_id == user_id)
        .values(
            download_count=ResumeBuilderDraft.download_count + 1,
            first_downloaded_at=func.coalesce(ResumeBuilderDraft.first_downloaded_at, func.now()),
            last_downloaded_at=func.now(),
        )
    )


async def record_push(
    session: AsyncSession, *, user_id: uuid.UUID, resume_version_id: uuid.UUID
) -> None:
    """`clock_timestamp()`, not `now()`: a save and a push in one transaction
    must still order the push after the save."""
    await session.execute(
        update(ResumeBuilderDraft)
        .where(ResumeBuilderDraft.user_id == user_id)
        .values(
            pushed_version_id=resume_version_id,
            pushed_at=func.clock_timestamp(),
            synced_at=func.clock_timestamp(),
        )
    )


async def mark_synced(session: AsyncSession, *, user_id: uuid.UUID) -> None:
    """The draft has caught up with the candidate's resume: refilled from it,
    or kept as it is on purpose. `clock_timestamp()` for the reason above."""
    await session.execute(
        update(ResumeBuilderDraft)
        .where(ResumeBuilderDraft.user_id == user_id)
        .values(synced_at=func.clock_timestamp())
    )
