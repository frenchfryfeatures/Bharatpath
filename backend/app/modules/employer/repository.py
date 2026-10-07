"""employer - data access

Employer tenant, team members, roles.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**`employers` is under Row-Level Security.** Every function here assumes the
service has already bound `app.tenant_id` for the transaction; without it the
policy matches nothing and a read returns None, which is the correct failure
direction. The `tenant_id` predicates below are belt and braces on top of RLS,
not instead of it.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.employer.models import Employer

#: The columns an owner may change. KYB status is deliberately absent: it
#: moves only through the KYB state machine (Day 10), never through a profile
#: edit, or invariant 8 would be one PATCH away from bypassed.
_EDITABLE: Final[frozenset[str]] = frozenset(
    {
        "legal_name",
        "employer_type",
        "industry",
        "trade_name",
        "employee_count_band",
        "website",
        "about",
    }
)


async def create_employer(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    legal_name: str,
    employer_type: str | None,
    industry: str | None,
) -> Employer:
    row = Employer(
        tenant_id=tenant_id,
        legal_name=legal_name,
        employer_type=employer_type,
        industry=industry,
        kyb_status="DRAFT",
    )
    session.add(row)
    await session.flush()
    return row


async def get_employer(session: AsyncSession, *, tenant_id: uuid.UUID) -> Employer | None:
    result = await session.execute(select(Employer).where(Employer.tenant_id == tenant_id))
    return result.scalar_one_or_none()


async def legal_names(
    session: AsyncSession, *, tenant_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Names by tenant, for as many of `tenant_ids` as the bound policy shows.

    Selects the name column alone. Under the candidate board policy the rest of
    the row -- KYB status above all -- is readable too, so what leaves this
    function is what the board is allowed to say.
    """
    if not tenant_ids:
        return {}
    result = await session.execute(
        select(Employer.tenant_id, Employer.legal_name).where(Employer.tenant_id.in_(tenant_ids))
    )
    return {row.tenant_id: row.legal_name for row in result}


async def update_employer(
    session: AsyncSession, *, tenant_id: uuid.UUID, changes: dict[str, str | None]
) -> Employer | None:
    unexpected = set(changes) - _EDITABLE
    if unexpected:
        raise ValueError(f"not editable through the profile: {sorted(unexpected)}")
    row = await get_employer(session, tenant_id=tenant_id)
    if row is None:
        return None
    for field, value in changes.items():
        setattr(row, field, value)
    await session.flush()
    return row


async def set_kyb_status(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    status: str,
    verified_at: datetime | None,
) -> Employer | None:
    """Written only by the KYB service, through `employer.service`. Kept apart
    from `update_employer` on purpose: a profile edit must never be a way to
    set this column, or invariant 8 is one PATCH away from bypassed."""
    row = await get_employer(session, tenant_id=tenant_id)
    if row is None:
        return None
    row.kyb_status = status
    row.verified_at = verified_at
    await session.flush()
    return row
