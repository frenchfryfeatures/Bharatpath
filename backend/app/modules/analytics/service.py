"""analytics - business rules and transaction boundaries

Cohort aggregates, placement tracking.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**Nothing here reveals a person**, so nothing here is audited: like a masked
search card, an aggregate over the floor is not a reveal. The college's view
of a named student is `college.service.open_student`, behind INDIVIDUAL
consent, and audited there.

**Read live, never cached.** A revoked consent leaves every figure on the
next request, because the functions this reads join consent in the query.
A cached dashboard would keep counting a student who had left.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Final

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import set_transaction_tenant
from app.core.errors import AppError, PermissionDeniedError
from app.core.logging import get_logger
from app.core.tenant import TenantContext
from app.modules.analytics import repository
from app.modules.analytics.domain import (
    DEFAULT_FLOORS,
    ApplicationFunnel,
    CohortOverview,
    PlacementReport,
    PrivacyFloors,
    PrivacyFloorsError,
    build_application_funnel,
    build_overview,
    build_placements,
    floors_from_config,
)
from app.modules.scoring.domain import display_value

logger = get_logger(__name__)

#: The `config_values` key holding `PrivacyFloors`. Insert a higher `version`
#: to raise a floor.
PRIVACY_CONFIG_KEY: Final = "analytics.privacy"


class AnalyticsFloorsInvalidError(AppError):
    """The configured floors cannot be applied. A 500, deliberately: falling
    back to the defaults would make a broken row look applied, and these are
    what stand between an aggregate and a person."""

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "analytics_floors_invalid"
    title = "Analytics privacy floors are misconfigured"


async def load_floors(session: AsyncSession, *, now: datetime) -> PrivacyFloors:
    row = await repository.current_config(session, key=PRIVACY_CONFIG_KEY, now=now)
    if row is None:
        return DEFAULT_FLOORS
    try:
        if not isinstance(row.value, dict):
            raise PrivacyFloorsError("analytics privacy floors must be a JSON object")
        return floors_from_config(row.value)
    except PrivacyFloorsError as exc:
        logger.error("analytics_floors_invalid", config_version=row.version, error=str(exc))
        raise AnalyticsFloorsInvalidError() from exc


async def _bind_college(session: AsyncSession, ctx: TenantContext) -> None:
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, ctx.tenant_id)


async def overview(
    session: AsyncSession, *, ctx: TenantContext, now: datetime | None = None
) -> CohortOverview:
    """Roster size, connected students, the score distribution and median,
    application and interview volume, platform-sourced hires (SRS 1.16.1)."""
    await _bind_college(session, ctx)
    floors = await load_floors(session, now=now or datetime.now(UTC))
    counts = await repository.cohort_counts(session)
    if counts is None:
        raise PermissionDeniedError()
    scores = (
        [display_value(value) for value in await repository.cohort_scores(session)]
        if counts.connected >= floors.min_cohort_size
        else []
    )
    return build_overview(counts, scores, floors)


async def placements(
    session: AsyncSession, *, ctx: TenantContext, now: datetime | None = None
) -> PlacementReport:
    """Platform-sourced hires by month and location (SRS 1.16.3)."""
    await _bind_college(session, ctx)
    now = now or datetime.now(UTC)
    floors = await load_floors(session, now=now)
    counts = await repository.cohort_counts(session)
    if counts is None:
        raise PermissionDeniedError()
    hires = (
        await repository.cohort_hires(session) if counts.connected >= floors.min_cohort_size else []
    )
    return build_placements(counts.connected, hires, floors, now=now)


async def applications(
    session: AsyncSession, *, ctx: TenantContext, now: datetime | None = None
) -> ApplicationFunnel:
    """Where the linked students' applications stand, by stage, and how many
    reached each milestone -- floored and suppressed like every aggregate."""
    await _bind_college(session, ctx)
    floors = await load_floors(session, now=now or datetime.now(UTC))
    counts = await repository.cohort_counts(session)
    if counts is None:
        raise PermissionDeniedError()
    rows = (
        await repository.cohort_applications(session)
        if counts.connected >= floors.min_cohort_size
        else []
    )
    return build_application_funnel(counts.connected, rows, floors)
