"""End-of-day reminder to students who have not opened the app today
(2026-11-23).

On Celery Beat (`app/tasks/schedule.py`), every 30 minutes through the
evening; `notifications.domain.daily_reminder_due` is the window, and the
dedupe key (person + IST day) makes every tick after the first a no-op for
anyone already reminded. The rows it writes are in-app messages, which the
`push-pending` sweep turns into pushes for opted-in devices.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)


@celery_app.task(name="notifications.daily_reminder", bind=True, max_retries=3)
def daily_reminder(self: Any) -> dict[str, int]:
    return run_async(sweep(now=datetime.now(UTC)))


async def sweep(*, now: datetime) -> dict[str, int]:
    from app.core.db import get_session_factory
    from app.modules.notifications import service

    examined = reminded = 0
    after = None
    while True:
        async with get_session_factory()() as session, session.begin():
            page = await service.daily_reminder_page(session, now=now, after_id=after)
        examined += page.examined
        reminded += page.nudged
        if page.next_after is None:
            break
        after = page.next_after
    logger.info("daily_reminder_sweep", examined=examined, reminded=reminded)
    return {"examined": examined, "reminded": reminded}
