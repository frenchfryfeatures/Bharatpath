"""Day 17 through HTTP and the database: the college tenant, seats, referral codes.

What this file holds, in order:

  * a business account creates a college, runs its team, onboards, and pays
    as its organisation -- the admin buys, staff do not;
  * referral codes are credentials: issued behind payment, revocable without
    it, and every kind of bad code is one refusal, rate-limited;
  * **entering a code is the student's consent, ROSTER scope only** (R16) --
    and a student cannot write their way onto a roster by any other path;
  * **a seat replaces the student's subscription** (C12) while the college
    pays, and the cap is held by the database, not by the service.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.errors import PermissionDeniedError
from app.modules.college import service as college_service
from app.modules.college.domain import CONSENT_VERSION, LINK_ATTEMPTS_PER_USER_PER_HOUR
from app.modules.subscriptions import service as subscriptions_service
from tests.conftest import _seed_url, sessions
from tests.integration.test_payments import _candidate, _scalar, _settle

pytestmark = pytest.mark.integration

API = "/api/v1"
COLLEGE = f"{API}/college"
STUDENT = f"{API}/candidate/colleges"
APP_URL = os.environ.get("DATABASE_URL_APP") or os.environ["DATABASE_URL"]

COMPLETE_ONBOARDING = {
    "legal_name": "Government Polytechnic, Nagpur",
    "institution_type": "POLYTECHNIC",
    "address_line1": "Sadar",
    "city": "Nagpur",
    "state": "MH",
    "pincode": "440001",
    "officer_name": "R. Deshmukh",
    "officer_email": "placements@gpn.example.test",
    "officer_phone": "+919812345678",
    "students_per_year": 600,
    "undertaking_student_consent": True,
    "undertaking_authorised": True,
}


def _email() -> str:
    return f"{uuid.uuid4().hex[:12]}@example.test"


async def _college(client: Any, mint_token: Any, *, seats_paid: int | None = 250) -> dict[str, Any]:
    """A college created through the API. `seats_paid` seeds a live COLLEGE
    subscription with that seat allowance as the migrator; None leaves it unpaid."""
    headers, _ = mint_token(pool="BUSINESS", email=_email())
    created = await client.post(
        f"{COLLEGE}/organisation",
        json={"name": f"College {uuid.uuid4().hex[:6]}", "institution_type": "AUTONOMOUS_COLLEGE"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    tenant_id = created.json()["tenant_id"]
    subscription_id = await _subscribe_college(tenant_id, seats_paid) if seats_paid else None
    return {"headers": headers, "tenant_id": tenant_id, "subscription_id": subscription_id}


async def _subscribe_college(tenant_id: str, seats: int) -> uuid.UUID:
    now = datetime.now(UTC)
    plan_id, subscription_id = uuid.uuid4(), uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO plans (id, audience, code, period, price_minor, entitlements, "
                "seat_allowance, active, version) VALUES (:p, 'COLLEGE', :c, 'SEMESTER', "
                "6999900, '{}'::jsonb, :seats, true, 1)"
            ),
            {"p": str(plan_id), "c": f"TEST_COL_{plan_id.hex[:16]}", "seats": seats},
        )
        await session.execute(
            text(
                "INSERT INTO subscriptions (id, subscriber_type, subscriber_id, plan_id, state, "
                "current_period_start, current_period_end, renews_automatically) "
                "VALUES (:id, 'TENANT', :t, :p, 'ACTIVE', :s, :e, false)"
            ),
            {
                "id": str(subscription_id),
                "t": tenant_id,
                "p": str(plan_id),
                "s": now - timedelta(days=1),
                "e": now + timedelta(days=150),
            },
        )
    return subscription_id


async def _lapse(subscription_id: uuid.UUID) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "UPDATE subscriptions SET current_period_start = now() - interval '200 days', "
                "current_period_end = now() - interval '1 second' WHERE id = :s"
            ),
            {"s": str(subscription_id)},
        )


async def _allocate(tenant_id: str, seats: int) -> college_service.Allocation:
    """What the admin console will do (Day 19), through the service, as the app role."""
    async with sessions(APP_URL)() as session, session.begin():
        return await college_service.allocate_seats(
            session,
            actor_id=None,
            actor_role="PLATFORM_ADMIN",
            tenant_id=uuid.UUID(tenant_id),
            seats=seats,
        )


async def _code(client: Any, college: dict[str, Any], **body: Any) -> dict[str, Any]:
    issued = await client.post(f"{COLLEGE}/referral-codes", json=body, headers=college["headers"])
    assert issued.status_code == 201, issued.text
    return dict(issued.json())


async def _link(client: Any, student: dict[str, Any], code: str, **body: Any) -> Any:
    return await client.post(
        f"{STUDENT}/link",
        json={"code": code, "consent_version": CONSENT_VERSION, **body},
        headers=student["headers"],
    )


# ===========================================================================
# The organisation, its team, onboarding, and paying
# ===========================================================================
async def test_a_business_account_creates_a_college_and_runs_its_team(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token, seats_paid=None)
    headers = college["headers"]

    org = await client.get(f"{COLLEGE}/organisation", headers=headers)
    assert org.status_code == 200 and org.json()["tenant_id"] == college["tenant_id"]
    seats = (await client.get(f"{COLLEGE}/seats", headers=headers)).json()
    assert seats == {
        "seats_allocated": 0,
        "seats_used": 0,
        "seats_available": 0,
        "subscription_active": False,
    }

    staff_email = _email()
    added = await client.post(
        f"{COLLEGE}/team", json={"email": staff_email, "role": "COLLEGE_STAFF"}, headers=headers
    )
    assert added.status_code == 201, added.text
    staff_headers, _ = mint_token(pool="BUSINESS", email=staff_email)
    assert (await client.get(f"{COLLEGE}/organisation", headers=staff_headers)).status_code == 200
    renamed = await client.patch(
        f"{COLLEGE}/organisation", json={"name": "Taken over"}, headers=staff_headers
    )
    assert renamed.status_code == 403

    # Employer roles are not college roles, and one account holds one organisation.
    refused = await client.post(
        f"{COLLEGE}/team", json={"email": _email(), "role": "EMPLOYER_OWNER"}, headers=headers
    )
    assert refused.status_code == 422
    again = await client.post(
        f"{COLLEGE}/organisation",
        json={"name": "Second", "institution_type": "ITI"},
        headers=headers,
    )
    assert again.status_code == 409

    # The last admin cannot leave.
    admin_id = next(
        m["user_id"]
        for m in (await client.get(f"{COLLEGE}/team", headers=headers)).json()
        if m["role"] == "COLLEGE_ADMIN"
    )
    demoted = await client.patch(
        f"{COLLEGE}/team/{admin_id}", json={"role": "COLLEGE_STAFF"}, headers=headers
    )
    assert demoted.status_code == 409 and demoted.json()["code"] == "identity_last_owner"


async def test_an_employer_is_not_a_college_and_a_college_is_not_an_employer(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token, seats_paid=None)
    assert (
        await client.get(f"{API}/employer/organisation", headers=college["headers"])
    ).status_code == 403

    employer, _ = mint_token(pool="BUSINESS", email=_email())
    created = await client.post(
        f"{API}/employer/organisation", json={"legal_name": "Employer Pvt Ltd"}, headers=employer
    )
    assert created.status_code == 201
    assert (await client.get(f"{COLLEGE}/organisation", headers=employer)).status_code == 403


async def test_onboarding_saves_partially_and_submits_only_when_complete(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token, seats_paid=None)
    headers = college["headers"]
    form = (await client.get(f"{COLLEGE}/onboarding", headers=headers)).json()
    assert form["form"]["code"] == "COLLEGE_ONBOARDING" and form["submitted_at"] is None
    assert {"college.INSTITUTION_TYPES", "college.MONTHS", "reference.INDIAN_STATES"} <= set(
        form["options"]
    )

    bad = await client.put(
        f"{COLLEGE}/onboarding/answers",
        json={"answers": {"state": "ATLANTIS", "pincode": "12", "surprise": 1}},
        headers=headers,
    )
    assert bad.status_code == 422
    assert {(i["field"], i["code"]) for i in bad.json()["params"]["issues"]} == {
        ("surprise", "unknown_field"),
        ("state", "not_an_option"),
        ("pincode", "invalid_format"),
    }

    partial = await client.put(
        f"{COLLEGE}/onboarding/answers",
        json={"answers": {"legal_name": "Government Polytechnic, Nagpur"}},
        headers=headers,
    )
    assert partial.status_code == 200
    incomplete = await client.post(f"{COLLEGE}/onboarding/submit", headers=headers)
    assert incomplete.status_code == 422
    assert ("officer_email", "required") in {
        (i["field"], i["code"]) for i in incomplete.json()["params"]["issues"]
    }

    saved = await client.put(
        f"{COLLEGE}/onboarding/answers", json={"answers": COMPLETE_ONBOARDING}, headers=headers
    )
    assert saved.status_code == 200
    submitted = await client.post(f"{COLLEGE}/onboarding/submit", headers=headers)
    assert submitted.status_code == 200 and submitted.json()["submitted_at"] is not None
    assert (await client.post(f"{COLLEGE}/onboarding/submit", headers=headers)).status_code == 200
    late = await client.put(
        f"{COLLEGE}/onboarding/answers", json={"answers": {"city": "Pune"}}, headers=headers
    )
    assert late.status_code == 409


async def test_a_college_pays_as_its_organisation_and_only_its_admin_buys(
    client: Any, mint_token: Any
) -> None:
    # CI does not run seed_catalogue.py; nothing guarantees test_payments synced it first.
    async with sessions(_seed_url())() as session, session.begin():
        await subscriptions_service.sync_plans(session)
    college = await _college(client, mint_token, seats_paid=None)
    plans = (await client.get(f"{COLLEGE}/subscription/plans", headers=college["headers"])).json()
    assert plans and {p["audience"] for p in plans} == {"COLLEGE"}
    assert all(p["seat_allowance"] for p in plans)
    code = next(p["code"] for p in plans if p["seat_allowance"] == 250)

    staff_email = _email()
    await client.post(
        f"{COLLEGE}/team",
        json={"email": staff_email, "role": "COLLEGE_STAFF"},
        headers=college["headers"],
    )
    staff, _ = mint_token(pool="BUSINESS", email=staff_email)
    staff_checkout = await client.post(
        f"{COLLEGE}/subscription/checkout", json={"plan_code": code}, headers=staff
    )
    assert staff_checkout.status_code == 403

    checkout = await client.post(
        f"{COLLEGE}/subscription/checkout", json={"plan_code": code}, headers=college["headers"]
    )
    assert checkout.status_code == 201, checkout.text
    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"
    current = (await client.get(f"{COLLEGE}/subscription", headers=staff)).json()
    assert current["state"] == "ACTIVE" and current["plan_code"] == code
    seats = (await client.get(f"{COLLEGE}/seats", headers=staff)).json()
    assert seats["subscription_active"] is True

    # A candidate plan is not for sale to a college.
    wrong = await client.post(
        f"{COLLEGE}/subscription/checkout",
        json={"plan_code": "CANDIDATE_MONTHLY"},
        headers=college["headers"],
    )
    assert wrong.status_code == 404


# ===========================================================================
# Referral codes are credentials
# ===========================================================================
async def test_codes_are_issued_behind_payment_and_revoked_without_it(
    client: Any, mint_token: Any
) -> None:
    unpaid = await _college(client, mint_token, seats_paid=None)
    refused = await client.post(f"{COLLEGE}/referral-codes", json={}, headers=unpaid["headers"])
    assert refused.status_code == 402

    college = await _college(client, mint_token)
    issued = await _code(client, college, expires_in_days=30, max_uses=5)
    assert len(issued["code"]) == 14 and issued["code"][4] == "-" and issued["state"] == "ACTIVE"
    assert issued["uses"] == 0 and issued["max_uses"] == 5
    listed = (await client.get(f"{COLLEGE}/referral-codes", headers=college["headers"])).json()[
        "items"
    ]
    assert [c["id"] for c in listed] == [issued["id"]]
    active = (
        await client.get(
            f"{COLLEGE}/referral-codes",
            params={"active_only": True, "limit": 1},
            headers=college["headers"],
        )
    ).json()["items"]
    assert [code["id"] for code in active] == [issued["id"]]

    audit = await _scalar(
        "SELECT metadata::text FROM audit_events WHERE action = 'referral_code_issued' "
        "AND target_id = :t",
        t=issued["id"],
    )
    assert issued["code"].replace("-", "") not in audit, "a credential in the audit log"

    await _lapse(college["subscription_id"])
    revoked = await client.post(
        f"{COLLEGE}/referral-codes/{issued['id']}/revoke", headers=college["headers"]
    )
    assert revoked.status_code == 200 and revoked.json()["state"] == "REVOKED"
    again = await client.post(
        f"{COLLEGE}/referral-codes/{issued['id']}/revoke", headers=college["headers"]
    )
    assert again.status_code == 200 and again.json()["revoked_at"] == revoked.json()["revoked_at"]
    active_after_revoke = (
        await client.get(
            f"{COLLEGE}/referral-codes",
            params={"active_only": True, "limit": 1},
            headers=college["headers"],
        )
    ).json()["items"]
    assert active_after_revoke == []


async def test_referral_codes_are_cursor_paginated(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    issued = [await _code(client, college) for _ in range(3)]

    first_response = await client.get(
        f"{COLLEGE}/referral-codes",
        params={"limit": 2},
        headers=college["headers"],
    )
    assert first_response.status_code == 200, first_response.text
    first = first_response.json()
    assert [item["id"] for item in first["items"]] == [
        issued[2]["id"],
        issued[1]["id"],
    ]
    assert first["next_cursor"]

    second_response = await client.get(
        f"{COLLEGE}/referral-codes",
        params={"limit": 2, "cursor": first["next_cursor"]},
        headers=college["headers"],
    )
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()
    assert [item["id"] for item in second["items"]] == [issued[0]["id"]]
    assert second["next_cursor"] is None

    invalid = await client.get(
        f"{COLLEGE}/referral-codes",
        params={"cursor": "not-a-cursor"},
        headers=college["headers"],
    )
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_cursor"


async def test_entering_a_code_links_the_student_with_roster_consent_only(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    code = await _code(client, college)
    student = await _candidate(mint_token)

    terms = (await client.get(f"{STUDENT}/consent-terms", headers=student["headers"])).json()
    assert terms["scope"] == "ROSTER" and terms["consent_version"] == CONSENT_VERSION

    # Typed the way people type: lower case, spaces, an O for a zero.
    typed = code["code"].lower().replace("-", " ").replace("0", "o")
    linked = await _link(client, student, typed)
    assert linked.status_code == 201, linked.text
    body = linked.json()
    assert body["college_id"] == college["tenant_id"] and body["college_name"]
    assert body["scope"] == "ROSTER" and body["granted_via"] == "REFERRAL_CODE"
    assert body["seat_held"] is False  # no seats allocated yet

    async with sessions(_seed_url())() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT scope, granted_via, referral_code_id, consent_version, revoked_at "
                    "FROM student_consents WHERE candidate_id = :c"
                ),
                {"c": str(student["id"])},
            )
        ).all()
    assert [tuple(r) for r in rows] == [
        ("ROSTER", "REFERRAL_CODE", uuid.UUID(code["id"]), CONSENT_VERSION, None)
    ], "a code must confer ROSTER scope and nothing else"
    assert (
        await _scalar(
            "SELECT count(*) FROM audit_events WHERE action = 'consent_granted' AND actor_id = :a",
            a=student["id"],
        )
        == 1
    )

    again = await _link(client, student, code["code"])
    assert again.status_code == 200 and again.json()["granted_at"] == body["granted_at"]
    assert await _scalar("SELECT uses FROM referral_codes WHERE id = :i", i=code["id"]) == 1

    links = (await client.get(STUDENT, headers=student["headers"])).json()
    assert [link["college_id"] for link in links] == [college["tenant_id"]]
    # The college learns a count exists, and nothing about who.
    listed = (await client.get(f"{COLLEGE}/referral-codes", headers=college["headers"])).json()[
        "items"
    ]
    assert listed[0]["uses"] == 1 and str(student["id"]) not in str(listed)


async def test_every_bad_code_is_the_same_refusal(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    expired = await _code(client, college)
    revoked = await _code(client, college)
    single = await _code(client, college, max_uses=1)
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "UPDATE referral_codes SET expires_at = now() - interval '1 second' WHERE id = :i"
            ),
            {"i": expired["id"]},
        )
    await client.post(
        f"{COLLEGE}/referral-codes/{revoked['id']}/revoke", headers=college["headers"]
    )
    first = await _candidate(mint_token)
    assert (await _link(client, first, single["code"])).status_code == 201

    student = await _candidate(mint_token)
    for attempt in (
        "ZZZZ-ZZZZ-ZZZZ",
        "not really a code!",
        expired["code"],
        revoked["code"],
        single["code"],
    ):
        refused = await _link(client, student, attempt)
        assert refused.status_code == 422, (attempt, refused.text)
        assert refused.json()["code"] == "referral_code_invalid"
        assert "params" not in refused.json() or not refused.json()["params"]

    fresh = await _code(client, college)
    stale = await _link(client, student, fresh["code"], consent_version="placeholder-0")
    assert stale.status_code == 409 and stale.json()["code"] == "consent_version_outdated"
    assert (
        await _scalar(
            "SELECT count(*) FROM student_consents WHERE candidate_id = :c", c=student["id"]
        )
        == 0
    )


async def test_code_entry_is_rate_limited_per_student(client: Any, mint_token: Any) -> None:
    student = await _candidate(mint_token)
    for _ in range(LINK_ATTEMPTS_PER_USER_PER_HOUR):
        assert (await _link(client, student, "ZZZZ-ZZZZ-ZZZZ")).status_code == 422
    assert (await _link(client, student, "ZZZZ-ZZZZ-ZZZZ")).status_code == 429


async def test_a_student_cannot_write_their_way_onto_a_roster(client: Any, mint_token: Any) -> None:
    """The consent INSERT policy re-checks what the service checked. A student
    naming another college's code, a revoked code, or asking for INDIVIDUAL
    scope directly is refused by the database."""
    college = await _college(client, mint_token)
    other = await _college(client, mint_token)
    code = await _code(client, college)
    revoked = await _code(client, college)
    await client.post(
        f"{COLLEGE}/referral-codes/{revoked['id']}/revoke", headers=college["headers"]
    )
    student = await _candidate(mint_token)

    async def insert(tenant: str, code_id: str, scope: str = "ROSTER") -> None:
        async with sessions(APP_URL)() as session, session.begin():
            await session.execute(
                text("SELECT set_config('app.user_id', :u, true)"), {"u": str(student["id"])}
            )
            await session.execute(
                text(
                    "INSERT INTO student_consents (id, tenant_id, candidate_id, scope, "
                    "granted_via, referral_code_id, consent_version) VALUES "
                    "(gen_random_uuid(), :t, :c, :s, 'REFERRAL_CODE', :r, :v)"
                ),
                {
                    "t": tenant,
                    "c": str(student["id"]),
                    "s": scope,
                    "r": code_id,
                    "v": CONSENT_VERSION,
                },
            )

    for tenant, code_id, scope in (
        (other["tenant_id"], code["id"], "ROSTER"),
        (college["tenant_id"], revoked["id"], "ROSTER"),
        (college["tenant_id"], code["id"], "INDIVIDUAL"),
    ):
        with pytest.raises(DBAPIError):
            await insert(tenant, code_id, scope)

    # And one student never reads another's consents.
    classmate = await _candidate(mint_token)
    assert (await _link(client, classmate, code["code"])).status_code == 201
    async with sessions(APP_URL)() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.user_id', :u, true)"), {"u": str(student["id"])}
        )
        seen = await session.scalar(text("SELECT count(*) FROM student_consents"))
        names = await session.scalar(text("SELECT count(*) FROM colleges"))
    assert seen == 0 and names == 0


# ===========================================================================
# Seats: the college pays, the database counts
# ===========================================================================
async def test_a_seat_replaces_the_students_subscription_while_the_college_pays(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    allocation = await _allocate(college["tenant_id"], 10)
    assert (allocation.allocated, allocation.used, allocation.filled) == (10, 0, 0)
    code = await _code(client, college)
    student = await _candidate(mint_token)
    paid_tool = f"{API}/candidate/questionnaire"
    assert (await client.get(paid_tool, headers=student["headers"])).status_code == 402

    linked = await _link(client, student, code["code"])
    assert linked.status_code == 201 and linked.json()["seat_held"] is True
    assert (await client.get(paid_tool, headers=student["headers"])).status_code == 200
    seats = (await client.get(f"{COLLEGE}/seats", headers=college["headers"])).json()
    assert (seats["seats_used"], seats["seats_available"]) == (1, 9)

    # The college stops paying: the student loses access on the next request,
    # and keeps their seat and their link for when it pays again.
    await _lapse(college["subscription_id"])
    assert (await client.get(paid_tool, headers=student["headers"])).status_code == 402
    assert (await client.get(STUDENT, headers=student["headers"])).json()[0]["seat_held"] is True


async def test_the_seat_cap_is_held_by_the_database(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token, seats_paid=250)
    await _allocate(college["tenant_id"], 1)
    code = await _code(client, college)
    first, second = await _candidate(mint_token), await _candidate(mint_token)

    assert (await _link(client, first, code["code"])).json()["seat_held"] is True
    waiting = await _link(client, second, code["code"])
    assert waiting.status_code == 201
    assert waiting.json()["seat_held"] is False, "the 2nd student on 1 seat is linked, not paid for"

    # A direct write past the allowance is refused, whoever writes it.
    consent = await _scalar(
        "SELECT id FROM student_consents WHERE candidate_id = :c", c=second["id"]
    )
    with pytest.raises(DBAPIError, match="COLLEGE_SEAT_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text(
                    "INSERT INTO college_seat_assignments "
                    "(id, tenant_id, candidate_id, consent_id) "
                    "VALUES (gen_random_uuid(), :t, :c, :k)"
                ),
                {"t": college["tenant_id"], "c": str(second["id"]), "k": str(consent)},
            )

    for seats, refusal in ((0, "college_seats_below_used"), (251, "college_seats_exceed_plan")):
        with pytest.raises(college_service.CollegeSeatAllocationError) as caught:
            await _allocate(college["tenant_id"], seats)
        assert caught.value.code == refusal

    grown = await _allocate(college["tenant_id"], 2)
    assert (grown.used, grown.filled) == (2, 1), "growing the allowance seats who was waiting"

    # Revoking consent releases the seat it paid for (Day 18 builds the route).
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text("UPDATE student_consents SET revoked_at = now() WHERE candidate_id = :c"),
            {"c": str(first["id"])},
        )
    assert (
        await _scalar(
            "SELECT seats_used FROM college_seats WHERE tenant_id = :t", t=college["tenant_id"]
        )
        == 1
    )
    assert (
        await _scalar(
            "SELECT release_reason FROM college_seat_assignments WHERE candidate_id = :c",
            c=first["id"],
        )
        == "CONSENT_REVOKED"
    )


async def test_one_student_holds_one_seat_across_colleges(client: Any, mint_token: Any) -> None:
    first, second = await _college(client, mint_token), await _college(client, mint_token)
    for college in (first, second):
        await _allocate(college["tenant_id"], 5)
    student = await _candidate(mint_token)
    assert (await _link(client, student, (await _code(client, first))["code"])).json()["seat_held"]
    both = await _link(client, student, (await _code(client, second))["code"])
    assert both.status_code == 201 and both.json()["seat_held"] is False
    links = (await client.get(STUDENT, headers=student["headers"])).json()
    assert sorted(link["seat_held"] for link in links) == [False, True]


async def test_seat_counts_are_not_the_applications_to_write(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    async with sessions(APP_URL)() as session:
        with pytest.raises(DBAPIError, match="permission denied"):
            async with session.begin():
                await session.execute(
                    text("SELECT set_config('app.tenant_id', :t, true)"),
                    {"t": college["tenant_id"]},
                )
                await session.execute(
                    text("UPDATE college_seats SET seats_used = 0 WHERE tenant_id = :t"),
                    {"t": college["tenant_id"]},
                )
    for statement in (
        "UPDATE student_consents SET scope = 'INDIVIDUAL'",
        "DELETE FROM student_consents",
        "UPDATE referral_codes SET uses = 0",
        "DELETE FROM college_seat_assignments",
    ):
        async with sessions(APP_URL)() as session:
            with pytest.raises(DBAPIError, match="permission denied"):
                async with session.begin():
                    await session.execute(text(statement))


async def test_only_our_staff_allocate_seats(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    async with sessions(APP_URL)() as session:
        with pytest.raises(PermissionDeniedError):
            async with session.begin():
                await college_service.allocate_seats(
                    session,
                    actor_id=None,
                    actor_role="COLLEGE_ADMIN",
                    tenant_id=uuid.UUID(college["tenant_id"]),
                    seats=10,
                )
    unpaid = await _college(client, mint_token, seats_paid=None)
    with pytest.raises(college_service.CollegeSeatAllocationError) as caught:
        await _allocate(unpaid["tenant_id"], 10)
    assert caught.value.code == "college_seats_no_plan"
    assert (
        await _scalar(
            "SELECT count(*) FROM audit_events WHERE action = 'college_seats_allocated' "
            "AND tenant_id = :t",
            t=unpaid["tenant_id"],
        )
        == 0
    )
