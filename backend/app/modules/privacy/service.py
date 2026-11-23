"""privacy - business rules and transaction boundaries

Export and deletion requests, DSR tracking.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**Two things take longer than a request, and each is split where the risk is.**

*An export* is read in one transaction, written to S3 outside any, and marked
complete in a second. Holding a transaction open across an S3 upload would pin
a connection for as long as Mumbai takes to answer.

*An erasure* deletes the S3 objects **first** and the rows second. The other
order loses the keys: they live on the rows the cascade destroys, so a failed
upload-side delete after a committed cascade leaves a CV in a bucket with
nothing anywhere saying it exists. Objects first means a failure leaves the
rows -- and therefore the keys -- in place for the retry, and deleting an
object that is already gone is not an error in S3.
"""

from __future__ import annotations

import io
import json
import uuid
import zipfile
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.audit import AuditAction, audit_event
from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.core.tenant import TenantContext
from app.modules.privacy import repository
from app.modules.privacy.domain import (
    DELETION_GRACE_HOURS,
    EXPORT_FORBIDDEN_FIELDS,
    EXPORT_RETENTION_HOURS,
    EXPORT_SECTIONS,
    EXPORT_URL_TTL_SECONDS,
    RETENTION_POLICY_VERSION,
    DsrError,
    due_at,
    erasable_at,
)
from app.modules.privacy.events import EXPORT_REQUESTED
from app.modules.privacy.models import DsrRequest
from app.settings import get_settings

logger = get_logger(__name__)

SYSTEM_ACTOR = "SYSTEM"
TARGET_TYPE = "dsr_request"
ARCHIVE_FORMAT_VERSION = "1"


@dataclass(frozen=True, slots=True)
class RequestView:
    row: DsrRequest
    erasable_at: datetime | None
    download_available: bool


def _view(row: DsrRequest) -> RequestView:
    return RequestView(
        row=row,
        erasable_at=erasable_at(requested_at=row.created_at) if row.type == "DELETE" else None,
        download_available=(
            row.type == "EXPORT" and row.state == "COMPLETED" and row.export_s3_key is not None
        ),
    )


# ---------------------------------------------------------------------------
# The requester's side
# ---------------------------------------------------------------------------


async def _open(
    session: AsyncSession, *, ctx: TenantContext, type_: str, now: datetime
) -> DsrRequest:
    if await repository.open_request_of_type(session, user_id=ctx.user_id, type_=type_):
        raise ConflictError(code=DsrError.ALREADY_OPEN)
    try:
        async with session.begin_nested():
            return await repository.create_request(
                session, user_id=ctx.user_id, type_=type_, due_at=due_at(requested_at=now)
            )
    except IntegrityError as exc:
        # Two taps raced past the read above; the partial unique index caught
        # the second. Same answer as the sequential path.
        raise ConflictError(code=DsrError.ALREADY_OPEN) from exc


async def request_export(
    session: AsyncSession, *, ctx: TenantContext, now: datetime, request_id: str | None
) -> RequestView:
    """Ask for a copy of everything we hold. Any signed-in person may.

    A business user's export is mostly empty sections, and that is correct:
    what we hold about a recruiter as a person is their account, and what they
    did at work belongs to their organisation.
    """
    row = await _open(session, ctx=ctx, type_="EXPORT", now=now)
    await audit_event(
        session,
        action=AuditAction.DSR_EXPORT_REQUESTED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type=TARGET_TYPE,
        target_id=row.id,
        request_id=request_id,
    )
    await emit(
        session,
        event_type=EXPORT_REQUESTED,
        aggregate_type=TARGET_TYPE,
        aggregate_id=row.id,
        payload={"user_id": str(ctx.user_id)},
    )
    return _view(row)


async def request_deletion(
    session: AsyncSession, *, ctx: TenantContext, now: datetime, request_id: str | None
) -> RequestView:
    """Ask to be forgotten. **Candidates only**, today.

    A business account is entangled with an organisation that outlives it --
    the last owner of an employer, erased, strands the tenant, its jobs, its
    subscription and its staff. What should happen to the organisation is a
    decision nobody has taken (blockers B3), so the request is refused with a
    code that sends the person to support, rather than accepted and left to
    fail in a sweep they cannot see.
    """
    if ctx.pool != "CANDIDATE":
        raise PermissionDeniedError(code=DsrError.DELETION_REQUIRES_SUPPORT)
    row = await _open(session, ctx=ctx, type_="DELETE", now=now)
    await audit_event(
        session,
        action=AuditAction.DSR_DELETION_REQUESTED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type=TARGET_TYPE,
        target_id=row.id,
        request_id=request_id,
    )
    logger.info("dsr_deletion_requested", request_id=str(row.id))
    return _view(row)


async def list_requests(session: AsyncSession, *, ctx: TenantContext) -> list[RequestView]:
    return [_view(r) for r in await repository.list_requests(session, user_id=ctx.user_id)]


async def get_request(
    session: AsyncSession, *, ctx: TenantContext, dsr_id: uuid.UUID
) -> RequestView:
    row = await repository.get_request(session, request_id=dsr_id, user_id=ctx.user_id)
    if row is None:
        raise NotFoundError()
    return _view(row)


async def withdraw(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    dsr_id: uuid.UUID,
    now: datetime,
    request_id: str | None,
) -> RequestView:
    """Change your mind about a deletion, inside the cooling-off period.

    Only a deletion, and only while RECEIVED. An export has nothing to undo,
    and a deletion the sweep has picked up is past the point where withdrawing
    could be honest about what it undid.
    """
    row = await repository.get_request(session, request_id=dsr_id, user_id=ctx.user_id)
    if row is None:
        raise NotFoundError()
    withdrawn = row.type == "DELETE" and await repository.claim(
        session,
        request_id=row.id,
        user_id=ctx.user_id,
        type_="DELETE",
        from_state="RECEIVED",
        to_state="REJECTED",
        completed_at=now,
        note="withdrawn by the requester",
    )
    if not withdrawn:
        raise ConflictError(code=DsrError.NOT_WITHDRAWABLE)
    await audit_event(
        session,
        action=AuditAction.DSR_COMPLETED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type=TARGET_TYPE,
        target_id=row.id,
        request_id=request_id,
        metadata={"outcome": "withdrawn"},
    )
    await session.refresh(row)
    return _view(row)


async def export_download(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    dsr_id: uuid.UUID,
    request_id: str | None,
) -> tuple[str, int]:
    """A link to the archive that lives `EXPORT_URL_TTL_SECONDS`.

    Minted per call and audited per call. The link is a bearer token for
    somebody's whole record, so "who was handed one, and when" belongs in the
    trail as much as any employer's reveal does.
    """
    row = await repository.get_request(session, request_id=dsr_id, user_id=ctx.user_id)
    if row is None or row.type != "EXPORT":
        raise NotFoundError()
    if row.state != "COMPLETED":
        raise ConflictError(code=DsrError.NOT_READY)
    if row.export_s3_key is None:
        raise ConflictError(code=DsrError.EXPIRED)

    url = await storage.presign_get(
        bucket=get_settings().s3_bucket_exports,
        key=row.export_s3_key,
        expires_in=EXPORT_URL_TTL_SECONDS,
    )
    await audit_event(
        session,
        action=AuditAction.DSR_EXPORT_DOWNLOADED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type=TARGET_TYPE,
        target_id=row.id,
        request_id=request_id,
    )
    return url, EXPORT_URL_TTL_SECONDS


# ---------------------------------------------------------------------------
# The worker's side: export
# ---------------------------------------------------------------------------


def strip_forbidden(value: Any) -> Any:
    """Remove every `EXPORT_FORBIDDEN_FIELDS` key, at any depth.

    The section queries already select none of them. This is the second lock,
    for the day somebody adds `SELECT *` or a JSONB column grows a nested
    `breakdown` -- an export is exactly the kind of output nobody re-reads.
    """
    if isinstance(value, dict):
        return {k: strip_forbidden(v) for k, v in value.items() if k not in EXPORT_FORBIDDEN_FIELDS}
    if isinstance(value, list):
        return [strip_forbidden(v) for v in value]
    return value


def build_archive(*, sections: dict[str, list[dict[str, Any]]], generated_at: datetime) -> bytes:
    """A zip holding one JSON file per section, plus a README.

    JSON rather than CSV: resume versions and questionnaire answers are
    nested, and flattening them would lose the structure the person gave us.
    Pure, so a test can open the bytes without S3.
    """
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "README.txt",
            "This archive holds the personal data BharatPath held about you on "
            f"{generated_at.isoformat()}.\n\n"
            "One file per section. Dates are UTC. Your Bharatpath Score is included; how it "
            "was calculated is not, because the platform never explains a score.\n"
            f"Format version {ARCHIVE_FORMAT_VERSION}.\n",
        )
        for section in EXPORT_SECTIONS:
            rows = strip_forbidden(sections.get(section, []))
            archive.writestr(
                f"{section}.json", json.dumps(rows, indent=2, default=str, ensure_ascii=False)
            )
    return buffer.getvalue()


async def collect_export(
    session: AsyncSession, *, dsr_id: uuid.UUID, user_id: uuid.UUID
) -> dict[str, list[dict[str, Any]]] | None:
    """Mark the request PROCESSING and read every section. None if there is
    nothing to do -- already finished, or redelivered after it was."""
    row = await repository.get_request(session, request_id=dsr_id, user_id=user_id)
    if row is None or row.type != "EXPORT" or row.state not in ("RECEIVED", "PROCESSING"):
        return None
    if row.state == "RECEIVED":
        await repository.set_state(session, request_id=row.id, state="PROCESSING")
    return {
        section: await repository.export_section(session, section=section, user_id=user_id)
        for section in EXPORT_SECTIONS
    }


def export_key(*, user_id: uuid.UUID, dsr_id: uuid.UUID) -> str:
    # Unguessable because the request id is, and grouped by user so an
    # operator removing one person's leftovers has one prefix to look under.
    return f"exports/{user_id}/{dsr_id}.zip"


async def finish_export(
    session: AsyncSession, *, dsr_id: uuid.UUID, user_id: uuid.UUID, key: str, now: datetime
) -> None:
    await repository.set_state(
        session,
        request_id=dsr_id,
        state="COMPLETED",
        completed_at=now,
        export_s3_key=key,
    )
    await audit_event(
        session,
        action=AuditAction.DSR_COMPLETED,
        actor_id=None,
        actor_role=SYSTEM_ACTOR,
        target_type=TARGET_TYPE,
        target_id=dsr_id,
        metadata={"type": "EXPORT", "user_id": str(user_id)},
    )


async def expired_exports(
    session: AsyncSession, *, now: datetime, limit: int
) -> list[tuple[uuid.UUID, str]]:
    return await repository.expired_exports(
        session, now=now - timedelta(hours=EXPORT_RETENTION_HOURS), limit=limit
    )


async def forget_export(session: AsyncSession, *, dsr_id: uuid.UUID) -> None:
    await repository.clear_export_key(session, request_id=dsr_id)


# ---------------------------------------------------------------------------
# The worker's side: erasure
# ---------------------------------------------------------------------------


async def due_deletions(
    session: AsyncSession, *, now: datetime, limit: int
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    """Deletions whose cooling-off period has ended."""
    return await repository.due_deletions(
        session, now=now - timedelta(hours=DELETION_GRACE_HOURS), limit=limit
    )


@dataclass(frozen=True, slots=True)
class ErasureTargets:
    """Everything the cascade will make unreachable, read while it still can be.

    Both fields exist for the same reason: they are pointers living on rows
    the erasure destroys. Collect them afterwards and you collect nothing --
    the objects stay in S3 and the Cognito user stays in the pool, with
    nothing left to name either.
    """

    object_keys: tuple[tuple[str, str], ...]
    #: `(pool, cognito_sub)`, or None for an account nobody ever signed in to.
    sign_in: tuple[str, str] | None


async def begin_erasure(
    session: AsyncSession, *, dsr_id: uuid.UUID, user_id: uuid.UUID
) -> ErasureTargets | None:
    """Claim a deletion and read what must be destroyed outside the database.

    None when somebody else claimed it, or it was withdrawn in the meantime.
    The claim is a conditional UPDATE, so a sweep and a withdrawal racing on
    the same row cannot both win.
    """
    claimed = await repository.claim(
        session,
        request_id=dsr_id,
        user_id=user_id,
        type_="DELETE",
        from_state="RECEIVED",
        to_state="PROCESSING",
    )
    if not claimed:
        return None
    keys = await repository.erasable_object_keys(session, user_id=user_id)
    sign_in = await repository.sign_in_to_destroy(session, user_id=user_id)
    return ErasureTargets(object_keys=tuple(keys), sign_in=sign_in)


async def complete_erasure(
    session: AsyncSession, *, dsr_id: uuid.UUID, user_id: uuid.UUID, now: datetime
) -> dict[str, int]:
    """Run the cascade and record what it destroyed, in one transaction."""
    manifest = await repository.erase_candidate(
        session, user_id=user_id, policy_version=RETENTION_POLICY_VERSION
    )
    # The archives were destroyed before this transaction opened; drop the
    # pointers too. Done here rather than in `erase_candidate` because
    # `dsr_requests` is retained, and the cascade may not touch a retained
    # table -- `test_erasure_plan.py` asserts exactly that.
    await repository.clear_export_keys_for_user(session, user_id=user_id)
    await repository.set_state(
        session,
        request_id=dsr_id,
        state="COMPLETED",
        completed_at=now,
        policy_version=RETENTION_POLICY_VERSION,
        manifest=manifest,
    )
    await audit_event(
        session,
        action=AuditAction.DSR_COMPLETED,
        actor_id=None,
        actor_role=SYSTEM_ACTOR,
        target_type=TARGET_TYPE,
        target_id=dsr_id,
        # Counts and ids only. The person this names no longer exists as
        # anything but this id, which is the point.
        metadata={
            "type": "DELETE",
            "user_id": str(user_id),
            "policy_version": RETENTION_POLICY_VERSION,
            "rows_destroyed": sum(manifest.values()),
        },
    )
    logger.info("dsr_erasure_completed", request_id=str(dsr_id), rows=sum(manifest.values()))
    return manifest


async def release_erasure(session: AsyncSession, *, dsr_id: uuid.UUID, reason: str) -> None:
    """Put a claimed deletion back after the object step failed, so the next
    sweep retries it rather than finding it stuck in PROCESSING forever."""
    await repository.set_state(session, request_id=dsr_id, state="RECEIVED", note=reason[:500])
