"""candidate - data access

Candidate profile, settings, language preference.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.candidate.models import CandidateProfile


async def get_profile(session: AsyncSession, *, user_id: uuid.UUID) -> CandidateProfile | None:
    result = await session.execute(
        select(CandidateProfile)
        .where(CandidateProfile.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def set_location(
    session: AsyncSession, *, user_id: uuid.UUID, city: str | None, state_code: str | None
) -> CandidateProfile:
    """Upsert, so the first save and every later one are the same statement and
    two concurrent saves cannot both try to insert."""
    await session.execute(
        insert(CandidateProfile)
        .values(user_id=user_id, city=city, state_code=state_code)
        .on_conflict_do_update(
            index_elements=[CandidateProfile.user_id],
            set_={"city": city, "state_code": state_code, "updated_at": func.now()},
        )
    )
    profile = await get_profile(session, user_id=user_id)
    assert profile is not None  # just written in this transaction
    return profile


async def set_full_name(
    session: AsyncSession, *, user_id: uuid.UUID, full_name: str
) -> CandidateProfile:
    """Upsert the name alone, leaving the location as it was."""
    await session.execute(
        insert(CandidateProfile)
        .values(user_id=user_id, full_name=full_name)
        .on_conflict_do_update(
            index_elements=[CandidateProfile.user_id],
            set_={"full_name": full_name, "updated_at": func.now()},
        )
    )
    profile = await get_profile(session, user_id=user_id)
    assert profile is not None  # just written in this transaction
    return profile


async def set_career(
    session: AsyncSession, *, user_id: uuid.UUID, career: dict[str, Any], city: str | None
) -> CandidateProfile:
    await session.execute(
        insert(CandidateProfile)
        .values(user_id=user_id, career=career, city=city)
        .on_conflict_do_update(
            index_elements=[CandidateProfile.user_id],
            set_={"career": career, "city": city, "updated_at": func.now()},
        )
    )
    profile = await get_profile(session, user_id=user_id)
    assert profile is not None
    return profile
