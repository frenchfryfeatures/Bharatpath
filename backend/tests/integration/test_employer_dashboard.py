"""The employer dashboard: the organisation's jobs and pipeline, counted.

Candidates are real and apply through the API, as in `test_pipeline.py`, whose
helpers these reuse. Every employer here is fresh, so an organisation's counts
are exactly what its test put there -- no filtering on a unique token needed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.core.tenant import TenantContext
from app.modules.applications.domain import STAGES, TREND_DAYS
from tests.conftest import sessions
from tests.integration.test_candidate_marketplace import (
    API,
    APPLICATIONS,
    _apply,
    _candidate,
    _employer,
    _job,
)
from tests.integration.test_candidate_marketplace import _move as _move_job
from tests.integration.test_pipeline import (
    APP_URL,
    PIPELINE,
    _age,
    _applied,
    _interview,
    _member,
    _walk,
)

pytestmark = pytest.mark.integration

DASHBOARD = f"{API}/employer/dashboard"
ACTIVITY = f"{DASHBOARD}/activity"


async def _dashboard(client: Any, employer: dict[str, Any], **params: Any) -> dict[str, Any]:
    response = await client.get(DASHBOARD, params=params, headers=employer["headers"])
    assert response.status_code == 200, response.text
    return dict(response.json())


async def _as_of(employer: dict[str, Any], now: datetime) -> Any:
    """The dashboard as it will read at `now`, through the service on the app role."""
    from app.modules.applications import service

    ctx = TenantContext(
        user_id=uuid.uuid4(),
        tenant_id=uuid.UUID(employer["tenant_id"]),
        role="EMPLOYER_OWNER",
        pool="BUSINESS",
    )
    async with sessions(APP_URL)() as session, session.begin():
        return await service.dashboard(session, ctx=ctx, now=now)


async def _expiry_days() -> int:
    from app.modules.applications import service

    async with sessions(APP_URL)() as session:
        return (await service.load_expiry_rules(session, now=datetime.now(UTC))).inactive_days


# --- the tiles ----------------------------------------------------------------------
async def test_a_new_organisation_reads_zero_everywhere(client: Any, mint_token: Any) -> None:
    """Every tile is present at zero. A missing key would leave the client
    guessing between "none" and "not built"."""
    body = await _dashboard(client, await _employer(client, mint_token))

    assert body["jobs"] == {"total": 0, "active": 0, "draft": 0, "paused": 0, "closed": 0}
    apps = body["applications"]
    assert apps["total"] == apps["open"] == apps["distinct_candidates"] == 0
    assert apps["by_stage"] == dict.fromkeys(STAGES, 0)
    assert set(body["needs_attention"].values()) == {0}
    assert body["top_jobs"] == [] and body["upcoming_interviews"] == []
    assert len(body["applications_per_day"]) == TREND_DAYS
    assert {day["count"] for day in body["applications_per_day"]} == {0}


async def test_the_dashboard_counts_the_organisations_jobs_and_pipeline(
    client: Any, mint_token: Any
) -> None:
    employer = await _employer(client, mint_token)
    busy = await _job(client, employer, title="Busy")
    quiet = await _job(client, employer, title="Quiet")
    await _job(client, employer, publish=False, title="Draft")
    paused = await _job(client, employer, title="Paused")
    await _move_job(client, employer, paused, "pause")
    closed = await _job(client, employer, title="Closed")
    await _move_job(client, employer, closed, "close")

    first = await _candidate(mint_token)
    second = await _candidate(mint_token)
    interviewing = (await _apply(client, first, busy)).json()["id"]
    shortlisted = (await _apply(client, second, busy)).json()["id"]
    unreviewed = (await _apply(client, first, quiet)).json()["id"]
    owner = {"employer": employer}
    await _walk(client, {**owner, "id": interviewing}, "SHORTLISTED", "INTERVIEW")
    await _walk(client, {**owner, "id": shortlisted}, "SHORTLISTED")
    booked = await client.put(
        f"{PIPELINE}/{interviewing}/interview",
        json=_interview(days=3),
        headers=employer["headers"],
    )
    assert booked.status_code == 200, booked.text

    body = await _dashboard(client, employer)

    assert body["jobs"] == {"total": 5, "active": 2, "draft": 1, "paused": 1, "closed": 1}
    apps = body["applications"]
    assert apps["total"] == apps["open"] == 3
    assert apps["distinct_candidates"] == 2, "one person applying twice is one candidate"
    assert apps["new_last_7_days"] == apps["new_last_30_days"] == 3
    assert apps["by_stage"] == {
        **dict.fromkeys(STAGES, 0),
        "SUBMITTED": 1,
        "SHORTLISTED": 1,
        "INTERVIEW": 1,
    }
    assert sum(apps["by_stage"].values()) == apps["total"]
    attention = body["needs_attention"]
    assert attention["unreviewed"] == 1
    assert attention["interviews_next_7_days"] == 1
    assert attention["interviews_to_schedule"] == 0

    assert [(j["job_id"], j["applications"]) for j in body["top_jobs"]] == [
        (busy["id"], 2),
        (quiet["id"], 1),
    ]
    assert body["top_jobs"][0] | {"last_applied_at": None} == {
        "job_id": busy["id"],
        "title": "Busy",
        "status": "PUBLISHED",
        "applications": 2,
        "open": 2,
        "new_last_7_days": 2,
        "last_applied_at": None,
    }

    [interview] = body["upcoming_interviews"]
    assert interview["application_id"] == interviewing
    assert interview["job_title"] == "Busy"
    assert body["applications_per_day"][-1]["count"] == 3, "today, in IST, is the last point"
    assert unreviewed not in {i["application_id"] for i in body["upcoming_interviews"]}


async def test_top_jobs_is_bounded(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    for k in (0, 21):
        response = await client.get(DASHBOARD, params={"top_jobs": k}, headers=employer["headers"])
        assert response.status_code == 422, k

    job_a, job_b = await _job(client, employer), await _job(client, employer)
    candidate = await _candidate(mint_token)
    for job in (job_a, job_b):
        assert (await _apply(client, candidate, job)).status_code == 201
    assert len((await _dashboard(client, employer, top_jobs=1))["top_jobs"]) == 1
    assert len((await _dashboard(client, employer))["top_jobs"]) == 2


async def test_hires_waiting_on_a_candidate_and_disputed_hires_are_told_apart(
    client: Any, mint_token: Any
) -> None:
    employer = await _employer(client, mint_token)
    pending = await _applied(client, mint_token, employer)
    disputed = await _applied(client, mint_token, employer)
    for a in (pending, disputed):
        await _walk(client, a, "SHORTLISTED", "INTERVIEW", "DECISION")
        proposed = await client.post(f"{PIPELINE}/{a['id']}/hire", headers=employer["headers"])
        assert proposed.status_code == 200, proposed.text
    answered = await client.post(
        f"{APPLICATIONS}/{disputed['id']}/hire/dispute", headers=disputed["candidate"]["headers"]
    )
    assert answered.status_code == 200, answered.text

    attention = (await _dashboard(client, employer))["needs_attention"]
    assert attention["hires_awaiting_candidate"] == 1
    assert attention["hires_disputed"] == 1
    assert attention["interviews_to_schedule"] == 0


async def test_an_interview_stage_with_no_time_booked_is_waiting_to_be_scheduled(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    await _walk(client, a, "SHORTLISTED", "INTERVIEW")
    attention = (await _dashboard(client, a["employer"]))["needs_attention"]
    assert attention["interviews_to_schedule"] == 1
    assert attention["interviews_next_7_days"] == 0


async def test_expiring_counts_what_the_sweep_will_expire_within_a_week(
    client: Any, mint_token: Any
) -> None:
    """Held to the sweep's own rule, read live, so the tile and the sweep
    cannot disagree about which applications are about to go."""
    days = await _expiry_days()
    employer = await _employer(client, mint_token)
    soon = await _applied(client, mint_token, employer)
    later = await _applied(client, mint_token, employer)
    overdue = await _applied(client, mint_token, employer)
    proposed = await _applied(client, mint_token, employer)
    await _age(soon["id"], days - 3)
    await _age(later["id"], days - 10)
    await _age(overdue["id"], days + 1)
    await _walk(client, proposed, "SHORTLISTED", "INTERVIEW", "DECISION")
    await client.post(f"{PIPELINE}/{proposed['id']}/hire", headers=employer["headers"])
    await _age(proposed["id"], days + 1)

    attention = (await _dashboard(client, employer))["needs_attention"]
    # `soon` and `overdue`. A proposed hire never expires, however quiet.
    assert attention["expiring_within_7_days"] == 2


async def test_recent_means_the_last_seven_days_and_the_trend_thirty(
    client: Any, mint_token: Any
) -> None:
    """`now` moved forward instead of the rows moved back: `created_at` is
    held by the application guard, and should be."""
    a = await _applied(client, mint_token)
    now = datetime.now(UTC)

    next_week = await _as_of(a["employer"], now + timedelta(days=8))
    assert next_week.applications.new_last_7_days == 0
    assert next_week.applications.new_last_30_days == 1
    assert next_week.top_jobs[0].new_last_7_days == 0
    assert sum(d.count for d in next_week.applications_per_day) == 1

    next_quarter = await _as_of(a["employer"], now + timedelta(days=31))
    assert next_quarter.applications.new_last_30_days == 0
    assert sum(d.count for d in next_quarter.applications_per_day) == 0
    assert next_quarter.applications.total == 1, "a total is not a window"


async def test_revealed_counts_people_not_opens(client: Any, mint_token: Any) -> None:
    """The frontend's "candidates unlocked". Opening someone twice is one
    person, as it is one against the organisation's caps."""
    from tests.integration.test_candidate_reveal import _reveal

    employer = await _employer(client, mint_token)
    someone, someone_else = await _candidate(mint_token), await _candidate(mint_token)
    for candidate in (someone, someone, someone_else):
        opened = await _reveal(client, employer, candidate["id"])
        assert opened.status_code == 200, opened.text

    body = await _dashboard(client, employer)
    assert body["candidates_revealed"] == {"total": 2, "last_7_days": 2}
    later = await _as_of(employer, datetime.now(UTC) + timedelta(days=8))
    assert (later.candidates_revealed.total, later.candidates_revealed.last_7_days) == (2, 0)

    other = await _dashboard(client, await _employer(client, mint_token))
    assert other["candidates_revealed"] == {"total": 0, "last_7_days": 0}


# --- the activity feed ----------------------------------------------------------------
async def test_activity_is_the_pipeline_history_newest_first(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    employer = a["employer"]
    moved = await client.post(
        f"{PIPELINE}/{a['id']}/stage",
        json={"stage": "SHORTLISTED", "note": "strong on CNC"},
        headers=employer["headers"],
    )
    assert moved.status_code == 200, moved.text

    response = await client.get(ACTIVITY, headers=employer["headers"])
    assert response.status_code == 200, response.text
    items = response.json()["items"]
    assert [(i["to_stage"], i["by"]) for i in items] == [
        ("SHORTLISTED", "EMPLOYER"),
        ("VIEWED", "EMPLOYER"),
        ("SUBMITTED", "CANDIDATE"),
    ]
    assert {i["application_id"] for i in items} == {a["id"]}
    assert {i["job_title"] for i in items} == {a["job"]["title"]}
    assert items[0]["actor_id"] is not None, "which team member acted"
    assert items[2]["actor_id"] is None, "never the candidate's user id"
    for item in items:
        assert not {"note", "candidate_id", "name", "phone", "email", "score"} & set(item)

    candidates = await client.get(
        ACTIVITY, params={"actor": "CANDIDATE"}, headers=employer["headers"]
    )
    assert [i["to_stage"] for i in candidates.json()["items"]] == ["SUBMITTED"]


async def test_activity_pages_without_gaps_or_repeats(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    await _walk(client, a, "SHORTLISTED", "INTERVIEW")
    everything = (await client.get(ACTIVITY, headers=a["employer"]["headers"])).json()["items"]

    seen: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"limit": 1}
        if cursor:
            params["cursor"] = cursor
        page = (await client.get(ACTIVITY, params=params, headers=a["employer"]["headers"])).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert seen == [i["id"] for i in everything]
    assert len(seen) == 4

    bad = await client.get(
        ACTIVITY, params={"cursor": "not-a-cursor"}, headers=a["employer"]["headers"]
    )
    assert bad.status_code == 422
    assert bad.json()["code"] == "invalid_cursor"


# --- who may read it --------------------------------------------------------------------
async def test_another_organisations_pipeline_is_never_counted_or_shown(
    client: Any, mint_token: Any
) -> None:
    """`application_events` has no RLS; the feed reaches it only through
    applications read under the tenant policy."""
    theirs = await _applied(client, mint_token)
    await _walk(client, theirs, "SHORTLISTED", "INTERVIEW")
    await client.put(
        f"{PIPELINE}/{theirs['id']}/interview",
        json=_interview(days=2),
        headers=theirs["employer"]["headers"],
    )
    mine = await _employer(client, mint_token)

    body = await _dashboard(client, mine)
    assert body["applications"]["total"] == 0
    assert body["top_jobs"] == [] and body["upcoming_interviews"] == []
    feed = await client.get(ACTIVITY, headers=mine["headers"])
    assert feed.json()["items"] == []


async def test_every_team_role_reads_it_and_nobody_else_does(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    for role in ("EMPLOYER_VIEWER", "EMPLOYER_RECRUITER"):
        member = await _member(client, mint_token, employer, role)
        for url in (DASHBOARD, ACTIVITY):
            response = await client.get(url, headers=member["headers"])
            assert response.status_code == 200, (role, url, response.text)

    candidate = await _candidate(mint_token, scored=False)
    for url in (DASHBOARD, ACTIVITY):
        assert (await client.get(url, headers=candidate["headers"])).status_code == 403


async def test_an_unpaid_employer_is_asked_to_pay(client: Any, mint_token: Any) -> None:
    """R15: an employer sees the portal without paying and reads nothing from it."""
    headers, _ = mint_token(pool="BUSINESS", email=f"{uuid.uuid4().hex[:12]}@example.test")
    created = await client.post(
        f"{API}/employer/organisation",
        json={"legal_name": f"Unpaid {uuid.uuid4().hex[:6]} Pvt Ltd"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    for url in (DASHBOARD, ACTIVITY):
        response = await client.get(url, headers=headers)
        assert response.status_code == 402, response.text
        assert response.json()["code"] == "subscription_required"
