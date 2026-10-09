"""Turn one published event into the messages it causes.

Triggered by every event in `notifications.domain.NOTIFYING_EVENTS`. Decides
in one transaction, then sends each message in its own: see
`notifications.service` for why the provider call never runs inside the
transaction that decided to make it.

**Idempotent by message.** The relay delivers at least once; a second run
writes no new rows and sends only what the first left PENDING.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)


@celery_app.task(name="notifications.dispatch", bind=True, max_retries=5)
def dispatch(self: Any, event_id: str) -> dict[str, int]:
    return run_async(run(event_id))


async def run(event_id: str) -> dict[str, int]:
    import uuid

    from app.core.db import get_session_factory
    from app.modules.notifications import service

    factory = get_session_factory()
    async with factory() as session, session.begin():
        outgoing = await service.dispatch_event(session, event_id=uuid.UUID(event_id))

    outcomes = await send_all(outgoing)
    logger.info("notifications_task_done", to_send=len(outgoing), **outcomes)
    return {"to_send": len(outgoing), **outcomes}


async def send_all(outgoing: list[Any]) -> dict[str, int]:
    """One short transaction per message. Shared with the nudge sweep."""
    from app.core.db import get_session_factory
    from app.modules.notifications import service

    counts = {"sent": 0, "failed": 0}
    for message in outgoing:
        async with get_session_factory()() as session, session.begin():
            state = await service.send(session, message=message)
        if state == "SENT":
            counts["sent"] += 1
        elif state == "FAILED":
            counts["failed"] += 1
    return counts


@celery_app.task(name="notifications.send_orphaned", bind=True, max_retries=3)
def send_orphaned(self: Any) -> dict[str, int]:
    """Send messages a crashed worker decided and never handed to a provider.

    Blockers E30. `dispatch_event` commits every message as PENDING in one
    transaction and `send_all` then sends each in its own, so a worker that
    dies in between leaves committed rows nobody owns.

    An event-sourced message gets another chance when the outbox redelivers
    it. **A nudge does not** -- its sequence number is already claimed, so
    the nudge sweep will never generate it again and without this the row
    would sit PENDING for ever, which is a person not hearing from us and no
    error anywhere saying so.
    """
    return run_async(run_orphaned())


async def run_orphaned() -> dict[str, int]:
    from app.core.db import get_session_factory
    from app.modules.notifications import service

    async with get_session_factory()() as session, session.begin():
        outgoing = await service.orphaned_messages(session)

    outcomes = await send_all(outgoing)
    if outgoing:
        logger.info("notifications_orphan_sweep", recovered=len(outgoing), **outcomes)
    return {"recovered": len(outgoing), **outcomes}
