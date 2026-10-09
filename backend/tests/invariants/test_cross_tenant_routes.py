"""Tenant A asking for tenant B's resource gets a 404.

**Every tenant-scoped route that takes an identifier must have a case here, or
this file fails the build.** The plan asks for "every tenant-scoped endpoint",
and a list written once goes stale the day the next endpoint lands. So the
routes are enumerated from the running application, and a route with an id in
its path and no registered cross-tenant case is a failure that names it.

404, never 403: a 403 would confirm that tenant B's resource exists
(`app/core/errors.py`). Row-Level Security proves isolation in the database
(`test_rls_and_grants.py`); this proves it through the API, where a missing
`WHERE` or a tenant id read from the path would actually leak.

Routes with no identifier -- "my organisation", "my team" -- cannot name
another tenant's resource at all, so they get a different check: that what
comes back is only ever the caller's own.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions, subscribe_tenant
from tests.integration.test_resume_intake import FakeS3, fake_s3  # noqa: F401 - fixture

pytestmark = [pytest.mark.invariant, pytest.mark.integration]

API = "/api/v1"
#: The surfaces whose routes act on one tenant's data.
#:
#: **`/admin` is not on this list, and is not dropped from coverage.**
#: A console route crosses tenants by design -- reading any organisation is
#: what a member of staff is for -- so "tenant A asking for tenant B's
#: resource is a 404" has no tenant A to ask. The guarantee that replaces it is
#: stronger and enumerated the same way: no employer, college or candidate
#: reaches any `/admin` route at all, whatever the id
#: (`tests/invariants/test_admin_console.py`).
TENANT_SURFACES = (f"{API}/employer", f"{API}/college")
ORG = {"legal_name": "Isolation Test Pvt Ltd", "industry": "IT_SOFTWARE"}
JOB = {
    "title": "Isolation test job",
    "description": "A job that belongs to exactly one organisation.",
    "salary_min_minor": 100_000,
    "salary_max_minor": 200_000,
}


def _email() -> str:
    return f"{uuid.uuid4().hex[:12]}@example.test"


async def _organisation(client: Any, mint_token: Any) -> dict[str, Any]:
    """A tenant with an owner, one viewer and one draft job."""
    headers, _ = mint_token(pool="BUSINESS", email=_email())
    created = await client.post(f"{API}/employer/organisation", json=ORG, headers=headers)
    assert created.status_code == 201, created.text
    await subscribe_tenant(created.json()["tenant_id"])
    member = await client.post(
        f"{API}/employer/team", json={"email": _email(), "role": "EMPLOYER_VIEWER"}, headers=headers
    )
    assert member.status_code == 201, member.text
    job = await client.post(f"{API}/employer/jobs", json=JOB, headers=headers)
    assert job.status_code == 201, job.text
    return {
        "headers": headers,
        "tenant_id": created.json()["tenant_id"],
        "member_id": member.json()["user_id"],
        "job_id": job.json()["id"],
    }


Case = Callable[[Any, dict[str, Any], dict[str, Any]], Awaitable[Any]]


async def _patch_other_member(client: Any, attacker: dict, victim: dict) -> Any:
    return await client.patch(
        f"{API}/employer/team/{victim['member_id']}",
        json={"role": "EMPLOYER_OWNER"},
        headers=attacker["headers"],
    )


async def _delete_other_member(client: Any, attacker: dict, victim: dict) -> Any:
    return await client.delete(
        f"{API}/employer/team/{victim['member_id']}", headers=attacker["headers"]
    )


async def _get_other_job(client: Any, attacker: dict, victim: dict) -> Any:
    return await client.get(f"{API}/employer/jobs/{victim['job_id']}", headers=attacker["headers"])


async def _patch_other_job(client: Any, attacker: dict, victim: dict) -> Any:
    return await client.patch(
        f"{API}/employer/jobs/{victim['job_id']}",
        json={"title": "Taken over"},
        headers=attacker["headers"],
    )


def _move_other_job(action: str) -> Case:
    async def case(client: Any, attacker: dict, victim: dict) -> Any:
        return await client.post(
            f"{API}/employer/jobs/{victim['job_id']}/{action}", headers=attacker["headers"]
        )

    return case


async def _complete_other_kyb_document(client: Any, attacker: dict, victim: dict) -> Any:
    """The victim uploads a real object; the attacker names its upload id.
    The key is rebuilt from the *attacker's* organisation, so there is nothing
    there -- and the victim's object must be left exactly where it was."""
    fake: FakeS3 = victim["fake_s3"]
    ticket = await client.post(
        f"{API}/employer/kyb/documents", json={"doc_type": "doc_pan"}, headers=victim["headers"]
    )
    assert ticket.status_code == 201, ticket.text
    body = ticket.json()
    key = urlparse(body["url"]).path.split("/", 2)[2]
    fake.objects[key] = b"%PDF-1.7\n" + b"0" * 64

    response = await client.post(
        f"{API}/employer/kyb/documents/{body['upload_id']}/complete",
        json={"doc_type": "doc_pan"},
        headers=attacker["headers"],
    )
    assert key in fake.objects, "the victim's document was touched"
    return response


async def _victim_application(victim: dict[str, Any]) -> str:
    """An application in the victim's pipeline, seeded as the migrator: a
    candidate, a live job of the victim's, and a SUBMITTED application to it."""
    candidate, job, application = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, status, locale) "
                "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(candidate), "p": f"+9195{uuid.uuid4().int % 10**8:08d}"},
        )
        await session.execute(
            text("UPDATE employers SET kyb_status = 'APPROVED' WHERE tenant_id = :t"),
            {"t": victim["tenant_id"]},
        )
        await session.execute(
            text(
                "INSERT INTO jobs (id, tenant_id, title, description, salary_min_minor, "
                "salary_max_minor, status) VALUES (:j, :t, 'Pipeline job', 'd', 1, 2, 'PUBLISHED')"
            ),
            {"j": str(job), "t": victim["tenant_id"]},
        )
        await session.execute(
            text(
                "INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage) "
                "VALUES (:a, :t, :j, :c, 'SUBMITTED')"
            ),
            {"a": str(application), "t": victim["tenant_id"], "j": str(job), "c": str(candidate)},
        )
    return str(application)


async def _assert_untouched(application_id: str) -> None:
    """Opening, moving, booking and hiring all write. None of them may have."""
    async with sessions(_seed_url())() as session:
        row = (
            await session.execute(
                text(
                    "SELECT stage, meeting_url, employer_confirmed_at FROM applications "
                    "WHERE id = :a"
                ),
                {"a": application_id},
            )
        ).one()
        events = await session.scalar(
            text("SELECT count(*) FROM application_events WHERE application_id = :a"),
            {"a": application_id},
        )
    assert tuple(row) == ("SUBMITTED", None, None), row
    assert events == 0


def _pipeline_case(method: str, suffix: str, body: dict[str, Any] | None = None) -> Case:
    async def case(client: Any, attacker: dict, victim: dict) -> Any:
        application = await _victim_application(victim)
        response = await client.request(
            method,
            f"{API}/employer/applications/{application}{suffix}",
            json=body,
            headers=attacker["headers"],
        )
        await _assert_untouched(application)
        return response

    return case


async def _reveal_other_member(client: Any, attacker: dict, victim: dict) -> Any:
    """A candidate belongs to no tenant, so what this route must protect is the
    other organisation's people: naming tenant B's staff member as a candidate
    reveals nothing about them. The attacker is paid (the helper) and approved,
    so the refusal is the lookup's and not a gate's."""
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text("UPDATE employers SET kyb_status = 'APPROVED' WHERE tenant_id = :t"),
            {"t": attacker["tenant_id"]},
        )
    return await client.get(
        f"{API}/employer/discovery/candidates/{victim['member_id']}", headers=attacker["headers"]
    )


def _shortlist_case(method: str, suffix: str) -> Case:
    """2026-10-05. Tenant B saves a candidate it opened; tenant A names B's
    entry. Both are approved and paid, so the refusal is the lookup's."""

    async def case(client: Any, attacker: dict, victim: dict) -> Any:
        from tests.integration.test_masked_search import _candidate, _token

        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("UPDATE employers SET kyb_status = 'APPROVED' WHERE tenant_id IN (:a, :v)"),
                {"a": attacker["tenant_id"], "v": victim["tenant_id"]},
            )
        candidate = await _candidate(victim["mint_token"], _token())
        opened = await client.get(
            f"{API}/employer/discovery/candidates/{candidate['id']}", headers=victim["headers"]
        )
        assert opened.status_code == 200, opened.text
        saved = await client.post(
            f"{API}/employer/shortlist",
            json={"candidate_id": str(candidate["id"])},
            headers=victim["headers"],
        )
        assert saved.status_code == 201, saved.text
        entry_id = saved.json()["id"]
        response = await client.request(
            method, f"{API}/employer/shortlist/{entry_id}{suffix}", headers=attacker["headers"]
        )
        theirs = (await client.get(f"{API}/employer/shortlist", headers=victim["headers"])).json()
        assert [(e["id"], e["status"]) for e in theirs["items"]] == [(entry_id, "SAVED")], (
            "the other organisation's shortlist changed"
        )
        return response

    return case


# ---------------------------------------------------------------------------
# Colleges. The employer organisations the runner builds cannot name
# a college's resources, so each case builds a college on each side.
# ---------------------------------------------------------------------------
async def _college_pair(client: Any, mint_token: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    from tests.integration.test_college import _college

    return await _college(client, mint_token), await _college(client, mint_token)


def _college_member_case(method: str) -> Case:
    async def case(client: Any, attacker: dict, victim: dict) -> Any:
        mint_token = victim["mint_token"]
        college_a, college_b = await _college_pair(client, mint_token)
        member = await client.post(
            f"{API}/college/team",
            json={"email": _email(), "role": "COLLEGE_STAFF"},
            headers=college_b["headers"],
        )
        assert member.status_code == 201, member.text
        member_id = member.json()["user_id"]
        response = await client.request(
            method,
            f"{API}/college/team/{member_id}",
            json={"role": "COLLEGE_ADMIN"} if method == "PATCH" else None,
            headers=college_a["headers"],
        )
        team = (await client.get(f"{API}/college/team", headers=college_b["headers"])).json()
        assert {"user_id": member_id, "role": "COLLEGE_STAFF"}.items() <= next(
            m for m in team if m["user_id"] == member_id
        ).items(), "the other college's team changed"
        return response

    return case


async def _revoke_other_colleges_code(client: Any, attacker: dict, victim: dict) -> Any:
    college_a, college_b = await _college_pair(client, victim["mint_token"])
    code = await client.post(f"{API}/college/referral-codes", json={}, headers=college_b["headers"])
    assert code.status_code == 201, code.text
    response = await client.post(
        f"{API}/college/referral-codes/{code.json()['id']}/revoke", headers=college_a["headers"]
    )
    codes = (
        await client.get(f"{API}/college/referral-codes", headers=college_b["headers"])
    ).json()["items"]
    assert codes[0]["state"] == "ACTIVE", "the other college's code was revoked"
    return response


def _roster_case(method: str, suffix: str) -> Case:
    async def case(client: Any, attacker: dict, victim: dict) -> Any:
        college_a, college_b = await _college_pair(client, victim["mint_token"])
        upload = await client.post(
            f"{API}/college/roster-imports",
            json={"file_name": "r.csv", "csv": f"phone\n9{uuid.uuid4().int % 10**9:09d}\n"},
            headers=college_b["headers"],
        )
        assert upload.status_code == 201, upload.text
        import_id = upload.json()["id"]
        response = await client.request(
            method,
            f"{API}/college/roster-imports/{import_id}{suffix}",
            headers=college_a["headers"],
        )
        mine = await client.get(
            f"{API}/college/roster-imports/{import_id}", headers=college_b["headers"]
        )
        assert mine.json()["state"] == "PREVIEW", "the other college's import changed"
        return response

    return case


def _other_colleges_student(suffix: str) -> Case:
    """College B's student lets B see them; college A asks by id. The same
    for the details and the CV (`suffix`)."""

    async def case(client: Any, attacker: dict, victim: dict) -> Any:
        from tests.integration.test_college_consent import _seed_student

        college_a, college_b = await _college_pair(client, victim["mint_token"])
        code = await client.post(
            f"{API}/college/referral-codes", json={}, headers=college_b["headers"]
        )
        student = await _seed_student(college_b, code.json()["id"], individual=True, name="B")
        url = f"{API}/college/students/{student}{suffix}"
        response = await client.get(url, headers=college_a["headers"])
        theirs = await client.get(url, headers=college_b["headers"])
        # The seeded student has no CV, so their own college's CV read is a
        # 404 of its own; everything else is theirs to see.
        expected = 404 if suffix == "/resume" else 200
        assert theirs.status_code == expected, "the student's own college lost its view"
        return response

    return case


_TOMORROW = (datetime.now(UTC) + timedelta(days=1)).isoformat()


#: `(METHOD, path template) -> a request from tenant A for tenant B's resource`.
#: Adding a tenant route with an id means adding its case here; the test below
#: refuses to pass until someone does.
CROSS_TENANT_CASES: dict[tuple[str, str], Case] = {
    ("PATCH", f"{API}/employer/team/{{user_id}}"): _patch_other_member,
    ("DELETE", f"{API}/employer/team/{{user_id}}"): _delete_other_member,
    ("GET", f"{API}/employer/jobs/{{job_id}}"): _get_other_job,
    ("PATCH", f"{API}/employer/jobs/{{job_id}}"): _patch_other_job,
    ("POST", f"{API}/employer/jobs/{{job_id}}/publish"): _move_other_job("publish"),
    ("POST", f"{API}/employer/jobs/{{job_id}}/pause"): _move_other_job("pause"),
    ("POST", f"{API}/employer/jobs/{{job_id}}/close"): _move_other_job("close"),
    ("POST", f"{API}/employer/kyb/documents/{{upload_id}}/complete"): _complete_other_kyb_document,
    ("GET", f"{API}/employer/applications/{{application_id}}"): _pipeline_case("GET", ""),
    ("POST", f"{API}/employer/applications/{{application_id}}/stage"): _pipeline_case(
        "POST", "/stage", {"stage": "REJECTED"}
    ),
    ("PUT", f"{API}/employer/applications/{{application_id}}/interview"): _pipeline_case(
        "PUT",
        "/interview",
        {"interview_at": _TOMORROW, "meeting_url": "https://meet.example.com/x"},
    ),
    ("POST", f"{API}/employer/applications/{{application_id}}/hire"): _pipeline_case(
        "POST", "/hire"
    ),
    ("GET", f"{API}/employer/discovery/candidates/{{candidate_id}}"): _reveal_other_member,
    ("PATCH", f"{API}/college/team/{{user_id}}"): _college_member_case("PATCH"),
    ("DELETE", f"{API}/college/team/{{user_id}}"): _college_member_case("DELETE"),
    ("POST", f"{API}/college/referral-codes/{{code_id}}/revoke"): _revoke_other_colleges_code,
    ("GET", f"{API}/college/roster-imports/{{import_id}}"): _roster_case("GET", ""),
    ("GET", f"{API}/college/roster-imports/{{import_id}}/rows"): _roster_case("GET", "/rows"),
    ("POST", f"{API}/college/roster-imports/{{import_id}}/commit"): _roster_case("POST", "/commit"),
    ("POST", f"{API}/college/roster-imports/{{import_id}}/discard"): _roster_case(
        "POST", "/discard"
    ),
    ("POST", f"{API}/college/roster-imports/{{import_id}}/invitations/send"): _roster_case(
        "POST", "/invitations/send"
    ),
    ("GET", f"{API}/college/students/{{candidate_id}}"): _other_colleges_student(""),
    # 2026-09-29.
    ("GET", f"{API}/college/students/{{candidate_id}}/details"): _other_colleges_student(
        "/details"
    ),
    ("GET", f"{API}/college/students/{{candidate_id}}/resume"): _other_colleges_student("/resume"),
    ("POST", f"{API}/employer/applications/{{application_id}}/messages"): _pipeline_case(
        "POST", "/messages", {"kind": "GENERAL", "body": "Hello."}
    ),
    ("GET", f"{API}/employer/applications/{{application_id}}/messages"): _pipeline_case(
        "GET", "/messages"
    ),
    # 2026-10-05.
    ("POST", f"{API}/employer/shortlist/{{shortlist_id}}/cancel"): _shortlist_case(
        "POST", "/cancel"
    ),
    ("DELETE", f"{API}/employer/shortlist/{{shortlist_id}}"): _shortlist_case("DELETE", ""),
}


def _tenant_routes_with_ids(app: Any) -> set[tuple[str, str]]:
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith(TENANT_SURFACES) and "{" in path
        for method in operations
    }


def test_every_tenant_route_with_an_id_has_a_cross_tenant_case(app: Any) -> None:
    """**The guard on the guard.** Without it this suite covers the routes that
    existed the day it was written, and nothing after."""
    routes = _tenant_routes_with_ids(app)
    missing = sorted(routes - set(CROSS_TENANT_CASES))
    stale = sorted(set(CROSS_TENANT_CASES) - routes)
    assert not missing, (
        f"tenant routes with no cross-tenant case: {missing}. Add one to "
        "CROSS_TENANT_CASES -- tenant A asking for tenant B's resource must be a 404."
    )
    assert not stale, f"cases for routes that no longer exist: {stale}"


@pytest.mark.parametrize("route", sorted(CROSS_TENANT_CASES), ids=lambda r: f"{r[0]} {r[1]}")
async def test_another_tenants_resource_is_a_404(
    route: tuple[str, str],
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,  # noqa: F811
) -> None:
    attacker = await _organisation(client, mint_token)
    victim = await _organisation(client, mint_token)
    victim["fake_s3"] = fake_s3
    victim["mint_token"] = mint_token

    response = await CROSS_TENANT_CASES[route](client, attacker, victim)
    assert response.status_code == 404, (
        f"{route[0]} {route[1]} answered {response.status_code} for another tenant's "
        "resource. A 403 confirms it exists; a 2xx means it leaked."
    )

    # And nothing changed on the victim's side.
    team = await client.get(f"{API}/employer/team", headers=victim["headers"])
    assert victim["member_id"] in {m["user_id"] for m in team.json()}
    job = await client.get(f"{API}/employer/jobs/{victim['job_id']}", headers=victim["headers"])
    assert job.status_code == 200
    assert job.json()["status"] == "DRAFT"
    assert job.json()["title"] == JOB["title"]


async def test_routes_without_an_id_only_ever_return_the_callers_own_tenant(
    client: Any, mint_token: Any
) -> None:
    """No identifier to swap, so the risk is different: a query that forgot its
    tenant filter would return someone else's rows to everyone."""
    a = await _organisation(client, mint_token)
    b = await _organisation(client, mint_token)

    org_a = (await client.get(f"{API}/employer/organisation", headers=a["headers"])).json()
    org_b = (await client.get(f"{API}/employer/organisation", headers=b["headers"])).json()
    assert org_a["tenant_id"] == a["tenant_id"]
    assert org_b["tenant_id"] == b["tenant_id"]

    team_a = {
        m["user_id"]
        for m in (await client.get(f"{API}/employer/team", headers=a["headers"])).json()
    }
    assert b["member_id"] not in team_a
    assert a["member_id"] in team_a

    jobs_a = {
        j["id"]
        for j in (await client.get(f"{API}/employer/jobs", headers=a["headers"])).json()["items"]
    }
    assert b["job_id"] not in jobs_a
    assert a["job_id"] in jobs_a


async def test_a_smuggled_tenant_id_changes_nothing(client: Any, mint_token: Any) -> None:
    """SRS 2.24.7: the tenant is the caller's resolved membership, never a value
    they send. A header, a query string or a body field naming tenant B must be
    ignored -- or refused -- but never honoured."""
    a = await _organisation(client, mint_token)
    b = await _organisation(client, mint_token)

    response = await client.get(
        f"{API}/employer/organisation",
        params={"tenant_id": b["tenant_id"]},
        headers={**a["headers"], "X-Tenant-Id": b["tenant_id"]},
    )
    assert response.status_code == 200
    assert response.json()["tenant_id"] == a["tenant_id"]


async def test_another_tenants_job_has_no_pipeline_to_list(client: Any, mint_token: Any) -> None:
    """The pipeline listing takes its job in the query string, where the guard
    above cannot see an id. Naming tenant B's job is `job_not_found`, and
    nothing of B's pipeline comes back."""
    a = await _organisation(client, mint_token)
    b = await _organisation(client, mint_token)
    application = await _victim_application(b)
    async with sessions(_seed_url())() as session:
        victim_job = await session.scalar(
            text("SELECT job_id FROM applications WHERE id = :a"), {"a": application}
        )

    response = await client.get(
        f"{API}/employer/applications", params={"job_id": str(victim_job)}, headers=a["headers"]
    )
    assert response.status_code == 404
    assert response.json()["code"] == "job_not_found"
    assert application not in response.text

    # Without a job the list spans the organisation, and a query that forgot
    # its tenant would hand A every organisation's pipeline.
    everything = await client.get(f"{API}/employer/applications", headers=a["headers"])
    assert everything.status_code == 200, everything.text
    assert application not in everything.text
    assert str(victim_job) not in everything.text


async def test_college_routes_without_an_id_only_ever_return_the_callers_own(
    client: Any, mint_token: Any
) -> None:
    """A college's organisation, team, codes and imports are its own."""
    college_a, college_b = await _college_pair(client, mint_token)
    for college in (college_a, college_b):
        await client.post(f"{API}/college/referral-codes", json={}, headers=college["headers"])
        await client.post(
            f"{API}/college/roster-imports",
            json={"file_name": "r.csv", "csv": f"phone\n9{uuid.uuid4().int % 10**9:09d}\n"},
            headers=college["headers"],
        )

    def ids(response: Any) -> set[str]:
        return {item["id"] for item in response.json()["items"]}

    a, b = college_a["headers"], college_b["headers"]
    org = (await client.get(f"{API}/college/organisation", headers=a)).json()
    assert org["tenant_id"] == college_a["tenant_id"]
    for path in ("referral-codes", "roster-imports"):
        mine = ids(await client.get(f"{API}/college/{path}", headers=a))
        theirs = ids(await client.get(f"{API}/college/{path}", headers=b))
        assert len(mine) == 1 and len(theirs) == 1 and not mine & theirs, path
    team_a = {m["user_id"] for m in (await client.get(f"{API}/college/team", headers=a)).json()}
    team_b = {m["user_id"] for m in (await client.get(f"{API}/college/team", headers=b)).json()}
    assert not team_a & team_b
