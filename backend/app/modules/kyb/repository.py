"""kyb - data access

Submissions, documents, review state machine.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

**Both tables are under Row-Level Security.** Every function assumes the
service has bound `app.tenant_id`; the `tenant_id` predicates are belt and
braces on top of the policy.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import ConfigValue
from app.modules.kyb.domain import OPEN_STATES
from app.modules.kyb.models import KybDocument, KybSubmission

_OPEN_PREDICATE = "state IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED')"


async def current_config(session: AsyncSession, *, key: str, now: datetime) -> ConfigValue | None:
    result = await session.execute(
        select(ConfigValue)
        .where(ConfigValue.key == key, ConfigValue.effective_from <= now)
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def append_config(
    session: AsyncSession, *, key: str, value: dict[str, Any], effective_from: datetime, note: str
) -> int:
    """The next version of `key`, never an update of the last. Serialised per
    key, so two staff flipping the switch at once write two versions rather
    than colliding on `uq_config_key_version`."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"config_values:{key}"},
    )
    version = int(
        await session.scalar(
            text("SELECT coalesce(max(version), 0) + 1 FROM config_values WHERE key = :k"),
            {"k": key},
        )
    )
    session.add(
        ConfigValue(key=key, value=value, version=version, effective_from=effective_from, note=note)
    )
    await session.flush()
    return version


async def open_submission(session: AsyncSession, *, tenant_id: uuid.UUID) -> KybSubmission | None:
    """The one submission still in progress, if any. The partial unique index
    guarantees there is never more than one."""
    result = await session.execute(
        select(KybSubmission).where(
            KybSubmission.tenant_id == tenant_id, KybSubmission.state.in_(OPEN_STATES)
        )
    )
    return result.scalar_one_or_none()


async def latest_submission(session: AsyncSession, *, tenant_id: uuid.UUID) -> KybSubmission | None:
    result = await session.execute(
        select(KybSubmission)
        .where(KybSubmission.tenant_id == tenant_id)
        .order_by(KybSubmission.created_at.desc(), KybSubmission.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def get_submission(
    session: AsyncSession, *, tenant_id: uuid.UUID, submission_id: uuid.UUID
) -> KybSubmission | None:
    result = await session.execute(
        select(KybSubmission).where(
            KybSubmission.id == submission_id, KybSubmission.tenant_id == tenant_id
        )
    )
    return result.scalar_one_or_none()


async def create_draft(
    session: AsyncSession, *, tenant_id: uuid.UUID, form_version: str
) -> KybSubmission:
    """A new DRAFT, or the open submission that won a race to exist.

    Two first saves at once -- a double-click, two tabs -- would both find no
    open submission and both insert. `ON CONFLICT DO NOTHING` against the
    partial unique index makes the loser a no-op, and the read that follows
    returns the winner, so both requests end on one row.
    """
    await session.execute(
        pg_insert(KybSubmission)
        .values(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            state="DRAFT",
            answers={},
            form_version=form_version,
            auto_approved=False,
        )
        .on_conflict_do_nothing(index_elements=["tenant_id"], index_where=text(_OPEN_PREDICATE))
    )
    row = await open_submission(session, tenant_id=tenant_id)
    if row is None:  # pragma: no cover - only on a genuine constraint failure
        raise RuntimeError("could not create or read the open KYB submission")
    return row


async def set_answers(
    session: AsyncSession, *, submission: KybSubmission, answers: dict[str, Any], form_version: str
) -> KybSubmission:
    # A new dict, not an in-place edit: SQLAlchemy does not see mutation
    # inside a JSONB value, and an edited-in-place dict would silently not save.
    submission.answers = dict(answers)
    submission.form_version = form_version
    await session.flush()
    return submission


async def set_state(
    session: AsyncSession, *, submission: KybSubmission, **fields: Any
) -> KybSubmission:
    allowed = {
        "state",
        "submitted_at",
        "reviewed_by",
        "reviewed_at",
        "decision_reason",
        "auto_approved",
    }
    unexpected = set(fields) - allowed
    if unexpected:
        raise ValueError(f"not settable: {sorted(unexpected)}")
    for field, value in fields.items():
        setattr(submission, field, value)
    await session.flush()
    return submission


async def documents(session: AsyncSession, *, submission_id: uuid.UUID) -> list[KybDocument]:
    result = await session.execute(
        select(KybDocument)
        .where(KybDocument.submission_id == submission_id)
        .order_by(KybDocument.uploaded_at, KybDocument.id)
    )
    return list(result.scalars().all())


async def document_by_key(session: AsyncSession, *, s3_key: str) -> KybDocument | None:
    result = await session.execute(select(KybDocument).where(KybDocument.s3_key == s3_key))
    return result.scalar_one_or_none()


async def add_document(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    submission_id: uuid.UUID,
    doc_type: str,
    s3_key: str,
    mime: str,
    uploaded_at: datetime,
) -> KybDocument:
    row = KybDocument(
        tenant_id=tenant_id,
        submission_id=submission_id,
        doc_type=doc_type,
        s3_key=s3_key,
        mime=mime,
        uploaded_at=uploaded_at,
    )
    session.add(row)
    await session.flush()
    return row
