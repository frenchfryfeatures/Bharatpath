"""Remind people who signed up and never started a profile (R9).

Hourly, on Celery Beat (`app/tasks/schedule.py`). The rules decide who is due, so running it
more often sends nothing extra: a person's next nudge is numbered, and the
number is claimed before any message is written.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)


@celery_app.task(name="notifications.nudge_incomplete_profiles", bind=True, max_retries=3)
def nudge_incomplete_profiles(self: Any) -> dict[str, int]:
    return run_async(sweep(now=datetime.now(UTC)))


async def sweep(*, now: datetime) -> dict[str, int]:
    """One transaction per page of candidates, then that page's messages."""
    from app.core.db import get_session_factory
    from app.modules.notifications import service
    from app.tasks.notify import send_all

    examined = nudged = sent = failed = 0
    after = None
    while True:
        async with get_session_factory()() as session, session.begin():
            page = await service.nudge_page(session, now=now, after_id=after)
        outcomes = await send_all(page.outgoing)
        examined += page.examined
        nudged += page.nudged
        sent += outcomes["sent"]
        failed += outcomes["failed"]
        if page.next_after is None:
            break
        after = page.next_after

    logger.info("profile_nudge_sweep", examined=examined, nudged=nudged, sent=sent, failed=failed)
    return {"examined": examined, "nudged": nudged, "sent": sent, "failed": failed}
