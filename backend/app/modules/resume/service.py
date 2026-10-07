"""resume - business rules and transaction boundaries

Upload, parse jobs, versions, review and confirm.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.modules.resume import repository
from app.modules.resume.domain import (
    build_edited_parsed,
    refuse_version_change,
    sniff_mime,
    upload_key,
    validate_upload,
)
from app.modules.resume.events import MODULE
from app.modules.resume.scanner import get_document_scanner
from app.modules.resume.schemas import (
    ManualResumeRequest,
    ResumeEditRequest,
    SharedResumeSection,
    SharedResumeView,
)
from app.modules.resume.sections import split_sections
from app.modules.resume.structuring import STORED_KEY as STRUCTURED_KEY
from app.modules.resume.structuring import structure_resume, structured_view
from app.settings import Settings, get_settings

logger = get_logger(__name__)


class UploadNotFoundError(NotFoundError):
    """Completing or reading an upload that is not there."""

    code = "resume_upload_not_found"
    title = "Upload not found"


class UploadRejectedError(ValidationError):
    """The stored object is not an acceptable resume.

    Carries the domain's reason code so the client renders the right localised
    message rather than a sentence written here.
    """

    code = "resume_upload_rejected"
    title = "Upload rejected"


class VersionNotFoundError(NotFoundError):
    """A version that is not there, or is not the caller's.

    Deliberately the same error either way: 404 rather than 403, because a 403
    would confirm that another candidate's version exists.
    """

    code = "resume_version_not_found"
    title = "Resume version not found"


class VersionSupersededError(ConflictError):
    """Editing or confirming a version that a newer one has replaced."""

    code = "resume_version_superseded"
    title = "Resume version superseded"


class ResumeNotConfirmedError(ConflictError):
    """**The confirm gate, refusing** (SRS 1.4.4).

    Raised when something asks for a scorable resume and the candidate has
    reviewed none. It is a 409 rather than a 404 because the distinction
    matters to the client: a resume exists, it simply has not been through the
    gate, and the action that fixes it is confirming rather than uploading.
    """

    code = "resume_not_confirmed"
    title = "No confirmed resume"


async def issue_upload_ticket(
    *, user_id: uuid.UUID, settings: Settings | None = None
) -> tuple[uuid.UUID, str, int]:
    """Presign a PUT. **Writes nothing.**

    This is the transaction boundary the plan asks for, expressed as an
    absence: no row exists until bytes have arrived and passed validation, so
    a failed or abandoned upload cannot leave a partial `resume_files` record
    behind. There is no cleanup path because there is nothing to clean up --
    an orphaned object expires by bucket lifecycle.
    """
    settings = settings or get_settings()
    upload_id = uuid.uuid4()
    key = upload_key(user_id=user_id, upload_id=upload_id)
    url = await storage.presign_put(
        bucket=settings.s3_bucket_resumes,
        key=key,
        expires_in=settings.presigned_url_ttl_seconds,
    )
    return upload_id, url, settings.presigned_url_ttl_seconds


async def complete_upload(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    upload_id: uuid.UUID,
    settings: Settings | None = None,
) -> tuple[uuid.UUID, str, str]:
    """Validate what was actually stored, then record it -- in that order.

    Everything that can refuse the upload happens before the first write, so
    the row and its event are one atomic unit on the caller's transaction.

    Nothing is trusted from the client: the key is rebuilt from the
    authenticated user, the size is read from S3 rather than accepted, and the
    type is sniffed from the stored bytes.

    Completing the same upload twice returns the existing row instead of
    creating a second one -- the row id IS the upload id, so a retried request
    is naturally idempotent.
    """
    settings = settings or get_settings()
    bucket = settings.s3_bucket_resumes
    key = upload_key(user_id=user_id, upload_id=upload_id)

    existing = await repository.get_resume_file(session, resume_file_id=upload_id, user_id=user_id)
    if existing is not None:
        # The row's own state, not an assumed QUEUED. A client that retries
        # the completion after the worker has already run would otherwise be
        # told to start polling something that finished -- or, worse, told
        # QUEUED for a parse that has permanently failed.
        return existing.id, existing.scan_status, existing.parse_status

    meta = await storage.head_object(bucket=bucket, key=key)
    if meta is None:
        raise UploadNotFoundError()

    head = await storage.read_head_bytes(bucket=bucket, key=key, count=settings.resume_sniff_bytes)
    rejection = validate_upload(
        head=head,
        size_bytes=meta["size_bytes"],
        max_bytes=settings.resume_max_upload_bytes,
        allowed=settings.resume_allowed_mime_types,
    )
    if rejection is not None:
        # Remove the object before refusing. A rejected file left in the
        # bucket is storage we pay for and personal data we hold under DPDP
        # with no lawful reason to.
        await storage.delete_object(bucket=bucket, key=key)
        logger.info("upload_rejected", reason=rejection.code, user_id=str(user_id))
        raise UploadRejectedError(code=rejection.code, params={"detail": rejection.detail})

    mime = sniff_mime(head) or "application/octet-stream"
    scan_status = await get_document_scanner(settings).scan(bucket=bucket, key=key)

    row = await repository.create_resume_file(
        session,
        resume_file_id=upload_id,
        user_id=user_id,
        s3_key=key,
        mime=mime,
        size_bytes=meta["size_bytes"],
        scan_status=scan_status,
    )

    # Emitted on the same transaction as the row. The relay publishes only
    # after that commits, so a rolled-back upload can never queue a parse job
    # for a row that does not exist.
    await emit(
        session,
        event_type=f"{MODULE}.file_uploaded",
        aggregate_type="resume_file",
        aggregate_id=row.id,
        payload={"user_id": str(user_id), "mime": mime, "scan_status": scan_status},
    )
    return row.id, scan_status, row.parse_status


async def create_pasted_version(session: AsyncSession, *, user_id: uuid.UUID, text: str) -> Any:
    """The paste-text path. No file, no scan, no OCR -- the text is the input.

    It arrives already normalised: `PasteTextRequest` does that on the way in,
    once, so what is scored is exactly what is stored (invariant 1).
    """
    row = await repository.create_version(
        session,
        user_id=user_id,
        source="PASTE",
        parsed={
            "raw_text": text,
            "extractor": {"parser": "paste", "parser_version": "1"},
            STRUCTURED_KEY: await structure_resume(text),
        },
    )
    await emit(
        session,
        event_type=f"{MODULE}.version_created",
        aggregate_type="resume_version",
        aggregate_id=row.id,
        payload={"user_id": str(user_id), "source": "PASTE"},
    )
    return row


async def create_manual_version(
    session: AsyncSession, *, user_id: uuid.UUID, payload: ManualResumeRequest
) -> Any:
    """The structured-form path (PRD 4.2), for candidates with no file.

    Stored in the same `parsed` shape a parser produces, so scoring has one
    input format rather than three.
    """
    row = await repository.create_version(
        session,
        user_id=user_id,
        source="MANUAL",
        parsed={
            "full_name": payload.full_name,
            "headline": payload.headline,
            "experience": [e.model_dump() for e in payload.experience],
            "education": [e.model_dump() for e in payload.education],
            "skills": list(payload.skills),
            "extractor": {"parser": "manual", "parser_version": "1"},
        },
    )
    await emit(
        session,
        event_type=f"{MODULE}.version_created",
        aggregate_type="resume_version",
        aggregate_id=row.id,
        payload={"user_id": str(user_id), "source": "MANUAL"},
    )
    return row


async def get_file_status(
    session: AsyncSession, *, user_id: uuid.UUID, resume_file_id: uuid.UUID
) -> tuple[Any, Any]:
    """Status for one upload, scoped to its owner.

    A miss raises 404 even when the file exists for someone else -- a 403
    would confirm that it does.
    """
    row = await repository.get_resume_file(session, resume_file_id=resume_file_id, user_id=user_id)
    if row is None:
        raise UploadNotFoundError()
    version = await repository.latest_version_for_file(session, resume_file_id=row.id)
    return row, version


# ---------------------------------------------------------------------------
# Day 7: review, edit, confirm (SRS 1.4.4)
# ---------------------------------------------------------------------------
#: How much history one candidate can read back. Generous -- a candidate with
#: more corrections than this still gets the newest ones, which is what the
#: screen shows -- but bounded, because an unbounded list is a response size
#: decided by whoever is most persistent.
MAX_VERSION_HISTORY: int = 50


async def list_versions(session: AsyncSession, *, user_id: uuid.UUID) -> list[tuple[Any, bool]]:
    """The candidate's version history, newest first, each with whether a
    newer version has replaced it.

    The supersession flag is derived from the chain rather than stored: every
    version whose id appears as some other version's `supersedes_id` has been
    replaced. Computed here over one already-fetched page, so it costs no
    extra query -- and a stored flag would be a second source of truth able to
    disagree with the links.
    """
    rows = await repository.list_versions(session, user_id=user_id, limit=MAX_VERSION_HISTORY)
    superseded = {r.supersedes_id for r in rows if r.supersedes_id is not None}
    return [(row, row.id in superseded) for row in rows]


async def get_version_for_review(
    session: AsyncSession, *, user_id: uuid.UUID, resume_version_id: uuid.UUID
) -> tuple[Any, bool]:
    """**The review step.** Returns the version and whether it is superseded.

    This is the read that makes the confirm gate meaningful: a candidate
    cannot meaningfully confirm content they have not been shown.
    """
    row = await repository.get_version(
        session, resume_version_id=resume_version_id, user_id=user_id
    )
    if row is None:
        raise VersionNotFoundError()
    successor = await repository.successor_of(session, resume_version_id=row.id)
    return row, successor is not None


async def edit_version(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    resume_version_id: uuid.UUID,
    payload: ResumeEditRequest,
) -> Any:
    """A correction. **Creates a version; never updates one.**

    The new row is deliberately *unconfirmed* even when the version it
    supersedes was confirmed. Inheriting confirmation would turn editing into
    a way to change scored content without anyone reviewing it -- which is
    precisely the gate SRS 1.4.4 puts in the way, reached through a side door.

    The file link is carried forward so an edited version still points at the
    document it came from, and `extractor` records that a human touched it.
    """
    previous = await repository.get_version(
        session, resume_version_id=resume_version_id, user_id=user_id
    )
    if previous is None:
        raise VersionNotFoundError()

    successor = await repository.successor_of(session, resume_version_id=previous.id)
    refusal = refuse_version_change(is_superseded=successor is not None)
    if refusal is not None:
        raise VersionSupersededError(code=refusal.code, params={"detail": refusal.detail})

    if payload.structured is not None:
        replacement: dict[str, Any] = {
            "full_name": payload.structured.full_name,
            "headline": payload.structured.headline,
            "experience": [e.model_dump() for e in payload.structured.experience],
            "education": [e.model_dump() for e in payload.structured.education],
            "skills": list(payload.structured.skills),
        }
    else:
        # `text` or `sections`: the schema guarantees exactly one shape was
        # sent, and a section edit is stored as the text it assembles to.
        # The corrected text is structured afresh: a structured view carried
        # over from the version being replaced would show what was corrected.
        edited = payload.edited_text()
        replacement = {"raw_text": edited, STRUCTURED_KEY: await structure_resume(edited or "")}

    parsed = build_edited_parsed(previous_parsed=previous.parsed, replacement=replacement)

    try:
        row = await repository.create_version(
            session,
            user_id=user_id,
            source="EDIT",
            parsed=parsed,
            resume_file_id=previous.resume_file_id,
            supersedes_id=previous.id,
        )
    except IntegrityError as exc:
        # Two edits of the same version raced. The unique index caught the one
        # that lost; translate it into the same 409 the sequential path gives,
        # so a client sees one behaviour rather than a 409 or a 500 depending
        # on timing.
        raise VersionSupersededError(
            code="resume_version_superseded",
            params={"detail": "This version was edited by another request."},
        ) from exc

    await emit(
        session,
        event_type=f"{MODULE}.version_created",
        aggregate_type="resume_version",
        aggregate_id=row.id,
        payload={"user_id": str(user_id), "source": "EDIT", "supersedes": str(previous.id)},
    )
    return row


async def confirm_version(
    session: AsyncSession, *, user_id: uuid.UUID, resume_version_id: uuid.UUID
) -> tuple[Any, bool]:
    """**The confirm gate** (SRS 1.4.4). Returns the version, and whether this
    call found it already confirmed.

    Confirming is the moment a candidate takes responsibility for what will be
    scored, so the order is not arbitrary: existence first (404), then
    supersession (409), then the latch. Confirming something the candidate has
    already replaced would make stale content scorable.

    Re-confirming is a retry, not an error. The latch reports the original
    timestamp rather than moving it -- when the candidate approved the content
    is a fact about them, not about how many times their phone lost signal
    mid-request.
    """
    existing = await repository.get_version(
        session, resume_version_id=resume_version_id, user_id=user_id
    )
    if existing is None:
        raise VersionNotFoundError()

    successor = await repository.successor_of(session, resume_version_id=existing.id)
    refusal = refuse_version_change(is_superseded=successor is not None)
    if refusal is not None:
        raise VersionSupersededError(code=refusal.code, params={"detail": refusal.detail})

    if existing.confirmed_at is not None:
        return existing, True

    row = await repository.confirm_version(
        session, resume_version_id=resume_version_id, user_id=user_id
    )
    if row is None:  # pragma: no cover - only reachable under a concurrent confirm
        # Lost a race with another confirm. That request won and the version
        # is confirmed, which is the outcome this caller asked for -- so this
        # is an idempotent retry, not a failure.
        refreshed = await repository.get_version(
            session, resume_version_id=resume_version_id, user_id=user_id
        )
        if refreshed is None or refreshed.confirmed_at is None:
            raise VersionNotFoundError()
        return refreshed, True

    # **This is the event scoring consumes, and `version_created` is not.**
    # Wiring recalculation to version creation would score every parse and
    # every correction the moment it landed -- the confirm gate bypassed by
    # subscribing to the wrong event. Pinned by
    # tests/invariants/test_confirm_gate.py.
    await emit(
        session,
        event_type=f"{MODULE}.version_confirmed",
        aggregate_type="resume_version",
        aggregate_id=row.id,
        payload={"user_id": str(user_id), "source": row.source},
    )
    logger.info("resume_version_confirmed", resume_version_id=str(row.id))
    return row, False


async def declared_name(
    session: AsyncSession, *, user_id: uuid.UUID, resume_version_id: uuid.UUID
) -> str | None:
    """The name the candidate typed on the structured form, or None.

    For a profile an employer has opened (Day 14). **Only the form carries a
    name.** Uploaded and pasted CVs are stored as text, and a name guessed
    from a first line would put the wrong name in front of an employer, so
    none is guessed. The version passed is the one a score was computed from,
    which the confirm gate has already let through.
    """
    row = await repository.get_version(
        session, resume_version_id=resume_version_id, user_id=user_id
    )
    name = (row.parsed or {}).get("full_name") if row is not None else None
    if not isinstance(name, str) or not name.strip():
        return None
    return name.strip()


async def get_scorable_version(session: AsyncSession, *, user_id: uuid.UUID) -> Any:
    """**The only supported way to obtain a resume to score** (SRS 1.4.4).

    Scoring cannot reach `repository` -- the `module-privacy` contract stops
    one module importing another's data access -- so this is the door, and the
    gate is on this side of it. No confirmed version raises rather than
    returning something a caller might score by forgetting to check.
    """
    row = await repository.latest_confirmed_version(session, user_id=user_id)
    if row is None:
        raise ResumeNotConfirmedError()
    return row


def shared_fields(parsed: object) -> dict[str, Any]:
    """A form-built CV's fields for someone other than its owner: empty for a
    version with text, and never the extractor's provenance block or the stored
    structured document (that goes out once, as `structured_resume`)."""
    if not isinstance(parsed, dict) or isinstance(parsed.get("raw_text"), str):
        return {}
    return {k: v for k, v in parsed.items() if k not in ("extractor", STRUCTURED_KEY)}


async def shared_resume(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    resume_version_id: uuid.UUID,
    settings: Settings | None = None,
) -> SharedResumeView | None:
    """The version a score was built from, for showing to someone other than
    its owner (an employer who opened the candidate), or None.

    **Confirmed versions only** (SRS 1.4.4): an unconfirmed version is what
    the candidate has not yet checked, and it reaches nobody. Callers pass the
    version a score names, which is confirmed by construction; the check here
    keeps that true for a caller that passes anything else. `sections` is the
    review screen's view of the text, computed here and never stored. The
    caller audits; this only reads.
    """
    settings = settings or get_settings()
    row = await repository.get_version(
        session, resume_version_id=resume_version_id, user_id=user_id
    )
    if row is None or row.confirmed_at is None:
        return None
    parsed = row.parsed if isinstance(row.parsed, dict) else {}
    body = parsed.get("raw_text")
    text = body if isinstance(body, str) else None
    file = (
        await repository.get_resume_file(
            session, resume_file_id=row.resume_file_id, user_id=user_id
        )
        if row.resume_file_id is not None
        else None
    )
    ttl = settings.presigned_url_ttl_seconds
    url = (
        await storage.presign_get(
            bucket=settings.s3_bucket_resumes, key=file.s3_key, expires_in=ttl
        )
        if file is not None
        else None
    )
    structured, structured_status = structured_view(parsed)
    return SharedResumeView(
        version_id=row.id,
        source=row.source,
        confirmed_at=row.confirmed_at,
        text=text,
        sections=[
            SharedResumeSection(kind=s.kind, heading=s.heading, body=s.body)
            for s in (split_sections(text) if text is not None else [])
        ],
        fields=shared_fields(parsed),
        structured_resume=structured,
        structured_status=structured_status,
        file_url=url,
        file_mime=file.mime if file is not None else None,
        file_url_expires_at=datetime.now(UTC) + timedelta(seconds=ttl) if url else None,
    )


async def get_version_for_profile(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    resume_version_id: uuid.UUID,
    current_only: bool = False,
) -> Any:
    """Owner-scoped reading before payment, independent of the confirm gate."""
    row = await repository.get_version(
        session, resume_version_id=resume_version_id, user_id=user_id
    )
    if row is None:
        raise VersionNotFoundError()
    if current_only and await repository.successor_of(session, resume_version_id=row.id):
        raise VersionSupersededError()
    return row


async def profile_resume_url(
    session: AsyncSession, *, user_id: uuid.UUID, resume_version_id: uuid.UUID
) -> str | None:
    version = await get_version_for_profile(
        session, user_id=user_id, resume_version_id=resume_version_id
    )
    if version.resume_file_id is None:
        return None
    row = await repository.get_resume_file(
        session, resume_file_id=version.resume_file_id, user_id=user_id
    )
    if row is None:
        raise UploadNotFoundError()
    settings = get_settings()
    return await storage.presign_get(
        bucket=settings.s3_bucket_resumes,
        key=row.s3_key,
        expires_in=settings.presigned_url_ttl_seconds,
    )


async def profile_resume_preview(
    session: AsyncSession, *, user_id: uuid.UUID, resume_version_id: uuid.UUID
) -> dict[str, Any]:
    from app.modules.resume.preview import render_pdf

    version = await get_version_for_profile(
        session, user_id=user_id, resume_version_id=resume_version_id
    )
    parsed = version.parsed or {}
    text = parsed.get("raw_text", "")
    structured, structured_status = structured_view(parsed)
    # Beside whatever the preview draws: the fields the candidate reviews.
    fields = {
        "structured_resume": structured.model_dump(mode="json") if structured else None,
        "structured_status": structured_status,
    }
    if version.resume_file_id is None:
        shown = {k: v for k, v in parsed.items() if k != STRUCTURED_KEY}
        return {"pages": [], "text": text or str(shown), "truncated": False, **fields}
    row = await repository.get_resume_file(
        session, resume_file_id=version.resume_file_id, user_id=user_id
    )
    if row is None:
        raise UploadNotFoundError()
    if row.mime != "application/pdf":
        return {"pages": [], "text": text, "truncated": False, **fields}
    content = await storage.read_whole_object(
        bucket=get_settings().s3_bucket_resumes, key=row.s3_key
    )
    pages, truncated = await asyncio.to_thread(render_pdf, content)
    return {"pages": pages, "text": "", "truncated": truncated, **fields}


async def users_with_any_resume(
    session: AsyncSession, *, user_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """For the incomplete-profile sweep (Day 19): who has started a profile at
    all -- an upload, a paste or the form, confirmed or not. **Not a scoring
    read**: it says whether a version exists, never what one holds, so it does
    not go near the confirm gate."""
    return await repository.users_with_any_resume(session, user_ids=user_ids)
