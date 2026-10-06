"""Day 19: the admin console -- staff tenancy, suspension, seats, KYB and
integrity queues, drill-downs, disputes, audit search.

Staff are provisioned the way `scripts/create_platform_staff.py` does it, as
the migrator, and then act only through the API with a real token.
"""

# ruff: noqa: F811 - `fake_s3` is a pytest fixture imported from the resume intake

from __future__ import annotations

import json
import os
import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import _seed_url, sessions
from tests.integration.test_candidate_marketplace import (
    APPLICATIONS,
    _apply,
    _board_ids,
    _candidate,
    _employer,
    _job,
)
from tests.integration.test_college import _allocate, _college
from tests.integration.test_integrity_pipeline import (
    EXTRACTED,
    INJECTED_CV,
    _evaluate,
    _high_signal_id,
    _scored_version,
    _visible,
)
from tests.integration.test_kyb import _config, _drop_config, _ready
from tests.integration.test_kyb import _organisation as _kyb_organisation
from tests.integration.test_pipeline import PIPELINE, _applied, _at_decision
from tests.integration.test_resume_intake import FakeS3, fake_s3  # noqa: F401 - fixture

pytestmark = pytest.mark.integration

API = "/api/v1"
ADMIN = f"{API}/admin"
DISPUTES = f"{API}/disputes"
APP_URL = os.environ.get("DATABASE_URL", "")


# --- helpers ------------------------------------------------------------------------
async def _staff(mint_token: Any, role: str = "PLATFORM_ADMIN") -> dict[str, Any]:
    from app.modules.identity import service as identity_service

    email = f"staff-{uuid.uuid4().hex[:12]}@example.test"
    async with sessions(_seed_url())() as session, session.begin():
        tenant_id, user_id = await identity_service.provision_platform_staff(
            session, email=email, role=role
        )
    headers, _ = mint_token(pool="BUSINESS", email=email)
    return {"headers": headers, "user_id": user_id, "tenant_id": tenant_id, "role": role}


async def _scalar(sql: str, **params: Any) -> Any:
    async with sessions(_seed_url())() as session:
        return await session.scalar(text(sql), {k: str(v) for k, v in params.items()})


async def _audit_rows(action: str, actor_id: uuid.UUID, target_id: Any | None = None) -> int:
    sql = "SELECT count(*) FROM audit_events WHERE action = :a AND actor_id = :u"
    params: dict[str, Any] = {"a": action, "u": actor_id}
    if target_id is not None:
        sql += " AND target_id = :t"
        params["t"] = target_id
    return int(await _scalar(sql, **params))


async def _find(client: Any, url: str, headers: dict, wanted: str, **params: Any) -> dict | None:
    """Walk a keyset-paged list until `wanted` appears. The test database is
    shared, so a queue holds every earlier test's rows as well."""
    cursor = None
    for _ in range(200):
        query = {**params, "limit": 100, **({"cursor": cursor} if cursor else {})}
        page = await client.get(url, params=query, headers=headers)
        assert page.status_code == 200, page.text
        body = page.json()
        for item in body["items"]:
            if str(item["id"]) == wanted:
                return dict(item)
        cursor = body["next_cursor"]
        if cursor is None:
            return None
    return None


# --- staff tenancy (blockers E10) --------------------------------------------------------
async def test_staff_share_one_platform_tenant_and_reach_the_console(
    client: Any, mint_token: Any
) -> None:
    first = await _staff(mint_token)
    second = await _staff(mint_token, "SUPPORT_AGENT")
    assert first["tenant_id"] == second["tenant_id"]
    assert await _scalar("SELECT count(*) FROM tenants WHERE type = 'PLATFORM'") == 1

    response = await client.get(f"{ADMIN}/tenants", headers=first["headers"])
    assert response.status_code == 200, response.text
    assert all(row["type"] != "PLATFORM" for row in response.json()["items"])


async def test_a_staff_role_cannot_be_held_outside_the_platform_tenant(
    client: Any, mint_token: Any
) -> None:
    """Held by the database, for every writer: an employer who could add a
    PLATFORM_ADMIN to its own team would have handed itself the console."""
    employer = await _employer(client, mint_token)
    staff = await _staff(mint_token)
    user_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, email, status, locale) "
                "VALUES (:u, 'BUSINESS', :e, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "e": f"{user_id.hex[:12]}@example.test"},
        )
    for tenant_id, role in (
        (employer["tenant_id"], "PLATFORM_ADMIN"),
        (str(staff["tenant_id"]), "EMPLOYER_OWNER"),
    ):
        with pytest.raises(DBAPIError, match="MEMBERSHIP_GUARD"):
            async with sessions(_seed_url())() as session, session.begin():
                await session.execute(
                    text(
                        "INSERT INTO memberships (id, user_id, tenant_id, role, status) "
                        "VALUES (gen_random_uuid(), :u, :t, :r, 'ACTIVE')"
                    ),
                    {"u": str(user_id), "t": tenant_id, "r": role},
                )

    added = await client.post(
        f"{API}/employer/team",
        json={"email": f"{uuid.uuid4().hex[:12]}@example.test", "role": "PLATFORM_ADMIN"},
        headers=employer["headers"],
    )
    assert added.status_code in (409, 422), added.text


async def test_the_platform_tenant_cannot_be_suspended(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    response = await client.post(
        f"{ADMIN}/tenants/{admin['tenant_id']}/suspend",
        json={"reason": "Locking ourselves out"},
        headers=admin["headers"],
    )
    assert response.status_code == 409
    assert response.json()["code"] == "identity_tenant_not_suspendable"
    with pytest.raises(DBAPIError, match="SUSPENSION_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text(
                    "INSERT INTO tenant_suspensions (id, tenant_id, reason, suspended_by, "
                    "suspended_at) VALUES (gen_random_uuid(), :t, 'x', :u, now())"
                ),
                {"t": str(admin["tenant_id"]), "u": str(admin["user_id"])},
            )


# --- suspension -----------------------------------------------------------------------------
async def test_suspending_an_employer_stops_it_now_and_deletes_nothing(
    client: Any, mint_token: Any
) -> None:
    token = uuid.uuid4().hex[:10]
    admin = await _staff(mint_token)
    employer = await _employer(client, mint_token)
    job = await _job(client, employer, title=f"Suspension {token}")
    me = await _candidate(mint_token, scored=False)
    assert (
        await client.get(f"{API}/employer/organisation", headers=employer["headers"])
    ).status_code == 200
    assert job["id"] in await _board_ids(client, me, q=token)

    suspended = await client.post(
        f"{ADMIN}/tenants/{employer['tenant_id']}/suspend",
        json={"reason": "Fraud review"},
        headers=admin["headers"],
    )
    assert suspended.status_code == 201, suspended.text
    assert suspended.json()["lifted_at"] is None

    # The very next request, with the membership already cached: refused.
    refused = await client.get(f"{API}/employer/organisation", headers=employer["headers"])
    assert refused.status_code == 403
    assert refused.json()["code"] == "tenant_suspended"

    assert job["id"] not in await _board_ids(client, me, q=token)
    assert (await _apply(client, me, job)).status_code != 201
    assert await _scalar("SELECT status FROM tenants WHERE id = :t", t=employer["tenant_id"]) == (
        "SUSPENDED"
    )
    assert await _scalar("SELECT count(*) FROM jobs WHERE id = :j", j=job["id"]) == 1
    assert await _audit_rows("tenant_suspended", admin["user_id"], employer["tenant_id"]) == 1

    again = await client.post(
        f"{ADMIN}/tenants/{employer['tenant_id']}/suspend",
        json={"reason": "Twice"},
        headers=admin["headers"],
    )
    assert again.status_code == 409
    assert again.json()["code"] == "identity_tenant_already_suspended"

    lifted = await client.post(
        f"{ADMIN}/tenants/{employer['tenant_id']}/reinstate", headers=admin["headers"]
    )
    assert lifted.status_code == 200, lifted.text
    assert (
        await client.get(f"{API}/employer/organisation", headers=employer["headers"])
    ).status_code == 200
    assert job["id"] in await _board_ids(client, me, q=token)
    assert await _audit_rows("tenant_reinstated", admin["user_id"], employer["tenant_id"]) == 1

    history = await client.get(
        f"{ADMIN}/tenants/{employer['tenant_id']}/suspensions", headers=admin["headers"]
    )
    assert [row["reason"] for row in history.json()] == ["Fraud review"]
    assert history.json()[0]["lifted_by"] == str(admin["user_id"])

    second_lift = await client.post(
        f"{ADMIN}/tenants/{employer['tenant_id']}/reinstate", headers=admin["headers"]
    )
    assert second_lift.status_code == 409


async def test_a_suspension_is_a_latch_and_the_status_follows_it(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    employer = await _employer(client, mint_token)

    with pytest.raises(DBAPIError, match="TENANT_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("UPDATE tenants SET status = 'SUSPENDED' WHERE id = :t"),
                {"t": employer["tenant_id"]},
            )

    await client.post(
        f"{ADMIN}/tenants/{employer['tenant_id']}/suspend",
        json={"reason": "Latch test"},
        headers=admin["headers"],
    )
    await client.post(
        f"{ADMIN}/tenants/{employer['tenant_id']}/reinstate", headers=admin["headers"]
    )
    with pytest.raises(DBAPIError, match="SUSPENSION_GUARD"):
        async with sessions(APP_URL)() as session, session.begin():
            await session.execute(
                text("UPDATE tenant_suspensions SET lifted_at = now() WHERE tenant_id = :t"),
                {"t": employer["tenant_id"]},
            )


@pytest.mark.parametrize("role", ["SUPPORT_AGENT", "KYB_REVIEWER", "INTEGRITY_REVIEWER"])
async def test_only_a_platform_admin_can_stop_an_organisation(
    client: Any, mint_token: Any, role: str
) -> None:
    staff = await _staff(mint_token, role)
    employer = await _employer(client, mint_token)
    response = await client.post(
        f"{ADMIN}/tenants/{employer['tenant_id']}/suspend",
        json={"reason": "Not mine to do"},
        headers=staff["headers"],
    )
    assert response.status_code == 403


# --- seats (blockers E23) -----------------------------------------------------------------
async def test_an_admin_sets_a_colleges_seats_within_its_plan(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    college = await _college(client, mint_token, seats_paid=40)
    url = f"{ADMIN}/colleges/{college['tenant_id']}/seats"

    set_ = await client.put(url, json={"seats": 25}, headers=admin["headers"])
    assert set_.status_code == 200, set_.text
    assert set_.json() == {"allocated": 25, "used": 0, "filled": 0}

    too_many = await client.put(url, json={"seats": 41}, headers=admin["headers"])
    assert too_many.status_code == 409
    assert too_many.json()["code"] == "college_seats_exceed_plan"

    assert await _audit_rows("college_seats_allocated", admin["user_id"], college["tenant_id"]) == 1
    view = await client.get(f"{API}/college/seats", headers=college["headers"])
    assert view.status_code == 200, view.text
    assert (view.json()["seats_allocated"], view.json()["seats_available"]) == (25, 25)


# --- KYB -----------------------------------------------------------------------------------------
async def test_with_approval_on_a_reviewer_opens_and_decides_a_submission(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    row = await _config(True)
    try:
        reviewer = await _staff(mint_token, "KYB_REVIEWER")
        owner = await _kyb_organisation(client, mint_token)
        await _ready(client, owner["headers"], fake_s3)
        submitted = await client.post(f"{API}/employer/kyb/submit", headers=owner["headers"])
        submission_id = submitted.json()["submission_id"]

        found = await _find(
            client,
            f"{ADMIN}/kyb/submissions",
            reviewer["headers"],
            submission_id,
            state="SUBMITTED",
        )
        assert found is not None and found["tenant_id"] == owner["tenant_id"]
        assert "answers" not in found
        page = await client.get(f"{ADMIN}/kyb/submissions", headers=reviewer["headers"])
        assert page.json()["review_required"] is True

        opened = await client.get(
            f"{ADMIN}/kyb/submissions/{submission_id}", headers=reviewer["headers"]
        )
        assert opened.status_code == 200, opened.text
        assert opened.json()["answers"]
        assert await _audit_rows("admin_kyb_submission_opened", reviewer["user_id"], submission_id)

        decided = await client.post(
            f"{ADMIN}/kyb/submissions/{submission_id}/decision",
            json={"decision": "APPROVED"},
            headers=reviewer["headers"],
        )
        assert decided.status_code == 200, decided.text
        assert decided.json()["state"] == "APPROVED"
        assert (
            await _scalar(
                "SELECT kyb_status FROM employers WHERE tenant_id = :t", t=owner["tenant_id"]
            )
            == "APPROVED"
        )
        assert await _audit_rows("kyb_decision_recorded", reviewer["user_id"], submission_id) == 1
    finally:
        await _drop_config(row)


async def test_an_unknown_submission_is_a_404(client: Any, mint_token: Any) -> None:
    reviewer = await _staff(mint_token, "KYB_REVIEWER")
    response = await client.get(
        f"{ADMIN}/kyb/submissions/{uuid.uuid4()}", headers=reviewer["headers"]
    )
    assert response.status_code == 404


# --- integrity ---------------------------------------------------------------------------------
async def test_a_reviewer_opens_and_clears_a_high_signal(client: Any, mint_token: Any) -> None:
    reviewer = await _staff(mint_token, "INTEGRITY_REVIEWER")
    candidate_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, status, locale) "
                "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(candidate_id), "p": f"+9196{uuid.uuid4().int % 10**8:08d}"},
        )
    version_id, _ = await _scored_version(candidate_id, INJECTED_CV, EXTRACTED)
    await _evaluate(candidate_id, version_id, INJECTED_CV, EXTRACTED)
    signal_id = str(await _high_signal_id(version_id))
    assert not await _visible(candidate_id)

    queued = await _find(
        client, f"{ADMIN}/integrity/signals", reviewer["headers"], signal_id, severity="HIGH"
    )
    assert queued is not None and "evidence" not in queued
    phone = await _scalar("SELECT phone FROM users WHERE id = :u", u=candidate_id)
    assert queued["rule_title"] == "Instructions aimed at the scorer"
    assert queued["rule_description"]
    assert queued["hides_candidate"] is True
    assert queued["candidate"]["id"] == str(candidate_id)
    assert queued["candidate"]["phone_masked"].endswith(phone[-4:])
    assert phone not in json.dumps(queued)
    assert isinstance(queued["other_open_signals"], int)

    opened = await client.get(f"{ADMIN}/integrity/signals/{signal_id}", headers=reviewer["headers"])
    assert opened.status_code == 200, opened.text
    detail = opened.json()
    assert detail["candidate_id"] == str(candidate_id)
    assert "evidence" in detail
    assert detail["visible_to_employers"] is False
    assert detail["resume_version"]["id"] == str(version_id)
    assert detail["resume_version"]["is_latest"] is True
    assert detail["score"]["band"] and "raw_value" not in json.dumps(detail)
    assert "text" not in detail["resume_version"], "the CV text is the CV endpoint's"
    assert all(o["id"] != signal_id for o in detail["other_signals"])
    assert await _audit_rows("admin_integrity_signal_opened", reviewer["user_id"], signal_id) == 1

    cleared = await client.post(
        f"{ADMIN}/integrity/signals/{signal_id}/resolve",
        json={"outcome": "CLEARED", "note": "A quoted example, not an instruction."},
        headers=reviewer["headers"],
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["state"] == "CLEARED"
    assert cleared.json()["hides_candidate"] is False
    assert cleared.json()["resolved_by"] == str(reviewer["user_id"])
    assert await _visible(candidate_id)

    resolved = await _find(
        client, f"{ADMIN}/integrity/signals", reviewer["headers"], signal_id, state="CLEARED"
    )
    assert resolved is not None
    assert resolved["resolution_note"] == "A quoted example, not an instruction."
    assert resolved["resolved_by_email"] == await _scalar(
        "SELECT email FROM users WHERE id = :u", u=reviewer["user_id"]
    )

    twice = await client.post(
        f"{ADMIN}/integrity/signals/{signal_id}/resolve",
        json={"outcome": "CONFIRMED"},
        headers=reviewer["headers"],
    )
    assert twice.status_code == 409


# --- drill-downs ------------------------------------------------------------------------------
async def test_a_candidate_drilldown_masks_contacts_and_is_audited(
    client: Any, mint_token: Any
) -> None:
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    candidate = await _candidate(mint_token)
    url = f"{ADMIN}/candidates/{candidate['id']}"

    response = await client.get(url, headers=agent["headers"])
    assert response.status_code == 200, response.text
    body = response.json()
    phone = await _scalar("SELECT phone FROM users WHERE id = :u", u=candidate["id"])
    assert body["phone_masked"] != phone and body["phone_masked"].endswith(phone[-4:])
    assert body["score"]["display_value"] == candidate["score"]
    assert body["subscription"]["state"] == "ACTIVE"
    assert body["visible_to_employers"] is True
    assert not [key for key in body if "raw" in key or "cognito" in key]
    assert await _audit_rows("admin_candidate_drilldown", agent["user_id"], candidate["id"]) == 1

    await client.get(url, headers=agent["headers"])
    assert await _audit_rows("admin_candidate_drilldown", agent["user_id"], candidate["id"]) == 2

    kyb = await _staff(mint_token, "KYB_REVIEWER")
    assert (await client.get(url, headers=kyb["headers"])).status_code == 403
    missing = await client.get(f"{ADMIN}/candidates/{agent['user_id']}", headers=agent["headers"])
    assert missing.status_code == 404, "a business account is not a candidate"


async def test_staff_find_a_candidate_by_name_or_email_and_the_search_is_audited(
    client: Any, mint_token: Any
) -> None:
    """Candidates are not tenants, so `/admin/tenants` cannot list them. The
    candidate list can, masked, and every page of it is an audit row that
    records a search was made without recording what was searched for."""
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    token = uuid.uuid4().hex[:12]
    email = f"cand-{token}@example.test"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text("UPDATE users SET email = :e WHERE id = :u"),
            {"e": email, "u": str(candidate["id"])},
        )
        await session.execute(
            text(
                "INSERT INTO candidate_profiles (user_id, full_name, city, state_code) "
                "VALUES (:u, :n, 'Pune', 'MH')"
            ),
            {"u": str(candidate["id"]), "n": f"Priya Lister {token}"},
        )
    url, headers = f"{ADMIN}/candidates", agent["headers"]

    by_name = await client.get(url, params={"q": token.upper()}, headers=headers)
    assert by_name.status_code == 200, by_name.text
    [row] = by_name.json()["items"]
    assert row["id"] == str(candidate["id"])
    assert row["full_name"] == f"Priya Lister {token}" and row["city"] == "Pune"
    assert row["email_masked"] == "c***@example.test"
    phone = await _scalar("SELECT phone FROM users WHERE id = :u", u=candidate["id"])
    assert row["phone_masked"] != phone and row["phone_masked"].endswith(phone[-4:])
    assert not [k for k in row if "raw" in k or "cognito" in k or "score" in k]

    by_email = await client.get(url, params={"email": f"  {email.upper()} "}, headers=headers)
    assert [r["id"] for r in by_email.json()["items"]] == [str(candidate["id"])]

    wildcard = await client.get(url, params={"q": f"{token}%"}, headers=headers)
    assert wildcard.json()["items"] == [], "a % in the search is a character, not a wildcard"
    suspended = await client.get(url, params={"q": token, "status": "SUSPENDED"}, headers=headers)
    assert suspended.json()["items"] == []
    staff_email = await _scalar("SELECT email FROM users WHERE id = :u", u=agent["user_id"])
    business = await client.get(url, params={"email": staff_email}, headers=headers)
    assert business.json()["items"] == [], "a business account is never a candidate"

    searches = int(
        await _scalar(
            "SELECT count(*) FROM audit_events WHERE action = 'admin_bypass_session_opened' "
            "AND actor_id = :u AND metadata->>'view' = 'candidates'",
            u=agent["user_id"],
        )
    )
    assert searches == 5
    leaked = await _scalar(
        "SELECT count(*) FROM audit_events WHERE actor_id = :u AND metadata::text ILIKE :t",
        u=agent["user_id"],
        t=f"%{token}%",
    )
    assert int(leaked) == 0, "the search terms are a name and an address, not ids"
    assert await _find(client, url, headers, str(candidate["id"])) is not None, "unfiltered, paged"

    kyb = await _staff(mint_token, "KYB_REVIEWER")
    assert (await client.get(url, headers=kyb["headers"])).status_code == 403


async def test_employer_and_college_drilldowns_are_audited(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    employer = await _employer(client, mint_token)
    college = await _college(client, mint_token, seats_paid=30)
    await _allocate(college["tenant_id"], 10)

    e = await client.get(f"{ADMIN}/employers/{employer['tenant_id']}", headers=admin["headers"])
    assert e.status_code == 200, e.text
    assert e.json()["kyb_status"] == "APPROVED"
    assert e.json()["members_by_role"] == {"EMPLOYER_OWNER": 1}
    assert e.json()["suspension"] is None
    assert (
        await _audit_rows("admin_employer_drilldown", admin["user_id"], employer["tenant_id"]) == 1
    )

    c = await client.get(f"{ADMIN}/colleges/{college['tenant_id']}", headers=admin["headers"])
    assert c.status_code == 200, c.text
    assert c.json()["seats"] == {"allocated": 10, "used": 0, "plan_allowance": 30}
    assert await _audit_rows("admin_college_drilldown", admin["user_id"], college["tenant_id"]) == 1

    # A tenant of the other kind is not found, not mislabelled.
    wrong = await client.get(f"{ADMIN}/colleges/{employer['tenant_id']}", headers=admin["headers"])
    assert wrong.status_code == 404


# --- disputes ----------------------------------------------------------------------------------
async def test_all_three_groups_raise_disputes_and_staff_close_them(
    client: Any, mint_token: Any
) -> None:
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    a = await _applied(client, mint_token)
    college = await _college(client, mint_token, seats_paid=None)

    candidate_dispute = await client.post(
        DISPUTES,
        json={"kind": "PAYMENT", "description": "I was charged twice for one month."},
        headers=a["candidate"]["headers"],
    )
    assert candidate_dispute.status_code == 201, candidate_dispute.text
    employer_dispute = await client.post(
        DISPUTES,
        json={
            "kind": "HIRE",
            "application_id": a["id"],
            "description": "The candidate joined and then said they did not.",
        },
        headers=a["employer"]["headers"],
    )
    assert employer_dispute.status_code == 201, employer_dispute.text
    college_hire = await client.post(
        DISPUTES,
        json={"kind": "HIRE", "application_id": a["id"], "description": "Not ours to raise."},
        headers=college["headers"],
    )
    assert college_hire.status_code == 422
    assert college_hire.json()["code"] == "dispute_kind_not_allowed"

    dispute_id = employer_dispute.json()["id"]
    found = await _find(client, f"{ADMIN}/disputes", agent["headers"], dispute_id, party="EMPLOYER")
    assert found is not None and "description" not in found

    opened = await client.get(f"{ADMIN}/disputes/{dispute_id}", headers=agent["headers"])
    assert opened.status_code == 200, opened.text
    links = opened.json()["links"]
    assert links["application"]["candidate_id"] == str(a["candidate"]["id"])
    assert links["application"]["employer_tenant_id"] == a["employer"]["tenant_id"]
    assert await _audit_rows("admin_dispute_opened", agent["user_id"], dispute_id) == 1

    taken = await client.post(f"{ADMIN}/disputes/{dispute_id}/assign", headers=agent["headers"])
    assert taken.json()["state"] == "IN_REVIEW"
    assert taken.json()["assigned_to"] == str(agent["user_id"])

    closed = await client.post(
        f"{ADMIN}/disputes/{dispute_id}/resolve",
        json={"outcome": "RESOLVED", "resolution": "Confirmed with both parties; the hire stands."},
        headers=agent["headers"],
    )
    assert closed.status_code == 200, closed.text
    again = await client.post(
        f"{ADMIN}/disputes/{dispute_id}/resolve",
        json={"outcome": "REJECTED", "resolution": "Second thoughts."},
        headers=agent["headers"],
    )
    assert again.status_code == 409 and again.json()["code"] == "dispute_closed"

    mine = await client.get(DISPUTES, headers=a["employer"]["headers"])
    ours = next(d for d in mine.json() if d["id"] == dispute_id)
    assert ours["state"] == "RESOLVED" and ours["resolution"].startswith("Confirmed")
    assert "assigned_to" not in ours and "resolved_by" not in ours
    assert candidate_dispute.json()["id"] not in {d["id"] for d in mine.json()}
    theirs = await client.get(DISPUTES, headers=a["candidate"]["headers"])
    assert {d["id"] for d in theirs.json()} == {candidate_dispute.json()["id"]}


async def test_a_dispute_cannot_name_someone_elses_application(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    stranger = await _employer(client, mint_token)
    response = await client.post(
        DISPUTES,
        json={"kind": "HIRE", "application_id": a["id"], "description": "Not our application."},
        headers=stranger["headers"],
    )
    assert response.status_code == 404
    assert response.json()["code"] == "dispute_application_not_found"


async def test_an_organisation_cannot_close_its_own_dispute_in_the_database(
    client: Any, mint_token: Any
) -> None:
    """The tenant policy lets an employer UPDATE its own rows; the guard is
    what keeps the queue ours."""
    employer = await _employer(client, mint_token)
    raised = await client.post(
        DISPUTES,
        json={"kind": "ACCOUNT", "description": "Our recruiter cannot sign in."},
        headers=employer["headers"],
    )
    assert raised.status_code == 201, raised.text
    with pytest.raises(DBAPIError, match="DISPUTE_GUARD"):
        async with sessions(APP_URL)() as session, session.begin():
            await session.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"), {"t": employer["tenant_id"]}
            )
            await session.execute(
                text(
                    "UPDATE disputes SET state = 'RESOLVED', resolution = 'self-served', "
                    "resolved_by = raised_by, resolved_at = now() WHERE id = :d"
                ),
                {"d": raised.json()["id"]},
            )


async def test_a_disputed_hire_lands_in_the_queue_once(client: Any, mint_token: Any) -> None:
    from app.tasks.open_hire_dispute import run

    a = await _at_decision(client, mint_token)
    await client.post(f"{PIPELINE}/{a['id']}/hire", headers=a["employer"]["headers"])
    disputed = await client.post(
        f"{APPLICATIONS}/{a['id']}/hire/dispute", headers=a["candidate"]["headers"]
    )
    assert disputed.status_code == 200, disputed.text

    first = await run(a["id"], str(a["candidate"]["id"]))
    second = await run(a["id"], str(a["candidate"]["id"]))
    assert first["dispute_id"] is not None and second["dispute_id"] is None

    theirs = await client.get(DISPUTES, headers=a["candidate"]["headers"])
    [dispute] = [d for d in theirs.json() if d["application_id"] == a["id"]]
    assert dispute["source"] == "HIRE_DISPUTE" and dispute["kind"] == "HIRE"


# --- audit search -----------------------------------------------------------------------------
async def test_the_audit_trail_is_searchable_paged_and_records_its_own_search(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    for _ in range(3):
        await client.get(f"{ADMIN}/candidates/{candidate['id']}", headers=agent["headers"])

    first = await client.get(
        f"{ADMIN}/audit-events",
        params={
            "actor_id": str(agent["user_id"]),
            "action": "admin_candidate_drilldown",
            "limit": 2,
        },
        headers=admin["headers"],
    )
    assert first.status_code == 200, first.text
    assert len(first.json()["items"]) == 2 and first.json()["next_cursor"]
    rest = await client.get(
        f"{ADMIN}/audit-events",
        params={
            "actor_id": str(agent["user_id"]),
            "action": "admin_candidate_drilldown",
            "limit": 2,
            "cursor": first.json()["next_cursor"],
        },
        headers=admin["headers"],
    )
    ids = [row["id"] for row in first.json()["items"] + rest.json()["items"]]
    assert len(ids) == 3 == len(set(ids))
    assert all(row["target_id"] == str(candidate["id"]) for row in rest.json()["items"])

    assert await _audit_rows("admin_audit_log_searched", admin["user_id"]) == 2
    unknown = await client.get(
        f"{ADMIN}/audit-events", params={"action": "made_up"}, headers=admin["headers"]
    )
    assert unknown.status_code == 422
    assert (await client.get(f"{ADMIN}/audit-events", headers=agent["headers"])).status_code == 403
