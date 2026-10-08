"""File a disputed hire in the console's dispute queue.

Triggered by `applications.hire_disputed`. The dispute is the candidate's, so
it is written as the candidate -- their identity bound as their own request
bound it -- and passes the same policy and guard a raised dispute does.

**Idempotent by application**: the relay delivers at least once, and a hire
disputed twice is one dispute (`uq_disputes_hire_dispute`).
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)


@celery_app.task(name="admin.open_hire_dispute", bind=True, max_retries=3)
def open_hire_dispute(self: Any, application_id: str, candidate_id: str) -> dict[str, str | None]:
    return run_async(run(application_id, candidate_id))


async def run(application_id: str, candidate_id: str) -> dict[str, str | None]:
    import uuid

    from app.core.db import get_session_factory
    from app.modules.admin import service

    async with get_session_factory()() as session, session.begin():
        dispute_id = await service.open_hire_dispute(
            session,
            application_id=uuid.UUID(application_id),
            candidate_id=uuid.UUID(candidate_id),
        )
    logger.info("hire_dispute_filed", already_open=dispute_id is None)
    return {"dispute_id": str(dispute_id) if dispute_id else None}
