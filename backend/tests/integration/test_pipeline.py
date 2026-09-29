"""Day 12 through HTTP: the employer's pipeline, interviews, the two-sided hire, expiry.

Candidates are real -- scored, integrity-checked, paying -- and apply through
the API, exactly as in `test_candidate_marketplace.py`, whose helpers these
reuse. The history is read back from `application_events` as the migrator,
so what the tests assert is what was written, not what a response chose to
show.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.applications.domain import STAGES
from tests.conftest import _seed_url, sessions
from tests.integration.test_candidate_marketplace import (
    API,
    APPLICATIONS,
    _apply,
    _candidate,
    _employer,
    _job,
)

pytestmark = pytest.mark.integration

PIPELINE = f"{API}/employer/applications"
APP_URL = os.getenv("DATABASE_URL", "")
MEET = "https://meet.google.com/abc-defg-hij"


# --- helpers ------------------------------------------------------------------
async def _applied(client: Any, mint_token: Any, employer: dict | None = None) -> dict[str, Any]:
    employer = employer or await _employer(client, mint_token)
    job = await _job(client, employer)
    candidate = await _candidate(mint_token)
    applied = await _apply(client, candidate, job)
    assert applied.status_code == 201, applied.text
    return {"employer": employer, "candidate": candidate, "job": job, "id": applied.json()["id"]}


async def _move(client: Any, a: dict[str, Any], stage: str, note: str | None = None) -> Any:
    body: dict[str, Any] = {"stage": stage}
    if note is not None:
        body["note"] = note
    return await client.post(
        f"{PIPELINE}/{a['id']}/stage", json=body, headers=a["employer"]["headers"]
    )


async def _walk(client: Any, a: dict[str, Any], *stages: str) -> dict[str, Any]:
    body: dict[str, Any] = {}
    for stage in stages:
        response = await _move(client, a, stage)
        assert response.status_code == 200, response.text
        body = response.json()
    return body


async def _events(application_id: str) -> list[tuple[Any, ...]]:
    async with sessions(_seed_url())() as session:
        rows = await session.execute(
            text(
                "SELECT kind, from_stage, to_stage, actor_type, actor_id, note "
                "FROM application_events WHERE application_id = :a ORDER BY occurred_at"
            ),
            {"a": application_id},
        )
        return [tuple(r) for r in rows]


async def _outbox(application_id: str) -> list[tuple[str, dict[str, Any]]]:
    async with sessions(_seed_url())() as session:
        rows = await session.execute(
            text(
                "SELECT event_type, payload FROM outbox WHERE aggregate_id = :a ORDER BY created_at"
            ),
            {"a": application_id},
        )
        return [(r[0], r[1]) for r in rows]


async def _as_migrator(sql: str, **params: Any) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(text(sql), params)


async def _scalar_as_migrator(sql: str, **params: Any) -> Any:
    """As above, for a statement with a RETURNING clause."""
    async with sessions(_seed_url())() as session, session.begin():
        return await session.scalar(text(sql), params)


async def _live_expiry_version() -> str:
    """The rules version the sweep SHOULD stamp, read straight from the table.

    `code-v1` when no row exists, `config-vN` when one does. Both are correct,
    and which applies depends on whether `scripts/seed_config.py` has run --
    which it now does on every deploy and in `reset_local_db.sh`.

    Asserting the literal `code-v1` (as this file did until 2026-09-22) was
    really asserting "no config row exists anywhere", i.e. that the platform
    runs on defaults that live only in code. That stopped being true the day
    the defaults became rows, which is the point of seeding them.

    Deliberately raw SQL rather than the service's own reader, so this is an
    independent check: it proves the sweep stamped the version of the row it
    actually used, not merely that it agrees with itself.
    """
    async with sessions(_seed_url())() as session:
        version = await session.scalar(
            text(
                "SELECT version FROM config_values "
                "WHERE key = 'applications.expiry' AND effective_from <= now() "
                "ORDER BY version DESC LIMIT 1"
            )
        )
    return "code-v1" if version is None else f"config-v{version}"


async def _stage(application_id: str) -> str:
    async with sessions(_seed_url())() as session:
        return str(
            await session.scalar(
                text("SELECT stage FROM applications WHERE id = :a"), {"a": application_id}
            )
        )


async def _member(client: Any, mint_token: Any, employer: dict[str, Any], role: str) -> dict:
    email = f"{uuid.uuid4().hex[:12]}@example.test"
    added = await client.post(
        f"{API}/employer/team", json={"email": email, "role": role}, headers=employer["headers"]
    )
    assert added.status_code == 201, added.text
    headers, _ = mint_token(pool="BUSINESS", email=email)
    return {"headers": headers, "user_id": added.json()["user_id"]}


def _interview(days: int = 3, url: str = MEET) -> dict[str, str]:
    at = (datetime.now(UTC) + timedelta(days=days)).replace(microsecond=0)
    return {"interview_at": at.isoformat(), "meeting_url": url}


# --- the pipeline -----------------------------------------------------------------
async def test_a_jobs_applications_are_listed_oldest_first_and_by_stage(
    client: Any, mint_token: Any
) -> None:
    first = await _applied(client, mint_token)
    employer, job = first["employer"], first["job"]
    second_candidate = await _candidate(mint_token)
    second = (await _apply(client, second_candidate, job)).json()["id"]

    listed = await client.get(PIPELINE, params={"job_id": job["id"]}, headers=employer["headers"])
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert [i["id"] for i in items] == [first["id"], second]
    assert items[0]["candidate_id"] == str(first["candidate"]["id"])
    for item in items:
        assert not {"name", "phone", "email", "score"} & set(item)

    await client.get(f"{PIPELINE}/{first['id']}", headers=employer["headers"])
    viewed = await client.get(
        PIPELINE, params={"job_id": job["id"], "stage": "VIEWED"}, headers=employer["headers"]
    )
    assert [i["id"] for i in viewed.json()["items"]] == [first["id"]]

    paged = await client.get(
        PIPELINE, params={"job_id": job["id"], "limit": 1}, headers=employer["headers"]
    )
    rest = await client.get(
        PIPELINE,
        params={"job_id": job["id"], "limit": 1, "cursor": paged.json()["next_cursor"]},
        headers=employer["headers"],
    )
    assert [i["id"] for i in paged.json()["items"] + rest.json()["items"]] == [first["id"], second]
    assert rest.json()["next_cursor"] is None


async def test_without_a_job_the_list_spans_every_job_and_names_each(
    client: Any, mint_token: Any
) -> None:
    """The pipeline board fills from one request. Before this `job_id` was
    required, so "All jobs" was one request per job, merged on the client.

    Oldest first across jobs, each row naming its job, the stage filter and
    the cursor working as they do for one job -- and listing is read-only: it
    never records VIEWED, which only opening an application does."""
    first = await _applied(client, mint_token)
    employer = first["employer"]
    other_job = await _job(client, employer, title="Line Supervisor", location="Nashik")
    second = (await _apply(client, await _candidate(mint_token), other_job)).json()["id"]
    third = (await _apply(client, await _candidate(mint_token), first["job"])).json()["id"]

    listed = await client.get(PIPELINE, headers=employer["headers"])
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert [i["id"] for i in items] == [first["id"], second, third]
    labels = {i["id"]: (i["job_id"], i["job_title"], i["job_location"]) for i in items}
    assert labels[first["id"]] == (first["job"]["id"], first["job"]["title"], "Pune")
    assert labels[second] == (other_job["id"], "Line Supervisor", "Nashik")
    assert {i["stage"] for i in items} == {"SUBMITTED"}, "listing must not record VIEWED"
    for item in items:
        assert not {"name", "phone", "email", "score", "min_score"} & set(item)

    await client.get(f"{PIPELINE}/{second}", headers=employer["headers"])
    viewed = await client.get(PIPELINE, params={"stage": "VIEWED"}, headers=employer["headers"])
    assert [i["id"] for i in viewed.json()["items"]] == [second]

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(3):
        params: dict[str, Any] = {"limit": 1}
        if cursor is not None:
            params["cursor"] = cursor
        page = (await client.get(PIPELINE, params=params, headers=employer["headers"])).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next_cursor"]
    assert seen == [first["id"], second, third]
    assert cursor is None

    # One job still narrows it, and names the job all the same.
    one = await client.get(
        PIPELINE, params={"job_id": other_job["id"]}, headers=employer["headers"]
    )
    assert [(i["id"], i["job_title"]) for i in one.json()["items"]] == [(second, "Line Supervisor")]


async def test_the_jobs_list_carries_each_jobs_pipeline_counts(
    client: Any, mint_token: Any
) -> None:
    """The employer's list draws its funnel from the one request that fills it.

    Without the counts on the row there is no way to fill those columns but a
    call per job, which is what the list costs before this: thirteen jobs,
    thirteen requests, and a table that cannot draw until the last returns.
    """
    employer = await _employer(client, mint_token)
    busy, quiet = await _job(client, employer), await _job(client, employer)

    filed = []
    for _ in range(3):
        applied = await _apply(client, await _candidate(mint_token), busy)
        assert applied.status_code == 201, applied.text
        filed.append({"employer": employer, "id": applied.json()["id"]})
    await _walk(client, filed[0], "SHORTLISTED")
    await _walk(client, filed[1], "REJECTED")

    listed = await client.get(f"{API}/employer/jobs", headers=employer["headers"])
    assert listed.status_code == 200, listed.text
    rows = {row["id"]: row["application_counts"] for row in listed.json()["items"]}

    counts = rows[busy["id"]]
    # Each application is at one stage, so the stages sum to the total: the
    # one that was shortlisted is counted there and not also under VIEWED.
    assert counts["total"] == 3
    assert sum(counts["by_stage"].values()) == counts["total"]
    assert counts["by_stage"]["SUBMITTED"] == 1
    assert counts["by_stage"]["SHORTLISTED"] == 1
    assert counts["by_stage"]["REJECTED"] == 1
    assert counts["by_stage"]["VIEWED"] == 0

    # A job nobody has applied to says zero at every stage rather than leaving
    # the client to tell an absent stage from an empty one.
    assert rows[quiet["id"]] == {"total": 0, "by_stage": dict.fromkeys(STAGES, 0)}


async def test_opening_an_application_records_viewed_once(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    for _ in range(2):
        opened = await client.get(f"{PIPELINE}/{a['id']}", headers=a["employer"]["headers"])
        assert opened.status_code == 200, opened.text
        assert opened.json()["stage"] == "VIEWED"

    events = await _events(a["id"])
    assert [(e[1], e[2], e[3]) for e in events] == [
        (None, "SUBMITTED", "CANDIDATE"),
        ("SUBMITTED", "VIEWED", "EMPLOYER"),
    ]
    board = (
        await client.get(f"{APPLICATIONS}/{a['id']}", headers=a["candidate"]["headers"])
    ).json()
    assert board["stage"] == "VIEWED"
    assert [(h["to_stage"], h["by"]) for h in board["history"]] == [
        ("SUBMITTED", "CANDIDATE"),
        ("VIEWED", "EMPLOYER"),
    ]


async def test_the_pipeline_moves_one_stage_at_a_time(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)

    shortlisted = await _move(client, a, "SHORTLISTED")
    assert shortlisted.status_code == 200, shortlisted.text
    assert [(e[1], e[2]) for e in await _events(a["id"])][1:] == [
        ("SUBMITTED", "VIEWED"),
        ("VIEWED", "SHORTLISTED"),
    ]

    skipped = await _move(client, a, "DECISION")
    assert skipped.status_code == 409
    assert skipped.json()["code"] == "application_invalid_transition"
    assert skipped.json()["params"] == {"from": "SHORTLISTED", "to": "DECISION"}

    again = await _move(client, a, "SHORTLISTED")
    assert again.status_code == 200
    assert len(await _events(a["id"])) == 3

    await _walk(client, a, "INTERVIEW", "DECISION")
    rejected = await _move(client, a, "REJECTED")
    assert rejected.json()["stage"] == "REJECTED"

    for target in ("VIEWED", "HIRED", "WITHDRAWN"):
        response = await _move(client, a, target)
        assert response.status_code in (409, 422), (target, response.text)
    assert await _stage(a["id"]) == "REJECTED"


async def test_notes_and_recruiters_stay_with_the_employer(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    note = f"Strong on CNC, weak on shift availability {uuid.uuid4().hex[:6]}"
    moved = await _move(client, a, "SHORTLISTED", note=note)
    history = moved.json()["history"]
    assert history[-1]["note"] == note
    assert history[-1]["actor_id"] is not None
    assert history[-2]["note"] is None, "the note belongs on the last step only"
    assert history[0]["actor_id"] is None, "a candidate's action names no user to the employer"

    board = await client.get(f"{APPLICATIONS}/{a['id']}", headers=a["candidate"]["headers"])
    assert note not in board.text
    for item in board.json()["history"]:
        assert set(item) == {"kind", "from_stage", "to_stage", "by", "occurred_at"}


async def test_a_viewer_reads_the_pipeline_and_changes_nothing(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    await _walk(client, a, "SHORTLISTED", "INTERVIEW", "DECISION")
    viewer = await _member(client, mint_token, a["employer"], "EMPLOYER_VIEWER")

    listed = await client.get(
        PIPELINE, params={"job_id": a["job"]["id"]}, headers=viewer["headers"]
    )
    assert listed.status_code == 200
    assert (await client.get(f"{PIPELINE}/{a['id']}", headers=viewer["headers"])).status_code == 200

    for response in (
        await client.post(
            f"{PIPELINE}/{a['id']}/stage", json={"stage": "REJECTED"}, headers=viewer["headers"]
        ),
        await client.put(
            f"{PIPELINE}/{a['id']}/interview", json=_interview(), headers=viewer["headers"]
        ),
        await client.post(f"{PIPELINE}/{a['id']}/hire", headers=viewer["headers"]),
    ):
        assert response.status_code == 403, response.text
    assert await _stage(a["id"]) == "DECISION"


async def test_a_recruiter_works_the_pipeline(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    recruiter = await _member(client, mint_token, a["employer"], "EMPLOYER_RECRUITER")
    moved = await client.post(
        f"{PIPELINE}/{a['id']}/stage", json={"stage": "SHORTLISTED"}, headers=recruiter["headers"]
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["history"][-1]["actor_id"] == recruiter["user_id"]


async def test_a_candidate_cannot_reach_the_pipeline(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    headers = a["candidate"]["headers"]
    assert (
        await client.get(PIPELINE, params={"job_id": a["job"]["id"]}, headers=headers)
    ).status_code == 403
    assert (await client.get(f"{PIPELINE}/{a['id']}", headers=headers)).status_code == 403
    assert (await client.post(f"{PIPELINE}/{a['id']}/hire", headers=headers)).status_code == 403


async def test_a_smuggled_field_is_refused(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    for body in (
        {"stage": "SHORTLISTED", "tenant_id": str(uuid.uuid4())},
        {"stage": "SHORTLISTED", "actor_id": str(uuid.uuid4())},
        {"stage": "HIRED"},
    ):
        response = await client.post(
            f"{PIPELINE}/{a['id']}/stage", json=body, headers=a["employer"]["headers"]
        )
        assert response.status_code == 422, body
    assert await _stage(a["id"]) == "SUBMITTED"


# --- interviews ----------------------------------------------------------------------
async def test_an_interview_is_booked_at_the_interview_stage(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    headers = a["employer"]["headers"]
    path = f"{PIPELINE}/{a['id']}/interview"
    await _walk(client, a, "SHORTLISTED")

    early = await client.put(path, json=_interview(), headers=headers)
    assert early.status_code == 409
    assert early.json()["code"] == "interview_not_at_stage"

    await _walk(client, a, "INTERVIEW")
    for body, code in (
        (_interview(url="http://meet.google.com/abc"), "meeting_url_invalid"),
        (_interview(url="javascript:alert(1)"), "meeting_url_invalid"),
        (_interview(days=-1), "interview_time_in_past"),
        (_interview(days=400), "interview_time_too_far"),
    ):
        refused = await client.put(path, json=body, headers=headers)
        assert refused.status_code == 422, body
        assert refused.json()["code"] == code
    naive = await client.put(
        path, json={"interview_at": "2030-01-01T10:00:00", "meeting_url": MEET}, headers=headers
    )
    assert naive.status_code == 422

    booking = _interview()
    booked = await client.put(path, json=booking, headers=headers)
    assert booked.status_code == 200, booked.text
    assert booked.json()["interview"]["meeting_url"] == MEET
    assert (await client.put(path, json=booking, headers=headers)).status_code == 200

    rebooking = _interview(days=5)
    rebooked = await client.put(path, json=rebooking, headers=headers)
    assert rebooked.status_code == 200
    kinds = [e[0] for e in await _events(a["id"])]
    assert kinds.count("INTERVIEW_SCHEDULED") == 2, "a retry records nothing; a rebooking does"

    board = (
        await client.get(f"{APPLICATIONS}/{a['id']}", headers=a["candidate"]["headers"])
    ).json()
    assert board["interview"]["meeting_url"] == MEET
    assert datetime.fromisoformat(board["interview"]["interview_at"]) == datetime.fromisoformat(
        rebooking["interview_at"]
    )

    for event_type, payload in await _outbox(a["id"]):
        assert "meet.google.com" not in json.dumps(payload), event_type


# --- the two-sided hire ------------------------------------------------------------
async def _at_decision(client: Any, mint_token: Any) -> dict[str, Any]:
    a = await _applied(client, mint_token)
    await _walk(client, a, "SHORTLISTED", "INTERVIEW", "DECISION")
    return a


async def test_a_hire_is_final_only_when_both_sides_confirm(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    employer, candidate = a["employer"]["headers"], a["candidate"]["headers"]
    hire = f"{PIPELINE}/{a['id']}/hire"
    confirm = f"{APPLICATIONS}/{a['id']}/hire/confirm"

    await _walk(client, a, "SHORTLISTED", "INTERVIEW")
    early = await client.post(hire, headers=employer)
    assert early.status_code == 409 and early.json()["code"] == "hire_not_allowed"

    await _walk(client, a, "DECISION")
    unproposed = await client.post(confirm, headers=candidate)
    assert unproposed.status_code == 409
    assert unproposed.json()["code"] == "hire_confirmation_not_pending"

    for _ in range(2):
        proposed = await client.post(hire, headers=employer)
        assert proposed.status_code == 200, proposed.text
        assert proposed.json()["stage"] == "DECISION"
        assert proposed.json()["hire_confirmation"] == "PENDING"
    mine = (await client.get(f"{APPLICATIONS}/{a['id']}", headers=candidate)).json()
    assert (mine["stage"], mine["hire_confirmation"]) == ("DECISION", "PENDING")

    for _ in range(2):
        confirmed = await client.post(confirm, headers=candidate)
        assert confirmed.status_code == 200, confirmed.text
        assert confirmed.json()["stage"] == "HIRED"
        assert confirmed.json()["hire_confirmation"] == "CONFIRMED"

    detail = (await client.get(f"{PIPELINE}/{a['id']}", headers=employer)).json()
    assert detail["hire_confirmation"] == "CONFIRMED"
    events = await _events(a["id"])
    assert [e[0] for e in events].count("HIRE_PROPOSED") == 1
    assert events[-1][:4] == ("STAGE_CHANGED", "DECISION", "HIRED", "CANDIDATE")
    assert [t for t, _ in await _outbox(a["id"])].count("applications.hire_confirmed") == 1

    assert (await _move(client, a, "REJECTED")).status_code == 409
    assert (
        await client.post(f"{APPLICATIONS}/{a['id']}/withdraw", headers=candidate)
    ).status_code == 409


async def test_a_disputed_hire_waits_for_someone_to_close_it(client: Any, mint_token: Any) -> None:
    confirmed_later = await _at_decision(client, mint_token)
    rejected_later = await _at_decision(client, mint_token)

    for a in (confirmed_later, rejected_later):
        await client.post(f"{PIPELINE}/{a['id']}/hire", headers=a["employer"]["headers"])
        for _ in range(2):
            disputed = await client.post(
                f"{APPLICATIONS}/{a['id']}/hire/dispute", headers=a["candidate"]["headers"]
            )
            assert disputed.status_code == 200, disputed.text
            assert disputed.json()["hire_confirmation"] == "DISPUTED"
            assert disputed.json()["stage"] == "DECISION"
        assert [e[0] for e in await _events(a["id"])].count("HIRE_DISPUTED") == 1

    a = confirmed_later
    after = await client.post(
        f"{APPLICATIONS}/{a['id']}/hire/confirm", headers=a["candidate"]["headers"]
    )
    assert after.json()["stage"] == "HIRED"

    a = rejected_later
    assert (await _move(client, a, "REJECTED")).json()["stage"] == "REJECTED"
    late = await client.post(
        f"{APPLICATIONS}/{a['id']}/hire/confirm", headers=a["candidate"]["headers"]
    )
    assert late.status_code == 409


async def test_a_candidate_can_walk_away_from_a_proposed_hire(client: Any, mint_token: Any) -> None:
    a = await _at_decision(client, mint_token)
    await client.post(f"{PIPELINE}/{a['id']}/hire", headers=a["employer"]["headers"])
    withdrawn = await client.post(
        f"{APPLICATIONS}/{a['id']}/withdraw", headers=a["candidate"]["headers"]
    )
    assert withdrawn.json()["stage"] == "WITHDRAWN"
    again = await client.post(f"{PIPELINE}/{a['id']}/hire", headers=a["employer"]["headers"])
    assert again.status_code == 409


async def test_answering_a_hire_needs_no_subscription(client: Any, mint_token: Any) -> None:
    a = await _at_decision(client, mint_token)
    await client.post(f"{PIPELINE}/{a['id']}/hire", headers=a["employer"]["headers"])
    await _as_migrator(
        "UPDATE subscriptions SET current_period_end = now() - interval '1 day' "
        "WHERE subscriber_id = :u",
        u=a["candidate"]["id"],
    )
    confirmed = await client.post(
        f"{APPLICATIONS}/{a['id']}/hire/confirm", headers=a["candidate"]["headers"]
    )
    assert confirmed.status_code == 200, confirmed.text


async def test_a_withdrawal_and_a_move_at_once_leave_a_consistent_history(
    client: Any, mint_token: Any
) -> None:
    """Both lock the row; whichever goes second sees the first one's result."""
    a = await _applied(client, mint_token)
    await _walk(client, a, "VIEWED")
    withdraw, move = await asyncio.gather(
        client.post(f"{APPLICATIONS}/{a['id']}/withdraw", headers=a["candidate"]["headers"]),
        _move(client, a, "SHORTLISTED"),
    )
    assert withdraw.status_code == 200, withdraw.text
    assert move.status_code in (200, 409), move.text
    assert await _stage(a["id"]) == "WITHDRAWN"

    events = await _events(a["id"])
    for before, after in itertools.pairwise(events):
        assert after[1] == before[2], events


# --- expiry ----------------------------------------------------------------------------
async def _age(application_id: str, days: int) -> None:
    await _as_migrator(
        "UPDATE applications SET employer_active_at = now() - make_interval(days => :d) "
        "WHERE id = :a",
        d=days,
        a=application_id,
    )


async def _expire(tenant_id: str, now: datetime | None = None) -> int:
    from app.modules.applications import service

    async with sessions(APP_URL)() as session, session.begin():
        return await service.expire_for_tenant(
            session, tenant_id=uuid.UUID(tenant_id), now=now or datetime.now(UTC)
        )


async def test_an_abandoned_application_expires_and_nothing_else_does(
    client: Any, mint_token: Any
) -> None:
    employer = await _employer(client, mint_token)
    abandoned = await _applied(client, mint_token, employer)
    fresh = await _applied(client, mint_token, employer)
    interviewing = await _applied(client, mint_token, employer)
    hire_proposed = await _applied(client, mint_token, employer)

    await _walk(client, interviewing, "SHORTLISTED", "INTERVIEW")
    booked = await client.put(
        f"{PIPELINE}/{interviewing['id']}/interview",
        json=_interview(days=10),
        headers=employer["headers"],
    )
    assert booked.status_code == 200
    await _walk(client, hire_proposed, "SHORTLISTED", "INTERVIEW", "DECISION")
    await client.post(f"{PIPELINE}/{hire_proposed['id']}/hire", headers=employer["headers"])
    for a in (abandoned, interviewing, hire_proposed):
        await _age(a["id"], 40)

    assert await _expire(employer["tenant_id"]) == 1
    assert await _expire(employer["tenant_id"]) == 0, "a second sweep changes nothing"

    assert await _stage(abandoned["id"]) == "EXPIRED"
    assert await _stage(fresh["id"]) == "SUBMITTED"
    assert await _stage(interviewing["id"]) == "INTERVIEW"
    assert await _stage(hire_proposed["id"]) == "DECISION"

    last = (await _events(abandoned["id"]))[-1]
    assert last[:5] == ("STAGE_CHANGED", "SUBMITTED", "EXPIRED", "SYSTEM", None)
    # The event records WHICH rules expired it, so a dispute months later can
    # name them. Compared against the live row rather than a literal -- see
    # `_live_expiry_version`.
    assert last[5] == f"expiry_rules={await _live_expiry_version()}"
    assert "applications.application_expired" in [t for t, _ in await _outbox(abandoned["id"])]

    board = await client.get(
        f"{APPLICATIONS}/{abandoned['id']}", headers=abandoned["candidate"]["headers"]
    )
    assert board.json()["stage"] == "EXPIRED"
    reapplied = await _apply(client, abandoned["candidate"], abandoned["job"])
    assert reapplied.status_code == 201
    assert reapplied.json()["id"] != abandoned["id"]


async def test_acting_on_an_application_restarts_the_clock(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    await _age(a["id"], 40)
    await _walk(client, a, "SHORTLISTED")
    assert await _expire(a["employer"]["tenant_id"]) == 0
    assert await _stage(a["id"]) == "SHORTLISTED"


async def test_the_sweep_releases_candidates_across_employers(client: Any, mint_token: Any) -> None:
    from app.tasks.expire_applications import sweep

    a, b = await _applied(client, mint_token), await _applied(client, mint_token)
    for x in (a, b):
        await _age(x["id"], 45)

    result = await sweep(now=datetime.now(UTC))
    assert result["expired"] >= 2
    assert await _stage(a["id"]) == "EXPIRED"
    assert await _stage(b["id"]) == "EXPIRED"


async def _config(value: object) -> tuple[str, int]:
    """Insert an `applications.expiry` row that outranks whatever is there.

    **Not `version = 1`.** This used to hardcode it, and broke the day
    `scripts/seed_config.py` started writing the defaults as rows -- which is
    what a real deployment looks like, so the test was asserting against a
    database state that only ever existed locally. `coalesce(max(version), 0)`
    is the pattern the rest of the suite already uses (`test_candidate_reveal`,
    `test_college_analytics`, `test_kyb`).

    Returns the version too, because the service stamps `config-v{version}`
    onto the event and the caller has to assert against the real one.
    """
    row = str(uuid.uuid4())
    version = await _scalar_as_migrator(
        "INSERT INTO config_values (id, key, value, version, effective_from) "
        "SELECT :i, 'applications.expiry', CAST(:v AS jsonb), "
        "coalesce(max(version), 0) + 1, :f "
        "FROM config_values WHERE key = 'applications.expiry' "
        "RETURNING version",
        i=row,
        v=json.dumps(value),
        f=datetime(2026, 1, 1, tzinfo=UTC),
    )
    return row, int(version)


async def test_the_expiry_period_is_config(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    await _age(a["id"], 10)
    assert await _expire(a["employer"]["tenant_id"]) == 0, "ten days is inside the default"

    row, version = await _config({"inactive_days": 7})
    try:
        assert await _expire(a["employer"]["tenant_id"]) == 1
    finally:
        await _as_migrator("DELETE FROM config_values WHERE id = :i", i=row)
    # The event records WHICH rules expired it, so a dispute about an expiry
    # months later can name the row. Asserted against the version actually
    # inserted rather than a literal, which is what broke when the defaults
    # became rows.
    assert (await _events(a["id"]))[-1][5] == f"expiry_rules=config-v{version}"


async def test_a_malformed_expiry_period_stops_the_sweep(client: Any, mint_token: Any) -> None:
    from app.modules.applications.service import ExpiryRulesInvalidError

    a = await _applied(client, mint_token)
    await _age(a["id"], 40)
    row, _ = await _config({"inactive_days": 1})
    try:
        with pytest.raises(ExpiryRulesInvalidError):
            await _expire(a["employer"]["tenant_id"])
    finally:
        await _as_migrator("DELETE FROM config_values WHERE id = :i", i=row)
    assert await _stage(a["id"]) == "SUBMITTED"
