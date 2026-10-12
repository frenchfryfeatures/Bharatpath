"""billing - pure domain logic

Payments, entitlements, signed callbacks.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**Three rules live here, and each has a twin below the service:**

  1. **A callback counts only if its signature verifies** (`signature_matches`).
     The gateway signs the raw body with a secret we share; a browser redirect,
     a query parameter or a JSON body without that signature is somebody's
     claim that they paid, and grants nothing (PRD section 8).
  2. **A payment moves along `PAYMENT_TRANSITIONS` and nowhere else.** The same
     set is compiled into `guard_payment_write` in the baseline migration, as
     `allowed_transitions()` is for the hiring pipeline, so the two cannot drift.
  3. **A verified success is never taken back by a later failure.** Gateways
     deliver out of order; UPI in particular reports a late success after a
     timeout was reported as a failure. So FAILED -> SUCCEEDED is allowed and
     SUCCEEDED -> FAILED is not.
"""

from __future__ import annotations

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime
from typing import Final, Literal

Purpose = Literal["SUBSCRIPTION", "COURSE", "INTERVIEW_SESSION", "MANDATE_DEBIT"]

#: What a payment can be for. Compiled into `ck_payments_purpose`.
PURPOSES: Final[tuple[Purpose, ...]] = (
    "SUBSCRIPTION",
    "COURSE",
    "INTERVIEW_SESSION",
    "MANDATE_DEBIT",
)

#: Purposes bought by one person for themselves: no subscriber on the payment.
ONE_OFF_PURPOSES: Final[frozenset[Purpose]] = frozenset({"COURSE", "INTERVIEW_SESSION"})

#: Paise, always. No other currency is sold.
CURRENCY: Final = "INR"

#: `from -> to` for `payments.status`. Compiled into the database guard.
PAYMENT_TRANSITIONS: Final[frozenset[tuple[str, str]]] = frozenset(
    {
        ("PENDING", "SUCCEEDED"),
        ("PENDING", "FAILED"),
        # A late success after a reported failure. UPI does this.
        ("FAILED", "SUCCEEDED"),
        # No refund flow is built: the refund policy is the client's decision.
        # The transition exists so recording one later is not a migration.
        ("SUCCEEDED", "REFUNDED"),
    }
)

#: The four callbacks a gateway sends us.
PAYMENT_SUCCEEDED: Final = "payment.succeeded"
PAYMENT_FAILED: Final = "payment.failed"
MANDATE_ACTIVATED: Final = "mandate.activated"
MANDATE_REVOKED: Final = "mandate.revoked"
PAYMENT_EVENTS: Final = frozenset({PAYMENT_SUCCEEDED, PAYMENT_FAILED})
MANDATE_EVENTS: Final = frozenset({MANDATE_ACTIVATED, MANDATE_REVOKED})

#: Debit failures that mean the mandate itself is gone, not that this debit
#: failed. **A payer can revoke a mandate inside their own UPI app and nobody
#: tells us**; the first we hear of it is one of these on the next debit. They
#: move the mandate to REVOKED_UNKNOWN and the subscriber back to manual
#: renewal, rather than being retried until access lapses.
MANDATE_GONE_FAILURE_CODES: Final = frozenset(
    {"MANDATE_REVOKED", "MANDATE_NOT_FOUND", "MANDATE_EXPIRED", "MANDATE_PAUSED"}
)

#: `X-Payment-Signature: sha256=<hex>`, HMAC-SHA256 over the raw request body.
SIGNATURE_SCHEME: Final = "sha256="

MAX_EVENT_ID_LENGTH: Final = 128
MAX_REF_LENGTH: Final = 128
MAX_FAILURE_CODE_LENGTH: Final = 64

#: What processing a callback did. Stored on the callback row.
CallbackOutcome = Literal["APPLIED", "DUPLICATE", "REFUSED", "UNMATCHED", "AMOUNT_MISMATCH"]


class CallbackMalformedError(ValueError):
    """A signed callback we cannot read. The gateway changed its format, or
    we did; either way nothing is granted from it."""


def sign(secret: bytes, body: bytes) -> str:
    """The signature header value for `body`."""
    return SIGNATURE_SCHEME + hmac.new(secret, body, hashlib.sha256).hexdigest()


def signature_matches(secret: bytes, body: bytes, header: str | None) -> bool:
    """Constant-time. An empty secret verifies nothing, rather than everything
    signed with an empty key."""
    if not secret or not header:
        return False
    expected = sign(secret, body).encode()
    return hmac.compare_digest(expected, header.strip().encode("utf-8", "replace"))


@dataclass(frozen=True, slots=True)
class CallbackEvent:
    event_id: str
    event_type: str
    provider_ref: str | None = None
    amount_minor: int | None = None
    currency: str | None = None
    failure_code: str | None = None
    mandate_ref: str | None = None


def _text(value: object, *, field: str, max_length: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > max_length:
        raise CallbackMalformedError(f"{field} must be a non-empty string of at most {max_length}")
    return value


def parse_callback(payload: object) -> CallbackEvent:
    """Read a verified callback body. Raises `CallbackMalformedError`.

    Strict on purpose: a field we do not recognise the shape of is a field we
    would otherwise guess at, and the guess would decide whether someone paid.
    """
    if not isinstance(payload, dict):
        raise CallbackMalformedError("callback body must be a JSON object")
    event_id = _text(payload.get("event_id"), field="event_id", max_length=MAX_EVENT_ID_LENGTH)
    event_type = payload.get("event")
    if event_type in PAYMENT_EVENTS:
        payment = payload.get("payment")
        if not isinstance(payment, dict):
            raise CallbackMalformedError("payment events carry a payment object")
        amount = payment.get("amount_minor")
        if not isinstance(amount, int) or isinstance(amount, bool) or amount < 0:
            raise CallbackMalformedError("amount_minor must be a non-negative integer")
        currency = _text(payment.get("currency"), field="currency", max_length=3)
        failure = payment.get("failure_code")
        if failure is not None:
            failure = _text(failure, field="failure_code", max_length=MAX_FAILURE_CODE_LENGTH)
        return CallbackEvent(
            event_id=event_id,
            event_type=str(event_type),
            provider_ref=_text(
                payment.get("provider_ref"), field="provider_ref", max_length=MAX_REF_LENGTH
            ),
            amount_minor=amount,
            currency=currency,
            failure_code=failure,
        )
    if event_type in MANDATE_EVENTS:
        mandate = payload.get("mandate")
        if not isinstance(mandate, dict):
            raise CallbackMalformedError("mandate events carry a mandate object")
        return CallbackEvent(
            event_id=event_id,
            event_type=str(event_type),
            mandate_ref=_text(
                mandate.get("provider_mandate_ref"),
                field="provider_mandate_ref",
                max_length=MAX_REF_LENGTH,
            ),
        )
    raise CallbackMalformedError("unknown callback event")


PaymentStep = Literal["APPLY", "DUPLICATE", "REFUSE"]


def payment_step(current_status: str, event_type: str) -> PaymentStep:
    """What a payment callback does to a payment in `current_status`.

    DUPLICATE for a status it already has -- a second success for a settled
    payment grants nothing twice. REFUSE for anything off the transition
    graph, the one that matters being a failure arriving after a success.
    """
    target = "SUCCEEDED" if event_type == PAYMENT_SUCCEEDED else "FAILED"
    if current_status == target:
        return "DUPLICATE"
    if (current_status, target) in PAYMENT_TRANSITIONS:
        return "APPLY"
    return "REFUSE"


# ---------------------------------------------------------------------------
# Discount codes (2026-09-18, "Signup_Login_Discussion_Updates")
# ---------------------------------------------------------------------------
# A code takes an amount off a **first purchase of a subscription**. Staff
# create it in the console for one kind of account -- a candidate, an
# employer or a college -- and every use is a row in `discount_redemptions`,
# written when the payment settles and never before: a code applied to a
# checkout nobody paid for was not used.
#
# **Three questions went to the client on 2026-09-18; one is answered.**
# Until the other two are, the policy below is partly ours, conservative,
# and named `placeholder-` in a string a test asserts on, so it cannot
# quietly become the product:
#
#   1. *A 100% code?* **Yes -- the client's answer, 2026-10-09.** A
#      percentage is 1-100, and a fixed amount may take the price to exactly
#      zero. A checkout that comes to zero has nothing to send to a gateway,
#      so it is settled on the spot as a COMPLIMENTARY payment
#      (`billing.service._settle_complimentary`) and granted through the
#      same `_settle` a verified callback uses. Between zero and
#      `MIN_NET_AMOUNT_MINOR` is still refused: a gateway order for 50 paise
#      is a fee, not a price.
#   2. *Renewals?* No. Only checkout reads a code; a manual renewal is a
#      checkout, so it may carry a new code, but a mandate debit never does.
#   3. *Reuse?* One redemption per code per subscriber -- the person for a
#      candidate, the organisation for an employer or a college.
#
# Questions 2 and 3 are still ours, so the version keeps its prefix.

DISCOUNT_POLICY_VERSION: Final = "placeholder-2-2026-10-09"

DiscountAudience = Literal["CANDIDATE", "EMPLOYER", "COLLEGE"]
DISCOUNT_AUDIENCES: Final[tuple[DiscountAudience, ...]] = ("CANDIDATE", "EMPLOYER", "COLLEGE")

#: The least a discounted payment that goes to a gateway may be. Zero is
#: allowed and settled without one; anything between is refused.
MIN_NET_AMOUNT_MINOR: Final = 100
MIN_PERCENT_OFF: Final = 1
MAX_PERCENT_OFF: Final = 100
ONE_REDEMPTION_PER_SUBSCRIBER: Final = True

#: The `payments.provider` of a checkout a code took to zero. No gateway was
#: involved, so no gateway's name may be written: `ck_payments_complimentary`
#: holds that this provider and a zero amount come together, and only on a
#: discounted subscription.
COMPLIMENTARY_PROVIDER: Final = "complimentary"

#: Minutes a PENDING discounted checkout counts against a usage limit.
#: Without a hold, ten people can check out against the last use of a code;
#: without an end to it, an abandoned checkout would use the code up forever.
CHECKOUT_HOLD_MINUTES: Final = 30

#: Readable aloud and typed from a poster: no 0/O, 1/I/L.
CODE_ALPHABET: Final = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
GENERATED_CODE_LENGTH: Final = 10
MIN_CODE_LENGTH: Final = 4
MAX_CODE_LENGTH: Final = 32
_CODE_CHARACTERS: Final = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")

DiscountStatus = Literal["ACTIVE", "SCHEDULED", "EXPIRED", "EXHAUSTED", "DISABLED"]
DISCOUNT_STATUSES: Final[tuple[DiscountStatus, ...]] = (
    "ACTIVE",
    "SCHEDULED",
    "EXPIRED",
    "EXHAUSTED",
    "DISABLED",
)

#: Why a code cannot be used by this checkout. One code for everything that
#: is about the code's existence or fit -- unknown, disabled, not started, or
#: meant for another kind of account -- so the form is not a way to learn
#: which codes exist.
DiscountRefusal = Literal[
    "discount_code_invalid",
    "discount_code_expired",
    "discount_code_exhausted",
    "discount_code_already_used",
    "discount_exceeds_price",
]


class DiscountCodeFormatError(ValueError):
    """A code staff typed that could not be printed, read out or typed back."""


def normalise_discount_code(raw: str) -> str:
    """Upper case, no surrounding space. A payer types `launch50`; the
    code is `LAUNCH50`, and both find it."""
    code = raw.strip().upper()
    if not MIN_CODE_LENGTH <= len(code) <= MAX_CODE_LENGTH:
        raise DiscountCodeFormatError(
            f"a code is {MIN_CODE_LENGTH} to {MAX_CODE_LENGTH} characters"
        )
    if not set(code) <= _CODE_CHARACTERS or code.startswith("-") or code.endswith("-"):
        raise DiscountCodeFormatError("a code is letters, digits and inner hyphens")
    return code


def generate_discount_code(entropy: bytes, *, length: int = GENERATED_CODE_LENGTH) -> str:
    """A code from `entropy` (the caller's `secrets.token_bytes`), one
    character per byte. Pure, so a test can pin the output."""
    if len(entropy) < length:
        raise ValueError(f"need {length} bytes of entropy, got {len(entropy)}")
    return "".join(CODE_ALPHABET[b % len(CODE_ALPHABET)] for b in entropy[:length])


def validate_discount_value(*, percent_off: int | None, amount_off_minor: int | None) -> None:
    """Exactly one of the two, each inside its bounds. Raises `ValueError`."""
    if (percent_off is None) == (amount_off_minor is None):
        raise ValueError("a code takes either a percentage or a fixed amount off, not both")
    if percent_off is not None and not MIN_PERCENT_OFF <= percent_off <= MAX_PERCENT_OFF:
        raise ValueError(f"a percentage is {MIN_PERCENT_OFF} to {MAX_PERCENT_OFF}")
    if amount_off_minor is not None and amount_off_minor < 1:
        raise ValueError("a fixed amount off is at least one paisa")


@dataclass(frozen=True, slots=True)
class DiscountPrice:
    list_amount_minor: int
    discount_minor: int
    amount_minor: int


def discounted_price(
    price_minor: int, *, percent_off: int | None, amount_off_minor: int | None
) -> DiscountPrice | None:
    """What a payer pays with this code, or None when the code would take the
    price below zero, or above zero but below `MIN_NET_AMOUNT_MINOR`.
    Exactly zero is a complimentary checkout (client, 2026-10-09).

    A percentage rounds the discount **down** to the paisa, so the payer is
    never charged less than the stated percentage allows by a rounding
    choice we made.
    """
    validate_discount_value(percent_off=percent_off, amount_off_minor=amount_off_minor)
    if percent_off is not None:
        discount = price_minor * percent_off // 100
    else:
        discount = amount_off_minor or 0
    net = price_minor - discount
    if net < 0 or 0 < net < MIN_NET_AMOUNT_MINOR:
        return None
    return DiscountPrice(price_minor, discount, net)


def discount_status(
    *,
    disabled: bool,
    valid_from: datetime,
    valid_until: datetime | None,
    usage_limit: int | None,
    used: int,
    now: datetime,
) -> DiscountStatus:
    """Worked out when read, never stored, so it cannot go stale. The order
    is what staff need to see first: a code someone switched off reads
    DISABLED even after it would have expired."""
    if disabled:
        return "DISABLED"
    if now < valid_from:
        return "SCHEDULED"
    if valid_until is not None and now >= valid_until:
        return "EXPIRED"
    if usage_limit is not None and used >= usage_limit:
        return "EXHAUSTED"
    return "ACTIVE"


def discount_refusal(
    *,
    status: DiscountStatus,
    audience_matches: bool,
    already_used_by_subscriber: bool,
    held: int,
    usage_limit: int | None,
    used: int,
) -> DiscountRefusal | None:
    """Whether this subscriber may use this code on this checkout.

    `held` is the fresh PENDING checkouts already carrying the code (other
    than this subscriber's reusable one); they count against the limit so
    the last use cannot be sold twice.
    """
    if status in ("DISABLED", "SCHEDULED") or not audience_matches:
        return "discount_code_invalid"
    if status == "EXPIRED":
        return "discount_code_expired"
    if status == "EXHAUSTED" or (usage_limit is not None and used + held >= usage_limit):
        return "discount_code_exhausted"
    if ONE_REDEMPTION_PER_SUBSCRIBER and already_used_by_subscriber:
        return "discount_code_already_used"
    return None
