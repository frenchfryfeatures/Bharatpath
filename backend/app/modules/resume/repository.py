"""resume - data access

Upload, parse jobs, versions, review and confirm.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import ConfigValue
from app.modules.resume.models import ResumeFile, ResumeVersion


async def create_resume_file(
    session: AsyncSession,
    *,
    resume_file_id: uuid.UUID,
    user_id: uuid.UUID,
    s3_key: str,
    mime: str,
    size_bytes: int,
    scan_status: str,
    original_filename: str | None = None,
) -> ResumeFile:
    """Insert the row for an upload that has already been validated.

    The id is supplied rather than generated, because it is the same id the
    presigned key was built from -- which is what makes completing an upload
    twice land on the same row instead of creating a second one.
    """
    row = ResumeFile(
        id=resume_file_id,
        user_id=user_id,
        s3_key=s3_key,
        mime=mime,
        size_bytes=size_bytes,
        scan_status=scan_status,
        original_filename=original_filename,
    )
    session.add(row)
    await session.flush()
    return row


async def get_resume_file(
    session: AsyncSession, *, resume_file_id: uuid.UUID, user_id: uuid.UUID
) -> ResumeFile | None:
    """Always scoped to the owner.

    `resume_files` is keyed by user rather than tenant, so row-level security
    does not cover it -- the `user_id` predicate here IS the isolation. A miss
    returns None and the caller answers 404, never 403: a 403 would confirm
    that someone else's file exists.
    """
    result = await session.execute(
        select(ResumeFile).where(ResumeFile.id == resume_file_id, ResumeFile.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def list_files(session: AsyncSession, *, user_id: uuid.UUID, limit: int) -> list[ResumeFile]:
    """The candidate's files, newest first: uploads, and the PDFs the builder
    drew. Failed and blocked uploads too -- they have no version, and the
    history is the only place a candidate sees that one did not work."""
    result = await session.execute(
        select(ResumeFile)
        .where(ResumeFile.user_id == user_id)
        .order_by(ResumeFile.uploaded_at.desc(), ResumeFile.id.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def files_by_id(
    session: AsyncSession, *, user_id: uuid.UUID, resume_file_ids: list[uuid.UUID]
) -> dict[uuid.UUID, ResumeFile]:
    if not resume_file_ids:
        return {}
    result = await session.execute(
        select(ResumeFile).where(ResumeFile.user_id == user_id, ResumeFile.id.in_(resume_file_ids))
    )
    return {row.id: row for row in result.scalars().all()}


async def versions_of_files(
    session: AsyncSession, *, user_id: uuid.UUID, resume_file_ids: list[uuid.UUID]
) -> list[ResumeVersion]:
    """Every version made from these files, newest first. An edit carries
    its file forward, so a file's versions are its upload and its corrections."""
    if not resume_file_ids:
        return []
    result = await session.execute(
        select(ResumeVersion)
        .where(
            ResumeVersion.user_id == user_id,
            ResumeVersion.resume_file_id.in_(resume_file_ids),
        )
        .order_by(ResumeVersion.created_at.desc(), ResumeVersion.id.desc())
    )
    return list(result.scalars().all())


async def set_scan_status(session: AsyncSession, *, resume_file_id: uuid.UUID, status: str) -> None:
    row = await session.get(ResumeFile, resume_file_id)
    if row is not None:
        row.scan_status = status
        await session.flush()


async def set_parse_status(
    session: AsyncSession,
    *,
    resume_file_id: uuid.UUID,
    status: str,
    error_code: str | None = None,
) -> None:
    """Record where the parse got to, for the status endpoint to report.

    Written on the parse task's own transaction, alongside the version it
    produced -- so a candidate can never poll a DONE whose version has not
    committed, nor a FAILED that a retry then quietly succeeds past.
    """
    row = await session.get(ResumeFile, resume_file_id)
    if row is not None:
        row.parse_status = status
        # Cleared on any non-failure, or a retry that succeeds would report
        # DONE while still carrying the previous attempt's error code.
        row.parse_error_code = error_code if status == "FAILED" else None
        await session.flush()


async def create_version(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    source: str,
    parsed: dict[str, Any],
    resume_file_id: uuid.UUID | None = None,
    supersedes_id: uuid.UUID | None = None,
) -> ResumeVersion:
    """Versions are append-only. There is deliberately no update function.

    A score points at the exact version it was computed from, so a version
    that could change underneath it would make every historical score
    unreproducible -- invariant 1. Edits create a new row and chain through
    `supersedes_id`.
    """
    row = ResumeVersion(
        user_id=user_id,
        source=source,
        parsed=parsed,
        resume_file_id=resume_file_id,
        supersedes_id=supersedes_id,
    )
    session.add(row)
    await session.flush()
    return row


async def latest_version_for_file(
    session: AsyncSession, *, resume_file_id: uuid.UUID
) -> ResumeVersion | None:
    result = await session.execute(
        select(ResumeVersion)
        .where(ResumeVersion.resume_file_id == resume_file_id)
        .order_by(ResumeVersion.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_version(
    session: AsyncSession, *, resume_version_id: uuid.UUID, user_id: uuid.UUID
) -> ResumeVersion | None:
    """One version, always scoped to its owner.

    Same reasoning as `get_resume_file`: `resume_versions` is keyed by user,
    not by tenant, so this predicate IS the isolation. A miss is a 404.
    """
    result = await session.execute(
        select(ResumeVersion).where(
            ResumeVersion.id == resume_version_id, ResumeVersion.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


async def list_versions(
    session: AsyncSession, *, user_id: uuid.UUID, limit: int
) -> list[ResumeVersion]:
    """The candidate's version history, newest first.

    Returns unconfirmed versions too, deliberately: this feeds the review
    screen, which exists precisely to show a candidate content that has not
    been through the confirm gate yet. `latest_confirmed_version` is the one
    that scoring uses, and it is the one that filters.
    """
    result = await session.execute(
        select(ResumeVersion)
        .where(ResumeVersion.user_id == user_id)
        .order_by(ResumeVersion.created_at.desc(), ResumeVersion.id.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def newest_text_version(
    session: AsyncSession, *, user_id: uuid.UUID
) -> tuple[uuid.UUID, datetime] | None:
    """`(id, created_at)` of the newest CV read from text -- an upload, a
    paste, or a correction of one -- confirmed or not. Never a version the
    resume builder drew, nor a form-built one: those hold nothing the
    builder's draft did not already start from. Ids only, no content."""
    result = await session.execute(
        select(ResumeVersion.id, ResumeVersion.created_at)
        .where(
            ResumeVersion.user_id == user_id,
            ResumeVersion.source != "BUILDER",
            ResumeVersion.parsed.has_key("raw_text"),
        )
        .order_by(ResumeVersion.created_at.desc(), ResumeVersion.id.desc())
        .limit(1)
    )
    row = result.one_or_none()
    return None if row is None else (row.id, row.created_at)


async def successor_of(
    session: AsyncSession, *, resume_version_id: uuid.UUID
) -> ResumeVersion | None:
    """The version that supersedes this one, if any.

    A unique index makes "if any" mean at most one, so this can return a
    single row rather than a list a caller would have to reason about.
    """
    result = await session.execute(
        select(ResumeVersion).where(ResumeVersion.supersedes_id == resume_version_id)
    )
    return result.scalar_one_or_none()


async def latest_confirmed_version(
    session: AsyncSession, *, user_id: uuid.UUID
) -> ResumeVersion | None:
    """**The only query that returns a scorable resume** (SRS 1.4.4).

    The `confirmed_at IS NOT NULL` predicate is the confirm gate. It lives in
    SQL rather than in a Python check after the fetch, because a filter that
    never loaded the unconfirmed row cannot be forgotten by the next caller.
    `tests/invariants/test_confirm_gate.py` asserts this stays the only
    function that carries it.
    """
    result = await session.execute(
        select(ResumeVersion)
        .where(ResumeVersion.user_id == user_id, ResumeVersion.confirmed_at.is_not(None))
        .order_by(ResumeVersion.confirmed_at.desc(), ResumeVersion.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def confirm_version(
    session: AsyncSession, *, resume_version_id: uuid.UUID, user_id: uuid.UUID
) -> ResumeVersion | None:
    """Latch `confirmed_at` from NULL to now. Returns None if nothing changed.

    **A conditional UPDATE, not read-modify-write.** `confirmed_at IS NULL` in
    the WHERE clause is what makes this a latch rather than an assignment: two
    concurrent confirms cannot both win, and no code path can move an existing
    timestamp -- which matters because the confirmation time is the moment the
    candidate took responsibility for the content, and a score computed from
    it points back here.

    This is the one permitted mutation of a version. The *content* stays
    immutable; a correction creates a new row (`create_version`), and there is
    still deliberately no update function for `parsed`.
    """
    result = await session.execute(
        update(ResumeVersion)
        .where(
            ResumeVersion.id == resume_version_id,
            ResumeVersion.user_id == user_id,
            ResumeVersion.confirmed_at.is_(None),
        )
        .values(confirmed_at=func.now())
        .returning(ResumeVersion)
    )
    return result.scalar_one_or_none()


async def lock_confirmations(session: AsyncSession, *, user_id: uuid.UUID) -> None:
    """Serialise one candidate's confirmations, so two confirms of different
    versions (an upload and a builder push) cannot both read "allowed" and
    both send a resume to scoring inside one interval."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"resume-confirm:{user_id}"},
    )


async def last_confirmed_at(session: AsyncSession, *, user_id: uuid.UUID) -> datetime | None:
    """When this candidate last confirmed any version, or None. A timestamp,
    never a row: `latest_confirmed_version` stays the one query that returns
    a version for scoring."""
    return await session.scalar(
        select(func.max(ResumeVersion.confirmed_at)).where(ResumeVersion.user_id == user_id)
    )


async def current_config(session: AsyncSession, *, key: str, now: datetime) -> ConfigValue | None:
    """The highest version of a config key in effect at `now`."""
    result = await session.execute(
        select(ConfigValue)
        .where(ConfigValue.key == key, ConfigValue.effective_from <= now)
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def users_with_any_resume(
    session: AsyncSession, *, user_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of these people have uploaded a file or written a version, of any
    state. Existence only: nothing about what the CV says."""
    if not user_ids:
        return set()
    files = select(ResumeFile.user_id).where(ResumeFile.user_id.in_(user_ids))
    versions = select(ResumeVersion.user_id).where(ResumeVersion.user_id.in_(user_ids))
    result = await session.execute(files.union(versions))
    return set(result.scalars().all())
