"""Day 18 through HTTP and the database: consent after linking.

What this file holds, in order:

  * **INDIVIDUAL is a separate grant** from its own words, on top of a live
    link, and nothing else confers it;
  * **revocation is the student's and is immediate**: revoking INDIVIDUAL
    keeps the link and the seat; disconnecting ends the link, the seat and
    individual visibility in one statement, and access goes with the seat;
  * **the college sees a named student only while that consent is live**,
    and every read that names one is audited;
  * the database holds all of it: a college cannot write or revoke a consent,
    one student cannot revoke another's, and INDIVIDUAL cannot outlive ROSTER.

The helpers at the top are shared with `test_college_analytics.py` and the
invariant 9 tests.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.modules.college.domain import CONSENT_VERSION, INDIVIDUAL_CONSENT_VERSION
from tests.conftest import _seed_url, sessions
from tests.integration.test_college import (
    APP_URL,
    COLLEGE,
    STUDENT,
    _allocate,
    _code,
    _college,
    _link,
)
from tests.integration.test_payments import _candidate, _scalar
from tests.integration.test_roster_import import _committed_and_sent, _phone, _student

pytestmark = pytest.mark.integration

STUDENTS = f"{COLLEGE}/students"
#: A paywalled student route: a seat is what lets a student in.
API_SCORE = "/api/v1/candidate/score/me"


# ===========================================================================
# Shared helpers
# ===========================================================================
async def _linked_student(client: Any, mint_token: Any, college: dict[str, Any]) -> dict[str, Any]:
    """A student linked to `college` through the API, by a fresh code."""
    student = await _candidate(mint_token)
    code = await _code(client, college)
    linked = await _link(client, student, code["code"])
    assert linked.status_code == 201, linked.text
    return student


async def _grant_individual(client: Any, student: dict[str, Any], college_id: str) -> Any:
    return await client.post(
        f"{STUDENT}/{college_id}/individual-visibility",
        json={"consent_version": INDIVIDUAL_CONSENT_VERSION},
        headers=student["headers"],
    )


async def _revoke(client: Any, student: dict[str, Any], college_id: str, scope: str) -> Any:
    return await client.post(
        f"{STUDENT}/{college_id}/revoke", json={"scope": scope}, headers=student["headers"]
    )


async def _seed_student(
    college: dict[str, Any],
    code_id: str,
    *,
    score: int | None = None,
    individual: bool = False,
    name: str | None = None,
) -> uuid.UUID:
    """A candidate linked to `college` as the migrator writes it -- for
    analytics, where a cohort of ten through the API would be slow and would
    exercise nothing new. Optionally scored, named and individually visible."""
    user_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, status, locale) "
                "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "p": f"+9193{uuid.uuid4().int % 10**8:08d}"},
        )
        await session.execute(
            text(
                "INSERT INTO student_consents (id, tenant_id, candidate_id, scope, granted_via, "
                "referral_code_id, consent_version) VALUES "
                "(gen_random_uuid(), :t, :u, 'ROSTER', 'REFERRAL_CODE', :r, :v)"
            ),
            {"t": college["tenant_id"], "u": str(user_id), "r": code_id, "v": CONSENT_VERSION},
        )
        if individual:
            await session.execute(
                text(
                    "INSERT INTO student_consents (id, tenant_id, candidate_id, scope, "
                    "granted_via, consent_version) VALUES "
                    "(gen_random_uuid(), :t, :u, 'INDIVIDUAL', 'DIRECT', :v)"
                ),
                {"t": college["tenant_id"], "u": str(user_id), "v": INDIVIDUAL_CONSENT_VERSION},
            )
        if name is not None:
            await session.execute(
                text("INSERT INTO candidate_profiles (user_id, full_name) VALUES (:u, :n)"),
                {"u": str(user_id), "n": name},
            )
        if score is not None:
            await _insert_score(session, user_id, score)
    return user_id


async def _insert_score(session: Any, user_id: uuid.UUID, score: int) -> None:
    version_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO resume_versions (id, user_id, source, parsed, confirmed_at) "
            "VALUES (:v, :u, 'UPLOAD', '{}'::jsonb, now())"
        ),
        {"v": str(version_id), "u": str(user_id)},
    )
    base = min(score, 900)
    await session.execute(
        text(
            "INSERT INTO scores (id, user_id, resume_version_id, algorithm_version, raw_value, "
            "base_value, addon_value, contribution_version) VALUES "
            "(gen_random_uuid(), :u, :v, 'test', :raw, :base, :addon, 'v1')"
        ),
        {
            "u": str(user_id),
            "v": str(version_id),
            "raw": score,
            "base": base,
            "addon": score - base,
        },
    )


async def _employer(location: str | None = "Pune") -> tuple[uuid.UUID, uuid.UUID]:
    """An approved employer with one published job, as the migrator."""
    tenant_id, job_id = uuid.uuid4(), uuid.uuid4()
    name = f"Hiring Co {tenant_id.hex[:6]}"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO tenants (id, type, name, status) VALUES (:t, 'EMPLOYER', :n, 'ACTIVE')"
            ),
            {"t": str(tenant_id), "n": name},
        )
        await session.execute(
            text(
                "INSERT INTO employers (tenant_id, legal_name, kyb_status) "
                "VALUES (:t, :n, 'APPROVED')"
            ),
            {"t": str(tenant_id), "n": name},
        )
        await session.execute(
            text(
                "INSERT INTO jobs (id, tenant_id, title, description, location, salary_min_minor, "
                "salary_max_minor, status) VALUES (:j, :t, 'Graduate Engineer', 'd', :loc, "
                "1000000, 2000000, 'PUBLISHED')"
            ),
            {"j": str(job_id), "t": str(tenant_id), "loc": location},
        )
    return tenant_id, job_id


async def _application(
    employer: tuple[uuid.UUID, uuid.UUID], candidate_id: uuid.UUID, *, outcome: str
) -> uuid.UUID:
    """An application walked one UPDATE per stage, as the guard requires.
    `outcome`: SUBMITTED, INTERVIEW (reached one), HIRED (both confirmed) or
    DISPUTED (proposed by the employer, disputed by the candidate)."""
    tenant_id, job_id = employer
    application = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage) "
                "VALUES (:a, :t, :j, :c, 'SUBMITTED')"
            ),
            {"a": str(application), "t": str(tenant_id), "j": str(job_id), "c": str(candidate_id)},
        )
        if outcome == "SUBMITTED":
            return application
        for stage in ("VIEWED", "SHORTLISTED", "INTERVIEW", "DECISION"):
            await session.execute(
                text("UPDATE applications SET stage = :s WHERE id = :a"),
                {"s": stage, "a": str(application)},
            )
        await session.execute(
            text(
                "INSERT INTO application_events (id, application_id, kind, from_stage, to_stage, "
                "actor_type) VALUES (gen_random_uuid(), :a, 'STAGE_CHANGED', 'SHORTLISTED', "
                "'INTERVIEW', 'SYSTEM')"
            ),
            {"a": str(application)},
        )
        if outcome == "INTERVIEW":
            return application
        await session.execute(
            text("UPDATE applications SET employer_confirmed_at = now() WHERE id = :a"),
            {"a": str(application)},
        )
        if outcome == "DISPUTED":
            await session.execute(
                text("UPDATE applications SET hire_disputed_at = now() WHERE id = :a"),
                {"a": str(application)},
            )
            return application
        await session.execute(
            text(
                "UPDATE applications SET stage = 'HIRED', candidate_confirmed_at = now() "
                "WHERE id = :a"
            ),
            {"a": str(application)},
        )
    return application


async def _audit_count(action: str, tenant_id: str, target_id: Any | None = None) -> int:
    sql = "SELECT count(*) FROM audit_events WHERE action = :a AND tenant_id = :t"
    params: dict[str, Any] = {"a": action, "t": tenant_id}
    if target_id is not None:
        sql += " AND target_id = :g"
        params["g"] = target_id
    return int(await _scalar(sql, **params))


# ===========================================================================
# Granting INDIVIDUAL
# ===========================================================================
async def test_individual_visibility_is_a_separate_grant_on_top_of_a_link(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    student = await _candidate(mint_token)

    terms = await client.get(
        f"{STUDENT}/consent-terms", params={"scope": "INDIVIDUAL"}, headers=student["headers"]
    )
    assert terms.status_code == 200
    assert terms.json()["scope"] == "INDIVIDUAL"
    assert terms.json()["consent_version"] == INDIVIDUAL_CONSENT_VERSION
    roster_terms = (await client.get(f"{STUDENT}/consent-terms", headers=student["headers"])).json()
    assert roster_terms["scope"] == "ROSTER" and roster_terms["text"] != terms.json()["text"]

    unlinked = await _grant_individual(client, student, college["tenant_id"])
    assert unlinked.status_code == 404 and unlinked.json()["code"] == "college_link_not_found"

    code = await _code(client, college)
    assert (await _link(client, student, code["code"])).status_code == 201
    stale = await client.post(
        f"{STUDENT}/{college['tenant_id']}/individual-visibility",
        json={"consent_version": CONSENT_VERSION.replace("1", "0")},
        headers=student["headers"],
    )
    assert stale.status_code == 409 and stale.json()["code"] == "consent_version_outdated"

    granted = await _grant_individual(client, student, college["tenant_id"])
    assert granted.status_code == 201, granted.text
    assert (granted.json()["scope"], granted.json()["granted_via"]) == ("INDIVIDUAL", "DIRECT")
    again = await _grant_individual(client, student, college["tenant_id"])
    assert again.status_code == 200 and again.json()["granted_at"] == granted.json()["granted_at"]

    links = (await client.get(STUDENT, headers=student["headers"])).json()
    assert sorted(link["scope"] for link in links) == ["INDIVIDUAL", "ROSTER"]
    assert await _audit_count("consent_granted", college["tenant_id"]) == 2


async def test_linking_never_makes_a_student_visible(client: Any, mint_token: Any) -> None:
    """PRD 3.8: roster consent never implies individual visibility."""
    college = await _college(client, mint_token)
    student = await _linked_student(client, mint_token, college)

    listed = await client.get(STUDENTS, headers=college["headers"])
    assert listed.status_code == 200 and listed.json()["items"] == []
    opened = await client.get(f"{STUDENTS}/{student['id']}", headers=college["headers"])
    assert opened.status_code == 404 and opened.json()["code"] == "college_student_not_found"
    assert await _audit_count("college_student_viewed", college["tenant_id"]) == 0
    assert await _audit_count("college_students_listed", college["tenant_id"]) == 0


# ===========================================================================
# Revocation
# ===========================================================================
async def test_revoking_individual_keeps_the_link_and_the_seat(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    await _allocate(college["tenant_id"], 5)
    student = await _linked_student(client, mint_token, college)
    assert (await _grant_individual(client, student, college["tenant_id"])).status_code == 201
    assert (
        await client.get(f"{STUDENTS}/{student['id']}", headers=college["headers"])
    ).status_code == 200

    revoked = await _revoke(client, student, college["tenant_id"], "INDIVIDUAL")
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["revoked"] == ["INDIVIDUAL"] and revoked.json()["revoked_at"]

    # Effective on the very next read.
    gone = await client.get(f"{STUDENTS}/{student['id']}", headers=college["headers"])
    assert gone.status_code == 404
    links = {
        link["scope"]: link
        for link in (await client.get(STUDENT, headers=student["headers"])).json()
    }
    assert links["ROSTER"]["revoked_at"] is None and links["ROSTER"]["seat_held"] is True
    assert links["INDIVIDUAL"]["revoked_at"] is not None
    # Still seated, so still in.
    assert (await client.get(API_SCORE, headers=student["headers"])).status_code != 402
    seats = (await client.get(f"{COLLEGE}/seats", headers=college["headers"])).json()
    assert seats["seats_used"] == 1

    retried = await _revoke(client, student, college["tenant_id"], "INDIVIDUAL")
    assert retried.status_code == 200 and retried.json()["revoked"] == []
    assert await _audit_count("consent_revoked", college["tenant_id"]) == 1


async def test_disconnecting_ends_the_link_the_seat_and_visibility_at_once(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    await _allocate(college["tenant_id"], 5)
    student = await _linked_student(client, mint_token, college)
    assert (await _grant_individual(client, student, college["tenant_id"])).status_code == 201
    # A seat is the student's access: a paywalled student route answers.
    paywalled = API_SCORE
    assert (await client.get(paywalled, headers=student["headers"])).status_code != 402

    revoked = await _revoke(client, student, college["tenant_id"], "ROSTER")
    assert revoked.status_code == 200, revoked.text
    assert revoked.json()["revoked"] == ["ROSTER", "INDIVIDUAL"]

    links = (await client.get(STUDENT, headers=student["headers"])).json()
    assert len(links) == 2 and all(link["revoked_at"] for link in links)
    assert len({link["revoked_at"] for link in links}) == 1, "one instant, one statement"
    assert all(link["seat_held"] is False for link in links)
    seats = (await client.get(f"{COLLEGE}/seats", headers=college["headers"])).json()
    assert seats["seats_used"] == 0
    assert (await client.get(paywalled, headers=student["headers"])).status_code == 402
    assert (
        await client.get(f"{STUDENTS}/{student['id']}", headers=college["headers"])
    ).status_code == 404

    assert await _audit_count("consent_revoked", college["tenant_id"]) == 2
    payload = await _scalar(
        "SELECT payload::text FROM outbox WHERE event_type = 'college.consent_revoked' "
        "AND payload->>'tenant_id' = :t",
        t=college["tenant_id"],
    )
    assert payload is not None and "ROSTER" in payload
    assert str(student["id"]) not in payload, "ids of consents only, never the student"

    # A disconnected student can link again, and is a new grant.
    code = await _code(client, college)
    assert (await _link(client, student, code["code"])).status_code == 201
    individual = await _grant_individual(client, student, college["tenant_id"])
    assert individual.status_code == 201


async def test_revoking_at_a_college_never_linked_is_a_404(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    student = await _candidate(mint_token)
    for scope in ("ROSTER", "INDIVIDUAL"):
        refused = await _revoke(client, student, college["tenant_id"], scope)
        assert refused.status_code == 404 and refused.json()["code"] == "college_link_not_found"
    bad = await client.post(
        f"{STUDENT}/{college['tenant_id']}/revoke",
        json={"scope": "ALL"},
        headers=student["headers"],
    )
    assert bad.status_code == 422


async def test_revoking_is_never_paywalled(client: Any, mint_token: Any) -> None:
    """A college that stopped paying cannot hold a student's consent hostage."""
    college = await _college(client, mint_token)
    student = await _linked_student(client, mint_token, college)
    assert (await _grant_individual(client, student, college["tenant_id"])).status_code == 201
    from tests.integration.test_college import _lapse

    await _lapse(college["subscription_id"])
    assert (await _revoke(client, student, college["tenant_id"], "ROSTER")).status_code == 200


# ===========================================================================
# The college's view
# ===========================================================================
async def test_the_college_sees_a_consenting_student_and_every_read_is_audited(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    code = await _code(client, college)
    visible = await _seed_student(college, code["id"], score=871, individual=True, name="Asha Rao")
    counted = await _seed_student(college, code["id"], score=750)
    unscored = await _seed_student(college, code["id"], individual=True)

    employer = await _employer("Pune")
    await _application(employer, visible, outcome="HIRED")
    await _application(employer, visible, outcome="SUBMITTED")
    other = await _employer("Nagpur")
    await _application(other, visible, outcome="INTERVIEW")

    listed = await client.get(STUDENTS, headers=college["headers"])
    assert listed.status_code == 200, listed.text
    ids = [item["candidate_id"] for item in listed.json()["items"]]
    assert set(ids) == {str(visible), str(unscored)} and str(counted) not in ids
    names = {item["candidate_id"]: item["full_name"] for item in listed.json()["items"]}
    assert names[str(visible)] == "Asha Rao" and names[str(unscored)] is None
    assert {item["link_state"] for item in listed.json()["items"]} == {"LINKED"}

    opened = await client.get(f"{STUDENTS}/{visible}", headers=college["headers"])
    assert opened.status_code == 200, opened.text
    body = opened.json()
    assert (body["full_name"], body["score"], body["band"]) == ("Asha Rao", 871, "STRONG")
    assert (body["applications"], body["interviews"]) == (3, 2)
    assert len(body["hires"]) == 1
    hire = body["hires"][0]
    assert (hire["job_title"], hire["source"]) == ("Graduate Engineer", "PLATFORM")
    assert hire["employer_name"].startswith("Hiring Co")

    no_score = (await client.get(f"{STUDENTS}/{unscored}", headers=college["headers"])).json()
    assert (no_score["score"], no_score["band"], no_score["hires"]) == (None, None, [])

    # Staff read too, and re-opens are audited like first opens.
    staff_email = f"{uuid.uuid4().hex[:12]}@example.test"
    await client.post(
        f"{COLLEGE}/team",
        json={"email": staff_email, "role": "COLLEGE_STAFF"},
        headers=college["headers"],
    )
    staff_headers, _ = mint_token(pool="BUSINESS", email=staff_email)
    assert (await client.get(f"{STUDENTS}/{visible}", headers=staff_headers)).status_code == 200

    assert await _audit_count("college_student_viewed", college["tenant_id"], str(visible)) == 2
    assert await _audit_count("college_student_viewed", college["tenant_id"], str(unscored)) == 1
    assert await _audit_count("college_students_listed", college["tenant_id"]) == 1
    listed_ids = await _scalar(
        "SELECT metadata::text FROM audit_events WHERE action = 'college_students_listed' "
        "AND tenant_id = :t",
        t=college["tenant_id"],
    )
    assert str(visible) in listed_ids and "Asha" not in listed_ids


async def test_the_list_pages_and_a_bad_cursor_is_refused(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    code = await _code(client, college)
    seeded = {str(await _seed_student(college, code["id"], individual=True)) for _ in range(3)}
    first = (await client.get(STUDENTS, params={"limit": 2}, headers=college["headers"])).json()
    assert len(first["items"]) == 2 and first["next_cursor"]
    second = (
        await client.get(
            STUDENTS,
            params={"limit": 2, "cursor": first["next_cursor"]},
            headers=college["headers"],
        )
    ).json()
    assert second["next_cursor"] is None
    assert {i["candidate_id"] for i in first["items"] + second["items"]} == seeded
    bad = await client.get(STUDENTS, params={"cursor": "e30"}, headers=college["headers"])
    assert bad.status_code == 422


async def test_the_list_searches_names_before_paginating(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    code = await _code(client, college)
    matching = {
        str(
            await _seed_student(
                college,
                code["id"],
                individual=True,
                name=f"Searchable Student {suffix}",
            )
        )
        for suffix in ("Alpha", "Beta", "Gamma")
    }
    await _seed_student(
        college,
        code["id"],
        individual=True,
        name="Different Name",
    )

    first_response = await client.get(
        STUDENTS,
        params={"q": "  sEaRcHaBlE  ", "limit": 2},
        headers=college["headers"],
    )
    assert first_response.status_code == 200, first_response.text
    first = first_response.json()
    assert len(first["items"]) == 2 and first["next_cursor"]

    second_response = await client.get(
        STUDENTS,
        params={"q": "searchable", "limit": 2, "cursor": first["next_cursor"]},
        headers=college["headers"],
    )
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()
    assert second["next_cursor"] is None
    assert {item["candidate_id"] for item in first["items"] + second["items"]} == matching

    no_match = await client.get(
        STUDENTS,
        params={"q": "Nobody has this name", "limit": 10},
        headers=college["headers"],
    )
    assert no_match.status_code == 200
    assert no_match.json() == {"items": [], "next_cursor": None}

    too_long = await client.get(
        STUDENTS,
        params={"q": "x" * 101},
        headers=college["headers"],
    )
    assert too_long.status_code == 422


async def test_the_list_filters_every_link_stage(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    code = await _code(client, college)
    linked = await _seed_student(
        college,
        code["id"],
        individual=True,
        name="Linked Student",
    )

    invited_phone = _phone()
    await _committed_and_sent(
        client,
        college,
        f"name,phone\nInvited Student,{invited_phone}\n",
    )

    pending_phone = _phone()
    await _committed_and_sent(
        client,
        college,
        f"name,phone\nConsent Pending Student,{pending_phone}\n",
    )
    pending_student = await _student(mint_token, pending_phone)
    invitation = (
        await client.get(f"{STUDENT}/invitations", headers=pending_student["headers"])
    ).json()[0]
    accepted = await client.post(
        f"{STUDENT}/invitations/{invitation['id']}/accept",
        json={"consent_version": CONSENT_VERSION},
        headers=pending_student["headers"],
    )
    # 200, as `test_roster_import.py` holds: accepting answers with the link.
    assert accepted.status_code == 200, accepted.text

    expected = {
        "LINKED": ("Linked Student", str(linked)),
        "INVITED": ("Invited Student", None),
        "CONSENT_PENDING": ("Consent Pending Student", None),
    }
    for stage, (name, candidate_id) in expected.items():
        response = await client.get(
            STUDENTS,
            params={"stage": stage, "q": name.split()[0]},
            headers=college["headers"],
        )
        assert response.status_code == 200, response.text
        assert len(response.json()["items"]) == 1
        item = response.json()["items"][0]
        assert (item["full_name"], item["link_state"], item["candidate_id"]) == (
            name,
            stage,
            candidate_id,
        )
        assert (item["roster_entry_id"] is None) == (stage == "LINKED")
        assert item["stage_since"]

    all_stages = await client.get(
        STUDENTS,
        params={"stage": "ALL"},
        headers=college["headers"],
    )
    assert all_stages.status_code == 200, all_stages.text
    assert {item["link_state"] for item in all_stages.json()["items"]} == {
        "LINKED",
        "INVITED",
        "CONSENT_PENDING",
    }

    title_case_all = await client.get(
        STUDENTS,
        params={"stage": "All"},
        headers=college["headers"],
    )
    assert title_case_all.status_code == 200, title_case_all.text
    assert {item["link_state"] for item in title_case_all.json()["items"]} == {
        "LINKED",
        "INVITED",
        "CONSENT_PENDING",
    }

    invalid = await client.get(
        STUDENTS,
        params={"stage": "UNKNOWN"},
        headers=college["headers"],
    )
    assert invalid.status_code == 422


async def test_a_student_visible_to_one_college_is_not_visible_to_another(
    client: Any, mint_token: Any
) -> None:
    college_a = await _college(client, mint_token)
    college_b = await _college(client, mint_token)
    code_a = await _code(client, college_a)
    code_b = await _code(client, college_b)
    student = await _seed_student(college_a, code_a["id"], individual=True, name="Both")
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO student_consents (id, tenant_id, candidate_id, scope, granted_via, "
                "referral_code_id, consent_version) VALUES "
                "(gen_random_uuid(), :t, :u, 'ROSTER', 'REFERRAL_CODE', :r, :v)"
            ),
            {
                "t": college_b["tenant_id"],
                "u": str(student),
                "r": code_b["id"],
                "v": CONSENT_VERSION,
            },
        )
    assert (
        await client.get(f"{STUDENTS}/{student}", headers=college_a["headers"])
    ).status_code == 200
    assert (
        await client.get(f"{STUDENTS}/{student}", headers=college_b["headers"])
    ).status_code == 404
    assert (await client.get(STUDENTS, headers=college_b["headers"])).json()["items"] == []


async def test_the_view_is_for_paying_colleges_and_college_roles(
    client: Any, mint_token: Any
) -> None:
    unpaid = await _college(client, mint_token, seats_paid=None)
    assert (await client.get(STUDENTS, headers=unpaid["headers"])).status_code == 402
    student = await _candidate(mint_token)
    assert (await client.get(STUDENTS, headers=student["headers"])).status_code == 403


# ===========================================================================
# The database holds it
# ===========================================================================
async def test_a_college_cannot_write_or_revoke_a_consent(client: Any, mint_token: Any) -> None:
    """SRS 1.15.3: institution-side bypass of student consent is prohibited.
    The tenant policy alone would allow both; the RESTRICTIVE policies do not."""
    college = await _college(client, mint_token)
    code = await _code(client, college)
    student = await _linked_student(client, mint_token, college)
    stranger = await _candidate(mint_token)

    async def as_college(sql: str, **params: Any) -> int:
        async with sessions(APP_URL)() as session, session.begin():
            await session.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"), {"t": college["tenant_id"]}
            )
            result = await session.execute(text(sql), params)
            return int(result.rowcount or 0)

    with pytest.raises(DBAPIError):
        await as_college(
            "INSERT INTO student_consents (id, tenant_id, candidate_id, scope, granted_via, "
            "referral_code_id, consent_version) VALUES "
            "(gen_random_uuid(), :t, :c, 'ROSTER', 'REFERRAL_CODE', :r, :v)",
            t=college["tenant_id"],
            c=str(stranger["id"]),
            r=code["id"],
            v=CONSENT_VERSION,
        )
    revoked = await as_college(
        "UPDATE student_consents SET revoked_at = now() WHERE candidate_id = :c",
        c=str(student["id"]),
    )
    assert revoked == 0
    assert (
        await _scalar(
            "SELECT count(*) FROM student_consents WHERE candidate_id = :c AND revoked_at IS NULL",
            c=student["id"],
        )
        == 1
    )


async def test_a_student_revokes_only_their_own_consent(client: Any, mint_token: Any) -> None:
    college = await _college(client, mint_token)
    victim = await _linked_student(client, mint_token, college)
    attacker = await _candidate(mint_token)
    async with sessions(APP_URL)() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.user_id', :u, true)"), {"u": str(attacker["id"])}
        )
        result = await session.execute(
            text("UPDATE student_consents SET revoked_at = now() WHERE candidate_id = :c"),
            {"c": str(victim["id"])},
        )
    assert result.rowcount == 0
    assert (
        await _scalar(
            "SELECT count(*) FROM student_consents WHERE candidate_id = :c AND revoked_at IS NULL",
            c=victim["id"],
        )
        == 1
    )


async def test_individual_cannot_exist_without_a_live_link(client: Any, mint_token: Any) -> None:
    """For every writer, the migrator included."""
    college = await _college(client, mint_token)
    student = await _candidate(mint_token)

    async def insert(scope: str, via: str, code_id: str | None = None) -> None:
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text(
                    "INSERT INTO student_consents (id, tenant_id, candidate_id, scope, "
                    "granted_via, referral_code_id, consent_version) VALUES "
                    "(gen_random_uuid(), :t, :c, :s, :g, :r, :v)"
                ),
                {
                    "t": college["tenant_id"],
                    "c": str(student["id"]),
                    "s": scope,
                    "g": via,
                    "r": code_id,
                    "v": INDIVIDUAL_CONSENT_VERSION,
                },
            )

    with pytest.raises(DBAPIError, match="needs a live link"):
        await insert("INDIVIDUAL", "DIRECT")
    code = await _code(client, college)
    await insert("ROSTER", "REFERRAL_CODE", code["id"])
    # Linked now, so only the constraint stands in the way: a code confers
    # ROSTER and only DIRECT confers INDIVIDUAL.
    with pytest.raises(DBAPIError, match="ck_student_consents_scope_via"):
        await insert("INDIVIDUAL", "REFERRAL_CODE", code["id"])
    with pytest.raises(DBAPIError, match="ck_student_consents_scope_via"):
        await insert("ROSTER", "DIRECT")

    # And revoking the link as the migrator still takes INDIVIDUAL with it.
    await insert("INDIVIDUAL", "DIRECT")
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "UPDATE student_consents SET revoked_at = now() "
                "WHERE candidate_id = :c AND scope = 'ROSTER'"
            ),
            {"c": str(student["id"])},
        )
    assert (
        await _scalar(
            "SELECT count(*) FROM student_consents WHERE candidate_id = :c AND revoked_at IS NULL",
            c=student["id"],
        )
        == 0
    )
