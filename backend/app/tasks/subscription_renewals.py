"""Renew by mandate, and close periods that have ended.

Hourly, on Celery Beat (`app/tasks/schedule.py`). If beat is not running, no
pre-debit notice goes out and nothing moves to GRACE, LAPSED or CANCELLED on
its own. **Access is unaffected either way**: it is read from
the clock (`app.core.entitlements`), so a period that has ended grants nothing
whether or not this has run.

For each subscription due -- ending within the notice horizon, ended, or in
grace -- two transactions:

  1. `advance_renewal`: send the pre-debit notice, request the debit once the
     notice period has passed, or fall back to manual renewal.
  2. `close_period`: move an ended period to GRACE, LAPSED or CANCELLED.

**One subscription per transaction**, so one gateway failure does not roll
back another subscriber's renewal. Safe to run on several workers: every step
locks the subscription row, and the unique key on notices refuses a second
notice for the same attempt.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)


@celery_app.task(name="subscriptions.renewals", bind=True, max_retries=3)
def run_subscription_renewals(self: Any) -> dict[str, int]:
    return run_async(sweep(now=datetime.now(UTC)))


async def sweep(*, now: datetime) -> dict[str, int]:
    from app.core.db import get_session_factory
    from app.modules.billing import service as billing_service
    from app.modules.subscriptions import service as subscriptions_service

    factory = get_session_factory()
    async with factory() as session, session.begin():
        due = await subscriptions_service.due_subscription_ids(session, now=now)

    counts = {"due": len(due), "steps": 0, "closed": 0, "failed": 0}
    for subscription_id in due:
        try:
            async with factory() as session, session.begin():
                if (
                    await billing_service.advance_renewal(
                        session, subscription_id=subscription_id, now=now
                    )
                    != "NONE"
                ):
                    counts["steps"] += 1
            async with factory() as session, session.begin():
                if await billing_service.close_period(
                    session, subscription_id=subscription_id, now=now
                ):
                    counts["closed"] += 1
        except Exception:
            # One subscriber's gateway error must not stop everyone else's
            # renewal. The row is untouched and the next sweep retries it.
            counts["failed"] += 1
            logger.exception("subscription_renewal_failed", subscription_id=str(subscription_id))

    logger.info("subscription_renewal_sweep", **counts)
    return counts
