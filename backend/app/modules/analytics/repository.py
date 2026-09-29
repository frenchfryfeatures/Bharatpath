"""analytics - data access

Cohort aggregates, placement tracking.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**No table holding a student is read here** (invariant 9). Every read goes
through a SECURITY DEFINER function in the baseline migration that INNER
JOINs live consent for the college bound on the transaction, and returns no
identifier: `college_cohort_summary`, `college_cohort_scores`,
`college_cohort_hires`. `tests/invariants/test_invariant_09_consent.py` fails
this file if it names a student table.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import ConfigValue
from app.modules.analytics.domain import CohortApplication, CohortCounts, Hire


async def current_config(session: AsyncSession, *, key: str, now: datetime) -> ConfigValue | None:
    result = await session.execute(
        select(ConfigValue)
        .where(ConfigValue.key == key, ConfigValue.effective_from <= now)
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def cohort_counts(session: AsyncSession) -> CohortCounts | None:
    """None unless the transaction is bound to an active college."""
    row = (
        await session.execute(
            text(
                "SELECT connected, individually_visible, scored, applicants, applications, "
                "interviews, hires FROM college_cohort_summary()"
            )
        )
    ).first()
    if row is None:
        return None
    return CohortCounts(
        connected=int(row.connected),
        individually_visible=int(row.individually_visible),
        scored=int(row.scored),
        applicants=int(row.applicants),
        applications=int(row.applications),
        interviews=int(row.interviews),
        hires=int(row.hires),
    )


async def cohort_scores(session: AsyncSession) -> list[int]:
    """One stored score per scored, consenting student, in no useful order."""
    result = await session.execute(text("SELECT stored_score FROM college_cohort_scores()"))
    return [int(value) for (value,) in result]


async def cohort_hires(session: AsyncSession) -> list[Hire]:
    result = await session.execute(
        text("SELECT hired_at, job_location FROM college_cohort_hires()")
    )
    return [Hire(hired_at=r.hired_at, job_location=r.job_location) for r in result]


async def cohort_applications(session: AsyncSession) -> list[CohortApplication]:
    """One row per application of a linked student, and nothing saying whose."""
    result = await session.execute(text("SELECT stage, reached FROM college_cohort_applications()"))
    return [CohortApplication(stage=r.stage, reached=tuple(r.reached or ())) for r in result]
