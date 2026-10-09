"""Through HTTP: the job board, eligibility, apply and withdraw.

Candidates are real: a confirmed resume, a score persisted through the one
write path, and an integrity check -- so "visible to employers" is decided by
the same CTE discovery uses, not by a flag set for the test. Employers publish
through the API.

**The board is every published job in the database**, other tests' included,
so each test tags its job titles with a fresh token and searches for it.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions, subscribe_tenant
from tests.integration.test_integrity_pipeline import (
    CLEAN_CV,
    EXTRACTED,
    INJECTED_CV,
    _evaluate,
    _scored_version,
)
from tests.integration.test_jobs import _set_kyb

pytestmark = pytest.mark.integration

API = "/api/v1"
BOARD = f"{API}/candidate/jobs"
APPLICATIONS = f"{API}/candidate/applications"
JOB = {
    "title": "Maintenance Technician",
    "description": "Preventive maintenance on CNC lines at a Chakan plant.",
    "skills": ["CNC maintenance"],
    "location": "Pune",
    "work_mode": "ONSITE",
    "salary_min_minor": 2_500_000,
    "salary_max_minor": 3_500_000,
}


def _token() -> str:
    return uuid.uuid4().hex[:12]


# --- fixtures, as functions -------------------------------------------------
async def _subscribe(user_id: uuid.UUID, *, lapsed: bool = False) -> None:
    now = datetime.now(UTC)
    start, end = (
        (now - timedelta(days=40), now - timedelta(days=10))
        if lapsed
        else (now - timedelta(days=1), now + timedelta(days=29))
    )
    plan_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO plans (id, audience, code, period, price_minor, entitlements, "
                "active, version) VALUES (:p, 'CANDIDATE', :c, 'MONTHLY', 49900, "
                "'{}'::jsonb, true, 1)"
            ),
            {"p": str(plan_id), "c": f"TEST_{plan_id.hex[:16]}"},
        )
        await session.execute(
            text(
                "INSERT INTO subscriptions (id, subscriber_type, subscriber_id, plan_id, state, "
                "current_period_start, current_period_end, renews_automatically) "
                "VALUES (gen_random_uuid(), 'USER', :u, :p, 'ACTIVE', :s, :e, false)"
            ),
            {"u": str(user_id), "p": str(plan_id), "s": start, "e": end},
        )


async def _candidate(
    mint_token: Any,
    *,
    scored: bool = True,
    checked: bool = True,
    subscribed: bool = True,
    cv: str = CLEAN_CV,
) -> dict[str, Any]:
    """A signed-in candidate. By default: scored, integrity-checked, paying."""
    from app.modules.scoring import service as scoring_service

    user_id, subject = uuid.uuid4(), f"local-test-{uuid.uuid4()}"
    phone = f"+9197{uuid.uuid4().int % 10**8:08d}"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, cognito_sub, pool, phone, status, locale) "
                "VALUES (:u, :s, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "s": subject, "p": phone},
        )

    score = None
    if scored:
        version_id, _ = await _scored_version(user_id, cv, EXTRACTED)
        if checked:
            await _evaluate(user_id, version_id, cv, EXTRACTED)
        async with sessions(_seed_url())() as session:
            score = int((await scoring_service.get_latest(session, user_id=user_id)).raw_value)
    if subscribed:
        await _subscribe(user_id)

    headers, _ = mint_token(pool="CANDIDATE", subject=subject, phone=phone)
    return {"id": user_id, "headers": headers, "score": score, "subject": subject}


async def _employer(client: Any, mint_token: Any) -> dict[str, Any]:
    """A verified employer, created through the API."""
    headers, _ = mint_token(pool="BUSINESS", email=f"{uuid.uuid4().hex[:12]}@example.test")
    name = f"Board Test {uuid.uuid4().hex[:6]} Pvt Ltd"
    created = await client.post(
        f"{API}/employer/organisation", json={"legal_name": name}, headers=headers
    )
    assert created.status_code == 201, created.text
    await _set_kyb(created.json()["tenant_id"], "APPROVED")
    await subscribe_tenant(created.json()["tenant_id"])
    return {"headers": headers, "tenant_id": created.json()["tenant_id"], "name": name}


async def _job(
    client: Any, employer: dict[str, Any], *, publish: bool = True, **overrides: Any
) -> dict[str, Any]:
    created = await client.post(
        f"{API}/employer/jobs", json={**JOB, **overrides}, headers=employer["headers"]
    )
    assert created.status_code == 201, created.text
    job = created.json()
    if publish:
        published = await client.post(
            f"{API}/employer/jobs/{job['id']}/publish", headers=employer["headers"]
        )
        assert published.status_code == 200, published.text
        job = published.json()
    return job


async def _move(client: Any, employer: dict[str, Any], job: dict[str, Any], action: str) -> None:
    response = await client.post(
        f"{API}/employer/jobs/{job['id']}/{action}", headers=employer["headers"]
    )
    assert response.status_code == 200, response.text


async def _board_ids(client: Any, candidate: dict[str, Any], **params: Any) -> list[str]:
    response = await client.get(BOARD, params=params, headers=candidate["headers"])
    assert response.status_code == 200, response.text
    return [item["id"] for item in response.json()["items"]]


async def _apply(client: Any, candidate: dict[str, Any], job: dict[str, Any]) -> Any:
    return await client.post(APPLICATIONS, json={"job_id": job["id"]}, headers=candidate["headers"])


# --- the board ----------------------------------------------------------------
async def test_the_board_shows_every_employers_published_jobs_and_nothing_else(
    client: Any, mint_token: Any
) -> None:
    token = _token()
    a, b = await _employer(client, mint_token), await _employer(client, mint_token)
    live_a = await _job(client, a, title=f"Welder {token}")
    live_b = await _job(client, b, title=f"Fitter {token}")
    await _job(client, a, publish=False, title=f"Draft {token}")
    paused = await _job(client, a, title=f"Paused {token}")
    await _move(client, a, paused, "pause")
    closed = await _job(client, b, title=f"Closed {token}")
    await _move(client, b, closed, "close")
    me = await _candidate(mint_token)

    response = await client.get(BOARD, params={"q": token}, headers=me["headers"])
    assert response.status_code == 200
    items = {item["id"]: item for item in response.json()["items"]}
    assert set(items) == {live_a["id"], live_b["id"]}
    assert items[live_a["id"]]["employer_name"] == a["name"]
    assert items[live_b["id"]]["employer_name"] == b["name"]
    for item in items.values():
        assert "min_score" not in item and "tenant_id" not in item and "status" not in item


async def test_the_board_filters(client: Any, mint_token: Any) -> None:
    token = _token()
    employer = await _employer(client, mint_token)
    pune = await _job(
        client,
        employer,
        title=f"Onsite {token}",
        location="Pune",
        work_mode="ONSITE",
        skills=["TIG welding"],
        salary_min_minor=1_000_000,
        salary_max_minor=2_000_000,
    )
    remote = await _job(
        client,
        employer,
        title=f"Remote {token}",
        location="Bengaluru",
        work_mode="REMOTE",
        skills=["Python"],
        salary_min_minor=5_000_000,
        salary_max_minor=6_000_000,
    )
    me = await _candidate(mint_token)

    async def ids(**params: Any) -> set[str]:
        return set(await _board_ids(client, me, q=token, **params))

    assert await ids() == {pune["id"], remote["id"]}
    assert await ids(location="pune") == {pune["id"]}
    assert await ids(work_mode="REMOTE") == {remote["id"]}
    assert await ids(skill="tig WELDING") == {pune["id"]}
    assert await ids(min_salary_minor=3_000_000) == {remote["id"]}
    # Wildcards are matched literally, not as patterns.
    assert await ids(location="%") == set()


async def test_the_board_pages_newest_first_without_repeats(client: Any, mint_token: Any) -> None:
    token = _token()
    employer = await _employer(client, mint_token)
    published = [(await _job(client, employer, title=f"Page {i} {token}"))["id"] for i in range(5)]
    me = await _candidate(mint_token)

    seen: list[str] = []
    cursor = None
    for _ in range(5):
        params: dict[str, Any] = {"q": token, "limit": 2}
        if cursor:
            params["cursor"] = cursor
        body = (await client.get(BOARD, params=params, headers=me["headers"])).json()
        seen += [item["id"] for item in body["items"]]
        cursor = body["next_cursor"]
        if cursor is None:
            break
    assert seen == list(reversed(published))


async def test_a_tampered_cursor_is_refused(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    response = await client.get(BOARD, params={"cursor": "not-a-cursor"}, headers=me["headers"])
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_cursor"


async def test_eligibility_is_judged_on_the_stored_score(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    score = me["score"]
    assert score is not None and score < 990
    token = _token()
    employer = await _employer(client, mint_token)
    at = await _job(client, employer, title=f"At {token}", min_score=score)
    above = await _job(client, employer, title=f"Above {token}", min_score=score + 1)
    open_ = await _job(client, employer, title=f"Open {token}")

    # A score in the query string is not an input to anything.
    response = await client.get(BOARD, params={"q": token, "score": 990}, headers=me["headers"])
    got = {item["id"]: item["eligibility"] for item in response.json()["items"]}
    assert got == {
        at["id"]: "ELIGIBLE",
        above["id"]: "BELOW_THRESHOLD",
        open_["id"]: "ELIGIBLE",
    }
    assert set(await _board_ids(client, me, q=token, eligible_only="true")) == {
        at["id"],
        open_["id"],
    }

    detail = await client.get(f"{BOARD}/{above['id']}", headers=me["headers"])
    assert detail.status_code == 200
    assert detail.json()["eligibility"] == "BELOW_THRESHOLD"
    assert detail.json()["description"] == JOB["description"]
    assert "min_score" not in detail.json()


async def test_without_a_score_every_job_is_pending(client: Any, mint_token: Any) -> None:
    token = _token()
    employer = await _employer(client, mint_token)
    job = await _job(client, employer, title=f"Pending {token}")
    me = await _candidate(mint_token, scored=False)

    items = (await client.get(BOARD, params={"q": token}, headers=me["headers"])).json()["items"]
    assert [(i["id"], i["eligibility"]) for i in items] == [(job["id"], "SCORE_PENDING")]
    assert await _board_ids(client, me, q=token, eligible_only="true") == []


async def test_a_job_off_the_board_reads_as_absent(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    draft = await _job(client, employer, publish=False)
    paused = await _job(client, employer)
    await _move(client, employer, paused, "pause")
    closed = await _job(client, employer)
    await _move(client, employer, closed, "close")
    me = await _candidate(mint_token)

    for job in (draft, paused, closed, {"id": str(uuid.uuid4())}):
        detail = await client.get(f"{BOARD}/{job['id']}", headers=me["headers"])
        assert detail.status_code == 404 and detail.json()["code"] == "job_not_found"
        applied = await _apply(client, me, job)
        assert applied.status_code == 404 and applied.json()["code"] == "job_not_found"


# --- pay-first (R13) ------------------------------------------------------------
@pytest.mark.parametrize("subscription", ["never", "lapsed"])
async def test_searching_and_applying_need_an_active_subscription(
    client: Any, mint_token: Any, subscription: str
) -> None:
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    me = await _candidate(mint_token, subscribed=False)
    if subscription == "lapsed":
        await _subscribe(me["id"], lapsed=True)

    for response in (
        await client.get(BOARD, headers=me["headers"]),
        await client.get(f"{BOARD}/{job['id']}", headers=me["headers"]),
        await _apply(client, me, job),
    ):
        assert response.status_code == 402, response.text
        assert response.json()["code"] == "subscription_required"


async def test_a_lapsed_subscriber_keeps_their_applications(client: Any, mint_token: Any) -> None:
    """They lose access, not data (R13): they can still see and withdraw what
    they applied for, and cannot apply for more."""
    employer = await _employer(client, mint_token)
    first, second = await _job(client, employer), await _job(client, employer)
    me = await _candidate(mint_token)
    application = (await _apply(client, me, first)).json()

    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "UPDATE subscriptions SET current_period_start = now() - interval '40 days', "
                "current_period_end = now() - interval '10 days' WHERE subscriber_id = :u"
            ),
            {"u": str(me["id"])},
        )

    mine = await client.get(APPLICATIONS, headers=me["headers"])
    assert mine.status_code == 200
    assert [a["id"] for a in mine.json()["items"]] == [application["id"]]
    withdrawn = await client.post(
        f"{APPLICATIONS}/{application['id']}/withdraw", headers=me["headers"]
    )
    assert withdrawn.status_code == 200
    assert (await _apply(client, me, second)).status_code == 402


async def test_an_employer_cannot_use_the_candidate_surface(client: Any, mint_token: Any) -> None:
    """403, not 402: nobody should be asked to pay for a surface they cannot use."""
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    for response in (
        await client.get(BOARD, headers=employer["headers"]),
        await client.post(APPLICATIONS, json={"job_id": job["id"]}, headers=employer["headers"]),
        await client.get(APPLICATIONS, headers=employer["headers"]),
    ):
        assert response.status_code == 403, response.text


# --- applying -------------------------------------------------------------------
async def test_applying_twice_returns_the_same_application(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    me = await _candidate(mint_token)

    first = await _apply(client, me, job)
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["stage"] == "SUBMITTED"
    assert body["job_title"] == JOB["title"]
    assert body["employer_name"] == employer["name"]
    assert "score" not in body and "tenant_id" not in body

    second = await _apply(client, me, job)
    assert second.status_code == 200
    assert second.json()["id"] == body["id"]

    async with sessions(_seed_url())() as session:
        events = (
            await session.execute(
                text("SELECT to_stage FROM application_events WHERE application_id = :a"),
                {"a": body["id"]},
            )
        ).scalars()
        assert list(events) == ["SUBMITTED"]
        tenant = await session.scalar(
            text("SELECT tenant_id FROM applications WHERE id = :a"), {"a": body["id"]}
        )
    assert str(tenant) == employer["tenant_id"], "filed under a tenant other than the job's"


async def test_simultaneous_applies_make_one_application(client: Any, mint_token: Any) -> None:
    """Every request sees no application; only the unique index can make all
    but one of them lose."""
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    me = await _candidate(mint_token)

    responses = await asyncio.gather(*(_apply(client, me, job) for _ in range(3)))
    assert sorted(r.status_code for r in responses) == [200, 200, 201]
    assert len({r.json()["id"] for r in responses}) == 1


async def test_a_score_below_the_threshold_is_refused_without_a_number(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    job = await _job(client, employer, min_score=me["score"] + 1)

    response = await _apply(client, me, job)
    assert response.status_code == 403
    body = response.json()
    assert body["code"] == "eligibility_below_threshold"
    assert "params" not in body
    said = json.dumps({k: body[k] for k in ("title", "code", "type")})
    assert not any(ch.isdigit() for ch in said), said


async def test_applying_needs_a_score(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    me = await _candidate(mint_token, scored=False)
    response = await _apply(client, me, job)
    assert response.status_code == 409 and response.json()["code"] == "score_pending"


@pytest.mark.parametrize("state", ["unchecked", "suppressed"])
async def test_a_candidate_employers_cannot_see_cannot_apply(
    client: Any, mint_token: Any, state: str
) -> None:
    """Applying puts a candidate in front of an employer, so it follows the
    discovery rule. Otherwise a CV held back by a HIGH signal reaches
    employers through the apply button -- and the refusal must not say why."""
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    if state == "unchecked":
        me = await _candidate(mint_token, checked=False)
    else:
        me = await _candidate(mint_token, cv=INJECTED_CV)

    response = await _apply(client, me, job)
    assert response.status_code == 409
    assert response.json()["code"] == "application_unavailable"
    assert "integrity" not in response.text.lower()


async def test_a_smuggled_field_is_refused(client: Any, mint_token: Any) -> None:
    employer, other = await _employer(client, mint_token), await _employer(client, mint_token)
    job = await _job(client, employer)
    me = await _candidate(mint_token)
    for extra in ({"tenant_id": other["tenant_id"]}, {"stage": "HIRED"}, {"score": 990}):
        response = await client.post(
            APPLICATIONS, json={"job_id": job["id"], **extra}, headers=me["headers"]
        )
        assert response.status_code == 422, extra


# --- the candidate's own applications -----------------------------------------------
async def test_withdrawing_and_applying_again(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    me = await _candidate(mint_token)
    application = (await _apply(client, me, job)).json()
    withdraw = f"{APPLICATIONS}/{application['id']}/withdraw"

    first = await client.post(withdraw, headers=me["headers"])
    assert first.status_code == 200 and first.json()["stage"] == "WITHDRAWN"
    again = await client.post(withdraw, headers=me["headers"])
    assert again.status_code == 200 and again.json()["stage"] == "WITHDRAWN"

    async with sessions(_seed_url())() as session:
        stages = (
            await session.execute(
                text(
                    "SELECT from_stage, to_stage FROM application_events "
                    "WHERE application_id = :a ORDER BY occurred_at, to_stage DESC"
                ),
                {"a": application["id"]},
            )
        ).all()
    assert [tuple(s) for s in stages] == [(None, "SUBMITTED"), ("SUBMITTED", "WITHDRAWN")]

    reapplied = await _apply(client, me, job)
    assert reapplied.status_code == 201
    assert reapplied.json()["id"] != application["id"]


async def test_a_finished_application_cannot_be_withdrawn(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    me = await _candidate(mint_token)
    application = (await _apply(client, me, job)).json()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text("UPDATE applications SET stage = 'REJECTED' WHERE id = :a"),
            {"a": application["id"]},
        )

    response = await client.post(
        f"{APPLICATIONS}/{application['id']}/withdraw", headers=me["headers"]
    )
    assert response.status_code == 409
    assert response.json()["code"] == "application_invalid_transition"


async def test_another_candidates_application_is_a_404(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    owner, other = await _candidate(mint_token), await _candidate(mint_token)
    application = (await _apply(client, owner, job)).json()
    path = f"{APPLICATIONS}/{application['id']}"

    for response in (
        await client.get(path, headers=other["headers"]),
        await client.post(f"{path}/withdraw", headers=other["headers"]),
    ):
        assert response.status_code == 404
        assert response.json()["code"] == "application_not_found"
    assert (await client.get(APPLICATIONS, headers=other["headers"])).json()["items"] == []
    assert (await client.get(path, headers=owner["headers"])).json()["stage"] == "SUBMITTED"


async def test_the_application_board_still_names_a_job_that_closed(
    client: Any, mint_token: Any
) -> None:
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    me = await _candidate(mint_token)
    application = (await _apply(client, me, job)).json()
    await _move(client, employer, job, "close")

    item = (await client.get(f"{APPLICATIONS}/{application['id']}", headers=me["headers"])).json()
    assert item["job_title"] == JOB["title"]
    assert item["employer_name"] == employer["name"]
    assert (await client.get(f"{BOARD}/{job['id']}", headers=me["headers"])).status_code == 404


async def test_the_application_list_pages(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    me = await _candidate(mint_token)
    applied = []
    for _ in range(3):
        job = await _job(client, employer)
        applied.append((await _apply(client, me, job)).json()["id"])

    first = (await client.get(APPLICATIONS, params={"limit": 2}, headers=me["headers"])).json()
    second = (
        await client.get(
            APPLICATIONS,
            params={"limit": 2, "cursor": first["next_cursor"]},
            headers=me["headers"],
        )
    ).json()
    assert [a["id"] for a in first["items"] + second["items"]] == list(reversed(applied))
    assert second["next_cursor"] is None


async def test_the_application_list_filters_by_active_or_closed(
    client: Any, mint_token: Any
) -> None:
    employer = await _employer(client, mint_token)
    me = await _candidate(mint_token)
    applied = [(await _apply(client, me, await _job(client, employer))).json()["id"] for _ in "ab"]
    withdrawn = (await _apply(client, me, await _job(client, employer))).json()["id"]
    response = await client.post(f"{APPLICATIONS}/{withdrawn}/withdraw", headers=me["headers"])
    assert response.status_code == 200

    async def ids(**params: Any) -> list[str]:
        listed = await client.get(APPLICATIONS, params=params, headers=me["headers"])
        assert listed.status_code == 200, listed.text
        return [a["id"] for a in listed.json()["items"]]

    assert await ids(status="ACTIVE") == list(reversed(applied))
    assert await ids(status="CLOSED") == [withdrawn]
    assert await ids() == [withdrawn, *reversed(applied)]
    refused = await client.get(APPLICATIONS, params={"status": "open"}, headers=me["headers"])
    assert refused.status_code == 422
