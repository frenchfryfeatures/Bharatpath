"""Parse an uploaded CV into a resume version.

Runs out of band because it is slow and can be expensive: reading a PDF takes
hundreds of milliseconds, and a scanned one goes to Textract for OCR, which
takes seconds and bills per page. Neither belongs on the request that uploaded
the file -- the endpoint returns 202 and this finishes the work.

**Idempotent by resume file id.** The outbox relays at-least-once, so this task
will be handed the same upload again. It creates a version only if that file
has none, because two versions of one upload would give a candidate two
different scores for a single CV.

**Every exit writes a terminal `parse_status`**, on the same transaction as
whatever else that exit did. That is what the client polls: without it the
only observable signal is whether a version exists, which cannot distinguish
"still working" from "this document will never parse" -- so a candidate whose
CV we cannot read waits on an endpoint that never changes.
"""

from __future__ import annotations

from typing import Any

from app.core.logging import get_logger
from app.tasks.async_runner import run_async
from app.worker import celery_app

logger = get_logger(__name__)


@celery_app.task(name="resume.parse", bind=True, max_retries=3)
def parse_resume(self: Any, resume_file_id: str) -> dict[str, Any]:
    """Entry point. Retries on infrastructure failure, never on a bad file.

    A document we cannot read will not become readable on the third attempt,
    so it is recorded and left alone. Retrying it would burn Textract pages
    and leave the candidate waiting for an outcome that cannot change.
    """
    return run_async(_parse(resume_file_id))


async def _parse(resume_file_id: str) -> dict[str, Any]:
    import uuid

    from app.core import storage
    from app.core.db import get_session_factory
    from app.core.errors import AppError
    from app.core.outbox import emit
    from app.modules.resume import repository
    from app.modules.resume.events import MODULE
    from app.modules.resume.models import ResumeFile
    from app.modules.resume.parser import get_resume_parser
    from app.modules.resume.scanner import may_process
    from app.modules.resume.structuring import STORED_KEY as STRUCTURED_KEY
    from app.modules.resume.structuring import structure_resume
    from app.settings import get_settings

    settings = get_settings()
    file_id = uuid.UUID(resume_file_id)

    async with get_session_factory()() as session, session.begin():
        row = await session.get(ResumeFile, file_id)
        if row is None:
            logger.warning("parse_skipped_missing_file", resume_file_id=resume_file_id)
            return {"status": "missing"}

        # At-least-once delivery means this can arrive twice. One upload gets
        # one version, or the candidate has two scores for one CV.
        existing = await repository.latest_version_for_file(session, resume_file_id=file_id)
        if existing is not None:
            logger.info("parse_skipped_already_parsed", resume_file_id=resume_file_id)
            # Re-asserted rather than assumed. If the first delivery created
            # the version but its transaction lost the status write, the row
            # would poll QUEUED forever with a version sitting next to it.
            await repository.set_parse_status(session, resume_file_id=file_id, status="DONE")
            return {"status": "already_parsed", "resume_version_id": str(existing.id)}

        # The scan gate. Today no scanner is wired and this passes PENDING
        # through; when GuardDuty lands, an infected file stops here without
        # this line changing.
        if not may_process(row.scan_status):
            logger.warning(
                "parse_blocked_by_scan", resume_file_id=resume_file_id, scan=row.scan_status
            )
            # BLOCKED rather than FAILED: the document may be perfectly
            # readable, and the candidate cannot act on this the way they can
            # on a file we could not parse. Conflating the two would tell them
            # to re-upload a CV that would be held again.
            await repository.set_parse_status(session, resume_file_id=file_id, status="BLOCKED")
            return {"status": "blocked", "scan_status": row.scan_status}

        content = await storage.read_whole_object(bucket=settings.s3_bucket_resumes, key=row.s3_key)
        if not content:
            logger.warning("parse_object_missing", key=row.s3_key)
            # A missing object is a parse failure, not a scan one. The earlier
            # version recorded it on `scan_status`, which read as "the scanner
            # failed" to anyone looking at the row later -- two different
            # facts in one column, and the wrong one.
            await repository.set_parse_status(
                session,
                resume_file_id=file_id,
                status="FAILED",
                error_code="resume_object_missing",
            )
            return {"status": "object_missing"}

        parser = get_resume_parser(settings)
        try:
            # Synchronous on purpose: this is a worker process with nothing
            # else on its event loop, and both pypdf and Textract's poller are
            # blocking. Wrapping them in threads here would add machinery for
            # no concurrency that anyone benefits from.
            extracted = parser.extract(
                content=content,
                mime=row.mime,
                bucket=settings.s3_bucket_resumes,
                key=row.s3_key,
            )
        except AppError as exc:
            # A file we cannot read is a final answer, not a transient fault.
            logger.warning("parse_failed", resume_file_id=resume_file_id, code=exc.code)
            # Written on the same transaction as the event, so a candidate can
            # never poll a QUEUED that the worker has already given up on.
            await repository.set_parse_status(
                session, resume_file_id=file_id, status="FAILED", error_code=exc.code
            )
            await emit(
                session,
                event_type=f"{MODULE}.parse_failed",
                aggregate_type="resume_file",
                aggregate_id=file_id,
                payload={"user_id": str(row.user_id), "code": exc.code},
            )
            return {"status": "unparseable", "code": exc.code}

        # Display only, never scored, and never fatal: a model that is down
        # leaves a FAILED status beside a perfectly good version.
        structured = await structure_resume(extracted.text, settings=settings)

        version = await repository.create_version(
            session,
            user_id=row.user_id,
            source="UPLOAD",
            resume_file_id=file_id,
            parsed={
                "raw_text": extracted.text,
                "page_count": extracted.page_count,
                # Text the document renders and a reader cannot see (E5).
                # **Absent on every version created before 2026-09-22**, which
                # is how a reader tells "never analysed" from "analysed and
                # clean" -- `{"analysed": true, "text": ""}`. Integrity reads
                # it through `hidden_text_of()`.
                "hidden_text": extracted.hidden.as_stored(),
                # Stored so a score can say which engine produced the text it
                # was computed from. Invariant 1: a different parser means a
                # different score, and a replay has to be able to tell.
                "extractor": {
                    "parser": extracted.parser,
                    "parser_version": extracted.parser_version,
                },
                # The review screen's structured view (`resume/structuring.py`).
                STRUCTURED_KEY: structured,
            },
        )
        await emit(
            session,
            event_type=f"{MODULE}.version_created",
            aggregate_type="resume_version",
            aggregate_id=version.id,
            payload={
                "user_id": str(row.user_id),
                "source": "UPLOAD",
                "parser": extracted.parser,
            },
        )
        await repository.set_parse_status(session, resume_file_id=file_id, status="DONE")
        logger.info(
            "parse_complete",
            resume_file_id=resume_file_id,
            parser=extracted.parser,
            chars=len(extracted.text),
        )
        return {"status": "parsed", "resume_version_id": str(version.id)}
