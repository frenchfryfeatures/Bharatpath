"""billing - business rules and transaction boundaries

Payments, entitlements, signed callbacks.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**The one way an entitlement is granted**, in order:

  1. `checkout_*` opens a PENDING payment and a gateway order, and returns
     where to send the payer. Nothing is granted.
  2. The gateway calls `POST /billing/callbacks/{provider}`. `receive_callback`
     verifies the signature over the raw body **before anything is written**,
     stores the payload verbatim, refuses a replayed event by its id, emits an
     outbox event, and returns -- the gateway gets its 200 at once.
  3. `process_callback`, run by a task, settles the payment and grants what it
     bought: a subscription period, a course, an interview session. Settling sets
     `signature_verified_at`, which the database requires of a SUCCEEDED row.

A client that reports success, a redirect back from the gateway, a payment
id in a URL -- none of those reach step 3 (PRD section 8). The payer polls
`GET /billing/payments/{id}` to learn the outcome.

**Both renewal paths go through here (R17).** Manual renewal is step 1 again.
The mandate path is `register_mandate`, then `advance_renewal` from the sweep:
a pre-debit notice, the wait, the debit, and its callback back through step 3.

**Discount codes (2026-09-18)** change step 1 and nothing after it. A code
lowers what the checkout asks the gateway for, and is recorded on the payment
with the list price; step 3 grants exactly what an undiscounted payment
grants, and writes the redemption beside it. A code is therefore used when
money moves and not before. The policy is `billing.domain`.

**A code that takes the price to zero (client, 2026-10-09)** skips steps 1
and 2: there is no money, so there is no gateway order and no callback to
wait for. `_settle_complimentary` inserts the payment PENDING, as every
payment is, and settles it in the same transaction through `_settle` -- the
code that settles a verified callback -- so the grant, the redemption and
the event are the same rows a paid checkout writes. What stands in for the
gateway's signature is the code: locked, checked against this payer and
counted under that lock, and a zero payment without one is refused by
`ck_payments_complimentary`.
"""

from __future__ import annotations

import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    AppError,
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
)
from app.core.errors import ValidationError as AppValidationError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.core.pagination import clamp_limit, decode_cursor, encode_cursor
from app.core.ratelimit import enforce
from app.core.tenant import TenantContext
from app.modules.billing import events, repository
from app.modules.billing.domain import (
    CHECKOUT_HOLD_MINUTES,
    COMPLIMENTARY_PROVIDER,
    CURRENCY,
    MANDATE_ACTIVATED,
    MANDATE_GONE_FAILURE_CODES,
    PAYMENT_EVENTS,
    PAYMENT_FAILED,
    PAYMENT_SUCCEEDED,
    CallbackEvent,
    DiscountCodeFormatError,
    DiscountPrice,
    DiscountStatus,
    discount_refusal,
    discount_status,
    discounted_price,
    generate_discount_code,
    normalise_discount_code,
    parse_callback,
    payment_step,
    validate_discount_value,
)
from app.modules.billing.models import DiscountCode, DiscountRedemption, Payment, PaymentCallback
from app.modules.billing.provider import (
    PaymentsUnavailableError,
    StubPaymentProvider,
    get_payment_provider,
)
from app.modules.courses import service as courses_service
from app.modules.interview import service as interview_service
from app.modules.subscriptions import service as subscriptions_service
from app.modules.subscriptions.models import UpiMandate
from app.settings import get_settings

logger = get_logger(__name__)

#: A callback bigger than this is not a gateway callback.
MAX_CALLBACK_BYTES: Final = 64 * 1024


class CallbackSignatureInvalidError(UnauthenticatedError):
    code = "callback_signature_invalid"
    title = "Callback signature did not verify"


class CallbackProviderUnknownError(NotFoundError):
    code = "callback_provider_unknown"
    title = "Unknown payment provider"


class CallbackMalformedApiError(AppValidationError):
    code = "callback_malformed"
    title = "Callback could not be read"


class CallbackTooLargeError(AppError):
    status_code = status.HTTP_413_CONTENT_TOO_LARGE
    code = "callback_too_large"
    title = "Callback body too large"


class PaymentNotFoundError(NotFoundError):
    code = "payment_not_found"
    title = "Payment not found"


class DiscountRefusedError(AppError):
    """The code cannot be used on this checkout. `code` is the reason from
    `billing.domain.DiscountRefusal`; nothing about the code itself is said."""

    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "discount_code_invalid"
    title = "This discount code cannot be used"


class DiscountCodeNotFoundError(NotFoundError):
    code = "discount_code_not_found"
    title = "Discount code not found"


class DiscountCodeTakenError(ConflictError):
    code = "discount_code_taken"
    title = "That code already exists"


class DiscountCodeTermsInvalidError(AppValidationError):
    code = "discount_code_terms_invalid"
    title = "The code's terms are not valid"


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


# ---------------------------------------------------------------------------
# Checkout -- step 1
# ---------------------------------------------------------------------------
async def _open_checkout(
    session: AsyncSession,
    *,
    payer_id: uuid.UUID,
    purpose: str,
    item_code: str,
    item_id: uuid.UUID,
    amount_minor: int,
    subscriber_type: str | None,
    subscriber_id: uuid.UUID | None,
    now: datetime,
    discount_code: str | None = None,
    audience: str | None = None,
) -> Payment:
    """A PENDING payment and its gateway order. A second checkout for the same
    item, price and code inside the reuse window returns the first.

    With a code, the code's row is locked for the rest of the transaction, so
    checkouts against it are serialised and its last use is sold once. A
    code that takes the price to zero returns the payment already settled."""
    provider = get_payment_provider()
    await repository.lock_checkout(session, user_id=payer_id, item_id=item_id)
    applied: _AppliedDiscount | None = None
    if discount_code is not None:
        assert subscriber_id is not None and audience is not None  # subscriptions only
        applied = await _apply_discount(
            session,
            raw_code=discount_code,
            audience=audience,
            subscriber_id=subscriber_id,
            payer_id=payer_id,
            purpose=purpose,
            item_id=item_id,
            price_minor=amount_minor,
            provider_name=provider.name,
            now=now,
        )
        amount_minor = applied.price.amount_minor
        if amount_minor == 0:
            return await _settle_complimentary(
                session,
                payer_id=payer_id,
                purpose=purpose,
                item_code=item_code,
                item_id=item_id,
                subscriber_type=subscriber_type,
                subscriber_id=subscriber_id,
                applied=applied,
                now=now,
            )
    existing = await repository.reusable_pending_payment(
        session,
        user_id=payer_id,
        purpose=purpose,
        item_id=item_id,
        amount_minor=amount_minor,
        provider=provider.name,
        since=now - timedelta(minutes=get_settings().payments_checkout_reuse_minutes),
        discount_code_id=applied.code.id if applied else None,
    )
    if existing is not None:
        return existing
    payment_id = uuid.uuid4()
    order = await provider.create_order(
        payment_id=payment_id, amount_minor=amount_minor, currency=CURRENCY
    )
    payment = await repository.insert_payment(
        session,
        payment_id=payment_id,
        user_id=payer_id,
        provider=provider.name,
        provider_ref=order.provider_ref,
        amount_minor=amount_minor,
        purpose=purpose,
        item_code=item_code,
        item_id=item_id,
        subscriber_type=subscriber_type,
        subscriber_id=subscriber_id,
        subscription_id=None,
        checkout_url=order.redirect_url,
        discount_code_id=applied.code.id if applied else None,
        list_amount_minor=applied.price.list_amount_minor if applied else None,
    )
    logger.info(
        "payment_opened",
        purpose=purpose,
        item_code=item_code,
        amount_minor=amount_minor,
        discounted=applied is not None,
    )
    return payment


async def _settle_complimentary(
    session: AsyncSession,
    *,
    payer_id: uuid.UUID,
    purpose: str,
    item_code: str,
    item_id: uuid.UUID,
    subscriber_type: str | None,
    subscriber_id: uuid.UUID | None,
    applied: _AppliedDiscount,
    now: datetime,
) -> Payment:
    """A checkout a code took to zero, settled now. Nothing to send a gateway.

    Called with the code's row still locked by `_apply_discount`, which has
    already refused a code this subscriber used, one used up, and one held
    by someone else's checkout -- the checks a paid checkout passes before
    its callback can settle it. Inserted PENDING like any payment, so
    `guard_payment_write` sees the ordinary transition.
    """
    payment_id = uuid.uuid4()
    payment = await repository.insert_payment(
        session,
        payment_id=payment_id,
        user_id=payer_id,
        provider=COMPLIMENTARY_PROVIDER,
        provider_ref=str(payment_id),
        amount_minor=0,
        purpose=purpose,
        item_code=item_code,
        item_id=item_id,
        subscriber_type=subscriber_type,
        subscriber_id=subscriber_id,
        subscription_id=None,
        checkout_url=None,
        discount_code_id=applied.code.id,
        list_amount_minor=applied.price.list_amount_minor,
    )
    await _settle(
        session,
        payment,
        verified_at=now,
        evidence={"complimentary": True, "discount_code_id": str(applied.code.id)},
        now=now,
    )
    logger.info("payment_complimentary", purpose=purpose, item_code=item_code)
    return payment


def _require_buyer(ctx: TenantContext, subscriber: subscriptions_service.Subscriber) -> None:
    """An organisation's money is its owner's to spend -- a college's admin's.
    Recruiters, viewers and college staff can see the subscription and cannot
    buy, cancel or set up auto-renew."""
    if subscriber.type == "TENANT" and ctx.role not in subscriptions_service.BUYER_ROLES:
        raise PermissionDeniedError()


async def checkout_subscription(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    plan_code: str,
    discount_code: str | None = None,
    now: datetime | None = None,
) -> Payment:
    """Buy a period of a plan: the first one, or a manual renewal -- with a
    discount code, if the payer has one."""
    subscriber = subscriptions_service.subscriber_for(ctx)
    _require_buyer(ctx, subscriber)
    if discount_code is not None:
        await enforce("billing.discount_code", subject=str(ctx.user_id))
    plan = await subscriptions_service.purchasable_plan(
        session, code=plan_code, audience=subscriber.audience
    )
    return await _open_checkout(
        session,
        payer_id=ctx.user_id,
        purpose="SUBSCRIPTION",
        item_code=plan.code,
        item_id=plan.id,
        amount_minor=plan.price_minor,
        subscriber_type=subscriber.type,
        subscriber_id=subscriber.id,
        now=_now(now),
        discount_code=discount_code,
        audience=subscriber.audience,
    )


async def preview_discount(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    plan_code: str,
    discount_code: str,
    now: datetime | None = None,
) -> DiscountPrice:
    """What this payer would pay for this plan with this code. **Writes
    nothing and holds nothing**: the checkout checks again, under the lock,
    and a code can be used up between the two."""
    subscriber = subscriptions_service.subscriber_for(ctx)
    _require_buyer(ctx, subscriber)
    await enforce("billing.discount_code", subject=str(ctx.user_id))
    plan = await subscriptions_service.purchasable_plan(
        session, code=plan_code, audience=subscriber.audience
    )
    applied = await _apply_discount(
        session,
        raw_code=discount_code,
        audience=subscriber.audience,
        subscriber_id=subscriber.id,
        payer_id=ctx.user_id,
        purpose="SUBSCRIPTION",
        item_id=plan.id,
        price_minor=plan.price_minor,
        provider_name=get_payment_provider().name,
        now=_now(now),
        lock=False,
    )
    return applied.price


@dataclass(frozen=True, slots=True)
class _AppliedDiscount:
    code: DiscountCode
    price: DiscountPrice


async def _apply_discount(
    session: AsyncSession,
    *,
    raw_code: str,
    audience: str,
    subscriber_id: uuid.UUID,
    payer_id: uuid.UUID,
    purpose: str,
    item_id: uuid.UUID,
    price_minor: int,
    provider_name: str,
    now: datetime,
    lock: bool = True,
) -> _AppliedDiscount:
    """The code, checked against this checkout, and the price it gives.
    Raises `DiscountRefusedError` with the reason as its code."""
    try:
        code_text = normalise_discount_code(raw_code)
    except DiscountCodeFormatError:
        raise DiscountRefusedError(code="discount_code_invalid") from None
    if lock:
        code = await repository.lock_discount_code_by_code(session, code=code_text)
    else:
        code = await repository.discount_code_by_code(session, code=code_text)
    if code is None:
        raise DiscountRefusedError(code="discount_code_invalid")

    used = (await repository.redemption_counts(session, code_ids=[code.id])).get(code.id, 0)
    # This payer's own reusable checkout with this code is not someone else's
    # hold: asking again must return it, not count it against them.
    own = await repository.reusable_pending_payment(
        session,
        user_id=payer_id,
        purpose=purpose,
        item_id=item_id,
        amount_minor=_net_or_list(price_minor, code),
        provider=provider_name,
        since=now - timedelta(minutes=get_settings().payments_checkout_reuse_minutes),
        discount_code_id=code.id,
    )
    held = await repository.held_checkouts(
        session,
        code_id=code.id,
        since=now - timedelta(minutes=CHECKOUT_HOLD_MINUTES),
        excluding_payment_id=own.id if own else None,
    )
    refusal = discount_refusal(
        status=_status_of(code, used=used, now=now),
        audience_matches=code.audience == audience,
        already_used_by_subscriber=await repository.subscriber_has_redeemed(
            session, code_id=code.id, subscriber_id=subscriber_id
        ),
        held=held,
        usage_limit=code.usage_limit,
        used=used,
    )
    if refusal is not None:
        raise DiscountRefusedError(code=refusal)
    price = discounted_price(
        price_minor, percent_off=code.percent_off, amount_off_minor=code.amount_off_minor
    )
    if price is None:
        raise DiscountRefusedError(code="discount_exceeds_price")
    return _AppliedDiscount(code, price)


def _net_or_list(price_minor: int, code: DiscountCode) -> int:
    price = discounted_price(
        price_minor, percent_off=code.percent_off, amount_off_minor=code.amount_off_minor
    )
    return price.amount_minor if price is not None else price_minor


def _status_of(code: DiscountCode, *, used: int, now: datetime) -> DiscountStatus:
    return discount_status(
        disabled=code.disabled_at is not None,
        valid_from=code.valid_from,
        valid_until=code.valid_until,
        usage_limit=code.usage_limit,
        used=used,
        now=now,
    )


async def checkout_course(
    session: AsyncSession, *, user_id: uuid.UUID, course_id: uuid.UUID, now: datetime | None = None
) -> Payment:
    course = await courses_service.purchasable_course(session, user_id=user_id, course_id=course_id)
    return await _open_checkout(
        session,
        payer_id=user_id,
        purpose="COURSE",
        item_code=course.code,
        item_id=course.id,
        amount_minor=course.price_minor,
        subscriber_type=None,
        subscriber_id=None,
        now=_now(now),
    )


async def checkout_interview_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    acknowledge_no_score_increase: bool,
    now: datetime | None = None,
) -> Payment:
    """One mock interview session. `interview.service.checkout_terms` refuses
    before any payment exists -- no passed device check, or a session that
    cannot move the score and was not acknowledged -- and what the candidate
    was told is written beside the payment in the same transaction."""
    now = _now(now)
    terms = await interview_service.checkout_terms(
        session,
        user_id=user_id,
        acknowledge_no_score_increase=acknowledge_no_score_increase,
        now=now,
    )
    payment = await _open_checkout(
        session,
        payer_id=user_id,
        purpose="INTERVIEW_SESSION",
        item_code=terms.product.code,
        item_id=terms.product.id,
        amount_minor=terms.product.price_minor,
        subscriber_type=None,
        subscriber_id=None,
        now=now,
    )
    await interview_service.record_checkout_notice(
        session, payment_id=payment.id, user_id=user_id, terms=terms
    )
    return payment


async def payment_for_payer(
    session: AsyncSession, *, user_id: uuid.UUID, payment_id: uuid.UUID
) -> Payment:
    """Someone else's payment is a 404, not a 403."""
    payment = await repository.get_payment(session, payment_id=payment_id)
    if payment is None or payment.user_id != user_id:
        raise PaymentNotFoundError()
    return payment


# ---------------------------------------------------------------------------
# Callbacks -- steps 2 and 3
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CallbackReceipt:
    callback_id: uuid.UUID | None
    duplicate: bool


async def receive_callback(
    session: AsyncSession,
    *,
    provider_name: str,
    body: bytes,
    signature: str | None,
    now: datetime | None = None,
) -> CallbackReceipt:
    """Verify, store, enqueue. **Grants nothing.**

    The signature is checked first, against the raw bytes, before the body is
    parsed or anything is written: a forged callback costs us one HMAC and
    leaves no row. A replay of a genuine one is answered 200 -- the gateway
    must stop retrying -- and changes nothing.
    """
    if len(body) > MAX_CALLBACK_BYTES:
        raise CallbackTooLargeError()
    provider = get_payment_provider()
    if not provider.verify_signature(body=body, signature=signature):
        logger.warning("payment_callback_signature_invalid", provider=provider_name[:32])
        raise CallbackSignatureInvalidError()
    if provider_name != provider.name:
        raise CallbackProviderUnknownError()
    try:
        payload = json.loads(body)
        event = parse_callback(payload)
    except ValueError as exc:
        logger.error("payment_callback_malformed", provider=provider.name, error=str(exc))
        raise CallbackMalformedApiError() from exc

    callback_id = await repository.insert_callback(
        session,
        provider=provider.name,
        event_id=event.event_id,
        event_type=event.event_type,
        payload=payload,
        verified_at=_now(now),
    )
    if callback_id is None:
        logger.info("payment_callback_replayed", event_type=event.event_type)
        return CallbackReceipt(None, duplicate=True)
    await emit(
        session,
        event_type=events.CALLBACK_RECEIVED,
        aggregate_type="payment_callback",
        aggregate_id=callback_id,
        payload={"callback_id": str(callback_id), "event_type": event.event_type},
    )
    return CallbackReceipt(callback_id, duplicate=False)


async def process_callback(
    session: AsyncSession, *, callback_id: uuid.UUID, now: datetime | None = None
) -> str:
    """Apply one stored callback. Idempotent: a processed callback returns its
    recorded outcome and does nothing."""
    now = _now(now)
    row = await repository.lock_callback(session, callback_id=callback_id)
    if row is None:
        return "UNMATCHED"
    if row.processed_at is not None:
        return row.outcome or "DUPLICATE"
    event = parse_callback(row.payload)  # verified and parsed once already
    if event.event_type in PAYMENT_EVENTS:
        outcome = await _apply_payment_event(session, row, event, now)
    elif event.event_type == MANDATE_ACTIVATED:
        outcome = await subscriptions_service.activate_mandate(
            session, provider_mandate_ref=event.mandate_ref or "", now=now
        )
    else:
        outcome = await subscriptions_service.mandate_revoked_by_payer(
            session, provider_mandate_ref=event.mandate_ref or "", now=now
        )
    await repository.mark_callback_processed(session, row, outcome=outcome, now=now)
    logger.info("payment_callback_processed", event_type=event.event_type, outcome=outcome)
    return outcome


async def _apply_payment_event(
    session: AsyncSession, row: PaymentCallback, event: CallbackEvent, now: datetime
) -> str:
    payment = await repository.lock_payment_by_ref(
        session, provider=row.provider, provider_ref=event.provider_ref or ""
    )
    if payment is None:
        logger.warning("payment_callback_unmatched", event_type=event.event_type)
        return "UNMATCHED"
    step = payment_step(payment.status, event.event_type)
    if step == "DUPLICATE":
        return "DUPLICATE"
    if step == "REFUSE":
        logger.warning(
            "payment_callback_refused", status=payment.status, event_type=event.event_type
        )
        return "REFUSED"

    if event.event_type == PAYMENT_SUCCEEDED:
        if event.amount_minor != payment.amount_minor or event.currency != payment.currency:
            # Signed by the gateway and still wrong: an order edited at the
            # gateway, or a bug on one side. Money moved, so a human settles
            # it; granting on it would sell a plan at whatever price arrived.
            logger.error(
                "payment_callback_amount_mismatch",
                payment_id=str(payment.id),
                expected=payment.amount_minor,
                received=event.amount_minor,
            )
            return "AMOUNT_MISMATCH"
        await _settle(
            session,
            payment,
            verified_at=row.signature_verified_at,
            evidence=row.payload,
            now=now,
        )
        return "APPLIED"

    assert event.event_type == PAYMENT_FAILED
    payment.status = "FAILED"
    payment.failure_code = event.failure_code or "UNSPECIFIED"
    payment.raw_callback = row.payload
    await session.flush()
    if payment.purpose == "MANDATE_DEBIT":
        await subscriptions_service.record_debit_failure(
            session,
            payment_id=payment.id,
            failure_code=payment.failure_code,
            mandate_gone=payment.failure_code in MANDATE_GONE_FAILURE_CODES,
            now=now,
        )
    await emit(
        session,
        event_type=events.PAYMENT_FAILED,
        aggregate_type="payment",
        aggregate_id=payment.id,
        payload={
            "payment_id": str(payment.id),
            "user_id": str(payment.user_id),
            "purpose": payment.purpose,
            "failure_code": payment.failure_code,
        },
    )
    return "APPLIED"


async def _settle(
    session: AsyncSession,
    payment: Payment,
    *,
    verified_at: datetime,
    evidence: dict[str, Any],
    now: datetime,
) -> None:
    """SUCCEEDED, granted, the code's use recorded, and the event -- in one
    transaction. Called by a verified callback (`_apply_payment_event`) and by
    a complimentary checkout (`_settle_complimentary`), and nothing else."""
    payment.status = "SUCCEEDED"
    payment.signature_verified_at = verified_at
    payment.raw_callback = evidence
    payment.settled_at = now
    payment.failure_code = None
    await session.flush()
    await _grant(session, payment, now)
    if payment.discount_code_id is not None:
        # The code is used now, when the payment settled, and in the
        # transaction that granted what it paid for.
        await repository.insert_redemption(session, payment=payment)
    await emit(
        session,
        event_type=events.PAYMENT_SUCCEEDED,
        aggregate_type="payment",
        aggregate_id=payment.id,
        payload={
            "payment_id": str(payment.id),
            "user_id": str(payment.user_id),
            "purpose": payment.purpose,
            "item_code": payment.item_code,
        },
    )


async def _grant(session: AsyncSession, payment: Payment, now: datetime) -> None:
    """What a settled payment bought. Only ever called from `_settle`."""
    if payment.purpose == "COURSE":
        await courses_service.record_purchase(
            session, user_id=payment.user_id, course_id=payment.item_id, payment_id=payment.id
        )
        return
    if payment.purpose == "INTERVIEW_SESSION":
        await interview_service.record_purchase(
            session, user_id=payment.user_id, product_id=payment.item_id, payment_id=payment.id
        )
        return
    if payment.purpose == "MANDATE_DEBIT" and payment.subscription_id is not None:
        await subscriptions_service.apply_mandate_renewal(
            session,
            subscription_id=payment.subscription_id,
            plan_id=payment.item_id,
            payment_id=payment.id,
            now=now,
        )
        return
    if payment.purpose == "SUBSCRIPTION" and payment.subscriber_id is not None:
        await subscriptions_service.apply_purchase(
            session,
            subscriber_type=payment.subscriber_type or "",
            subscriber_id=payment.subscriber_id,
            plan_id=payment.item_id,
            payment_id=payment.id,
            now=now,
        )
        return
    raise RuntimeError(f"payment {payment.id} has nothing to grant")  # pragma: no cover


# ---------------------------------------------------------------------------
# Cancellation and the mandate path
# ---------------------------------------------------------------------------
async def cancel_subscription(
    session: AsyncSession, *, ctx: TenantContext, now: datetime | None = None
) -> None:
    """Stop renewing at the end of the period. The gateway is told in the
    same transaction; if it refuses, nothing is cancelled and the caller can
    retry."""
    subscriber = subscriptions_service.subscriber_for(ctx)
    _require_buyer(ctx, subscriber)
    refs = await subscriptions_service.cancel_at_period_end(
        session, subscriber=subscriber, now=_now(now)
    )
    provider = get_payment_provider()
    for ref in refs:
        await provider.revoke_mandate(mandate_ref=ref)


@dataclass(frozen=True, slots=True)
class MandateRegistration:
    mandate: UpiMandate
    authorisation_url: str


async def register_mandate(
    session: AsyncSession, *, ctx: TenantContext, now: datetime | None = None
) -> MandateRegistration:
    """Start UPI AutoPay for the live subscription. PENDING until the payer
    approves it in their UPI app and the gateway's callback says so."""
    now = _now(now)
    subscriber = subscriptions_service.subscriber_for(ctx)
    _require_buyer(ctx, subscriber)
    policy = await subscriptions_service.load_policy(session, now=now)
    target = await subscriptions_service.mandate_target(
        session, subscriber=subscriber, policy=policy, now=now
    )
    valid_until = now + timedelta(days=policy.mandate_validity_days)
    provider = get_payment_provider()
    registered = await provider.register_mandate(
        subscription_id=target.subscription_id,
        max_amount_minor=target.ceiling_minor,
        valid_until=valid_until,
    )
    mandate = await subscriptions_service.record_mandate(
        session,
        subscription_id=target.subscription_id,
        registered_by=ctx.user_id,
        provider_mandate_ref=registered.provider_mandate_ref,
        max_amount_minor=target.ceiling_minor,
        valid_until=valid_until,
    )
    return MandateRegistration(mandate, registered.authorisation_url)


async def advance_renewal(
    session: AsyncSession, *, subscription_id: uuid.UUID, now: datetime
) -> str:
    """Take the next step in renewing one subscription by mandate. Returns the
    step taken. One subscription per transaction (`app/tasks/subscription_renewals.py`)."""
    step = await subscriptions_service.next_renewal_step(
        session, subscription_id=subscription_id, now=now
    )
    if step is None:
        return "NONE"
    action = step.action
    provider = get_payment_provider()

    if action.kind == "SEND_NOTICE" and step.mandate_ref is not None:
        debit_not_before = now + timedelta(hours=step.policy.pre_debit_notice_hours)
        notice_ref = await provider.notify_pre_debit(
            mandate_ref=step.mandate_ref, amount_minor=step.price_minor, debit_on=debit_not_before
        )
        written = await subscriptions_service.record_notice(
            session,
            step=step,
            provider_notice_ref=notice_ref,
            now=now,
            debit_not_before=debit_not_before,
        )
        return "SEND_NOTICE" if written else "NONE"

    if (
        action.kind == "REQUEST_DEBIT"
        and step.notice_id is not None
        and step.mandate_ref is not None
        and step.registered_by is not None
        and step.notice_amount_minor is not None
    ):
        # The amount the payer was told, never a price changed since.
        payment_id = uuid.uuid4()
        debit_ref = await provider.request_mandate_debit(
            mandate_ref=step.mandate_ref,
            payment_id=payment_id,
            amount_minor=step.notice_amount_minor,
        )
        await repository.insert_payment(
            session,
            payment_id=payment_id,
            user_id=step.registered_by,
            provider=provider.name,
            provider_ref=debit_ref,
            amount_minor=step.notice_amount_minor,
            purpose="MANDATE_DEBIT",
            item_code=step.plan_code,
            item_id=step.plan_id,
            subscriber_type=step.subscriber_type,
            subscriber_id=step.subscriber_id,
            subscription_id=step.subscription_id,
            checkout_url=None,
        )
        await subscriptions_service.mark_debit_requested(
            session, notice_id=step.notice_id, payment_id=payment_id
        )
        return "REQUEST_DEBIT"

    if action.kind == "FALL_BACK":
        refs = await subscriptions_service.fall_back_to_manual(
            session, subscription_id=subscription_id, reason=action.reason, now=now
        )
        for ref in refs:
            await provider.revoke_mandate(mandate_ref=ref)
        return "FALL_BACK"
    return "NONE"


async def close_period(
    session: AsyncSession, *, subscription_id: uuid.UUID, now: datetime
) -> str | None:
    """Record the end of a period, revoking at the gateway any mandate the
    ended tenure leaves behind."""
    closed = await subscriptions_service.close_period(
        session, subscription_id=subscription_id, now=now
    )
    if closed is None:
        return None
    provider = get_payment_provider()
    for ref in closed.revoke_refs:
        await provider.revoke_mandate(mandate_ref=ref)
    return closed.to_state


# ---------------------------------------------------------------------------
# Local development only
# ---------------------------------------------------------------------------
async def simulate_callback(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    payment_id: uuid.UUID,
    succeed: bool,
    failure_code: str | None,
    now: datetime | None = None,
) -> Payment:
    """Have the stub gateway call back about the caller's own payment.

    **Not a bypass**: it builds the callback the stub gateway would send, signs
    it, and runs it through `receive_callback` and `process_callback` exactly
    as a real one. It exists so the app teams can finish a checkout with no
    gateway, and only while the stub is configured, which `Settings` refuses
    outside local and dev.
    """
    provider = get_payment_provider()
    if not isinstance(provider, StubPaymentProvider):
        raise PaymentsUnavailableError()
    payment = await payment_for_payer(session, user_id=user_id, payment_id=payment_id)
    body, signature = provider.signed_event(
        {
            "event_id": f"sim_{uuid.uuid4().hex}",
            "event": PAYMENT_SUCCEEDED if succeed else PAYMENT_FAILED,
            "payment": {
                "provider_ref": payment.provider_ref,
                "amount_minor": payment.amount_minor,
                "currency": payment.currency,
                "failure_code": None if succeed else (failure_code or "PAYMENT_DECLINED"),
            },
        }
    )
    receipt = await receive_callback(
        session, provider_name=provider.name, body=body, signature=signature, now=now
    )
    if receipt.callback_id is not None:
        await process_callback(session, callback_id=receipt.callback_id, now=now)
    await session.refresh(payment)
    return payment


# ---------------------------------------------------------------------------
# Discount codes -- the console's half (2026-09-18)
# ---------------------------------------------------------------------------
# The console (`admin.service`) decides who may press the button and writes
# the audit row; the rules about what a code is live here, beside the
# checkout that spends it.


@dataclass(frozen=True, slots=True)
class DiscountCodeView:
    code: DiscountCode
    used: int
    status: str


async def create_discount_code(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
    code: str | None,
    audience: str,
    percent_off: int | None,
    amount_off_minor: int | None,
    valid_from: datetime | None,
    valid_until: datetime | None,
    usage_limit: int | None,
    label: str | None,
    now: datetime | None = None,
) -> DiscountCodeView:
    """Make a code. With `code` None one is generated; a generated code that
    collides is regenerated, a chosen one that collides is refused."""
    now = _now(now)
    try:
        validate_discount_value(percent_off=percent_off, amount_off_minor=amount_off_minor)
        chosen = normalise_discount_code(code) if code is not None else None
    except ValueError as exc:
        raise DiscountCodeTermsInvalidError(params={"reason": str(exc)}) from exc
    starts = valid_from or now
    if valid_until is not None and valid_until <= starts:
        raise DiscountCodeTermsInvalidError(params={"reason": "valid_until must follow valid_from"})

    for _ in range(5):
        text_code = chosen or generate_discount_code(secrets.token_bytes(16))
        row = await repository.insert_discount_code(
            session,
            code=text_code,
            audience=audience,
            percent_off=percent_off,
            amount_off_minor=amount_off_minor,
            valid_from=starts,
            valid_until=valid_until,
            usage_limit=usage_limit,
            label=label.strip() if label and label.strip() else None,
            created_by=created_by,
        )
        if row is not None:
            logger.info("discount_code_created", discount_code_id=str(row.id), audience=audience)
            return DiscountCodeView(row, 0, _status_of(row, used=0, now=now))
        if chosen is not None:
            raise DiscountCodeTakenError()
    raise RuntimeError("five generated discount codes collided")  # pragma: no cover


async def disable_discount_code(
    session: AsyncSession,
    *,
    code_id: uuid.UUID,
    disabled_by: uuid.UUID,
    now: datetime | None = None,
) -> DiscountCodeView:
    """Switch a code off, for good. Idempotent: a code already off is
    returned as it is. Payments already made with it are untouched."""
    now = _now(now)
    row = await repository.lock_discount_code(session, code_id=code_id)
    if row is None:
        raise DiscountCodeNotFoundError()
    if row.disabled_at is None:
        await repository.disable_discount_code(session, code=row, disabled_by=disabled_by, now=now)
    return await _view(session, row, now)


async def get_discount_code(
    session: AsyncSession, *, code_id: uuid.UUID, now: datetime | None = None
) -> DiscountCodeView:
    row = await repository.get_discount_code(session, code_id=code_id)
    if row is None:
        raise DiscountCodeNotFoundError()
    return await _view(session, row, _now(now))


async def list_discount_codes(
    session: AsyncSession,
    *,
    audience: str | None,
    cursor: str | None,
    limit: int | None,
    now: datetime | None = None,
) -> tuple[list[DiscountCodeView], str | None]:
    """Newest first."""
    now = _now(now)
    size = clamp_limit(limit)
    rows = await repository.list_discount_codes(
        session, audience=audience, after=_keyset(cursor), limit=size
    )
    counts = await repository.redemption_counts(session, code_ids=[r.id for r in rows])
    views = [
        DiscountCodeView(r, counts.get(r.id, 0), _status_of(r, used=counts.get(r.id, 0), now=now))
        for r in rows
    ]
    next_cursor = (
        encode_cursor({"t": rows[-1].created_at.isoformat(), "i": str(rows[-1].id)})
        if len(rows) == size
        else None
    )
    return views, next_cursor


async def list_redemptions(
    session: AsyncSession, *, code_id: uuid.UUID, cursor: str | None, limit: int | None
) -> tuple[list[DiscountRedemption], str | None]:
    """Who used a code, newest first -- the usage log."""
    if await repository.get_discount_code(session, code_id=code_id) is None:
        raise DiscountCodeNotFoundError()
    size = clamp_limit(limit)
    rows = await repository.list_redemptions(
        session, code_id=code_id, after=_keyset(cursor), limit=size
    )
    next_cursor = (
        encode_cursor({"t": rows[-1].redeemed_at.isoformat(), "i": str(rows[-1].id)})
        if len(rows) == size
        else None
    )
    return rows, next_cursor


async def _view(session: AsyncSession, row: DiscountCode, now: datetime) -> DiscountCodeView:
    used = (await repository.redemption_counts(session, code_ids=[row.id])).get(row.id, 0)
    return DiscountCodeView(row, used, _status_of(row, used=used, now=now))


def _keyset(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    payload = decode_cursor(cursor)
    try:
        return datetime.fromisoformat(str(payload["t"])), uuid.UUID(str(payload["i"]))
    except (KeyError, ValueError, TypeError) as exc:
        raise AppValidationError(code="invalid_cursor") from exc
