"""The admin dashboard: every queue a member of staff can open, counted.

The console's counts are platform-wide and the test database is shared, so
every assertion here is a **difference** between two loads around one action,
never an absolute number. Tests run one at a time, so nothing else moves the
counts in between.
"""

# ruff: noqa: F811 - `fake_s3` is a pytest fixture imported from the resume intake

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.admin.domain import THROUGHPUT_DAYS, dashboard_sections
from app.modules.identity.domain import PLATFORM_ROLES
from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import ADMIN, API, DISPUTES, _audit_rows, _scalar, _staff
from tests.integration.test_candidate_marketplace import _candidate, _employer, _job
from tests.integration.test_integrity_pipeline import (
    EXTRACTED,
    INJECTED_CV,
    _evaluate,
    _high_signal_id,
    _scored_version,
)
from tests.integration.test_kyb import _config, _drop_config, _ready
from tests.integration.test_kyb import _organisation as _kyb_organisation
from tests.integration.test_resume_intake import FakeS3, fake_s3  # noqa: F401 - fixture

pytestmark = pytest.mark.integration

DASHBOARD = f"{ADMIN}/dashboard"
#: `domain.DashboardSection -> (response field, oldest_waiting type)`.
SECTIONS = {
    "kyb": ("kyb", "KYB"),
    "integrity": ("integrity", "INTEGRITY"),
    "disputes": ("disputes", "DISPUTE"),
    "tenants": ("organisations", None),
}


async def _load(client: Any, staff: dict[str, Any]) -> dict[str, Any]:
    response = await client.get(DASHBOARD, headers=staff["headers"])
    assert response.status_code == 200, response.text
    return dict(response.json())


def _today(body: dict[str, Any]) -> dict[str, int]:
    return dict(body["throughput"][-1])


# --- who sees what ------------------------------------------------------------------------
async def test_each_role_sees_the_queues_it_can_open_and_nothing_more(
    client: Any, mint_token: Any
) -> None:
    for role in sorted(PLATFORM_ROLES):
        body = await _load(client, await _staff(mint_token, role))
        shown = {section for section, (field, _) in SECTIONS.items() if body[field] is not None}
        assert shown == dashboard_sections(role), role
        types = {SECTIONS[section][1] for section in shown}
        assert {w["type"] for w in body["oldest_waiting"]} <= types, role
        assert body["platform_totals"] is not None
        assert len(body["throughput"]) == THROUGHPUT_DAYS


async def test_a_load_is_one_audit_row(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    before = await _audit_rows("admin_bypass_session_opened", admin["user_id"])
    await _load(client, admin)
    assert await _audit_rows("admin_bypass_session_opened", admin["user_id"]) == before + 1
    target = await _scalar(
        "SELECT target_type FROM audit_events WHERE actor_id = :u ORDER BY occurred_at DESC "
        "LIMIT 1",
        u=admin["user_id"],
    )
    assert target == "admin_dashboard"


async def test_oldest_waiting_is_oldest_first_and_names_no_person(
    client: Any, mint_token: Any
) -> None:
    body = await _load(client, await _staff(mint_token))
    waiting = body["oldest_waiting"]
    assert len(waiting) <= 5
    assert [w["waiting_since"] for w in waiting] == sorted(w["waiting_since"] for w in waiting)
    for item in waiting:
        assert not {"name", "email", "phone", "description", "evidence"} & set(item)


# --- the queues move ------------------------------------------------------------------------
async def test_a_dispute_moves_through_the_tiles_and_the_chart(
    client: Any, mint_token: Any
) -> None:
    agent = await _staff(mint_token, "SUPPORT_AGENT")
    candidate = await _candidate(mint_token, scored=False, subscribed=False)
    before = await _load(client, agent)

    raised = await client.post(
        DISPUTES,
        json={"kind": "PAYMENT", "description": "I was charged twice this month."},
        headers=candidate["headers"],
    )
    assert raised.status_code == 201, raised.text
    dispute_id = raised.json()["id"]
    opened = await _load(client, agent)
    assert opened["disputes"]["open"] == before["disputes"]["open"] + 1
    assert opened["disputes"]["unassigned"] == before["disputes"]["unassigned"] + 1
    assert opened["disputes"]["by_kind"]["PAYMENT"] == before["disputes"]["by_kind"]["PAYMENT"] + 1
    assert _today(opened)["intake"] == _today(before)["intake"] + 1

    await client.post(f"{ADMIN}/disputes/{dispute_id}/assign", headers=agent["headers"])
    taken = await _load(client, agent)
    assert taken["disputes"]["open"] == before["disputes"]["open"]
    assert taken["disputes"]["in_review"] == before["disputes"]["in_review"] + 1
    assert taken["disputes"]["unassigned"] == before["disputes"]["unassigned"]

    closed = await client.post(
        f"{ADMIN}/disputes/{dispute_id}/resolve",
        json={"outcome": "RESOLVED", "resolution": "Refunded the second charge."},
        headers=agent["headers"],
    )
    assert closed.status_code == 200, closed.text
    after = await _load(client, agent)
    assert after["disputes"]["in_review"] == before["disputes"]["in_review"]
    assert _today(after)["cleared"] == _today(before)["cleared"] + 1


async def test_a_high_signal_holds_its_candidate_back_until_cleared(
    client: Any, mint_token: Any
) -> None:
    reviewer = await _staff(mint_token, "INTEGRITY_REVIEWER")
    before = await _load(client, reviewer)

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
    raised = int(
        await _scalar(
            "SELECT count(*) FROM integrity_signals WHERE candidate_id = :c", c=candidate_id
        )
    )

    flagged = await _load(client, reviewer)
    assert flagged["integrity"]["open"] == before["integrity"]["open"] + raised
    assert (
        flagged["integrity"]["open_by_severity"]["HIGH"]
        > before["integrity"]["open_by_severity"]["HIGH"]
    )
    assert (
        flagged["integrity"]["candidates_held_back"]
        == before["integrity"]["candidates_held_back"] + 1
    )
    assert _today(flagged)["intake"] == _today(before)["intake"] + raised

    cleared = await client.post(
        f"{ADMIN}/integrity/signals/{signal_id}/resolve",
        json={"outcome": "CLEARED", "note": "A quoted example."},
        headers=reviewer["headers"],
    )
    assert cleared.status_code == 200, cleared.text
    after = await _load(client, reviewer)
    assert after["integrity"]["candidates_held_back"] == before["integrity"]["candidates_held_back"]
    assert _today(after)["cleared"] == _today(flagged)["cleared"] + 1


async def test_with_approval_on_a_submission_waits_for_review(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    row = await _config(True)
    try:
        reviewer = await _staff(mint_token, "KYB_REVIEWER")
        before = await _load(client, reviewer)
        assert before["kyb"]["review_required"] is True

        owner = await _kyb_organisation(client, mint_token)
        await _ready(client, owner["headers"], fake_s3)
        submitted = await client.post(f"{API}/employer/kyb/submit", headers=owner["headers"])
        assert submitted.status_code == 200, submitted.text
        submission_id = submitted.json()["submission_id"]

        waiting = await _load(client, reviewer)
        assert waiting["kyb"]["awaiting_review"] == before["kyb"]["awaiting_review"] + 1
        assert waiting["kyb"]["oldest_waiting_since"] is not None
        assert _today(waiting)["intake"] == _today(before)["intake"] + 1

        decided = await client.post(
            f"{ADMIN}/kyb/submissions/{submission_id}/decision",
            json={"decision": "APPROVED"},
            headers=reviewer["headers"],
        )
        assert decided.status_code == 200, decided.text
        after = await _load(client, reviewer)
        assert after["kyb"]["awaiting_review"] == before["kyb"]["awaiting_review"]
        assert _today(after)["cleared"] == _today(before)["cleared"] + 1
    finally:
        await _drop_config(row)


async def test_organisations_and_platform_totals_follow_the_platform(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    before = await _load(client, admin)

    employer = await _employer(client, mint_token)
    await _job(client, employer)
    await _candidate(mint_token, scored=False, subscribed=False)
    grown = await _load(client, admin)
    for key, delta in (("employers", 1), ("candidates", 1), ("jobs_published", 1)):
        assert grown["platform_totals"][key] == before["platform_totals"][key] + delta, key
    assert (
        grown["organisations"]["employers"]["active"]
        == before["organisations"]["employers"]["active"] + 1
    )

    suspended = await client.post(
        f"{ADMIN}/tenants/{employer['tenant_id']}/suspend",
        json={"reason": "Dashboard test"},
        headers=admin["headers"],
    )
    assert suspended.status_code == 201, suspended.text
    after = await _load(client, admin)
    employers = after["organisations"]["employers"]
    assert employers["active"] == before["organisations"]["employers"]["active"]
    assert employers["suspended"] == before["organisations"]["employers"]["suspended"] + 1
    assert after["platform_totals"]["employers"] == before["platform_totals"]["employers"]
