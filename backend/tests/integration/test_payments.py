"""Day 15 through HTTP and the database: payments, subscriptions, courses.

**The Week 3 gate's two payment clauses live here.** A forged payment callback
grants nothing; a subscription that lapses stops granting access without
deleting history.

The gateway is the stub, which signs callbacks with a real HMAC. A test that
forges a callback signs with the wrong key, or not at all, and goes through
exactly the route and verification a real gateway's callback would.

Callbacks are processed by calling the service a task would call, because the
outbox relay has no broker behind it yet (Day 19). The renewal sweep's steps
take an injected `now`, so a month is crossed without waiting one.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError, ProgrammingError

from app.modules.billing import service as billing_service
from app.modules.billing.provider import StubPaymentProvider, get_payment_provider
from app.modules.courses import service as courses_service
from app.modules.courses.domain import CourseProgress
from app.modules.scoring import service as scoring_service
from app.modules.subscriptions import service as subscriptions_service
from app.modules.subscriptions.domain import add_months
from tests.conftest import _clear_membership_cache, _seed_url, sessions

pytestmark = pytest.mark.integration

API = "/api/v1"
APP_URL = os.environ.get("DATABASE_URL_APP") or os.environ["DATABASE_URL"]
CANDIDATE_SUBSCRIPTION = f"{API}/candidate/subscription"
EMPLOYER_SUBSCRIPTION = f"{API}/employer/subscription"
CALLBACK = f"{API}/billing/callbacks/stub"
COMPLETE = CourseProgress(lessons_total=6, lessons_completed=6)


@pytest.fixture(autouse=True)
async def _catalogue() -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await subscriptions_service.sync_plans(session)


# --- people ---------------------------------------------------------------------
async def _candidate(mint_token: Any) -> dict[str, Any]:
    user_id, subject = uuid.uuid4(), f"local-test-{uuid.uuid4()}"
    phone = f"+9195{uuid.uuid4().int % 10**8:08d}"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, cognito_sub, pool, phone, status, locale) "
                "VALUES (:u, :s, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "s": subject, "p": phone},
        )
    headers, _ = mint_token(pool="CANDIDATE", subject=subject, phone=phone)
    return {"id": user_id, "headers": headers}


async def _owner(client: Any, mint_token: Any) -> dict[str, Any]:
    """An employer owner whose organisation has not paid."""
    from tests.integration.test_jobs import _set_kyb

    headers, _ = mint_token(pool="BUSINESS", email=f"{uuid.uuid4().hex[:12]}@example.test")
    created = await client.post(
        f"{API}/employer/organisation",
        json={"legal_name": f"Billing Test {uuid.uuid4().hex[:6]} Pvt Ltd"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    await _set_kyb(created.json()["tenant_id"], "APPROVED")
    return {"headers": headers, "tenant_id": created.json()["tenant_id"]}


async def _recruiter(mint_token: Any, tenant_id: str) -> dict[str, Any]:
    user_id, subject = uuid.uuid4(), f"local-test-{uuid.uuid4()}"
    email = f"{uuid.uuid4().hex[:12]}@example.test"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, cognito_sub, pool, email, status, locale) "
                "VALUES (:u, :s, 'BUSINESS', :e, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "s": subject, "e": email},
        )
        await session.execute(
            text(
                "INSERT INTO memberships (id, user_id, tenant_id, role, status) "
                "VALUES (gen_random_uuid(), :u, :t, 'EMPLOYER_RECRUITER', 'ACTIVE')"
            ),
            {"u": str(user_id), "t": tenant_id},
        )
    await _clear_membership_cache(user_id)
    headers, _ = mint_token(pool="BUSINESS", subject=subject, email=email)
    return {"headers": headers}


# --- the gateway ------------------------------------------------------------------
def _stub() -> StubPaymentProvider:
    provider = get_payment_provider()
    assert isinstance(provider, StubPaymentProvider)
    return provider


async def _payment_row(payment_id: str) -> dict[str, Any]:
    async with sessions(_seed_url())() as session:
        row = (
            (await session.execute(text("SELECT * FROM payments WHERE id = :p"), {"p": payment_id}))
            .mappings()
            .one()
        )
    return dict(row)


async def _payment_event(
    payment_id: str,
    event: str = "payment.succeeded",
    *,
    amount_minor: int | None = None,
    failure_code: str | None = None,
    event_id: str | None = None,
) -> dict[str, Any]:
    row = await _payment_row(payment_id)
    return {
        "event_id": event_id or f"evt_{uuid.uuid4().hex}",
        "event": event,
        "payment": {
            "provider_ref": row["provider_ref"],
            "amount_minor": row["amount_minor"] if amount_minor is None else amount_minor,
            "currency": "INR",
            "failure_code": failure_code,
        },
    }


def _mandate_event(ref: str, event: str = "mandate.activated") -> dict[str, Any]:
    return {
        "event_id": f"evt_{uuid.uuid4().hex}",
        "event": event,
        "mandate": {"provider_mandate_ref": ref},
    }


async def _post_callback(client: Any, event: dict[str, Any]) -> Any:
    body, signature = _stub().signed_event(event)
    return await client.post(
        CALLBACK,
        content=body,
        headers={"X-Payment-Signature": signature, "Content-Type": "application/json"},
    )


async def _process(event_id: str, now: datetime | None = None) -> str:
    """What the `billing.process_callback` task does, for one stored callback."""
    async with sessions(_seed_url())() as session:
        callback_id = await session.scalar(
            text("SELECT id FROM payment_callbacks WHERE provider = 'stub' AND event_id = :e"),
            {"e": event_id},
        )
    assert callback_id is not None, "callback was not stored"
    async with sessions(APP_URL)() as session, session.begin():
        return await billing_service.process_callback(session, callback_id=callback_id, now=now)


async def _settle(
    client: Any, payment_id: str, *, now: datetime | None = None, **event: Any
) -> str:
    """Post a signed callback about a payment and process it."""
    body = await _payment_event(payment_id, **event)
    response = await _post_callback(client, body)
    assert response.status_code == 200, response.text
    return await _process(body["event_id"], now)


async def _checkout(
    client: Any, who: dict[str, Any], plan_code: str, base: str = CANDIDATE_SUBSCRIPTION
) -> Any:
    return await client.post(
        f"{base}/checkout", json={"plan_code": plan_code}, headers=who["headers"]
    )


async def _subscribe_through_the_api(
    client: Any,
    who: dict[str, Any],
    plan_code: str = "CANDIDATE_MONTHLY",
    base: str = CANDIDATE_SUBSCRIPTION,
) -> dict[str, Any]:
    checkout = await _checkout(client, who, plan_code, base)
    assert checkout.status_code == 201, checkout.text
    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"
    current = await client.get(base, headers=who["headers"])
    assert current.json()["state"] == "ACTIVE", current.text
    return current.json()


async def _subscription(subscriber_id: Any) -> dict[str, Any]:
    async with sessions(_seed_url())() as session:
        row = (
            (
                await session.execute(
                    text(
                        "SELECT * FROM subscriptions WHERE subscriber_id = :s "
                        "ORDER BY created_at DESC LIMIT 1"
                    ),
                    {"s": str(subscriber_id)},
                )
            )
            .mappings()
            .one()
        )
    return dict(row)


async def _reasons(subscription_id: Any) -> list[str]:
    async with sessions(_seed_url())() as session:
        rows = await session.execute(
            text(
                "SELECT reason FROM subscription_events WHERE subscription_id = :s "
                "ORDER BY occurred_at, id"
            ),
            {"s": str(subscription_id)},
        )
        return [r[0] for r in rows]


async def _scalar(sql: str, **params: Any) -> Any:
    async with sessions(_seed_url())() as session:
        return await session.scalar(text(sql), {k: str(v) for k, v in params.items()})


async def _end_period(subscription_id: Any) -> datetime:
    """Move a period into the past, as time passing would."""
    async with sessions(_seed_url())() as session, session.begin():
        end = await session.scalar(
            text(
                "UPDATE subscriptions SET current_period_start = now() - interval '40 days', "
                "current_period_end = now() - interval '1 second', "
                "cancel_at = CASE WHEN cancel_at IS NULL THEN NULL "
                "ELSE now() - interval '1 second' END "
                "WHERE id = :s RETURNING current_period_end"
            ),
            {"s": str(subscription_id)},
        )
    return end


# ===========================================================================
# The gate: nothing is granted without a verified, processed callback
# ===========================================================================
async def test_a_checkout_grants_nothing_until_a_signed_callback_is_processed(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    assert (await client.get(f"{API}/candidate/score/me", headers=me["headers"])).status_code == 402

    before = await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])
    assert before.json() == {**before.json(), "state": "NONE", "has_access": False}
    plans = await client.get(f"{CANDIDATE_SUBSCRIPTION}/plans", headers=me["headers"])
    codes = {p["code"] for p in plans.json()}
    assert {"CANDIDATE_MONTHLY", "CANDIDATE_ANNUAL"} <= codes
    # Other tests seed plans of their own, so the rule is the audience, not the code.
    assert {p["audience"] for p in plans.json()} == {"CANDIDATE"}

    checkout = await _checkout(client, me, "CANDIDATE_MONTHLY")
    assert checkout.status_code == 201, checkout.text
    payment_id = checkout.json()["payment_id"]
    assert checkout.json()["status"] == "PENDING"
    assert checkout.json()["amount_minor"] == 14_900
    assert checkout.json()["redirect_url"].startswith("https://")

    event = await _payment_event(payment_id)
    received = await _post_callback(client, event)
    assert received.status_code == 200 and received.json() == {"received": True, "duplicate": False}

    # Stored, acknowledged -- and still nothing granted until it is processed.
    assert (await client.get(f"{API}/candidate/score/me", headers=me["headers"])).status_code == 402
    assert (await client.get(f"{API}/billing/payments/{payment_id}", headers=me["headers"])).json()[
        "status"
    ] == "PENDING"

    assert await _process(event["event_id"]) == "APPLIED"

    after = await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])
    assert after.json()["state"] == "ACTIVE" and after.json()["has_access"] is True
    assert after.json()["plan_code"] == "CANDIDATE_MONTHLY"
    assert (await client.get(f"{API}/candidate/score/me", headers=me["headers"])).status_code == 200

    payment = await _payment_row(payment_id)
    assert payment["status"] == "SUCCEEDED"
    assert payment["signature_verified_at"] is not None and payment["settled_at"] is not None
    assert payment["raw_callback"] == event
    subscription = await _subscription(me["id"])
    assert await _reasons(subscription["id"]) == ["purchased"]
    assert (
        await _scalar(
            "SELECT payment_id FROM subscription_events WHERE subscription_id = :s",
            s=subscription["id"],
        )
    ) == uuid.UUID(payment_id)


@pytest.mark.parametrize("forgery", ["unsigned", "wrong_key", "tampered_body", "other_body"])
async def test_a_forged_callback_grants_nothing_and_leaves_no_trace(
    client: Any, mint_token: Any, forgery: str
) -> None:
    """**Week 3 gate.** A callback the gateway did not sign is a 401 before
    anything is read or written."""
    from app.modules.billing.domain import sign

    me = await _candidate(mint_token)
    payment_id = (await _checkout(client, me, "CANDIDATE_ANNUAL")).json()["payment_id"]
    event = await _payment_event(payment_id)
    body, signature = _stub().signed_event(event)
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if forgery == "wrong_key":
        headers["X-Payment-Signature"] = sign(b"not-the-gateway", body)
    elif forgery == "tampered_body":
        headers["X-Payment-Signature"] = signature
        body = body.replace(b'"amount_minor":119900', b'"amount_minor":100')
    elif forgery == "other_body":
        _other, other_signature = _stub().signed_event({**event, "event_id": "evt_other"})
        headers["X-Payment-Signature"] = other_signature

    response = await client.post(CALLBACK, content=body, headers=headers)
    assert response.status_code == 401, response.text
    assert response.json()["code"] == "callback_signature_invalid"

    assert (
        await _scalar(
            "SELECT count(*) FROM payment_callbacks WHERE event_id = :e", e=event["event_id"]
        )
        == 0
    )
    assert (await _payment_row(payment_id))["status"] == "PENDING"
    current = await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])
    assert current.json()["state"] == "NONE" and current.json()["has_access"] is False


async def test_a_callback_for_another_provider_name_is_not_accepted(client: Any) -> None:
    body, signature = _stub().signed_event(
        {"event_id": "e", "event": "mandate.revoked", "mandate": {"provider_mandate_ref": "x"}}
    )
    response = await client.post(
        f"{API}/billing/callbacks/razorpay",
        content=body,
        headers={"X-Payment-Signature": signature},
    )
    assert response.status_code == 404


async def test_a_replayed_callback_is_acknowledged_and_changes_nothing(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    payment_id = (await _checkout(client, me, "CANDIDATE_MONTHLY")).json()["payment_id"]
    event = await _payment_event(payment_id)

    assert (await _post_callback(client, event)).json()["duplicate"] is False
    assert (await _post_callback(client, event)).json()["duplicate"] is True
    assert await _process(event["event_id"]) == "APPLIED"
    assert await _process(event["event_id"]) == "APPLIED"  # its recorded outcome, not a re-run
    assert (await _post_callback(client, event)).json()["duplicate"] is True
    end = (await _subscription(me["id"]))["current_period_end"]

    # A second, genuinely different success for the same payment grants nothing twice.
    assert await _settle(client, payment_id) == "DUPLICATE"

    assert (
        await _scalar(
            "SELECT count(*) FROM payment_callbacks WHERE event_id = :e", e=event["event_id"]
        )
        == 1
    )
    subscription = await _subscription(me["id"])
    assert subscription["current_period_end"] == end
    assert await _reasons(subscription["id"]) == ["purchased"]


async def test_a_signed_callback_for_the_wrong_amount_grants_nothing(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    payment_id = (await _checkout(client, me, "CANDIDATE_ANNUAL")).json()["payment_id"]
    assert await _settle(client, payment_id, amount_minor=100) == "AMOUNT_MISMATCH"
    assert (await _payment_row(payment_id))["status"] == "PENDING"
    assert (await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])).json()[
        "has_access"
    ] is False


async def test_a_late_success_after_a_failure_counts_and_a_late_failure_after_a_success_does_not(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    payment_id = (await _checkout(client, me, "CANDIDATE_MONTHLY")).json()["payment_id"]

    assert (
        await _settle(client, payment_id, event="payment.failed", failure_code="TIMEOUT")
        == "APPLIED"
    )
    failed = (
        await client.get(f"{API}/billing/payments/{payment_id}", headers=me["headers"])
    ).json()
    assert (failed["status"], failed["failure_code"]) == ("FAILED", "TIMEOUT")
    assert (await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])).json()[
        "has_access"
    ] is False

    assert await _settle(client, payment_id) == "APPLIED"
    assert (await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])).json()[
        "has_access"
    ] is True

    assert (
        await _settle(client, payment_id, event="payment.failed", failure_code="LATE") == "REFUSED"
    )
    assert (await _payment_row(payment_id))["status"] == "SUCCEEDED"


async def test_the_database_refuses_to_settle_or_rewrite_a_payment(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    payment_id = (await _checkout(client, me, "CANDIDATE_MONTHLY")).json()["payment_id"]
    refusals = {
        "UPDATE payments SET status = 'SUCCEEDED' WHERE id = :p": (
            "ck_payments_settled_only_when_verified"
        ),
        "UPDATE payments SET amount_minor = 1 WHERE id = :p": "PAYMENT_GUARD",
        "UPDATE payments SET status = 'REFUNDED', signature_verified_at = now() "
        "WHERE id = :p": "PAYMENT_GUARD",
        "DELETE FROM payments WHERE id = :p": "permission denied",
    }
    for statement, expected in refusals.items():
        async with sessions(APP_URL)() as session, session.begin():
            with pytest.raises((IntegrityError, ProgrammingError, DBAPIError)) as exc:
                await session.execute(text(statement), {"p": payment_id})
        assert expected.lower() in str(exc.value).lower(), statement

    async with sessions(APP_URL)() as session, session.begin():
        with pytest.raises((IntegrityError, DBAPIError)) as exc:
            await session.execute(
                text(
                    "INSERT INTO payments (id, user_id, provider, provider_ref, amount_minor, "
                    "currency, status, purpose, item_code, item_id, subscriber_type, "
                    "subscriber_id, signature_verified_at) VALUES (gen_random_uuid(), :u, "
                    "'stub', :r, 14900, 'INR', 'SUCCEEDED', 'SUBSCRIPTION', 'X', "
                    "gen_random_uuid(), 'USER', :u, now())"
                ),
                {"u": str(me["id"]), "r": uuid.uuid4().hex},
            )
    assert "PAYMENT_GUARD" in str(exc.value)

    # A stored callback is evidence: processed, yes; rewritten, never.
    assert await _settle(client, payment_id) == "APPLIED"
    async with sessions(APP_URL)() as session, session.begin():
        with pytest.raises((ProgrammingError, DBAPIError)) as exc:
            await session.execute(text("UPDATE payment_callbacks SET payload = '{}'::jsonb"))
    assert "permission denied" in str(exc.value).lower()


async def test_a_double_checkout_is_one_payment_and_another_persons_payment_is_a_404(
    client: Any, mint_token: Any
) -> None:
    me, someone = await _candidate(mint_token), await _candidate(mint_token)
    first = await _checkout(client, me, "CANDIDATE_QUARTERLY")
    second = await _checkout(client, me, "CANDIDATE_QUARTERLY")
    assert first.json()["payment_id"] == second.json()["payment_id"]

    response = await client.get(
        f"{API}/billing/payments/{first.json()['payment_id']}", headers=someone["headers"]
    )
    assert response.status_code == 404 and response.json()["code"] == "payment_not_found"
    wrong_audience = await _checkout(client, me, "EMPLOYER_MONTHLY")
    assert wrong_audience.status_code == 404 and wrong_audience.json()["code"] == "plan_not_found"


async def test_the_stub_gateway_can_settle_your_own_payment_through_the_real_path(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    payment_id = (await _checkout(client, me, "CANDIDATE_MONTHLY")).json()["payment_id"]
    simulated = await client.post(
        f"{API}/billing/dev/payments/{payment_id}/simulate",
        json={"outcome": "SUCCEEDED"},
        headers=me["headers"],
    )
    assert simulated.status_code == 200, simulated.text
    assert simulated.json()["status"] == "SUCCEEDED"
    assert (
        await _scalar(
            "SELECT count(*) FROM payment_callbacks WHERE payload->'payment'->>'provider_ref' = :r",
            r=(await _payment_row(payment_id))["provider_ref"],
        )
        == 1
    )
    assert (await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])).json()[
        "has_access"
    ] is True


# ===========================================================================
# Periods: repurchase, cancellation, lapse
# ===========================================================================
async def test_renewing_early_extends_from_the_end_of_the_paid_period(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    first = await _subscribe_through_the_api(client, me)
    renewed = await _subscribe_through_the_api(client, me, "CANDIDATE_QUARTERLY")

    assert renewed["current_period_start"] == first["current_period_start"]
    subscription = await _subscription(me["id"])
    first_end = datetime.fromisoformat(first["current_period_end"])
    assert subscription["current_period_end"] == add_months(first_end, 3)
    assert renewed["plan_code"] == "CANDIDATE_QUARTERLY"
    assert await _reasons(subscription["id"]) == ["purchased", "extended"]


async def test_cancelling_keeps_access_to_the_end_then_ends_it_and_deletes_nothing(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    await _subscribe_through_the_api(client, me)

    cancelled = await client.post(f"{CANDIDATE_SUBSCRIPTION}/cancel", headers=me["headers"])
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["cancel_at"] == cancelled.json()["current_period_end"]
    assert cancelled.json()["has_access"] is True
    assert (
        await client.post(f"{CANDIDATE_SUBSCRIPTION}/cancel", headers=me["headers"])
    ).status_code == 200

    subscription = await _subscription(me["id"])
    await _end_period(subscription["id"])
    # The clock decides: access is gone before any sweep has run.
    assert (await client.get(f"{API}/candidate/score/me", headers=me["headers"])).status_code == 402

    async with sessions(APP_URL)() as session, session.begin():
        assert (
            await billing_service.close_period(
                session, subscription_id=subscription["id"], now=datetime.now(UTC)
            )
            == "CANCELLED"
        )

    after = await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])
    assert after.json()["state"] == "CANCELLED" and after.json()["has_access"] is False
    assert await _reasons(subscription["id"]) == ["purchased", "cancel_requested", "cancelled"]
    assert await _scalar("SELECT count(*) FROM payments WHERE user_id = :u", u=me["id"]) == 1


async def test_a_lapsed_subscriber_loses_access_not_history_and_buying_again_opens_a_new_tenure(
    client: Any, mint_token: Any
) -> None:
    """**Week 3 gate.**"""
    me = await _candidate(mint_token)
    await _subscribe_through_the_api(client, me)
    old = await _subscription(me["id"])
    await _end_period(old["id"])

    from app.tasks.subscription_renewals import sweep

    counts = await sweep(now=datetime.now(UTC))
    assert counts["failed"] == 0 and counts["closed"] >= 1

    lapsed = await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])
    assert lapsed.json()["state"] == "LAPSED" and lapsed.json()["has_access"] is False
    assert (await client.get(f"{API}/candidate/score/me", headers=me["headers"])).status_code == 402
    assert await _reasons(old["id"]) == ["purchased", "lapsed"]

    await _subscribe_through_the_api(client, me)
    new = await _subscription(me["id"])
    assert new["id"] != old["id"] and await _reasons(new["id"]) == ["purchased"]
    assert await _scalar("SELECT state FROM subscriptions WHERE id = :s", s=old["id"]) == "LAPSED"


async def test_an_organisation_subscribes_and_only_its_owner_can_spend(
    client: Any, mint_token: Any
) -> None:
    from tests.integration.test_candidate_marketplace import JOB

    owner = await _owner(client, mint_token)
    recruiter = await _recruiter(mint_token, owner["tenant_id"])
    candidate = await _candidate(mint_token)

    # Unpaid: the subscription surface is open, the product is not.
    assert (await client.get(EMPLOYER_SUBSCRIPTION, headers=owner["headers"])).json()[
        "state"
    ] == "NONE"
    assert (
        await client.post(f"{API}/employer/jobs", json=JOB, headers=owner["headers"])
    ).status_code == 402
    plans = await client.get(f"{EMPLOYER_SUBSCRIPTION}/plans", headers=recruiter["headers"])
    assert {p["audience"] for p in plans.json()} == {"EMPLOYER"}

    refused = await _checkout(client, recruiter, "EMPLOYER_MONTHLY", EMPLOYER_SUBSCRIPTION)
    assert refused.status_code == 403
    assert (
        await client.get(EMPLOYER_SUBSCRIPTION, headers=candidate["headers"])
    ).status_code == 403
    assert (
        await _checkout(client, owner, "CANDIDATE_MONTHLY", EMPLOYER_SUBSCRIPTION)
    ).status_code == 404

    await _subscribe_through_the_api(client, owner, "EMPLOYER_MONTHLY", EMPLOYER_SUBSCRIPTION)
    seen = await client.get(EMPLOYER_SUBSCRIPTION, headers=recruiter["headers"])
    assert seen.json()["has_access"] is True
    assert (
        await client.post(f"{API}/employer/jobs", json=JOB, headers=owner["headers"])
    ).status_code == 201
    subscription = await _subscription(owner["tenant_id"])
    assert subscription["subscriber_type"] == "TENANT"

    assert (
        await client.post(f"{EMPLOYER_SUBSCRIPTION}/cancel", headers=recruiter["headers"])
    ).status_code == 403
    mandate = await client.post(f"{EMPLOYER_SUBSCRIPTION}/mandate", headers=owner["headers"])
    assert mandate.status_code == 201, mandate.text  # monthly is under the mandate limit


async def test_a_plan_over_the_mandate_limit_cannot_renew_automatically(
    client: Any, mint_token: Any
) -> None:
    owner = await _owner(client, mint_token)
    await _subscribe_through_the_api(client, owner, "EMPLOYER_ANNUAL", EMPLOYER_SUBSCRIPTION)
    response = await client.post(f"{EMPLOYER_SUBSCRIPTION}/mandate", headers=owner["headers"])
    assert response.status_code == 422 and response.json()["code"] == "mandate_amount_over_limit"


# ===========================================================================
# The mandate path (R17)
# ===========================================================================
async def _with_active_mandate(client: Any, mint_token: Any) -> dict[str, Any]:
    me = await _candidate(mint_token)
    await _subscribe_through_the_api(client, me)
    registered = await client.post(f"{CANDIDATE_SUBSCRIPTION}/mandate", headers=me["headers"])
    assert registered.status_code == 201, registered.text
    assert (
        registered.json()["state"] == "PENDING" and registered.json()["max_amount_minor"] == 14_900
    )
    assert (await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])).json()[
        "renews_automatically"
    ] is False

    again = await client.post(f"{CANDIDATE_SUBSCRIPTION}/mandate", headers=me["headers"])
    assert again.status_code == 409 and again.json()["code"] == "mandate_exists"

    subscription = await _subscription(me["id"])
    ref = await _scalar(
        "SELECT provider_mandate_ref FROM upi_mandates WHERE subscription_id = :s",
        s=subscription["id"],
    )
    event = _mandate_event(ref)
    assert (await _post_callback(client, event)).status_code == 200
    assert await _process(event["event_id"]) == "APPLIED"
    current = (await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])).json()
    assert current["renews_automatically"] is True and current["mandate_state"] == "ACTIVE"
    return {
        **me,
        "subscription_id": subscription["id"],
        "end": subscription["current_period_end"],
        "ref": ref,
    }


async def _advance(subscription_id: Any, now: datetime) -> str:
    async with sessions(APP_URL)() as session, session.begin():
        return await billing_service.advance_renewal(
            session, subscription_id=subscription_id, now=now
        )


async def _notices(subscription_id: Any) -> list[dict[str, Any]]:
    async with sessions(_seed_url())() as session:
        rows = await session.execute(
            text(
                "SELECT * FROM mandate_debit_notices WHERE subscription_id = :s "
                "ORDER BY period_end, attempt"
            ),
            {"s": str(subscription_id)},
        )
        return [dict(r) for r in rows.mappings()]


async def test_auto_renew_notifies_waits_debits_and_renews_from_the_paid_end(
    client: Any, mint_token: Any
) -> None:
    me = await _with_active_mandate(client, mint_token)
    end: datetime = me["end"]
    notice_at = end - timedelta(hours=48)

    assert await _advance(me["subscription_id"], end - timedelta(days=10)) == "NONE"
    assert await _advance(me["subscription_id"], notice_at) == "SEND_NOTICE"
    [notice] = await _notices(me["subscription_id"])
    assert notice["state"] == "NOTIFIED" and notice["attempt"] == 1
    assert notice["debit_not_before"] == notice_at + timedelta(hours=24)
    assert notice["provider_notice_ref"].startswith("stub_notice_")
    assert (
        await _scalar(
            "SELECT count(*) FROM outbox WHERE event_type = 'subscriptions.pre_debit_notified' "
            "AND aggregate_id = :s",
            s=me["subscription_id"],
        )
        == 1
    )

    # Nothing debits a payer who was not told, or before the notice period is up.
    assert await _advance(me["subscription_id"], notice_at) == "NONE"
    assert (
        await _advance(me["subscription_id"], notice_at + timedelta(hours=23, minutes=59)) == "NONE"
    )
    assert await _payment_count(me["id"], "MANDATE_DEBIT") == 0

    debit_at = notice_at + timedelta(hours=24)
    assert await _advance(me["subscription_id"], debit_at) == "REQUEST_DEBIT"
    assert await _advance(me["subscription_id"], debit_at) == "NONE"
    [notice] = await _notices(me["subscription_id"])
    assert notice["state"] == "DEBIT_REQUESTED"
    debit = await _payment_row(str(notice["payment_id"]))
    assert (debit["purpose"], debit["status"], debit["amount_minor"]) == (
        "MANDATE_DEBIT",
        "PENDING",
        14_900,
    )

    assert await _settle(client, str(debit["id"]), now=debit_at) == "APPLIED"
    subscription = await _subscription(me["id"])
    assert subscription["state"] == "ACTIVE"
    assert subscription["current_period_end"] == add_months(end, 1)
    assert (await _notices(me["subscription_id"]))[0]["state"] == "SUCCEEDED"
    assert (await _reasons(me["subscription_id"]))[-1] == "renewed_by_mandate"


async def _payment_count(user_id: Any, purpose: str) -> int:
    return int(
        await _scalar(
            "SELECT count(*) FROM payments WHERE user_id = :u AND purpose = :p",
            u=user_id,
            p=purpose,
        )
    )


async def _requested_debit(me: dict[str, Any], at: datetime) -> tuple[str, datetime]:
    assert await _advance(me["subscription_id"], at) == "SEND_NOTICE"
    debit_at = at + timedelta(hours=24)
    assert await _advance(me["subscription_id"], debit_at) == "REQUEST_DEBIT"
    notice = (await _notices(me["subscription_id"]))[-1]
    return str(notice["payment_id"]), debit_at


async def test_a_mandate_revoked_in_the_upi_app_falls_back_to_manual_before_access_lapses(
    client: Any, mint_token: Any
) -> None:
    me = await _with_active_mandate(client, mint_token)
    payment_id, debit_at = await _requested_debit(me, me["end"] - timedelta(hours=48))

    outcome = await _settle(
        client, payment_id, event="payment.failed", failure_code="MANDATE_REVOKED", now=debit_at
    )
    assert outcome == "APPLIED"

    current = (await client.get(CANDIDATE_SUBSCRIPTION, headers=me["headers"])).json()
    assert current["renews_automatically"] is False
    assert current["has_access"] is True  # told while the period still has days in it
    assert (
        await _scalar("SELECT state FROM upi_mandates WHERE provider_mandate_ref = :r", r=me["ref"])
        == "REVOKED_UNKNOWN"
    )
    assert (await _reasons(me["subscription_id"]))[-1] == "mandate_lost"
    assert (
        await _scalar(
            "SELECT payload->>'reason' FROM outbox "
            "WHERE event_type = 'subscriptions.fell_back_to_manual' AND aggregate_id = :s",
            s=me["subscription_id"],
        )
        == "mandate_lost"
    )

    async with sessions(APP_URL)() as session, session.begin():
        assert (
            await billing_service.close_period(
                session, subscription_id=me["subscription_id"], now=me["end"] + timedelta(seconds=1)
            )
            == "LAPSED"
        )


async def test_a_failed_debit_gives_grace_and_retries_with_a_fresh_notice(
    client: Any, mint_token: Any
) -> None:
    me = await _with_active_mandate(client, mint_token)
    end: datetime = me["end"]
    payment_id, debit_at = await _requested_debit(me, end - timedelta(hours=30))
    assert (
        await _settle(
            client,
            payment_id,
            event="payment.failed",
            failure_code="INSUFFICIENT_FUNDS",
            now=debit_at,
        )
        == "APPLIED"
    )
    assert (
        await _scalar("SELECT state FROM upi_mandates WHERE provider_mandate_ref = :r", r=me["ref"])
        == "ACTIVE"
    )

    after_end = end + timedelta(seconds=1)
    async with sessions(APP_URL)() as session, session.begin():
        assert (
            await billing_service.close_period(
                session, subscription_id=me["subscription_id"], now=after_end
            )
            == "GRACE"
        )
    grace = await _subscription(me["id"])
    assert grace["grace_from"] == end
    assert grace["current_period_end"] == end + timedelta(days=3)

    retry_payment, retry_at = await _requested_debit(me, after_end)
    notices = await _notices(me["subscription_id"])
    assert [(n["attempt"], n["state"]) for n in notices] == [(1, "FAILED"), (2, "DEBIT_REQUESTED")]
    assert {n["period_end"] for n in notices} == {end}

    assert await _settle(client, retry_payment, now=retry_at) == "APPLIED"
    renewed = await _subscription(me["id"])
    assert (renewed["state"], renewed["current_period_start"], renewed["current_period_end"]) == (
        "ACTIVE",
        end,
        add_months(end, 1),
    )
    assert renewed["grace_from"] is None


async def test_cancelling_revokes_the_mandate_so_nothing_is_debited(
    client: Any, mint_token: Any
) -> None:
    me = await _with_active_mandate(client, mint_token)
    assert (
        await client.post(f"{CANDIDATE_SUBSCRIPTION}/cancel", headers=me["headers"])
    ).status_code == 200
    assert (
        await _scalar("SELECT state FROM upi_mandates WHERE provider_mandate_ref = :r", r=me["ref"])
        == "REVOKED"
    )
    assert await _advance(me["subscription_id"], me["end"] - timedelta(hours=48)) == "NONE"
    assert await _notices(me["subscription_id"]) == []


# ===========================================================================
# Courses: bought by a verified payment, completed only by the platform
# ===========================================================================
async def _active_course(points: int = 30) -> uuid.UUID:
    course_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO courses (id, code, title, price_minor, contribution_points, active, "
                "version) VALUES (:i, :c, 'Test course', 49900, :p, true, 1)"
            ),
            {"i": str(course_id), "c": f"TEST_COURSE_{course_id.hex[:12]}", "p": points},
        )
    return course_id


async def _complete(
    user_id: Any, course_id: Any, *, role: str = "SYSTEM", progress: CourseProgress = COMPLETE
) -> Any:
    async with sessions(APP_URL)() as session, session.begin():
        return await courses_service.record_completion(
            session,
            user_id=user_id,
            course_id=course_id,
            progress=progress,
            actor_id=None,
            actor_role=role,
        )


async def _buy_course(client: Any, me: dict[str, Any], course_id: uuid.UUID) -> None:
    checkout = await client.post(
        f"{API}/candidate/courses/{course_id}/checkout", headers=me["headers"]
    )
    assert checkout.status_code == 201, checkout.text
    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"


async def test_a_course_is_bought_by_a_verified_payment_and_completed_only_by_the_platform(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    assert (await client.get(f"{API}/candidate/courses", headers=me["headers"])).status_code == 402
    await _subscribe_through_the_api(client, me)

    listed = await client.get(f"{API}/candidate/courses", headers=me["headers"])
    assert "COURSE_RESUME_FOUNDATION" not in {c["code"] for c in listed.json()}, (
        "the course has no recorded lessons and must not be on sale"
    )

    course_id = await _active_course()
    checkout = await client.post(
        f"{API}/candidate/courses/{course_id}/checkout", headers=me["headers"]
    )
    assert checkout.status_code == 201
    with pytest.raises(courses_service.CourseNotPurchasedError):
        await _complete(me["id"], course_id)

    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"
    [entry] = [
        c
        for c in (await client.get(f"{API}/candidate/courses", headers=me["headers"])).json()
        if c["id"] == str(course_id)
    ]
    assert (entry["purchased"], entry["completed"]) == (True, False)
    again = await client.post(
        f"{API}/candidate/courses/{course_id}/checkout", headers=me["headers"]
    )
    assert again.status_code == 409 and again.json()["code"] == "course_already_purchased"

    from app.core.errors import PermissionDeniedError

    with pytest.raises(PermissionDeniedError):
        await _complete(me["id"], course_id, role="CANDIDATE")
    with pytest.raises(courses_service.CourseNotCompleteError) as incomplete:
        await _complete(me["id"], course_id, progress=CourseProgress(6, 5))
    assert incomplete.value.params == {"reason": "lessons_incomplete"}

    first = await _complete(me["id"], course_id)
    second = await _complete(me["id"], course_id)
    assert first.created and not second.created
    assert first.completion.points_awarded == 30
    assert (
        await _scalar(
            "SELECT count(*) FROM audit_events "
            "WHERE action = 'course_completion_recorded' AND target_id = :t",
            t=first.completion.id,
        )
        == 1
    )
    assert (
        await _scalar(
            "SELECT count(*) FROM outbox "
            "WHERE event_type = 'courses.completion_recorded' AND aggregate_id = :t",
            t=first.completion.id,
        )
        == 1
    )


def test_no_route_records_a_course_completion(app: Any) -> None:
    """A completion moves a score. Candidates report progress through a
    lesson; the server records the completion when the rule is met, and no
    route lets anyone post one (2026-09-29)."""
    paths = [path for path in app.openapi()["paths"] if "course" in path]
    assert paths and not [p for p in paths if "complet" in p.lower()]


async def test_the_database_refuses_a_purchase_or_completion_without_a_verified_payment(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    await _subscribe_through_the_api(client, me)
    course_id = await _active_course()
    pending = (
        await client.post(f"{API}/candidate/courses/{course_id}/checkout", headers=me["headers"])
    ).json()

    async with sessions(_seed_url())() as session, session.begin():
        with pytest.raises((IntegrityError, DBAPIError)) as exc:
            await session.execute(
                text(
                    "INSERT INTO course_purchases (id, user_id, course_id, payment_id) "
                    "VALUES (gen_random_uuid(), :u, :c, :p)"
                ),
                {"u": str(me["id"]), "c": str(course_id), "p": pending["payment_id"]},
            )
    assert "COURSE_PURCHASE_GUARD" in str(exc.value)

    async with sessions(_seed_url())() as session, session.begin():
        with pytest.raises(IntegrityError) as exc:
            await session.execute(
                text(
                    "INSERT INTO course_completions (id, user_id, course_id, contribution_version, "
                    "points_awarded) VALUES (gen_random_uuid(), :u, :c, 'x', 30)"
                ),
                {"u": str(me["id"]), "c": str(course_id)},
            )
    assert "fk_course_completions_purchase" in str(exc.value)


async def test_a_completion_rescores_from_the_stored_extraction_and_replays_exactly(
    client: Any, mint_token: Any
) -> None:
    from tests.integration.test_candidate_marketplace import _candidate as scored_candidate

    me = await scored_candidate(mint_token)
    course_id = await _active_course()
    await _buy_course(client, me, course_id)

    async with sessions(APP_URL)() as session:
        before = await scoring_service.get_latest(session, user_id=me["id"])
    assert before is not None and before.addon_value == 0

    async with sessions(APP_URL)() as session, session.begin():
        assert await scoring_service.rescore_for_addons(session, user_id=me["id"]) is None

    completion = await _complete(me["id"], course_id)
    async with sessions(APP_URL)() as session, session.begin():
        # The model is unconfigured in tests: reaching it would raise.
        result = await scoring_service.rescore_for_addons(session, user_id=me["id"])
    assert result is not None
    assert result.base_value == before.base_value
    assert result.resume_version_id == before.resume_version_id
    assert result.raw_value == min(before.base_value + 30, 990)
    assert result.addon_value == result.raw_value - result.base_value

    async with sessions(APP_URL)() as session, session.begin():
        assert await scoring_service.rescore_for_addons(session, user_id=me["id"]) is None
        replayed = await scoring_service.replay(session, score_id=result.score_id)
        stored = await scoring_service.get_score(session, score_id=result.score_id)
    assert replayed.raw_value == result.raw_value
    assert stored.contributing_events == [
        {
            "kind": "course",
            "id": str(completion.completion.id),
            "course_id": str(course_id),
            "points": 30,
            "contribution_version": completion.completion.contribution_version,
        }
    ]
    badges = await _scalar(
        "SELECT badges FROM candidate_search_documents WHERE user_id = :u", u=me["id"]
    )
    assert "COURSE_COMPLETED" in badges


def test_a_completion_routes_to_the_rescore_and_a_callback_to_its_processing() -> None:
    from app.tasks.routing import (
        PROCESS_PAYMENT_CALLBACK_TASK,
        RESCORE_FOR_ADDONS_TASK,
        SCORE_RESUME_TASK,
        tasks_for,
    )

    assert tasks_for("courses.completion_recorded") == (RESCORE_FOR_ADDONS_TASK,)
    assert SCORE_RESUME_TASK not in tasks_for("courses.completion_recorded")
    assert tasks_for("billing.callback_received") == (PROCESS_PAYMENT_CALLBACK_TASK,)
