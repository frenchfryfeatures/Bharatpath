"""Discount codes through HTTP and the database (2026-09-18).

Staff make a code in the console for candidates, employers or colleges; a
payer types it at checkout; the gateway is asked for the discounted amount;
and the code counts as used -- a row in the usage log -- only when that
payment's signed callback is processed. The payments here go through the stub
gateway's real HMAC path (`test_payments.py`), because a use that could be
recorded any other way is not a record of money moving.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _audit_rows, _staff
from tests.integration.test_payments import (
    APP_URL,
    CANDIDATE_SUBSCRIPTION,
    EMPLOYER_SUBSCRIPTION,
    _candidate,
    _owner,
    _settle,
)

pytestmark = pytest.mark.integration

API = "/api/v1"
CODES = f"{API}/admin/discount-codes"


@pytest.fixture(autouse=True)
async def _catalogue() -> None:
    from app.modules.subscriptions import service as subscriptions_service

    async with sessions(_seed_url())() as session, session.begin():
        await subscriptions_service.sync_plans(session)


def _code() -> str:
    return f"T{uuid.uuid4().hex[:10].upper()}"


async def _make(client: Any, admin: dict[str, Any], **terms: Any) -> dict[str, Any]:
    body = {"code": _code(), "audience": "CANDIDATE", "percent_off": 20, **terms}
    created = await client.post(CODES, json=body, headers=admin["headers"])
    assert created.status_code == 201, created.text
    return created.json()


async def _checkout(
    client: Any,
    who: dict[str, Any],
    code: str | None,
    *,
    plan: str = "CANDIDATE_MONTHLY",
    base: str = CANDIDATE_SUBSCRIPTION,
) -> Any:
    body: dict[str, Any] = {"plan_code": plan}
    if code is not None:
        body["discount_code"] = code
    return await client.post(f"{base}/checkout", json=body, headers=who["headers"])


async def _used(client: Any, admin: dict[str, Any], code_id: str) -> int:
    response = await client.get(f"{CODES}/{code_id}", headers=admin["headers"])
    assert response.status_code == 200, response.text
    return int(response.json()["usage_count"])


# ===========================================================================
# The whole path
# ===========================================================================
async def test_a_candidate_pays_the_discounted_price_and_the_use_is_logged_when_it_settles(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    code = await _make(client, admin, percent_off=20, usage_limit=5, label="Launch week")
    assert code["status"] == "ACTIVE" and code["usage_count"] == 0
    assert await _audit_rows("discount_code_created", admin["user_id"], code["id"]) == 1
    me = await _candidate(mint_token)

    preview = await client.post(
        f"{CANDIDATE_SUBSCRIPTION}/checkout/discount-preview",
        json={"plan_code": "CANDIDATE_MONTHLY", "discount_code": code["code"].lower()},
        headers=me["headers"],
    )
    assert preview.status_code == 200, preview.text
    assert preview.json() == {
        "list_amount_minor": 14_900,
        "discount_minor": 2_980,
        "amount_minor": 11_920,
    }

    checkout = await _checkout(client, me, code["code"].lower())
    assert checkout.status_code == 201, checkout.text
    assert checkout.json()["amount_minor"] == 11_920
    assert checkout.json()["list_amount_minor"] == 14_900
    # Checking out is not using: nobody has paid.
    assert await _used(client, admin, code["id"]) == 0

    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"
    current = await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])
    assert current.json()["state"] == "ACTIVE"
    assert await _used(client, admin, code["id"]) == 1

    log = await client.get(f"{CODES}/{code['id']}/redemptions", headers=admin["headers"])
    assert log.status_code == 200, log.text
    [use] = log.json()["items"]
    assert use["user_id"] == str(me["id"]) and use["subscriber_type"] == "USER"
    assert (use["list_amount_minor"], use["discount_minor"], use["amount_minor"]) == (
        14_900,
        2_980,
        11_920,
    )
    assert use["payment_id"] == checkout.json()["payment_id"]

    again = await _checkout(client, me, code["code"])
    assert again.status_code == 422
    assert again.json()["code"] == "discount_code_already_used"


async def test_an_employer_code_takes_a_fixed_amount_off_and_the_log_names_the_organisation(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    code = await _make(
        client, admin, audience="EMPLOYER", percent_off=None, amount_off_minor=100_000
    )
    owner = await _owner(client, mint_token)
    checkout = await _checkout(
        client, owner, code["code"], plan="EMPLOYER_MONTHLY", base=EMPLOYER_SUBSCRIPTION
    )
    assert checkout.status_code == 201, checkout.text
    assert checkout.json()["amount_minor"] == 399_900
    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"

    log = await client.get(f"{CODES}/{code['id']}/redemptions", headers=admin["headers"])
    [use] = log.json()["items"]
    assert use["subscriber_type"] == "TENANT" and use["subscriber_id"] == owner["tenant_id"]
    assert use["organisation"] and use["organisation"].startswith("Billing Test")


async def test_a_checkout_without_a_code_is_unchanged(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    checkout = await _checkout(client, me, None)
    assert checkout.status_code == 201
    assert checkout.json()["amount_minor"] == 14_900
    assert checkout.json()["list_amount_minor"] is None


# ===========================================================================
# 100% codes (client, 2026-10-09)
# ===========================================================================
async def test_a_hundred_percent_code_makes_the_plan_free_at_checkout(
    client: Any, mint_token: Any
) -> None:
    """No gateway order and no callback: the checkout settles, the period
    starts, and the use is logged, all before the response."""
    admin = await _staff(mint_token)
    code = await _make(client, admin, percent_off=100, label="Pilot college batch")
    me = await _candidate(mint_token)

    preview = await client.post(
        f"{CANDIDATE_SUBSCRIPTION}/checkout/discount-preview",
        json={"plan_code": "CANDIDATE_MONTHLY", "discount_code": code["code"]},
        headers=me["headers"],
    )
    assert preview.json() == {
        "list_amount_minor": 14_900,
        "discount_minor": 14_900,
        "amount_minor": 0,
    }

    checkout = await _checkout(client, me, code["code"])
    assert checkout.status_code == 201, checkout.text
    body = checkout.json()
    assert body["status"] == "SUCCEEDED"
    assert (body["amount_minor"], body["list_amount_minor"]) == (0, 14_900)
    assert body["redirect_url"] is None

    payment = await client.get(
        f"{API}/billing/payments/{body['payment_id']}", headers=me["headers"]
    )
    assert payment.json()["status"] == "SUCCEEDED" and payment.json()["settled_at"]
    current = await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])
    assert current.json()["state"] == "ACTIVE"

    assert await _used(client, admin, code["id"]) == 1
    log = await client.get(f"{CODES}/{code['id']}/redemptions", headers=admin["headers"])
    [use] = log.json()["items"]
    assert (use["list_amount_minor"], use["discount_minor"], use["amount_minor"]) == (
        14_900,
        14_900,
        0,
    )
    assert use["payment_id"] == body["payment_id"]

    again = await _checkout(client, me, code["code"])
    assert again.status_code == 422
    assert again.json()["code"] == "discount_code_already_used"


async def test_a_free_code_works_with_no_payment_gateway_configured(
    client: Any, mint_token: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """There is no gateway yet (D3). A free code must not need one; a paid
    checkout still answers 503."""
    from app.modules.billing import service as billing_service
    from app.modules.billing.provider import UnconfiguredPaymentProvider

    admin = await _staff(mint_token)
    code = await _make(
        client, admin, audience="EMPLOYER", percent_off=None, amount_off_minor=499_900
    )
    owner = await _owner(client, mint_token)
    monkeypatch.setattr(billing_service, "get_payment_provider", UnconfiguredPaymentProvider)

    paid = await _checkout(client, owner, None, plan="EMPLOYER_MONTHLY", base=EMPLOYER_SUBSCRIPTION)
    assert paid.status_code == 503
    free = await _checkout(
        client, owner, code["code"], plan="EMPLOYER_MONTHLY", base=EMPLOYER_SUBSCRIPTION
    )
    assert free.status_code == 201, free.text
    assert free.json()["status"] == "SUCCEEDED"
    current = await client.get(EMPLOYER_SUBSCRIPTION, headers=owner["headers"])
    assert current.json()["state"] == "ACTIVE"


async def test_a_free_codes_usage_limit_is_its_last_use(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    code = await _make(client, admin, percent_off=100, usage_limit=1)
    first, second = await _candidate(mint_token), await _candidate(mint_token)
    assert (await _checkout(client, first, code["code"])).json()["status"] == "SUCCEEDED"
    refused = await _checkout(client, second, code["code"])
    assert refused.status_code == 422
    assert refused.json()["code"] == "discount_code_exhausted"


# ===========================================================================
# Refusals
# ===========================================================================
async def test_a_code_for_another_kind_of_account_reads_exactly_like_an_unknown_one(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    for_colleges = await _make(client, admin, audience="COLLEGE")
    me = await _candidate(mint_token)
    wrong = await _checkout(client, me, for_colleges["code"])
    unknown = await _checkout(client, me, _code())
    assert wrong.status_code == unknown.status_code == 422
    assert wrong.json()["code"] == unknown.json()["code"] == "discount_code_invalid"


@pytest.mark.parametrize("amount_off_minor", [14_850, 15_000])
async def test_a_code_that_would_leave_a_few_paise_or_less_than_nothing_is_refused(
    client: Any, mint_token: Any, amount_off_minor: int
) -> None:
    admin = await _staff(mint_token)
    code = await _make(client, admin, percent_off=None, amount_off_minor=amount_off_minor)
    me = await _candidate(mint_token)
    response = await _checkout(client, me, code["code"])
    assert response.status_code == 422
    assert response.json()["code"] == "discount_exceeds_price"


async def test_a_pending_checkout_holds_the_last_use(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    code = await _make(client, admin, usage_limit=1)
    first, second = await _candidate(mint_token), await _candidate(mint_token)

    held = await _checkout(client, first, code["code"])
    assert held.status_code == 201
    # The same payer asking again gets their own checkout back, not a refusal.
    assert (await _checkout(client, first, code["code"])).json()["payment_id"] == (
        held.json()["payment_id"]
    )
    refused = await _checkout(client, second, code["code"])
    assert refused.status_code == 422
    assert refused.json()["code"] == "discount_code_exhausted"

    assert await _settle(client, held.json()["payment_id"]) == "APPLIED"
    listed = await client.get(f"{CODES}/{code['id']}", headers=admin["headers"])
    assert listed.json()["status"] == "EXHAUSTED"


async def test_a_switched_off_code_is_refused_and_switching_off_is_idempotent_and_audited(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    code = await _make(client, admin)
    off = await client.post(f"{CODES}/{code['id']}/disable", headers=admin["headers"])
    assert off.status_code == 200 and off.json()["status"] == "DISABLED"
    again = await client.post(f"{CODES}/{code['id']}/disable", headers=admin["headers"])
    assert again.json()["disabled_at"] == off.json()["disabled_at"]
    assert await _audit_rows("discount_code_disabled", admin["user_id"], code["id"]) == 2

    me = await _candidate(mint_token)
    response = await _checkout(client, me, code["code"])
    assert response.json()["code"] == "discount_code_invalid"


async def test_expired_codes_say_so(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    code = await _make(
        client,
        admin,
        valid_from="2026-01-01T00:00:00Z",
        valid_until="2026-01-31T00:00:00Z",
    )
    assert code["status"] == "EXPIRED"
    me = await _candidate(mint_token)
    response = await _checkout(client, me, code["code"])
    assert response.json()["code"] == "discount_code_expired"


# ===========================================================================
# The console
# ===========================================================================
async def test_the_console_refuses_bad_terms_and_a_chosen_code_that_exists(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    both = await client.post(
        CODES,
        json={"audience": "CANDIDATE", "percent_off": 10, "amount_off_minor": 100},
        headers=admin["headers"],
    )
    assert both.status_code == 422
    over = await client.post(
        CODES, json={"audience": "CANDIDATE", "percent_off": 101}, headers=admin["headers"]
    )
    assert over.status_code == 422

    code = await _make(client, admin)
    taken = await client.post(
        CODES,
        json={"code": code["code"].lower(), "audience": "EMPLOYER", "percent_off": 5},
        headers=admin["headers"],
    )
    assert taken.status_code == 409 and taken.json()["code"] == "discount_code_taken"


async def test_a_generated_code_is_made_when_none_is_chosen_and_listed_with_its_policy(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    created = await client.post(
        CODES, json={"audience": "COLLEGE", "percent_off": 15}, headers=admin["headers"]
    )
    assert created.status_code == 201, created.text
    assert len(created.json()["code"]) == 10

    page = await client.get(CODES, params={"audience": "COLLEGE"}, headers=admin["headers"])
    assert page.status_code == 200
    assert page.json()["policy_version"].startswith("placeholder-")
    assert created.json()["id"] in {item["id"] for item in page.json()["items"]}


async def test_support_reads_codes_and_their_log_but_cannot_make_or_stop_one(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    support = await _staff(mint_token, "SUPPORT_AGENT")
    code = await _make(client, admin)
    assert (
        await client.get(f"{CODES}/{code['id']}", headers=support["headers"])
    ).status_code == 200
    made = await client.post(
        CODES, json={"audience": "CANDIDATE", "percent_off": 5}, headers=support["headers"]
    )
    assert made.status_code == 403
    stopped = await client.post(f"{CODES}/{code['id']}/disable", headers=support["headers"])
    assert stopped.status_code == 403


# ===========================================================================
# Below the service
# ===========================================================================
async def test_the_database_refuses_a_use_that_no_verified_payment_made(
    client: Any, mint_token: Any
) -> None:
    """`guard_discount_redemption`: the migrator, which bypasses RLS and
    holds every grant, still cannot write a use for a payment that has not
    settled."""
    admin = await _staff(mint_token)
    code = await _make(client, admin)
    me = await _candidate(mint_token)
    checkout = await _checkout(client, me, code["code"])
    payment_id = checkout.json()["payment_id"]
    with pytest.raises(DBAPIError, match="DISCOUNT_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text(
                    "INSERT INTO discount_redemptions (id, discount_code_id, payment_id, "
                    "user_id, subscriber_type, subscriber_id, list_amount_minor, "
                    "discount_minor, amount_minor) VALUES (gen_random_uuid(), :c, :p, :u, "
                    "'USER', :u, 14900, 2980, 11920)"
                ),
                {"c": code["id"], "p": payment_id, "u": str(me["id"])},
            )


async def test_a_codes_terms_never_change_and_switching_off_is_a_latch(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    code = await _make(client, admin)
    with pytest.raises(DBAPIError, match="DISCOUNT_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("UPDATE discount_codes SET percent_off = 90 WHERE id = :c"), {"c": code["id"]}
            )
    # The app role cannot even try: it holds UPDATE on the switch-off columns only.
    with pytest.raises(DBAPIError):
        async with sessions(APP_URL)() as session, session.begin():
            await session.execute(
                text("UPDATE discount_codes SET usage_limit = 999 WHERE id = :c"),
                {"c": code["id"]},
            )
    await client.post(f"{CODES}/{code['id']}/disable", headers=admin["headers"])
    with pytest.raises(DBAPIError, match="DISCOUNT_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text(
                    "UPDATE discount_codes SET disabled_at = NULL, disabled_by = NULL WHERE id = :c"
                ),
                {"c": code["id"]},
            )


@pytest.mark.parametrize(
    ("provider", "amount", "with_code"),
    [
        ("stub", 0, True),  # a gateway payment is never zero
        ("complimentary", 0, False),  # a free payment is always a code's
        ("complimentary", 100, True),  # and is always zero
    ],
)
async def test_a_payment_of_zero_is_a_codes_and_nothing_elses(
    client: Any, mint_token: Any, provider: str, amount: int, with_code: bool
) -> None:
    """`ck_payments_complimentary`, for every writer: the migrator cannot
    write a free payment the console did not make a code for."""
    admin = await _staff(mint_token)
    code = await _make(client, admin, percent_off=100)
    me = await _candidate(mint_token)
    with pytest.raises(DBAPIError, match="ck_payments_complimentary"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text(
                    "INSERT INTO payments (id, user_id, provider, provider_ref, amount_minor, "
                    "currency, status, purpose, item_code, item_id, subscriber_type, "
                    "subscriber_id, discount_code_id, list_amount_minor) "
                    "SELECT gen_random_uuid(), :u, :p, gen_random_uuid()::text, :a, 'INR', "
                    "'PENDING', 'SUBSCRIPTION', code, id, 'USER', :u, :c, :l "
                    "FROM plans WHERE code = 'CANDIDATE_MONTHLY' LIMIT 1"
                ),
                {
                    "u": str(me["id"]),
                    "p": provider,
                    "a": amount,
                    "c": code["id"] if with_code else None,
                    "l": 14_900 if with_code else None,
                },
            )


async def test_what_a_discounted_payment_charged_never_changes(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    code = await _make(client, admin)
    me = await _candidate(mint_token)
    payment_id = (await _checkout(client, me, code["code"])).json()["payment_id"]
    with pytest.raises(DBAPIError, match="PAYMENT_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("UPDATE payments SET list_amount_minor = 99999 WHERE id = :p"),
                {"p": payment_id},
            )
