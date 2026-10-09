"""Transcribe and evaluate a completed mock-interview session.

Triggered by `interview.session_completed`, beside the re-score. **Feedback
only**: the +20 was recorded at completion, before this runs, and nothing here
can change it -- `guard_interview_session_write` refuses.

Two transactions, on purpose. Transcription is paid per minute of audio, so
transcripts are committed as soon as they exist; an evaluator that fails
afterwards costs a retry of the evaluation, not a second transcription.

**No provider is configured by default**, so in a running API this raises
`EvaluationUnavailableError` and the session stays COMPLETED with its report
PENDING. That is the intended state until a speech model and an evaluator are
chosen, not an error to page anyone about.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)


@celery_app.task(name="interview.evaluate_session", bind=True, max_retries=5)
def evaluate_session(self: Any, session_id: str) -> dict[str, Any]:
    return run_async(_evaluate(session_id))


async def _evaluate(session_id: str) -> dict[str, Any]:
    import uuid

    from app.core.db import get_session_factory
    from app.modules.interview import service
    from app.modules.interview.evaluation import EvaluationUnavailableError

    target = uuid.UUID(session_id)
    factory = get_session_factory()
    try:
        async with factory() as session, session.begin():
            await service.transcribe_session(session, session_id=target)
        async with factory() as session, session.begin():
            outcome = await service.evaluate_session(session, session_id=target)
    except EvaluationUnavailableError:
        logger.info("interview_evaluation_unavailable")
        return {"status": "unavailable"}
    return {"status": outcome}
