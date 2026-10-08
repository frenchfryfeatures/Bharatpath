"""Data-subject requests: build an export, run due erasures, expire archives.

**The export is event-driven; the other two are sweeps.** An export is wanted
as soon as it is asked for, so `privacy.export_requested` routes straight to
`build_export`. A deletion must wait out its cooling-off period, and an event
is consumed the moment it is published, so erasure is found by
`erase_due` reading the clock. Both sweeps run hourly on Celery Beat
(`app/tasks/schedule.py`): the response window is thirty days, and an hour of
slack inside it costs nothing. Without beat a deletion request is accepted,
tracked and shown with its due date, and nothing is destroyed -- a promise
not kept, so beat is not optional in any deployment.

Idempotent throughout. A redelivered export finds its request finished; a
second sweep finds nothing RECEIVED to claim; an S3 delete of an object
already gone succeeds.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)

#: One sweep's work. Each erasure is its own transaction, so this bounds how
#: long a run takes, not how much any one transaction holds.
SWEEP_BATCH = 50


def _bucket(kind: str) -> str:
    from app.settings import get_settings

    settings = get_settings()
    return {
        "resumes": settings.s3_bucket_resumes,
        "interview_audio": settings.s3_bucket_interview_audio,
        "exports": settings.s3_bucket_exports,
    }[kind]


@celery_app.task(name="privacy.build_export", bind=True, max_retries=5, default_retry_delay=60)
def build_export(self: Any, request_id: str, user_id: str) -> dict[str, Any]:
    return run_async(
        run_export(dsr_id=uuid.UUID(request_id), user_id=uuid.UUID(user_id), now=datetime.now(UTC))
    )


async def run_export(*, dsr_id: uuid.UUID, user_id: uuid.UUID, now: datetime) -> dict[str, Any]:
    from app.core import storage
    from app.core.db import get_session_factory
    from app.modules.privacy import service

    factory = get_session_factory()
    async with factory() as session, session.begin():
        sections = await service.collect_export(session, dsr_id=dsr_id, user_id=user_id)
    if sections is None:
        return {"status": "nothing_to_do"}

    key = service.export_key(user_id=user_id, dsr_id=dsr_id)
    await storage.put_object(
        bucket=_bucket("exports"),
        key=key,
        body=service.build_archive(sections=sections, generated_at=now),
        content_type="application/zip",
    )
    async with factory() as session, session.begin():
        await service.finish_export(session, dsr_id=dsr_id, user_id=user_id, key=key, now=now)
    logger.info("dsr_export_built", request_id=str(dsr_id))
    return {"status": "completed"}


@celery_app.task(name="privacy.erase_due", bind=True, max_retries=3)
def erase_due(self: Any) -> dict[str, int]:
    return run_async(run_erasures(now=datetime.now(UTC)))


async def run_erasures(*, now: datetime, limit: int = SWEEP_BATCH) -> dict[str, int]:
    """Erase every candidate whose deletion is past its grace period.

    One person at a time. A failure on one puts their request back to
    RECEIVED and moves on, so one stuck S3 object cannot hold up every erasure
    behind it.
    """
    from app.core.db import get_session_factory
    from app.modules.privacy import service

    async with get_session_factory()() as session, session.begin():
        due = await service.due_deletions(session, now=now, limit=limit)

    outcomes = [await erase_one(dsr_id=d, user_id=u, now=now) for d, u in due]
    result = {
        "due": len(due),
        "erased": outcomes.count("erased"),
        "failed": outcomes.count("failed"),
    }
    logger.info("dsr_erasure_sweep", **result)
    return result


async def erase_one(*, dsr_id: uuid.UUID, user_id: uuid.UUID, now: datetime) -> str:
    """Claim, destroy what lives outside the database, then run the cascade.

    `erased`, `skipped` or `failed`.

    **The order is the whole design.** Every step before the cascade is
    retryable, because the cascade is what makes its own inputs unreachable:
    the S3 keys and the Cognito subject both live on rows it deletes or
    empties. So anything that fails here releases the request back to
    RECEIVED and the next sweep starts again from a state where the pointers
    still exist. Run the cascade first and a failure afterwards is permanent
    -- there is nothing left to name the object or the sign-in.

    That is also why both outward steps are idempotent: a retry re-deletes an
    object that is already gone and a Cognito user that is already absent,
    and neither counts as an error.
    """
    from app.core import storage
    from app.core.auth.directory import get_account_directory
    from app.core.db import get_session_factory
    from app.modules.privacy import service

    factory = get_session_factory()
    async with factory() as session, session.begin():
        targets = await service.begin_erasure(session, dsr_id=dsr_id, user_id=user_id)
    if targets is None:
        return "skipped"
    try:
        for kind, key in targets.object_keys:
            await storage.delete_object(bucket=_bucket(kind), key=key)

        # The sign-in itself. Left standing, someone erased and later signing
        # in with the same address would present a subject whose hash we still
        # hold, and be refused forever instead of starting fresh.
        if targets.sign_in is not None:
            pool, subject = targets.sign_in
            await get_account_directory().delete_user(pool=pool, subject=subject)  # type: ignore[arg-type]

        async with factory() as session, session.begin():
            await service.complete_erasure(session, dsr_id=dsr_id, user_id=user_id, now=now)
    except Exception as exc:
        logger.error("dsr_erasure_failed", request_id=str(dsr_id), error=type(exc).__name__)
        async with factory() as session, session.begin():
            await service.release_erasure(
                session, dsr_id=dsr_id, reason=f"retrying after {type(exc).__name__}"
            )
        return "failed"
    return "erased"


@celery_app.task(name="privacy.expire_exports", bind=True, max_retries=3)
def expire_exports(self: Any) -> dict[str, int]:
    return run_async(run_export_expiry(now=datetime.now(UTC)))


async def run_export_expiry(*, now: datetime, limit: int = SWEEP_BATCH) -> dict[str, int]:
    """Destroy archives older than `EXPORT_RETENTION_HOURS`. Object first, key
    second, for the same reason as erasure: the key is the only record of
    where the object is."""
    from app.core import storage
    from app.core.db import get_session_factory
    from app.modules.privacy import service

    factory = get_session_factory()
    async with factory() as session, session.begin():
        expired = await service.expired_exports(session, now=now, limit=limit)
    for dsr_id, key in expired:
        await storage.delete_object(bucket=_bucket("exports"), key=key)
        async with factory() as session, session.begin():
            await service.forget_export(session, dsr_id=dsr_id)
    return {"expired": len(expired)}
