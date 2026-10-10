"""billing - Pydantic request/response DTOs

Payments, entitlements, signed callbacks.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**No schema here carries the callback payload or a gateway reference.** The
payload is evidence for a dispute, read by staff; the reference is the handle
a forged callback would need.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.core.schemas import ApiSchema


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class PaymentResponse(_Base):
    id: uuid.UUID
    status: Literal["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"] = Field(
        description="PENDING until the gateway's signed callback has been processed. "
        "Poll this; a redirect back from the gateway says nothing."
    )
    purpose: Literal["SUBSCRIPTION", "COURSE", "INTERVIEW_SESSION", "MANDATE_DEBIT"]
    item_code: str
    amount_minor: int = Field(ge=0, description="Paise.")
    list_amount_minor: int | None = Field(
        default=None, description="The price before a discount code; null without one."
    )
    currency: str
    failure_code: str | None = None
    created_at: datetime
    settled_at: datetime | None = None


class CheckoutResponse(_Base):
    payment_id: uuid.UUID
    status: str
    amount_minor: int = Field(ge=0, description="Paise.")
    list_amount_minor: int | None = Field(
        default=None, description="The price before a discount code; null without one."
    )
    currency: str
    redirect_url: str | None = Field(
        description="Where to send the payer to pay. Null when a discount code made the "
        "checkout free: `status` is then already SUCCEEDED and there is nothing to pay."
    )

    @classmethod
    def of(cls, payment: Any) -> CheckoutResponse:
        return cls(
            payment_id=payment.id,
            status=payment.status,
            amount_minor=payment.amount_minor,
            list_amount_minor=payment.list_amount_minor,
            currency=payment.currency,
            redirect_url=payment.checkout_url,
        )


class CallbackAck(_Base):
    received: bool
    duplicate: bool = Field(description="True when this event had already been received.")


class SimulatePaymentRequest(_Base):
    outcome: Literal["SUCCEEDED", "FAILED"]
    failure_code: str | None = Field(default=None, max_length=64)
