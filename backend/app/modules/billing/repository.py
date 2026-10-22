"""billing - data access

Payments, entitlements, signed callbacks.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

No delete function, for either table. Payments are the financial record the
deletion carve-out keeps (blockers B3), and callbacks are evidence.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.listing import Key, Ordering, SortField, contains
from app.modules.billing.models import DiscountCode, DiscountRedemption, Payment, PaymentCallback


async def lock_checkout(session: AsyncSession, *, user_id: uuid.UUID, item_id: uuid.UUID) -> None:
    """Serialise checkouts for one payer and one item, so a double tap finds
    the first pending payment instead of racing it to open a second order."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"checkout:{user_id}:{item_id}"},
    )


async def reusable_pending_payment(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    purpose: str,
    item_id: uuid.UUID,
    amount_minor: int,
    provider: str,
    since: datetime,
    discount_code_id: uuid.UUID | None = None,
) -> Payment | None:
    result = await session.execute(
        select(Payment)
        .where(
            Payment.user_id == user_id,
            Payment.purpose == purpose,
            Payment.item_id == item_id,
            Payment.status == "PENDING",
            Payment.amount_minor == amount_minor,
            Payment.provider == provider,
            Payment.created_at >= since,
            Payment.discount_code_id.is_(None)
            if discount_code_id is None
            else Payment.discount_code_id == discount_code_id,
        )
        .order_by(Payment.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def insert_payment(
    session: AsyncSession,
    *,
    payment_id: uuid.UUID,
    user_id: uuid.UUID,
    provider: str,
    provider_ref: str,
    amount_minor: int,
    purpose: str,
    item_code: str,
    item_id: uuid.UUID,
    subscriber_type: str | None,
    subscriber_id: uuid.UUID | None,
    subscription_id: uuid.UUID | None,
    checkout_url: str | None,
    discount_code_id: uuid.UUID | None = None,
    list_amount_minor: int | None = None,
) -> Payment:
    """Always PENDING and unverified. The database refuses anything else."""
    row = Payment(
        id=payment_id,
        user_id=user_id,
        provider=provider,
        provider_ref=provider_ref,
        amount_minor=amount_minor,
        currency="INR",
        status="PENDING",
        purpose=purpose,
        item_code=item_code,
        item_id=item_id,
        subscriber_type=subscriber_type,
        subscriber_id=subscriber_id,
        subscription_id=subscription_id,
        checkout_url=checkout_url,
        discount_code_id=discount_code_id,
        list_amount_minor=list_amount_minor,
    )
    session.add(row)
    await session.flush()
    return row


async def get_payment(session: AsyncSession, *, payment_id: uuid.UUID) -> Payment | None:
    return await session.get(Payment, payment_id)


async def lock_payment_by_ref(
    session: AsyncSession, *, provider: str, provider_ref: str
) -> Payment | None:
    result = await session.execute(
        select(Payment)
        .where(Payment.provider == provider, Payment.provider_ref == provider_ref)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def insert_callback(
    session: AsyncSession,
    *,
    provider: str,
    event_id: str,
    event_type: str,
    payload: dict[str, Any],
    verified_at: datetime,
) -> uuid.UUID | None:
    """Store a verified callback. None if this event was already received --
    that is the replay protection."""
    result = await session.execute(
        pg_insert(PaymentCallback)
        .values(
            id=uuid.uuid4(),
            provider=provider,
            event_id=event_id,
            event_type=event_type,
            payload=payload,
            signature_verified_at=verified_at,
        )
        .on_conflict_do_nothing(constraint="uq_payment_callback_event")
        .returning(PaymentCallback.id)
    )
    return result.scalar_one_or_none()


async def lock_callback(session: AsyncSession, *, callback_id: uuid.UUID) -> PaymentCallback | None:
    result = await session.execute(
        select(PaymentCallback)
        .where(PaymentCallback.id == callback_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def mark_callback_processed(
    session: AsyncSession, row: PaymentCallback, *, outcome: str, now: datetime
) -> None:
    """The two columns the app role may update on this table."""
    row.processed_at = now
    row.outcome = outcome
    await session.flush()


# ---------------------------------------------------------------------------
# Discount codes (2026-09-18)
# ---------------------------------------------------------------------------
async def insert_discount_code(
    session: AsyncSession,
    *,
    code: str,
    audience: str,
    percent_off: int | None,
    amount_off_minor: int | None,
    valid_from: datetime,
    valid_until: datetime | None,
    usage_limit: int | None,
    label: str | None,
    created_by: uuid.UUID,
) -> DiscountCode | None:
    """None when the code is taken -- the caller says so, or tries another."""
    result = await session.execute(
        pg_insert(DiscountCode)
        .values(
            id=uuid.uuid4(),
            code=code,
            audience=audience,
            percent_off=percent_off,
            amount_off_minor=amount_off_minor,
            valid_from=valid_from,
            valid_until=valid_until,
            usage_limit=usage_limit,
            label=label,
            created_by=created_by,
        )
        .on_conflict_do_nothing(constraint="uq_discount_codes_code")
        .returning(DiscountCode.id)
    )
    code_id = result.scalar_one_or_none()
    return None if code_id is None else await session.get(DiscountCode, code_id)


async def get_discount_code(session: AsyncSession, *, code_id: uuid.UUID) -> DiscountCode | None:
    return await session.get(DiscountCode, code_id)


async def discount_code_by_code(session: AsyncSession, *, code: str) -> DiscountCode | None:
    result = await session.execute(select(DiscountCode).where(DiscountCode.code == code))
    return result.scalar_one_or_none()


async def lock_discount_code_by_code(session: AsyncSession, *, code: str) -> DiscountCode | None:
    """The row, locked: checkouts against one code are serialised, so two
    payers cannot both take its last use."""
    result = await session.execute(
        select(DiscountCode)
        .where(DiscountCode.code == code)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def lock_discount_code(session: AsyncSession, *, code_id: uuid.UUID) -> DiscountCode | None:
    result = await session.execute(
        select(DiscountCode)
        .where(DiscountCode.id == code_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def disable_discount_code(
    session: AsyncSession, *, code: DiscountCode, disabled_by: uuid.UUID, now: datetime
) -> None:
    code.disabled_at = now
    code.disabled_by = disabled_by
    await session.flush()


#: How the console may sort codes and their uses (2026-10-21); the first
#: entry is the default. The admin router's `Literal`s offer these keys.
DISCOUNT_CODE_SORTS: dict[str, SortField] = {
    "created_at": SortField(
        keys=(
            Key("discount_codes.created_at", "timestamptz", "created_at"),
            Key("discount_codes.id", "uuid", "id"),
        ),
        default_order="desc",
    ),
    "code": SortField(
        keys=(Key("discount_codes.code", "text", "code"), Key("discount_codes.id", "uuid", "id")),
        default_order="asc",
    ),
    "valid_until": SortField(
        keys=(
            Key("discount_codes.valid_until", "timestamptz", "valid_until", nullable=True),
            Key("discount_codes.id", "uuid", "id"),
        ),
        default_order="asc",
    ),
}
REDEMPTION_SORTS: dict[str, SortField] = {
    "redeemed_at": SortField(
        keys=(
            Key("discount_redemptions.redeemed_at", "timestamptz", "redeemed_at"),
            Key("discount_redemptions.id", "uuid", "id"),
        ),
        default_order="desc",
    ),
    "amount_minor": SortField(
        keys=(
            Key("discount_redemptions.amount_minor", "integer", "amount_minor"),
            Key("discount_redemptions.id", "uuid", "id"),
        ),
        default_order="desc",
    ),
}

#: `domain.discount_status`, in SQL, so a list can be filtered by it. The
#: same precedence, the same comparisons; an integration test holds the two
#: equal for every status. `:now` is bound, never the database's clock, so the
#: filter and the status shown on each row are one instant.
DISCOUNT_STATUS_SQL = """
    CASE WHEN discount_codes.disabled_at IS NOT NULL THEN 'DISABLED'
         WHEN CAST(:now AS timestamptz) < discount_codes.valid_from THEN 'SCHEDULED'
         WHEN discount_codes.valid_until IS NOT NULL
              AND CAST(:now AS timestamptz) >= discount_codes.valid_until THEN 'EXPIRED'
         WHEN discount_codes.usage_limit IS NOT NULL
              AND (SELECT count(*) FROM discount_redemptions r
                    WHERE r.discount_code_id = discount_codes.id)
                  >= discount_codes.usage_limit THEN 'EXHAUSTED'
         ELSE 'ACTIVE' END
"""


async def list_discount_codes(
    session: AsyncSession,
    *,
    audience: str | None,
    statuses: tuple[str, ...] | None,
    query: str | None,
    created_from: datetime | None,
    created_before: datetime | None,
    now: datetime,
    ordering: Ordering,
    limit: int,
) -> list[DiscountCode]:
    """`query` is part of the code (codes are upper case) or of its label."""
    statement = select(DiscountCode)
    if audience is not None:
        statement = statement.where(DiscountCode.audience == audience)
    if statuses:
        statement = statement.where(
            text(f"({DISCOUNT_STATUS_SQL}) = ANY(CAST(:statuses AS text[]))").bindparams(
                now=now, statuses=list(statuses)
            )
        )
    if query:
        statement = statement.where(
            DiscountCode.code.like(contains(query.upper()), escape="\\")
            | DiscountCode.label.ilike(contains(query), escape="\\")
        )
    if created_from is not None:
        statement = statement.where(DiscountCode.created_at >= created_from)
    if created_before is not None:
        statement = statement.where(DiscountCode.created_at < created_before)
    after, params = ordering.where()
    if params:
        statement = statement.where(text(after).bindparams(**params))
    result = await session.execute(statement.order_by(text(ordering.order_by())).limit(limit))
    return list(result.scalars())


async def redemption_counts(
    session: AsyncSession, *, code_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not code_ids:
        return {}
    result = await session.execute(
        text(
            "SELECT discount_code_id, count(*) AS used FROM discount_redemptions "
            "WHERE discount_code_id = ANY(:ids) GROUP BY discount_code_id"
        ),
        {"ids": code_ids},
    )
    return {row.discount_code_id: int(row.used) for row in result}


async def subscriber_has_redeemed(
    session: AsyncSession, *, code_id: uuid.UUID, subscriber_id: uuid.UUID
) -> bool:
    result = await session.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM discount_redemptions "
            "WHERE discount_code_id = :code AND subscriber_id = :subscriber)"
        ),
        {"code": code_id, "subscriber": subscriber_id},
    )
    return bool(result.scalar())


async def held_checkouts(
    session: AsyncSession,
    *,
    code_id: uuid.UUID,
    since: datetime,
    excluding_payment_id: uuid.UUID | None,
) -> int:
    """Fresh PENDING checkouts carrying this code: uses promised, not yet paid."""
    result = await session.execute(
        text(
            "SELECT count(*) FROM payments "
            "WHERE discount_code_id = :code AND status = 'PENDING' AND created_at >= :since "
            "AND (CAST(:exclude AS uuid) IS NULL OR id <> CAST(:exclude AS uuid))"
        ),
        {"code": code_id, "since": since, "exclude": excluding_payment_id},
    )
    return int(result.scalar() or 0)


async def insert_redemption(session: AsyncSession, *, payment: Payment) -> None:
    """Once per payment. `guard_discount_redemption` checks the payment."""
    assert payment.discount_code_id is not None and payment.list_amount_minor is not None
    assert payment.subscriber_type is not None and payment.subscriber_id is not None
    await session.execute(
        pg_insert(DiscountRedemption)
        .values(
            id=uuid.uuid4(),
            discount_code_id=payment.discount_code_id,
            payment_id=payment.id,
            user_id=payment.user_id,
            subscriber_type=payment.subscriber_type,
            subscriber_id=payment.subscriber_id,
            list_amount_minor=payment.list_amount_minor,
            discount_minor=payment.list_amount_minor - payment.amount_minor,
            amount_minor=payment.amount_minor,
        )
        .on_conflict_do_nothing(constraint="uq_discount_redemptions_payment")
    )


async def list_redemptions(
    session: AsyncSession,
    *,
    code_id: uuid.UUID,
    subscriber_type: str | None,
    payer_email: str | None,
    payer_phone: str | None,
    partial_contact: bool,
    redeemed_from: datetime | None,
    redeemed_before: datetime | None,
    ordering: Ordering,
    limit: int,
) -> list[DiscountRedemption]:
    """`payer_email` (normalised) and `payer_phone` (digits) are the paying
    account's, in part only when `partial_contact`; `users` is not under RLS."""
    query = select(DiscountRedemption).where(DiscountRedemption.discount_code_id == code_id)
    if subscriber_type is not None:
        query = query.where(DiscountRedemption.subscriber_type == subscriber_type)
    if redeemed_from is not None:
        query = query.where(DiscountRedemption.redeemed_at >= redeemed_from)
    if redeemed_before is not None:
        query = query.where(DiscountRedemption.redeemed_at < redeemed_before)
    payer = []
    params: dict[str, Any] = {}
    if payer_email is not None:
        if partial_contact:
            payer.append("u.email LIKE CAST(:payer_email AS text) ESCAPE '\\'")
            params["payer_email"] = contains(payer_email)
        else:
            payer.append("u.email = CAST(:payer_email AS text)")
            params["payer_email"] = payer_email
    if payer_phone is not None:
        if partial_contact:
            payer.append("u.phone LIKE CAST(:payer_phone AS text)")
            params["payer_phone"] = contains(payer_phone)
        else:
            payer.append("u.phone = CAST(:payer_phone AS text)")
            params["payer_phone"] = f"+{payer_phone}"
    if payer:
        query = query.where(
            text(
                "discount_redemptions.user_id IN (SELECT u.id FROM users u WHERE "  # noqa: S608 - constants
                + " AND ".join(payer)
                + ")"
            ).bindparams(**params)
        )
    after, after_params = ordering.where()
    if after_params:
        query = query.where(text(after).bindparams(**after_params))
    result = await session.execute(query.order_by(text(ordering.order_by())).limit(limit))
    return list(result.scalars())
