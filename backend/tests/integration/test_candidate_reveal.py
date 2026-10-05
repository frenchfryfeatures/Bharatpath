"""Day 14 through HTTP: opening a profile, the view caps, the alerts, and the view log.

The invariants have their own files (`test_invariant_07_access_window.py`,
`test_invariant_07_prime_reveal_audit.py`). This holds everything around them:
who may open a profile, what the caps count, what an alert records, and that
the partitioned log keeps its grants.

**Limits are one global config row**, so a test that changes them inserts a
row and deletes it in a `finally`.
"""

from __future__ import annotations

import json
import os
import random
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from app.core.db import set_transaction_tenant
from app.modules.scoring.domain import band_for, display_value
from tests.conftest import _seed_url, sessions, subscribe_tenant
from tests.integration.test_candidate_marketplace import API, _employer
from tests.integration.test_integrity_pipeline import INJECTED_CV
from tests.integration.test_jobs import _set_kyb
from tests.integration.test_masked_search import SEARCH, _candidate, _latest_raw, _token
from tests.integration.test_pipeline import _member
from tests.invariants.test_invariant_07_prime_reveal_audit import audit_rows, view_events

pytestmark = pytest.mark.integration

APP_URL = os.getenv("DATABASE_URL", "")
ANOMALY = "candidate_view_anomaly_flagged"


async def _reveal(client: Any, employer: dict[str, Any], candidate_id: Any) -> Any:
    return await client.get(f"{SEARCH}/{candidate_id}", headers=employer["headers"])


@asynccontextmanager
async def _limits(value: dict[str, Any]) -> AsyncIterator[None]:
    row_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO config_values (id, key, value, version, effective_from) "
                "SELECT :id, 'discovery.limits', CAST(:v AS jsonb), "
                "coalesce(max(version), 0) + 1, now() - interval '1 hour' "
                "FROM config_values WHERE key = 'discovery.limits'"
            ),
            {"id": str(row_id), "v": json.dumps(value)},
        )
    try:
        yield
    finally:
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("DELETE FROM config_values WHERE id = :id"), {"id": str(row_id)}
            )


async def _outbox_anomalies(tenant_id: str) -> list[dict[str, Any]]:
    async with sessions(_seed_url())() as session:
        result = await session.execute(
            text(
                "SELECT payload FROM outbox WHERE event_type = 'discovery.view_anomaly_flagged' "
                "AND aggregate_id = :t"
            ),
            {"t": tenant_id},
        )
        return [row.payload for row in result]


# --- the profile ----------------------------------------------------------------
async def test_an_opened_profile_has_contact_details_and_the_display_score(
    client: Any, mint_token: Any
) -> None:
    skill = _token()
    candidate = await _candidate(mint_token, skill)
    employer = await _employer(client, mint_token)

    response = await _reveal(client, employer, candidate["id"])
    assert response.status_code == 200, response.text
    body = response.json()

    async with sessions(_seed_url())() as session:
        phone = await session.scalar(
            text("SELECT phone FROM users WHERE id = :u"), {"u": str(candidate["id"])}
        )
    raw = await _latest_raw(candidate["id"])
    assert body["candidate_id"] == str(candidate["id"])
    assert body["phone"] == phone
    assert body["score"] == display_value(raw)
    assert body["band"] == band_for(raw)
    assert skill in body["skills"]
    # A pasted CV names nobody, and no name is guessed from it.
    assert body["full_name"] is None
    # The confirmed CV the score was built from (2026-10-05).
    async with sessions(_seed_url())() as session:
        version = await session.scalar(
            text("SELECT resume_version_id FROM scores WHERE user_id = :u"),
            {"u": str(candidate["id"])},
        )
    assert body["resume"]["version_id"] == str(version)
    assert body["resume"]["confirmed_at"] and body["resume"]["text"]
    assert body["resume"]["sections"]


async def test_the_name_typed_on_the_form_is_shown(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                'UPDATE resume_versions SET parsed = parsed || \'{"full_name": " Kavya Iyer "}\' '
                "WHERE user_id = :u"
            ),
            {"u": str(candidate["id"])},
        )
    employer = await _employer(client, mint_token)
    response = await _reveal(client, employer, candidate["id"])
    assert response.status_code == 200, response.text
    assert response.json()["full_name"] == "Kavya Iyer"


# --- who may open one --------------------------------------------------------------
async def test_a_recruiter_may_open_a_profile_and_a_viewer_may_not(
    client: Any, mint_token: Any
) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    recruiter = await _member(client, mint_token, employer, "EMPLOYER_RECRUITER")
    viewer = await _member(client, mint_token, employer, "EMPLOYER_VIEWER")

    assert (await _reveal(client, recruiter, candidate["id"])).status_code == 200
    refused = await _reveal(client, viewer, candidate["id"])
    assert refused.status_code == 403
    assert len(await view_events(employer["tenant_id"])) == 1


async def test_a_candidate_cannot_open_a_profile(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    other = await _candidate(mint_token, _token())
    response = await client.get(f"{SEARCH}/{other['id']}", headers=candidate["headers"])
    assert response.status_code == 403


async def test_an_unverified_employer_is_refused_when_approval_matters(
    client: Any, mint_token: Any
) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    await _set_kyb(employer["tenant_id"], "UNDER_REVIEW")

    response = await _reveal(client, employer, candidate["id"])
    assert response.status_code == 403
    assert response.json()["code"] == "kyb_required"
    assert await view_events(employer["tenant_id"]) == []


async def test_a_candidate_employers_cannot_see_is_a_404_and_leaves_no_trace(
    client: Any, mint_token: Any
) -> None:
    employer = await _employer(client, mint_token)
    colleague = await _member(client, mint_token, employer, "EMPLOYER_VIEWER")
    unchecked = await _candidate(mint_token, _token(), checked=False)
    suppressed = await _candidate(mint_token, _token(), cv=INJECTED_CV)

    for candidate_id in (uuid.uuid4(), unchecked["id"], suppressed["id"], colleague["user_id"]):
        response = await _reveal(client, employer, candidate_id)
        assert response.status_code == 404, (candidate_id, response.text)
        assert response.json()["code"] == "candidate_not_found"

    assert await view_events(employer["tenant_id"]) == []
    assert await audit_rows(employer["tenant_id"]) == []


# --- R15: payment is the gate --------------------------------------------------------
async def test_an_unpaid_employer_sees_the_portal_and_can_do_nothing_in_it(
    client: Any, mint_token: Any
) -> None:
    headers, _ = mint_token(pool="BUSINESS", email=f"{_token()}@example.test")
    created = await client.post(
        f"{API}/employer/organisation", json={"legal_name": "Browsing Pvt Ltd"}, headers=headers
    )
    assert created.status_code == 201, created.text
    tenant_id = created.json()["tenant_id"]
    await _set_kyb(tenant_id, "APPROVED")

    for path in ("/employer/organisation", "/employer/team", "/employer/kyb"):
        assert (await client.get(f"{API}{path}", headers=headers)).status_code == 200, path

    job = {"title": "Fitter", "description": "d", "salary_min_minor": 1, "salary_max_minor": 2}
    for response in (
        await client.post(f"{API}/employer/jobs", json=job, headers=headers),
        await client.get(f"{API}/employer/jobs", headers=headers),
        await client.get(
            f"{API}/employer/applications", params={"job_id": str(uuid.uuid4())}, headers=headers
        ),
        await client.get(SEARCH, headers=headers),
    ):
        assert response.status_code == 402, response.text
        assert response.json()["code"] == "subscription_required"

    await subscribe_tenant(tenant_id, lapsed=True)
    assert (await client.get(SEARCH, headers=headers)).status_code == 402
    await subscribe_tenant(tenant_id)
    assert (await client.get(SEARCH, headers=headers)).status_code == 200


# --- the caps --------------------------------------------------------------------------
async def test_the_hourly_cap_counts_distinct_candidates(client: Any, mint_token: Any) -> None:
    first, second, third = [await _candidate(mint_token, _token()) for _ in range(3)]
    employer = await _employer(client, mint_token)

    async with _limits({"views_per_hour": 2, "views_per_day": 5}):
        assert (await _reveal(client, employer, first["id"])).status_code == 200
        assert (await _reveal(client, employer, second["id"])).status_code == 200

        refused = await _reveal(client, employer, third["id"])
        assert refused.status_code == 429, refused.text
        assert refused.json()["code"] == "view_cap_reached"
        assert refused.json()["params"] == {"window": "HOURLY"}

        # Opening someone already opened costs nothing, and is still audited.
        assert (await _reveal(client, employer, first["id"])).status_code == 200

    assert [r.candidate_id for r in await view_events(employer["tenant_id"])] == [
        first["id"],
        second["id"],
        first["id"],
    ]
    assert len(await audit_rows(employer["tenant_id"])) == 3


async def test_a_capped_employer_learns_nothing_about_an_id(client: Any, mint_token: Any) -> None:
    """The cap is checked before the lookup, so a capped organisation cannot
    probe which ids are real candidates."""
    first = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    async with _limits({"views_per_hour": 1, "views_per_day": 1}):
        assert (await _reveal(client, employer, first["id"])).status_code == 200
        response = await _reveal(client, employer, uuid.uuid4())
    assert response.status_code == 429
    assert response.json()["params"] == {"window": "DAILY"}


async def test_the_caps_belong_to_each_organisation(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    other = await _candidate(mint_token, _token())
    capped = await _employer(client, mint_token)
    fresh = await _employer(client, mint_token)
    async with _limits({"views_per_hour": 1, "views_per_day": 1}):
        assert (await _reveal(client, capped, candidate["id"])).status_code == 200
        assert (await _reveal(client, capped, other["id"])).status_code == 429
        assert (await _reveal(client, fresh, other["id"])).status_code == 200


async def test_a_person_clicking_too_fast_is_rate_limited(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    async with _limits({"reveals_per_minute": 2}):
        statuses = [
            (await _reveal(client, employer, candidate["id"])).status_code for _ in range(3)
        ]
    assert statuses == [200, 200, 429]


async def test_a_misconfigured_limit_refuses_rather_than_defaulting(
    client: Any, mint_token: Any
) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    async with _limits({"views_per_dya": 3}):
        response = await _reveal(client, employer, candidate["id"])
        search = await client.get(SEARCH, headers=employer["headers"])
    assert response.status_code == 500
    assert response.json()["code"] == "discovery_limits_invalid"
    assert search.json()["code"] == "discovery_limits_invalid"
    assert await view_events(employer["tenant_id"]) == []


# --- alerts ----------------------------------------------------------------------------
async def test_a_burst_by_one_person_is_flagged_once_and_blocks_nothing(
    client: Any, mint_token: Any
) -> None:
    candidates = [await _candidate(mint_token, _token()) for _ in range(3)]
    employer = await _employer(client, mint_token)

    async with _limits({"velocity_views": 2, "velocity_window_minutes": 10}):
        for candidate in candidates:
            assert (await _reveal(client, employer, candidate["id"])).status_code == 200

    (alert,) = await audit_rows(employer["tenant_id"], ANOMALY)
    assert alert.target_type == "tenant"
    assert alert.target_id == employer["tenant_id"]
    assert alert.metadata == {"kind": "ACTOR_VELOCITY", "views": 2, "window_minutes": 10}
    (event,) = await _outbox_anomalies(employer["tenant_id"])
    assert event["kind"] == "ACTOR_VELOCITY"


async def test_filling_the_daily_cap_is_flagged(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    async with _limits({"views_per_hour": 1, "views_per_day": 1}):
        assert (await _reveal(client, employer, candidate["id"])).status_code == 200
    kinds = [row.metadata["kind"] for row in await audit_rows(employer["tenant_id"], ANOMALY)]
    assert kinds == ["DAILY_CAP_REACHED"]


# --- the view log ------------------------------------------------------------------------
async def test_the_view_log_is_partitioned_by_month() -> None:
    async with sessions(_seed_url())() as session:
        kind = await session.scalar(
            text("SELECT relkind::text FROM pg_class WHERE relname = 'candidate_view_events'")
        )
        strategy = await session.scalar(
            text(
                "SELECT partstrat::text FROM pg_partitioned_table p JOIN pg_class c "
                "ON c.oid = p.partrelid WHERE c.relname = 'candidate_view_events'"
            )
        )
    assert (kind, strategy) == ("p", "r")


async def test_the_view_log_is_append_only_and_its_partitions_are_closed(
    client: Any, mint_token: Any
) -> None:
    """RLS on the parent does not cover a query that names a partition, so the
    app role must not be able to name one."""
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    assert (await _reveal(client, employer, candidate["id"])).status_code == 200
    partition = f"candidate_view_events_{datetime.now(UTC):%Y_%m}"

    factory = sessions(APP_URL)
    for statement in (
        "UPDATE candidate_view_events SET candidate_id = actor_id",
        "DELETE FROM candidate_view_events",
        f"SELECT * FROM {partition}",
        "SELECT * FROM candidate_view_events_default",
        f"INSERT INTO {partition} (tenant_id, actor_id, candidate_id) "
        "SELECT tenant_id, actor_id, candidate_id FROM candidate_view_events LIMIT 1",
    ):
        async with factory() as session, session.begin():
            await set_transaction_tenant(session, uuid.UUID(employer["tenant_id"]))
            with pytest.raises((ProgrammingError, DBAPIError)) as exc:
                await session.execute(text(statement))
            assert "permission denied" in str(exc.value).lower(), statement


async def test_one_organisation_cannot_read_anothers_view_log(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    viewer = await _employer(client, mint_token)
    other = await _employer(client, mint_token)
    assert (await _reveal(client, viewer, candidate["id"])).status_code == 200

    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_tenant(session, uuid.UUID(other["tenant_id"]))
        seen = await session.scalar(
            text("SELECT count(*) FROM candidate_view_events WHERE tenant_id = :t"),
            {"t": viewer["tenant_id"]},
        )
    assert seen == 0


async def test_the_maintenance_task_adds_months_once_and_closes_them() -> None:
    from app.tasks.view_event_partitions import run

    # A month no other run has created, so "created" is exact.
    year = random.randint(2100, 2900)
    now = datetime(year, 1, 15, tzinfo=UTC)
    assert await run(now=now) == {"created": 4}
    assert await run(now=now) == {"created": 0}

    async with sessions(_seed_url())() as session:
        readable = await session.scalar(
            text("SELECT has_table_privilege('bharatpath_app', :p, 'SELECT')"),
            {"p": f"candidate_view_events_{year}_04"},
        )
    assert readable is False


async def test_the_partition_function_refuses_a_silly_range() -> None:
    async with sessions(APP_URL)() as session, session.begin():
        with pytest.raises(DBAPIError, match="months must be between"):
            await session.execute(
                text("SELECT ensure_candidate_view_partitions(:d, 0)"), {"d": date(2030, 1, 1)}
            )


# --- the name given at sign-up (blockers E13) ------------------------------------
async def test_the_name_given_at_sign_up_is_shown_on_the_reveal_and_never_on_a_card(
    client: Any, mint_token: Any
) -> None:
    skill = _token()
    candidate = await _candidate(mint_token, skill)
    saved = await client.put(
        f"{API}/candidate/profile/name",
        json={"full_name": "  Meera   Nair "},
        headers=candidate["headers"],
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["full_name"] == "Meera Nair"

    employer = await _employer(client, mint_token)
    cards = await client.get(SEARCH, params={"skill": skill}, headers=employer["headers"])
    assert cards.status_code == 200, cards.text
    assert "Meera" not in cards.text

    revealed = await _reveal(client, employer, candidate["id"])
    assert revealed.json()["full_name"] == "Meera Nair"


async def test_the_sign_up_name_wins_over_the_form(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                'UPDATE resume_versions SET parsed = parsed || \'{"full_name": "Old Name"}\' '
                "WHERE user_id = :u"
            ),
            {"u": str(candidate["id"])},
        )
    await client.put(
        f"{API}/candidate/profile/name",
        json={"full_name": "New Name"},
        headers=candidate["headers"],
    )
    employer = await _employer(client, mint_token)
    assert (await _reveal(client, employer, candidate["id"])).json()["full_name"] == "New Name"


async def test_a_name_that_is_not_a_name_is_refused(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    for refused in (
        {"full_name": "call 9876543210"},
        {"full_name": "a@b.in"},
        {"full_name": ""},
        {},
    ):
        response = await client.put(
            f"{API}/candidate/profile/name", json=refused, headers=candidate["headers"]
        )
        assert response.status_code == 422, refused

    employer = await _employer(client, mint_token)
    response = await client.put(
        f"{API}/candidate/profile/name", json={"full_name": "Anyone"}, headers=employer["headers"]
    )
    assert response.status_code == 403
