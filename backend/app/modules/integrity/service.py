"""integrity - business rules and transaction boundaries

Signals, severity policy, search suppression.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**This module never imports `scoring`** (SRS 1.4.5, enforced by the
`integrity-never-imports-scoring` contract). It is handed a Layer 1 extraction
as plain data by the task layer. A signal can hide a candidate from search
until a human looks; it can never move their number.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, audit_event
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.modules.integrity import repository
from app.modules.integrity.domain import (
    DEFAULT_THRESHOLDS,
    RULE_VERSION,
    IntegrityThresholds,
    IntegrityThresholdsError,
    claims_from_extraction,
    detect,
    highest_severity,
    month_index,
    suppresses_from_discovery,
    thresholds_from_config,
)
from app.modules.integrity.events import MODULE

logger = get_logger(__name__)


#: Where the thresholds live. Insert a row with a higher `version` to change
#: them; `effective_from` lets a change be written ahead of the day it applies.
THRESHOLDS_CONFIG_KEY = "integrity.thresholds"


class IntegrityConfigError(AppError):
    """The thresholds row cannot be parsed. **The check does not run.**

    Not a fallback to defaults: a misspelt key that silently kept the old
    number would look applied. Failing leaves the candidate unchecked, which
    discovery treats as invisible -- loud, and safe for the person being
    judged.
    """

    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
    code = "integrity_thresholds_invalid"
    title = "Integrity thresholds are misconfigured"


async def current_thresholds(session: AsyncSession, *, as_of: datetime) -> IntegrityThresholds:
    row = await repository.current_config(session, key=THRESHOLDS_CONFIG_KEY, now=as_of)
    if row is None:
        return DEFAULT_THRESHOLDS
    try:
        return thresholds_from_config(row.value, version=str(row.version))
    except IntegrityThresholdsError as exc:
        raise IntegrityConfigError(params={"detail": str(exc)}) from exc


class SignalNotFoundError(NotFoundError):
    code = "integrity_signal_not_found"
    title = "Integrity signal not found"


class SignalAlreadyResolvedError(ConflictError):
    """A second decision on a decided signal. Refused rather than replacing
    the first one, which a later reader of the queue would never see."""

    code = "integrity_signal_already_resolved"
    title = "Integrity signal already resolved"


@dataclass(frozen=True, slots=True)
class EvaluationResult:
    resume_version_id: uuid.UUID
    signal_count: int
    highest_severity: str | None
    suppresses: bool
    already_evaluated: bool


async def evaluate_version(
    session: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    resume_version_id: uuid.UUID,
    extracted: dict[str, Any],
    visible_text: str,
    #: Text the CV renders and a reader cannot see. Empty for
    #: versions parsed before the detector existed -- which reads as "nothing
    #: hidden", deliberately: a rule that fired on our own missing data would
    #: suppress candidates for a reason that is nothing to do with them.
    hidden_text: str = "",
    as_of: datetime,
) -> EvaluationResult:
    """Run the rules over one scored version and record what they found.

    `as_of` is required, never defaulted to now. The task passes the score's
    `computed_at`, so re-evaluating an old version reproduces the signals it
    produced then -- "is this start date in the future?" has to be asked of
    the date the CV was read, not of the day someone re-ran it.

    Idempotent by `(resume_version_id, RULE_VERSION)`. A second delivery of
    the same score event returns the first result and writes nothing.
    """
    thresholds = await current_thresholds(session, as_of=as_of)
    claims = claims_from_extraction(extracted, visible_text=visible_text, hidden_text=hidden_text)
    signals = detect(
        claims, as_of_month=month_index(as_of.year, as_of.month), thresholds=thresholds
    )
    top = highest_severity(signals)
    suppresses = suppresses_from_discovery(signals)

    claimed = await repository.claim_check(
        session,
        candidate_id=candidate_id,
        resume_version_id=resume_version_id,
        rule_version=RULE_VERSION,
        thresholds_version=thresholds.version,
        highest_severity=top,
        signal_count=len(signals),
    )
    if not claimed:
        existing = await repository.get_check(
            session, resume_version_id=resume_version_id, rule_version=RULE_VERSION
        )
        severity = existing.highest_severity if existing is not None else None
        logger.info("integrity_skipped_already_evaluated", resume_version_id=str(resume_version_id))
        return EvaluationResult(
            resume_version_id=resume_version_id,
            signal_count=existing.signal_count if existing is not None else 0,
            highest_severity=severity,
            suppresses=severity == "HIGH",
            already_evaluated=True,
        )

    await repository.insert_signals(
        session,
        candidate_id=candidate_id,
        resume_version_id=resume_version_id,
        signals=signals,
        thresholds_version=thresholds.version,
    )

    # Counts and severity only. Signal evidence names employers and quotes CV
    # text, and an outbox payload is read by consumers far beyond the reviewer
    # who is entitled to see it.
    await emit(
        session,
        event_type=f"{MODULE}.version_evaluated",
        aggregate_type="resume_version",
        aggregate_id=resume_version_id,
        payload={
            "candidate_id": str(candidate_id),
            "signal_count": len(signals),
            "highest_severity": top,
            "suppresses": suppresses,
            "thresholds_version": thresholds.version,
        },
    )
    logger.info(
        "integrity_evaluated",
        resume_version_id=str(resume_version_id),
        signals=len(signals),
        highest_severity=top,
    )
    return EvaluationResult(
        resume_version_id=resume_version_id,
        signal_count=len(signals),
        highest_severity=top,
        suppresses=suppresses,
        already_evaluated=False,
    )


async def signals_for_version(session: AsyncSession, *, resume_version_id: uuid.UUID) -> Any:
    return await repository.signals_for_version(session, resume_version_id=resume_version_id)


async def resolve_signal(
    session: AsyncSession,
    *,
    signal_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    reviewer_role: str,
    outcome: Literal["CLEARED", "CONFIRMED"],
    note: str | None = None,
) -> Any:
    """A human's decision on one signal. Audited on the same transaction.

    **Only CLEARED restores visibility.** CONFIRMED means a reviewer agrees
    the CV is dishonest, and discovery keeps that candidate suppressed. Staff
    call this from the admin console's integrity queue.

    The note goes on the signal row and never into the audit metadata: it is
    free text a reviewer typed, and an audit table carrying CV details is a
    privacy problem of its own.
    """
    row = await repository.resolve_signal(
        session, signal_id=signal_id, state=outcome, resolved_by=reviewer_id, note=note
    )
    if row is None:
        if await repository.get_signal(session, signal_id=signal_id) is None:
            raise SignalNotFoundError()
        raise SignalAlreadyResolvedError()

    await audit_event(
        session,
        action=AuditAction.INTEGRITY_FLAG_RESOLVED,
        actor_id=reviewer_id,
        actor_role=reviewer_role,
        target_type="integrity_signal",
        target_id=row.id,
        metadata={"outcome": outcome, "rule_id": row.rule_id, "severity": row.severity},
    )
    return row
