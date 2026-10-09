"""interview - data access

Audio sessions, chunk upload, evaluation, +20/session.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

Candidate rows carry no tenant and are not under Row-Level Security, as for
resumes and scores: every read here filters on the authenticated `user_id`,
and a row belonging to someone else is simply not found.

`device_checks`, `interview_purchases`, `interview_checkout_notices`,
`interview_transcripts` and `interview_evaluations` are insert-only; the app
role holds no UPDATE or DELETE on them.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.interview.domain import COMPLETED_STATES, OPEN_STATES
from app.modules.interview.models import (
    DeviceCheck,
    InterviewAnswer,
    InterviewCheckoutNotice,
    InterviewEvaluation,
    InterviewProduct,
    InterviewPurchase,
    InterviewSession,
    InterviewSessionQuestion,
    InterviewTranscript,
)


async def lock_candidate(session: AsyncSession, *, user_id: uuid.UUID) -> None:
    """Serialise session starts for one candidate, so a double tap cannot
    consume two purchases or race the one-open-session index."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"interview:{user_id}"},
    )


# --- products -------------------------------------------------------------------
async def active_product(session: AsyncSession, *, code: str) -> InterviewProduct | None:
    result = await session.execute(
        select(InterviewProduct)
        .where(InterviewProduct.code == code, InterviewProduct.active.is_(True))
        .order_by(InterviewProduct.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def latest_product_version(session: AsyncSession, *, code: str) -> InterviewProduct | None:
    result = await session.execute(
        select(InterviewProduct)
        .where(InterviewProduct.code == code)
        .order_by(InterviewProduct.version.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def insert_product(
    session: AsyncSession, *, code: str, price_minor: int, active: bool, version: int
) -> InterviewProduct:
    row = InterviewProduct(code=code, price_minor=price_minor, active=active, version=version)
    session.add(row)
    await session.flush()
    return row


# --- device checks --------------------------------------------------------------
async def insert_device_check(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    mic_ok: bool,
    audio_out_ok: bool,
    network_kbps: int | None,
    storage_mb: int | None,
    quiet_env_ok: bool,
    passed: bool,
    failures: list[str],
    rule_version: str,
    checked_at: datetime,
) -> DeviceCheck:
    row = DeviceCheck(
        user_id=user_id,
        mic_ok=mic_ok,
        audio_out_ok=audio_out_ok,
        network_kbps=network_kbps,
        storage_mb=storage_mb,
        quiet_env_ok=quiet_env_ok,
        passed=passed,
        failures=failures,
        rule_version=rule_version,
        checked_at=checked_at,
    )
    session.add(row)
    await session.flush()
    return row


async def latest_passed_check(session: AsyncSession, *, user_id: uuid.UUID) -> DeviceCheck | None:
    result = await session.execute(
        select(DeviceCheck)
        .where(DeviceCheck.user_id == user_id, DeviceCheck.passed.is_(True))
        .order_by(DeviceCheck.checked_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


# --- purchases ------------------------------------------------------------------
async def insert_checkout_notice(
    session: AsyncSession,
    *,
    payment_id: uuid.UUID,
    user_id: uuid.UUID,
    will_increase_score: bool,
    acknowledged_no_increase: bool,
    device_check_id: uuid.UUID,
) -> None:
    """One row per distinct thing a checkout of this payment was told. A retried
    checkout that reuses the pending payment and was told the same adds nothing."""
    await session.execute(
        pg_insert(InterviewCheckoutNotice)
        .values(
            id=uuid.uuid4(),
            payment_id=payment_id,
            user_id=user_id,
            will_increase_score=will_increase_score,
            acknowledged_no_increase=acknowledged_no_increase,
            device_check_id=device_check_id,
        )
        .on_conflict_do_nothing(constraint="uq_interview_checkout_notice_terms")
    )


async def insert_purchase(
    session: AsyncSession, *, user_id: uuid.UUID, product_id: uuid.UUID, payment_id: uuid.UUID
) -> bool:
    """False if this payment already bought its session. The database guard
    refuses the insert outright unless the payment is verified and matches."""
    result = await session.execute(
        pg_insert(InterviewPurchase)
        .values(id=uuid.uuid4(), user_id=user_id, product_id=product_id, payment_id=payment_id)
        .on_conflict_do_nothing(constraint="uq_interview_purchase_payment")
        .returning(InterviewPurchase.id)
    )
    return result.scalar_one_or_none() is not None


async def oldest_unstarted_purchase(
    session: AsyncSession, *, user_id: uuid.UUID
) -> InterviewPurchase | None:
    result = await session.execute(
        select(InterviewPurchase)
        .outerjoin(InterviewSession, InterviewSession.purchase_id == InterviewPurchase.id)
        .where(InterviewPurchase.user_id == user_id, InterviewSession.id.is_(None))
        .order_by(InterviewPurchase.purchased_at, InterviewPurchase.id)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def count_unstarted_purchases(session: AsyncSession, *, user_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count(InterviewPurchase.id))
        .outerjoin(InterviewSession, InterviewSession.purchase_id == InterviewPurchase.id)
        .where(InterviewPurchase.user_id == user_id, InterviewSession.id.is_(None))
    )
    return int(result.scalar_one())


# --- sessions -------------------------------------------------------------------
async def count_sessions(
    session: AsyncSession, *, user_id: uuid.UUID, states: frozenset[str] | None = None
) -> int:
    query = select(func.count(InterviewSession.id)).where(InterviewSession.user_id == user_id)
    if states is not None:
        query = query.where(InterviewSession.state.in_(sorted(states)))
    return int((await session.execute(query)).scalar_one())


async def open_session(session: AsyncSession, *, user_id: uuid.UUID) -> InterviewSession | None:
    result = await session.execute(
        select(InterviewSession).where(
            InterviewSession.user_id == user_id, InterviewSession.state.in_(sorted(OPEN_STATES))
        )
    )
    return result.scalar_one_or_none()


async def insert_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    purchase_id: uuid.UUID,
    device_check_id: uuid.UUID,
    session_number: int,
    question_set_code: str,
    question_set_version: str,
) -> InterviewSession:
    row = InterviewSession(
        user_id=user_id,
        purchase_id=purchase_id,
        device_check_id=device_check_id,
        session_number=session_number,
        state="CREATED",
        question_set_code=question_set_code,
        question_set_version=question_set_version,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def get_session(
    session: AsyncSession, *, user_id: uuid.UUID, session_id: uuid.UUID, lock: bool = False
) -> InterviewSession | None:
    query = select(InterviewSession).where(
        InterviewSession.id == session_id, InterviewSession.user_id == user_id
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def list_sessions(session: AsyncSession, *, user_id: uuid.UUID) -> list[InterviewSession]:
    result = await session.execute(
        select(InterviewSession)
        .where(InterviewSession.user_id == user_id)
        .order_by(InterviewSession.session_number.desc())
    )
    return list(result.scalars())


async def completed_sessions(
    session: AsyncSession, *, user_id: uuid.UUID
) -> list[InterviewSession]:
    result = await session.execute(
        select(InterviewSession)
        .where(
            InterviewSession.user_id == user_id,
            InterviewSession.state.in_(sorted(COMPLETED_STATES)),
        )
        .order_by(InterviewSession.completed_at, InterviewSession.id)
    )
    return list(result.scalars())


async def save_session(session: AsyncSession, row: InterviewSession) -> InterviewSession:
    await session.flush()
    await session.refresh(row)
    return row


# --- questions (2026-09-29) --------------------------------------------------------
async def questions_for(
    session: AsyncSession, *, session_id: uuid.UUID
) -> list[InterviewSessionQuestion]:
    result = await session.execute(
        select(InterviewSessionQuestion)
        .where(InterviewSessionQuestion.session_id == session_id)
        .order_by(InterviewSessionQuestion.question_index)
    )
    return list(result.scalars())


async def insert_question(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    question_index: int,
    code: str,
    key: str | None,
    prompt: str,
    looking_for: str,
    kind: str,
    source: str,
    model_id: str | None,
    prompt_version: str | None,
) -> None:
    """Insert-only. A position already asked is left as it was: the caller
    holds the session row lock, so this only meets a row it wrote itself."""
    await session.execute(
        pg_insert(InterviewSessionQuestion)
        .values(
            id=uuid.uuid4(),
            session_id=session_id,
            question_index=question_index,
            code=code,
            key=key,
            prompt=prompt,
            looking_for=looking_for,
            kind=kind,
            source=source,
            model_id=model_id,
            prompt_version=prompt_version,
        )
        .on_conflict_do_nothing(constraint="uq_interview_session_question_slot")
    )


async def earlier_sessions(
    session: AsyncSession, *, user_id: uuid.UUID, before_session_id: uuid.UUID
) -> list[InterviewSession]:
    """Every other session this candidate has started, abandoned ones too:
    a question put to them once is not to be put again."""
    result = await session.execute(
        select(InterviewSession)
        .where(InterviewSession.user_id == user_id, InterviewSession.id != before_session_id)
        .order_by(InterviewSession.session_number)
    )
    return list(result.scalars())


async def questions_for_sessions(
    session: AsyncSession, *, session_ids: list[uuid.UUID]
) -> list[InterviewSessionQuestion]:
    if not session_ids:
        return []
    result = await session.execute(
        select(InterviewSessionQuestion)
        .where(InterviewSessionQuestion.session_id.in_(session_ids))
        .order_by(InterviewSessionQuestion.session_id, InterviewSessionQuestion.question_index)
    )
    return list(result.scalars())


# --- answers --------------------------------------------------------------------
async def answers_for(session: AsyncSession, *, session_id: uuid.UUID) -> list[InterviewAnswer]:
    result = await session.execute(
        select(InterviewAnswer)
        .where(InterviewAnswer.session_id == session_id)
        .order_by(InterviewAnswer.question_index)
    )
    return list(result.scalars())


async def get_answer(
    session: AsyncSession, *, session_id: uuid.UUID, question_index: int, lock: bool = False
) -> InterviewAnswer | None:
    query = select(InterviewAnswer).where(
        InterviewAnswer.session_id == session_id, InterviewAnswer.question_index == question_index
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def mark_uploading(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    question_index: int,
    question_code: str,
    s3_key: str,
) -> None:
    """Create the slot, or re-open a slot whose earlier upload never landed.
    A STORED slot is left alone (and the guard refuses to change it anyway)."""
    statement = pg_insert(InterviewAnswer).values(
        id=uuid.uuid4(),
        session_id=session_id,
        question_index=question_index,
        question_code=question_code,
        s3_key=s3_key,
        upload_state="UPLOADING",
    )
    await session.execute(
        statement.on_conflict_do_update(
            constraint="uq_interview_answer_slot",
            set_={"upload_state": "UPLOADING", "s3_key": s3_key},
            where=InterviewAnswer.upload_state != "STORED",
        )
    )


async def mark_stored(
    session: AsyncSession,
    answer: InterviewAnswer,
    *,
    mime: str,
    size_bytes: int,
    duration_ms: int,
    uploaded_at: datetime,
) -> InterviewAnswer:
    answer.mime = mime
    answer.size_bytes = size_bytes
    answer.duration_ms = duration_ms
    answer.upload_state = "STORED"
    answer.uploaded_at = uploaded_at
    await session.flush()
    return answer


# --- evaluation -----------------------------------------------------------------
async def get_session_by_id(
    session: AsyncSession, *, session_id: uuid.UUID, lock: bool = False
) -> InterviewSession | None:
    """**System use only** -- the evaluation task has no candidate. Every
    candidate-facing read goes through `get_session`, which filters on the
    owner."""
    query = select(InterviewSession).where(InterviewSession.id == session_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def transcripts_for(
    session: AsyncSession, *, session_id: uuid.UUID
) -> list[InterviewTranscript]:
    result = await session.execute(
        select(InterviewTranscript)
        .where(InterviewTranscript.session_id == session_id)
        .order_by(InterviewTranscript.question_index)
    )
    return list(result.scalars())


async def insert_transcript(
    session: AsyncSession,
    *,
    session_id: uuid.UUID,
    answer_id: uuid.UUID,
    question_index: int,
    provider: str,
    provider_version: str,
    language: str | None,
    text_value: str,
) -> None:
    """Idempotent by answer: a transcript already stored is kept, never
    overwritten, so two task deliveries cannot disagree about what was said."""
    await session.execute(
        pg_insert(InterviewTranscript)
        .values(
            id=uuid.uuid4(),
            session_id=session_id,
            answer_id=answer_id,
            question_index=question_index,
            provider=provider,
            provider_version=provider_version,
            language=language,
            text=text_value,
        )
        .on_conflict_do_nothing(constraint="uq_interview_transcript_answer")
    )


async def get_evaluation(
    session: AsyncSession, *, session_id: uuid.UUID
) -> InterviewEvaluation | None:
    result = await session.execute(
        select(InterviewEvaluation).where(InterviewEvaluation.session_id == session_id)
    )
    return result.scalar_one_or_none()


async def insert_evaluation(session: AsyncSession, **values: object) -> InterviewEvaluation:
    row = InterviewEvaluation(**values)
    session.add(row)
    await session.flush()
    return row
