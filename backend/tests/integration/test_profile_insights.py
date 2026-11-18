"""Activity receipts, deduplication, rollups, privacy and job-context viewed proof."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text

from app.tasks.profile_insights import sweep
from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _staff
from tests.integration.test_candidate_marketplace import _apply, _candidate, _employer, _job

pytestmark = pytest.mark.integration
BASE = "/api/v1/candidate/insights"


async def test_views_deduplicate_per_recruiter_day_and_general_search_is_not_job_view(
    client: Any, mint_token: Any
):
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    for _ in range(2):
        response = await client.get(
            f"/api/v1/employer/discovery/candidates/{candidate['id']}", headers=employer["headers"]
        )
        assert response.status_code == 200, response.text
    await sweep()
    overview = await client.get(BASE, headers=candidate["headers"], params={"days": 7})
    assert overview.status_code == 200, overview.text
    assert overview.json()["views"]["current"] == 1
    assert overview.json()["views"]["percent_change"] is None
    assert overview.json()["applications"]["items"] == []
    outsider = await _candidate(mint_token)
    other = await client.get(BASE, headers=outsider["headers"])
    assert other.json()["views"]["current"] == 0


async def test_search_is_counted_only_after_visible_receipt_and_cannot_be_replayed_or_stolen(
    client: Any, mint_token: Any
):
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    other = await _employer(client, mint_token)
    page = await client.get(
        "/api/v1/employer/discovery/candidates?limit=100&skill=SAP", headers=employer["headers"]
    )
    assert page.status_code == 200, page.text
    card = None
    for _ in range(100):
        card = next(
            (item for item in page.json()["items"] if item["candidate_id"] == str(candidate["id"])),
            None,
        )
        if card or not page.json()["next_cursor"]:
            break
        page = await client.get(
            "/api/v1/employer/discovery/candidates",
            params={"limit": 100, "skill": "SAP", "cursor": page.json()["next_cursor"]},
            headers=employer["headers"],
        )
    assert card is not None, page.text
    receipt = card["impression_receipt"]
    await sweep()
    before = await client.get(BASE, headers=candidate["headers"])
    assert before.json()["search"]["current"] == 0
    stolen = await client.post(
        "/api/v1/employer/insights/impressions",
        headers=other["headers"],
        json={"receipts": [receipt]},
    )
    assert stolen.status_code == 200, stolen.text
    assert stolen.json()["accepted"] == 0
    for expected in (1, 0):
        shown = await client.post(
            "/api/v1/employer/insights/impressions",
            headers=employer["headers"],
            json={"receipts": [receipt, receipt]},
        )
        assert shown.status_code == 200, shown.text
        assert shown.json()["accepted"] == expected
    await sweep()
    await sweep()
    after = (await client.get(BASE, headers=candidate["headers"])).json()
    assert after["search"]["current"] == 1
    assert {item["keyword"] for item in after["keywords"]} == {"sap"}


async def test_recruiter_actions_are_idempotent_and_never_return_recruiter_identity(
    client: Any, mint_token: Any
):
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    await client.get(
        f"/api/v1/employer/discovery/candidates/{candidate['id']}", headers=employer["headers"]
    )
    body = {
        "candidate_id": str(candidate["id"]),
        "action": "EMAIL_OPENED",
        "event_id": str(uuid.uuid4()),
    }
    for expected in (True, False):
        response = await client.post(
            "/api/v1/employer/insights/actions", headers=employer["headers"], json=body
        )
        assert response.status_code == 200, response.text
        assert response.json()["recorded"] is expected
    await sweep()
    result = (await client.get(BASE, headers=candidate["headers"])).json()
    assert result["actions"]["current"] == 1
    assert result["companies"][0]["name"] == employer["name"]
    assert set(result["companies"][0]) == {"name", "industry", "city", "actions"}
    forbidden = await client.get("/api/v1/admin/insights/config", headers=candidate["headers"])
    assert forbidden.status_code == 403


async def test_viewed_timeline_requires_an_actual_application_open(client: Any, mint_token: Any):
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    applied = await _apply(client, candidate, job)
    assert applied.status_code == 201, applied.text
    application = applied.json()["id"]
    await client.get(
        f"/api/v1/employer/discovery/candidates/{candidate['id']}", headers=employer["headers"]
    )
    before = (await client.get(BASE, headers=candidate["headers"])).json()["applications"]["items"]
    item = next(item for item in before if item["id"] == application)
    assert [event["stage"] for event in item["timeline"]] == ["SUBMITTED"]
    opened = await client.get(
        f"/api/v1/employer/applications/{application}", headers=employer["headers"]
    )
    assert opened.status_code == 200, opened.text
    after = (await client.get(BASE, headers=candidate["headers"])).json()["applications"]["items"]
    assert [
        event["stage"]
        for event in next(item for item in after if item["id"] == application)["timeline"]
    ] == ["SUBMITTED", "VIEWED"]


async def test_config_is_admin_only_versioned_and_switches_off_metrics(
    client: Any, mint_token: Any
):
    staff = await _staff(mint_token)
    candidate = await _candidate(mint_token)
    old = (await client.get("/api/v1/admin/insights/config", headers=staff["headers"])).json()
    changed = {**old, "metrics": {**old["metrics"], "views": False}}
    try:
        saved = await client.put(
            "/api/v1/admin/insights/config", headers=staff["headers"], json=changed
        )
        assert saved.status_code == 200, saved.text
        stale = await client.put(
            "/api/v1/admin/insights/config", headers=staff["headers"], json=changed
        )
        assert stale.status_code == 409
        overview = (await client.get(BASE, headers=candidate["headers"])).json()
        assert "views" not in overview
    finally:
        current = (
            await client.get("/api/v1/admin/insights/config", headers=staff["headers"])
        ).json()
        await client.put(
            "/api/v1/admin/insights/config",
            headers=staff["headers"],
            json={**old, "version": current["version"]},
        )


async def test_retention_archives_only_anonymous_totals_and_rollup_is_idempotent(
    client: Any, mint_token: Any
):
    from app.modules.profile_insights import repository

    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    employer = await _employer(client, mint_token)
    now = datetime.now(UTC)
    async with sessions(_seed_url())() as session, session.begin():
        actor = await session.scalar(
            text("SELECT user_id FROM memberships WHERE tenant_id=:tenant LIMIT 1"),
            {"tenant": uuid.UUID(employer["tenant_id"])},
        )
        for ago in (0, 10, 400):
            await repository.event(
                session,
                candidate_id=candidate["id"],
                actor_id=actor,
                tenant_id=uuid.UUID(employer["tenant_id"]),
                metric="PROFILE_VIEW",
                dedup_key=str(uuid.uuid4()),
                occurred_at=now - timedelta(days=ago),
            )
    await sweep()
    await sweep()
    seven = (await client.get(BASE, headers=candidate["headers"], params={"days": 7})).json()
    assert seven["views"]["current"] == 1
    assert seven["views"]["previous"] == 1
    assert seven["views"]["percent_change"] == 0
    thirty = (await client.get(BASE, headers=candidate["headers"], params={"days": 30})).json()
    assert thirty["views"]["current"] == 2
    async with sessions(_seed_url())() as session:
        old = await session.scalar(
            text(
                """SELECT count(*) FROM profile_insight_events
                WHERE candidate_id=:candidate AND occurred_at<:cutoff"""
            ),
            {"candidate": candidate["id"], "cutoff": now - timedelta(days=365)},
        )
        assert old == 0
        total = await session.scalar(
            text("SELECT count FROM profile_insight_anonymous_totals WHERE metric='PROFILE_VIEW'")
        )
        assert total >= 1


async def test_expired_and_now_hidden_impressions_do_not_count(client: Any, mint_token: Any):
    from app.core.tenant import TenantContext
    from app.modules.profile_insights import repository

    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    async with sessions(_seed_url())() as session, session.begin():
        actor = await session.scalar(
            text("SELECT user_id FROM memberships WHERE tenant_id=:tenant LIMIT 1"),
            {"tenant": uuid.UUID(employer["tenant_id"])},
        )
        ctx = TenantContext(actor, uuid.UUID(employer["tenant_id"]), "EMPLOYER_OWNER", "BUSINESS")
        expired = (await repository.issue_receipts(session, ctx, [candidate["id"]], ["sap"]))[
            candidate["id"]
        ]
        await session.execute(
            text(
                """UPDATE profile_insight_receipts SET expires_at=now()-interval '1 second'
                WHERE id=:id"""
            ),
            {"id": expired},
        )
    response = await client.post(
        "/api/v1/employer/insights/impressions",
        headers=employer["headers"],
        json={"receipts": [str(expired)]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["accepted"] == 0
    async with sessions(_seed_url())() as session, session.begin():
        hidden = (await repository.issue_receipts(session, ctx, [candidate["id"]], ["sap"]))[
            candidate["id"]
        ]
        await session.execute(
            text("UPDATE users SET status='SUSPENDED' WHERE id=:id"), {"id": candidate["id"]}
        )
    try:
        response = await client.post(
            "/api/v1/employer/insights/impressions",
            headers=employer["headers"],
            json={"receipts": [str(hidden)]},
        )
        assert response.status_code == 200, response.text
        assert response.json()["accepted"] == 0
    finally:
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("UPDATE users SET status='ACTIVE' WHERE id=:id"), {"id": candidate["id"]}
            )


async def test_hidden_application_profile_does_not_add_a_view(client: Any, mint_token: Any):
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    job = await _job(client, employer)
    applied = await _apply(client, candidate, job)
    application = applied.json()["id"]
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text("UPDATE users SET status='SUSPENDED' WHERE id=:id"), {"id": candidate["id"]}
        )
    try:
        opened = await client.get(
            f"/api/v1/employer/applications/{application}", headers=employer["headers"]
        )
        assert opened.status_code == 200, opened.text
        assert opened.json()["candidate"] is None
    finally:
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("UPDATE users SET status='ACTIVE' WHERE id=:id"), {"id": candidate["id"]}
            )
    await sweep()
    overview = (await client.get(BASE, headers=candidate["headers"])).json()
    assert overview["views"]["current"] == 0
    assert all(
        event["stage"] != "VIEWED"
        for item in overview["applications"]["items"]
        for event in item["timeline"]
    )
