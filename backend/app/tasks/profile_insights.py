"""Bounded, retry-safe insights summaries; recruiter requests do no aggregation."""

from datetime import UTC, datetime

from app.tasks.async_runner import run_async
from app.worker import celery_app


@celery_app.task(name="insights.aggregate", bind=True, max_retries=3)
def aggregate(self):
    try:
        return run_async(sweep())
    except Exception as exc:
        raise self.retry(exc=exc, countdown=30) from exc


async def sweep():
    from app.core.db import get_admin_session_factory
    from app.modules.profile_insights import repository

    total = 0
    # Bounded per tick; backlog remains pending and drains on later ticks.
    for _ in range(20):
        async with get_admin_session_factory()() as session, session.begin():
            count = await repository.rollup(session, datetime.now(UTC))
        total += count
        if count < 1000:
            break
    async with get_admin_session_factory()() as session, session.begin():
        # Serialize retention so overlapping Beat deliveries cannot archive totals twice.
        from sqlalchemy import text

        await session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended('insights:retention',0))")
        )
        await repository.purge(session, datetime.now(UTC))
    return {"aggregated": total}
