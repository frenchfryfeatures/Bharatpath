"""billing - SQLAlchemy ORM models.

Payments, entitlements, signed callbacks.

**An entitlement is granted only after a verified server-to-server signed
callback** (PRD section 8). Never from a client-side success callback, never
from a redirect parameter. `signature_verified_at` being NULL means the
payment grants nothing, whatever the client said -- and the database holds
that: `ck_payments_settled_only_when_verified` refuses SUCCEEDED without it,
and `guard_payment_write` (baseline migration) refuses a payment inserted as
anything but PENDING.

The raw callback payload is stored verbatim for dispute forensics, in
`payment_callbacks`, which the app role can append to and never rewrite.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import Timestamps, UUIDPrimaryKey
from app.modules.billing.domain import (
    COMPLIMENTARY_PROVIDER,
    DISCOUNT_AUDIENCES,
    MAX_PERCENT_OFF,
    MIN_PERCENT_OFF,
    ONE_OFF_PURPOSES,
    PURPOSES,
)


def _sql_list(values: Iterable[str]) -> str:
    """Generated from the domain, so the constraint and the Literal cannot drift."""
    return ", ".join(f"'{v}'" for v in values)


class Payment(Base, UUIDPrimaryKey, Timestamps):
    """One attempt to take money, from checkout to its verified outcome.

    `user_id` is who paid. For an employer that is the owner who checked out;
    the organisation is `subscriber_id`. Payments are never deleted -- they are
    the financial record the deletion carve-out keeps (blockers B3).
    """

    __tablename__ = "payments"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False)

    #: What was bought: a plan, a course or an interview session, by the id of the exact version
    #: priced at checkout, so a price change between checkout and callback
    #: cannot change what the money bought.
    purpose: Mapped[str] = mapped_column(String(24), nullable=False)
    item_code: Mapped[str] = mapped_column(String(64), nullable=False)
    item_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)

    #: Subscription purposes only: who the period is for.
    subscriber_type: Mapped[str | None] = mapped_column(String(16))
    subscriber_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    #: Mandate debits only: the subscription being renewed.
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("subscriptions.id", ondelete="RESTRICT"), index=True
    )

    #: Where the gateway sends the payer. None for a mandate debit, which has
    #: no payer in the loop.
    checkout_url: Mapped[str | None] = mapped_column(String(512))
    failure_code: Mapped[str | None] = mapped_column(String(64))
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # The gate. NULL means no entitlement is granted, regardless of status.
    signature_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_callback: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    #: A discounted checkout (2026-09-18): the code, and the price before it.
    #: `amount_minor` is what the gateway was asked for. Both are fixed at
    #: checkout like everything else about what was charged, and
    #: `guard_payment_write` holds them.
    discount_code_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("discount_codes.id", ondelete="RESTRICT")
    )
    list_amount_minor: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED')",
            name="ck_payments_status",
        ),
        CheckConstraint("amount_minor >= 0", name="ck_payments_amount_non_negative"),
        CheckConstraint(
            f"purpose IN ({_sql_list(PURPOSES)})",
            name="ck_payments_purpose",
        ),
        CheckConstraint(
            "status NOT IN ('SUCCEEDED', 'REFUNDED') OR signature_verified_at IS NOT NULL",
            name="ck_payments_settled_only_when_verified",
        ),
        CheckConstraint(
            f"purpose IN ({_sql_list(sorted(ONE_OFF_PURPOSES))}) "
            "OR (subscriber_type IN ('USER', 'TENANT') "
            "AND subscriber_id IS NOT NULL)",
            name="ck_payments_subscription_has_subscriber",
        ),
        CheckConstraint(
            "purpose <> 'MANDATE_DEBIT' OR subscription_id IS NOT NULL",
            name="ck_payments_debit_has_subscription",
        ),
        # A code and its list price arrive together, only on a subscription,
        # and the list price is what the code was taken off.
        CheckConstraint(
            "(discount_code_id IS NULL AND list_amount_minor IS NULL) OR "
            "(discount_code_id IS NOT NULL AND purpose = 'SUBSCRIPTION' "
            "AND list_amount_minor > amount_minor)",
            name="ck_payments_discount_shape",
        ),
        # A payment of zero is a discount code's and nothing else's
        # (2026-10-09). It never reached a gateway, so it carries no
        # gateway's name, and a gateway payment is never zero. With the shape
        # above, that makes a free grant reachable only through a code that
        # staff made and the console audited.
        CheckConstraint(
            f"(provider = '{COMPLIMENTARY_PROVIDER}') = (amount_minor = 0) "
            f"AND (provider <> '{COMPLIMENTARY_PROVIDER}' OR discount_code_id IS NOT NULL)",
            name="ck_payments_complimentary",
        ),
        # One order reference lands once.
        UniqueConstraint("provider", "provider_ref", name="uq_payment_provider_ref"),
        Index("ix_payments_user", "user_id", "created_at"),
        Index(
            "ix_payments_pending_checkout",
            "user_id",
            "purpose",
            "item_id",
            postgresql_where="status = 'PENDING'",
        ),
        # The usage-limit hold counts fresh PENDING checkouts per code.
        Index(
            "ix_payments_discount_code",
            "discount_code_id",
            "created_at",
            postgresql_where="discount_code_id IS NOT NULL",
        ),
    )


class PaymentCallback(Base, UUIDPrimaryKey):
    """Every verified callback, verbatim, once.

    **Replay protection is the unique key.** A gateway retries until it gets a
    200, and an attacker who captured a genuine signed body can resend it; the
    second arrival finds `(provider, event_id)` taken and nothing is stored or
    processed twice. A forged callback never reaches this table: the signature
    is checked before anything is written.

    The app role may INSERT and may UPDATE only `processed_at` and `outcome`
    (column grants in the baseline). The payload is evidence, and evidence the
    application could edit would not settle a dispute.
    """

    __tablename__ = "payment_callbacks"

    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    signature_verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str | None] = mapped_column(String(32))

    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_payment_callback_event"),
        CheckConstraint(
            "outcome IS NULL OR outcome IN "
            "('APPLIED', 'DUPLICATE', 'REFUSED', 'UNMATCHED', 'AMOUNT_MISMATCH')",
            name="ck_payment_callbacks_outcome",
        ),
        Index(
            "ix_payment_callbacks_unprocessed",
            "received_at",
            postgresql_where="processed_at IS NULL",
        ),
    )


class Entitlement(Base, UUIDPrimaryKey, Timestamps):
    """What a successful payment bought.

    **Nothing writes this table yet.** Employer database access is NOT an
    entitlement row - it is the subscription window itself - a course is
    `course_purchases`, and a mock interview session is `interview_purchases`,
    each held by its own database guard beside the thing it buys.
    """

    __tablename__ = "entitlements"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    product: Mapped[str] = mapped_column(String(64), nullable=False)
    granted_by_payment_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL")
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        # Consumed entitlements too: the erasure's predicate
        # (`test_index_review.py`). `ix_entitlements_usable` covers only the unconsumed.
        Index("ix_entitlements_user", "user_id"),
        Index(
            "ix_entitlements_usable",
            "user_id",
            "product",
            postgresql_where="consumed_at IS NULL",
        ),
    )


class DiscountCode(Base, UUIDPrimaryKey, Timestamps):
    """A code staff created that takes an amount off a subscription checkout.

    **Created, then only ever switched off.** What it was worth, who it was
    for and when it ran are fixed once it exists -- a code whose terms could
    change after a payer used it would make the redemption log say something
    other than what happened. `guard_discount_code_write` holds that; the
    app role may update `disabled_at`, `disabled_by` and `updated_at` only.

    Its status (ACTIVE, SCHEDULED, EXPIRED, EXHAUSTED, DISABLED) is worked out
    when read (`billing.domain.discount_status`), never stored.
    """

    __tablename__ = "discount_codes"

    code: Mapped[str] = mapped_column(String(32), nullable=False)
    audience: Mapped[str] = mapped_column(String(16), nullable=False)
    percent_off: Mapped[int | None] = mapped_column(Integer)
    amount_off_minor: Mapped[int | None] = mapped_column(Integer)
    valid_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    usage_limit: Mapped[int | None] = mapped_column(Integer)
    #: Staff's own note: the campaign or partner it was made for. Never
    #: shown to a payer.
    label: Mapped[str | None] = mapped_column(String(120))
    created_by: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    disabled_by: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )

    __table_args__ = (
        UniqueConstraint("code", name="uq_discount_codes_code"),
        CheckConstraint(
            f"audience IN ({_sql_list(DISCOUNT_AUDIENCES)})", name="ck_discount_codes_audience"
        ),
        CheckConstraint(
            "code = upper(code) AND length(code) BETWEEN 4 AND 32",
            name="ck_discount_codes_code_normalised",
        ),
        CheckConstraint(
            "(percent_off IS NULL) <> (amount_off_minor IS NULL)",
            name="ck_discount_codes_one_kind",
        ),
        CheckConstraint(
            f"percent_off IS NULL OR percent_off BETWEEN {MIN_PERCENT_OFF} AND {MAX_PERCENT_OFF}",
            name="ck_discount_codes_percent_bounds",
        ),
        CheckConstraint(
            "amount_off_minor IS NULL OR amount_off_minor > 0",
            name="ck_discount_codes_amount_positive",
        ),
        CheckConstraint(
            "usage_limit IS NULL OR usage_limit > 0", name="ck_discount_codes_limit_positive"
        ),
        CheckConstraint(
            "valid_until IS NULL OR valid_until > valid_from",
            name="ck_discount_codes_window",
        ),
        CheckConstraint(
            "(disabled_at IS NULL) = (disabled_by IS NULL)",
            name="ck_discount_codes_disabled_pair",
        ),
        Index("ix_discount_codes_created", "created_at"),
        Index("ix_discount_codes_created_by", "created_by"),
        Index(
            "ix_discount_codes_disabled_by",
            "disabled_by",
            postgresql_where="disabled_by IS NOT NULL",
        ),
    )


class DiscountRedemption(Base, UUIDPrimaryKey):
    """One use of a code: who used it, on which payment, for how much, when.

    **Written when the payment settles, in the same transaction as the grant,
    and never changed** (the app role holds no UPDATE or DELETE). A checkout
    that was never paid is not a use. `guard_discount_redemption` refuses a
    row whose payment is not this code's SUCCEEDED, verified payment -- the
    same shape as `guard_course_purchase`.

    Retained on erasure: it is part of the financial record of what was
    charged (`privacy.domain.ERASURE_PLAN`).
    """

    __tablename__ = "discount_redemptions"

    discount_code_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("discount_codes.id", ondelete="RESTRICT"), nullable=False
    )
    payment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payments.id", ondelete="RESTRICT"), nullable=False
    )
    #: Who paid.
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    #: Who the subscription is for: the person, or their organisation.
    subscriber_type: Mapped[str] = mapped_column(String(16), nullable=False)
    subscriber_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    list_amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    redeemed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("payment_id", name="uq_discount_redemptions_payment"),
        CheckConstraint(
            "subscriber_type IN ('USER', 'TENANT')", name="ck_discount_redemptions_subscriber"
        ),
        CheckConstraint(
            "discount_minor > 0 AND amount_minor >= 0 "
            "AND list_amount_minor = amount_minor + discount_minor",
            name="ck_discount_redemptions_arithmetic",
        ),
        Index("ix_discount_redemptions_code", "discount_code_id", "redeemed_at"),
        Index("ix_discount_redemptions_subscriber", "discount_code_id", "subscriber_id"),
        Index("ix_discount_redemptions_user", "user_id"),
    )
