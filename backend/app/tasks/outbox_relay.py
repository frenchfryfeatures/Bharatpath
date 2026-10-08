"""The transactional outbox relay.

Business transactions append to `outbox`. This task drains it and publishes to
SQS/EventBridge with **at-least-once** delivery, so consumers must be
idempotent by event id.

Why the indirection is worth it: notifications, analytics rollups and search
reindexing must not fire on a transaction that later rolls back. Concretely -
a course purchase that fails at the payment step must not have already moved
the candidate's score. Emitting the event inside the same transaction as the
purchase makes that impossible rather than unlikely.

**`FOR UPDATE SKIP LOCKED` is what makes this safe to run on several workers.**
Each one claims a disjoint batch; none blocks on another; nothing is
published twice by two workers racing.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)

BATCH_SIZE = 100
MAX_ATTEMPTS = 10


@celery_app.task(name="outbox.relay", bind=True, max_retries=3)
def relay_outbox(self: Any) -> dict[str, int]:
    """Publish a batch of unpublished events.

    Run by Celery Beat every 30 seconds (`app/tasks/schedule.py`).

    Draining a batch is the only thing standing between an outbox row and a
    granted entitlement, a sent notification or a re-score, so an interval
    here is a latency the user feels.
    """
    return run_async(_relay_batch())


async def _relay_batch() -> dict[str, int]:
    from app.core.db import get_session_factory

    published = 0
    failed = 0

    async with get_session_factory()() as session, session.begin():
        rows = (
            (
                await session.execute(
                    text(
                        """
                    SELECT id, event_type, aggregate_type, aggregate_id, payload,
                           attempts
                      FROM outbox
                     WHERE published_at IS NULL
                       AND attempts < :max_attempts
                     ORDER BY created_at
                     LIMIT :batch
                    FOR UPDATE SKIP LOCKED
                    """
                    ),
                    {"batch": BATCH_SIZE, "max_attempts": MAX_ATTEMPTS},
                )
            )
            .mappings()
            .all()
        )

        for row in rows:
            try:
                _publish(dict(row))
                await session.execute(
                    text("UPDATE outbox SET published_at = now() WHERE id = :id"),
                    {"id": row["id"]},
                )
                published += 1
            except Exception:
                # Count the attempt and leave it for the next pass. A poison
                # event stops being retried at MAX_ATTEMPTS rather than
                # blocking the queue behind it forever.
                await session.execute(
                    text("UPDATE outbox SET attempts = attempts + 1 WHERE id = :id"),
                    {"id": row["id"]},
                )
                failed += 1
                logger.warning(
                    "outbox_publish_failed",
                    event_type=row["event_type"],
                    attempts=row["attempts"] + 1,
                )

    if published or failed:
        logger.info("outbox_relay_batch", published=published, failed=failed)
    return {"published": published, "failed": failed}


def _publish(event: dict[str, Any]) -> None:
    """Enqueue every task the event triggers.

    **Raises if any enqueue fails**, and then the row stays unpublished and
    its attempt is counted, so the whole event is retried. A subscriber that
    was enqueued on the first attempt is enqueued again on the second, which
    is why every consumer is idempotent by what it acts on -- the callback,
    the resume version, the dispute's application, the notification's
    `dedupe_key`.

    An event nobody subscribes to is published by being marked, and logged
    with no subscribers, which is ordinary: most events exist for readers
    that have not been built.
    """
    from app.tasks.routing import task_arguments, tasks_for

    subscribers = tasks_for(event["event_type"])
    for task_name in subscribers:
        celery_app.send_task(task_name, kwargs=task_arguments(task_name, event))
    logger.info(
        "outbox_event_published",
        event_type=event["event_type"],
        aggregate_type=event["aggregate_type"],
        subscribers=list(subscribers),
    )
