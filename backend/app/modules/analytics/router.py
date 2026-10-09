"""analytics - HTTP layer

Cohort aggregates, placement tracking.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**College admins and staff both read analytics** (SRS 1.16: "College Admin /
Staff"), and it is behind payment (R13): it is what a college pays for.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.deps import (
    COLLEGE_ADMIN,
    COLLEGE_STAFF,
    CurrentUser,
    DbSession,
    rate_limit,
    require_active_subscription,
    require_role,
)
from app.modules.analytics import service
from app.modules.analytics.schemas import (
    ApplicationFunnelResponse,
    CohortOverviewResponse,
    LocationCount,
    MonthCount,
    PlacementReportResponse,
    ScoreDistribution,
)

router = APIRouter()

CollegeReaders = [
    Depends(require_role(COLLEGE_ADMIN, COLLEGE_STAFF)),
    Depends(require_active_subscription),
    # Per organisation, not per member: a dashboard left open in a tab is the
    # thing being bounded, and a college's staff share one.
    Depends(rate_limit("analytics.read")),
]


@router.get(
    "/overview",
    response_model=CohortOverviewResponse,
    dependencies=CollegeReaders,
    summary="Cohort statistics for the college's linked students",
)
async def get_overview(user: CurrentUser, session: DbSession) -> CohortOverviewResponse:
    """Aggregates only, over students who are linked right now. No student is
    named or singled out: under `min_cohort_size` only counts are shown, and a
    band too small to show safely is `null`."""
    view = await service.overview(session, ctx=user)
    return CohortOverviewResponse(
        connected_students=view.connected_students,
        individually_visible=view.individually_visible,
        min_cohort_size=view.min_cohort_size,
        below_floor=view.below_floor,
        scored_students=view.scored_students,
        score_distribution=(
            ScoreDistribution(**view.score_distribution)
            if view.score_distribution is not None
            else None
        ),
        median_score=view.median_score,
        applicants=view.applicants,
        applications=view.applications,
        interviews=view.interviews,
        platform_hires=view.platform_hires,
    )


@router.get(
    "/placements",
    response_model=PlacementReportResponse,
    dependencies=CollegeReaders,
    summary="Platform-sourced placements of the college's linked students",
)
async def get_placements(user: CurrentUser, session: DbSession) -> PlacementReportResponse:
    """Hires confirmed by both sides on BharatPath, by month for the last
    twelve months and by job location. Labelled platform-sourced."""
    report = await service.placements(session, ctx=user)
    return PlacementReportResponse(
        source="PLATFORM",
        min_cohort_size=report.min_cohort_size,
        below_floor=report.below_floor,
        total_hires=report.total_hires,
        by_month=[MonthCount(month=m, hires=n) for m, n in report.by_month],
        by_location=[LocationCount(location=loc, hires=n) for loc, n in report.by_location],
    )


@router.get(
    "/applications",
    response_model=ApplicationFunnelResponse,
    dependencies=CollegeReaders,
    summary="Where the linked students' applications stand, by stage",
)
async def get_applications(user: CurrentUser, session: DbSession) -> ApplicationFunnelResponse:
    """Counted over students who are linked right now: current stage, and how
    many applications ever reached each milestone. Nothing under the cohort
    floor; small cells are withheld (null) with a partner, as in the overview."""
    funnel = await service.applications(session, ctx=user)
    return ApplicationFunnelResponse(
        min_cohort_size=funnel.min_cohort_size,
        below_floor=funnel.below_floor,
        total_applications=funnel.total,
        by_stage=funnel.by_stage,
        reached=funnel.reached,
    )
