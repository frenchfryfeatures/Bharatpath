"""Transient pre-account reading and owner-only resume intake."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.openai_responses import OpenAIOutputInvalidError, OpenAIUnavailableError
from app.core.outbox import emit
from app.modules.candidate.extraction import extract_career
from app.modules.resume import repository
from app.modules.resume.domain import sniff_mime, upload_key, validate_upload
from app.modules.resume.models import ResumeVersion
from app.modules.resume.parser import ExtractedDocument, LocalResumeParser
from app.modules.resume.scanner import get_document_scanner, may_process
from app.modules.resume.service import UploadRejectedError
from app.modules.resume.structuring import STORED_KEY as STRUCTURED_KEY
from app.modules.resume.structuring import structure_resume
from app.settings import get_settings

logger = get_logger(__name__)


class ResumePrefillUnavailableError(AppError):
    status_code = 503
    code = "resume_prefill_unavailable"
    title = "Your resume could not be read automatically. Try again or enter your details."


async def read_document(content: bytes) -> tuple[str, ExtractedDocument]:
    settings = get_settings()
    rejection = validate_upload(
        head=content[: settings.resume_sniff_bytes],
        size_bytes=len(content),
        max_bytes=settings.resume_max_upload_bytes,
        allowed=settings.resume_allowed_mime_types,
    )
    if rejection:
        raise UploadRejectedError(code=rejection.code, params={"detail": rejection.detail})
    mime = sniff_mime(content[: settings.resume_sniff_bytes])
    assert mime is not None  # validate_upload has already rejected unknown content
    parser = LocalResumeParser()
    extracted = await asyncio.to_thread(parser.extract, content=content, mime=mime)
    return mime, extracted


async def preview(content: bytes) -> dict[str, Any]:
    _, extracted = await read_document(content)
    try:
        facts = await extract_career(extracted.text)
    except (OpenAIUnavailableError, OpenAIOutputInvalidError) as exc:
        # The reason only (`max_output_tokens`, `http_429`, ...), never the CV.
        logger.warning("resume_prefill_unavailable", reason=exc.reason)
        raise ResumePrefillUnavailableError() from exc
    values = facts.model_dump()
    full_name = values.pop("full_name")
    email = values.pop("email")
    # No original bytes, user record, resume version, or scoring event is stored.
    return {"full_name": full_name, "email": email, "details": values}


async def intake(session: AsyncSession, *, user_id: uuid.UUID, content: bytes) -> ResumeVersion:
    mime, extracted = await read_document(content)
    settings = get_settings()
    file_id = uuid.uuid4()
    key = upload_key(user_id=user_id, upload_id=file_id)
    await asyncio.to_thread(
        storage.get_s3_client().put_object,
        Bucket=settings.s3_bucket_resumes,
        Key=key,
        Body=content,
        ContentType=mime,
    )
    scan_status = await get_document_scanner(settings).scan(
        bucket=settings.s3_bucket_resumes, key=key
    )
    if not may_process(scan_status):
        await storage.delete_object(bucket=settings.s3_bucket_resumes, key=key)
        raise UploadRejectedError(code="resume_scan_blocked")
    # Before any row is written: the model call is the slow part of this
    # request, and it never fails it (`resume/structuring.py`).
    structured = await structure_resume(extracted.text, settings=settings)
    await repository.create_resume_file(
        session,
        resume_file_id=file_id,
        user_id=user_id,
        s3_key=key,
        mime=mime,
        size_bytes=len(content),
        scan_status=scan_status,
    )
    row = await repository.create_version(
        session,
        user_id=user_id,
        source="UPLOAD",
        resume_file_id=file_id,
        parsed={
            "raw_text": extracted.text,
            "page_count": extracted.page_count,
            "hidden_text": extracted.hidden.as_stored(),
            "extractor": {"parser": extracted.parser, "parser_version": extracted.parser_version},
            STRUCTURED_KEY: structured,
        },
    )
    await repository.set_parse_status(session, resume_file_id=file_id, status="DONE")
    await emit(
        session,
        event_type="resume.version_created",
        aggregate_type="resume_version",
        aggregate_id=row.id,
        payload={"user_id": str(user_id), "source": "UPLOAD"},
    )
    return row
