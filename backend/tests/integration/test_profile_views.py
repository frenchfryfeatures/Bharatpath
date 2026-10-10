"""Who viewed my profile (2026-10-02): `GET /candidate/profile/views`.

The candidate's side of the view log the reveal writes. One entry per
organisation, its name and its latest open, within the lookback. What it must
never carry: the recruiter who looked, a count of opens, or anything about
another candidate.
"""

from __future__ import annotations

import importlib.util
import os
import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.discovery.domain import PROFILE_VIEWS_LOOKBACK_DAYS
from app.modules.discovery.schemas import ProfileView
from tests.conftest import _seed_url, sessions
from tests.integration.test_candidate_marketplace import API, _employer
from tests.integration.test_masked_search import SEARCH, _candidate, _token
from tests.integration.test_pipeline import _member

pytestmark = pytest.mark.integration

VIEWS = f"{API}/candidate/profile/views"
APP_URL = os.getenv("DATABASE_URL", "")
MIGRATION = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0009_candidate_profile_views.py"
)

#: Widening this tells candidates something new about every employer that
#: opens them. It is a product decision, not a refactor. The logo was one
#: (2026-10-10: every surface naming an organisation carries its logo): it
#: is the organisation's own face, and says nothing about who in it looked.
VIEW_FIELDS = frozenset({"employer_name", "employer_logo_url", "last_viewed_at"})


async def _open(client: Any, employer: dict[str, Any], candidate_id: Any) -> None:
    response = await client.get(f"{SEARCH}/{candidate_id}", headers=employer["headers"])
    assert response.status_code == 200, response.text


async def _views(client: Any, candidate: dict[str, Any], **params: Any) -> Any:
    response = await client.get(VIEWS, params=params, headers=candidate["headers"])
    assert response.status_code == 200, response.text
    return response.json()


# --- what it says -------------------------------------------------------------
def test_a_view_names_the_organisation_and_nothing_else() -> None:
    assert set(ProfileView.model_fields) == VIEW_FIELDS


def test_the_lookback_frozen_in_sql_is_the_domains() -> None:
    spec = importlib.util.spec_from_file_location("profile_views_migration", MIGRATION)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.LOOKBACK_DAYS == PROFILE_VIEWS_LOOKBACK_DAYS


async def test_a_candidate_sees_who_opened_their_profile(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    await _open(client, employer, candidate["id"])

    body = await _views(client, candidate)
    assert [item["employer_name"] for item in body["items"]] == [employer["name"]]
    assert set(body["items"][0]) == VIEW_FIELDS
    assert body["next_cursor"] is None
    assert body.get("total") is None


async def test_nobody_having_looked_is_an_empty_list(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    assert (await _views(client, candidate))["items"] == []


async def test_re_opens_and_colleagues_are_one_entry_per_organisation(
    client: Any, mint_token: Any
) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    recruiter = await _member(client, mint_token, employer, "EMPLOYER_RECRUITER")
    await _open(client, employer, candidate["id"])
    await _open(client, employer, candidate["id"])
    await _open(client, recruiter, candidate["id"])

    items = (await _views(client, candidate))["items"]
    assert [item["employer_name"] for item in items] == [employer["name"]]


async def test_the_latest_open_comes_first(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    first = await _employer(client, mint_token)
    second = await _employer(client, mint_token)
    await _open(client, first, candidate["id"])
    await _open(client, second, candidate["id"])
    names = [item["employer_name"] for item in (await _views(client, candidate))["items"]]
    assert names == [second["name"], first["name"]]

    # Opening again moves an organisation back to the top.
    await _open(client, first, candidate["id"])
    names = [item["employer_name"] for item in (await _views(client, candidate))["items"]]
    assert names == [first["name"], second["name"]]


async def test_it_pages_by_cursor(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    employers = [await _employer(client, mint_token) for _ in range(3)]
    for employer in employers:
        await _open(client, employer, candidate["id"])

    seen: list[str] = []
    cursor = None
    for _ in range(3):
        params = {"limit": 1} if cursor is None else {"limit": 1, "cursor": cursor}
        body = await _views(client, candidate, **params)
        seen += [item["employer_name"] for item in body["items"]]
        cursor = body["next_cursor"]
    assert seen == [e["name"] for e in reversed(employers)]
    assert cursor is None


async def test_a_bad_cursor_is_refused(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    response = await client.get(
        VIEWS, params={"cursor": "not-a-cursor"}, headers=candidate["headers"]
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_cursor"


async def test_an_open_older_than_the_lookback_is_not_listed(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    await _open(client, employer, candidate["id"])
    old = await _employer(client, mint_token)
    insert = text(
        "INSERT INTO candidate_view_events (tenant_id, actor_id, candidate_id, viewed_at) "
        "SELECT :t, m.user_id, :c, now() - make_interval(days => :d) "
        "FROM memberships m WHERE m.tenant_id = :t LIMIT 1"
    )
    params = {"t": old["tenant_id"], "c": str(candidate["id"])}
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(insert, {**params, "d": PROFILE_VIEWS_LOOKBACK_DAYS + 1})
    try:
        names = [item["employer_name"] for item in (await _views(client, candidate))["items"]]
        assert names == [employer["name"]]
    finally:
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text(
                    "DELETE FROM candidate_view_events WHERE tenant_id = :t AND candidate_id = :c"
                ),
                params,
            )


# --- who may read it ----------------------------------------------------------
async def test_a_candidate_never_sees_anothers_views(client: Any, mint_token: Any) -> None:
    opened = await _candidate(mint_token, _token())
    other = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    await _open(client, employer, opened["id"])
    assert (await _views(client, other))["items"] == []


async def test_an_employer_cannot_read_it(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    response = await client.get(VIEWS, headers=employer["headers"])
    assert response.status_code == 403


async def test_the_function_answers_for_nobody_when_nothing_is_bound(
    client: Any, mint_token: Any
) -> None:
    """On the app role with no candidate bound, or with a tenant bound, the
    function returns nothing. It takes no candidate id to be talked into."""
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    await _open(client, employer, candidate["id"])

    call = text("SELECT count(*) FROM candidate_profile_views(NULL, NULL, 100)")
    async with sessions(APP_URL)() as session, session.begin():
        assert await session.scalar(call) == 0
    async with sessions(APP_URL)() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.user_id', :u, true)"), {"u": str(candidate["id"])}
        )
        await session.execute(
            text("SELECT set_config('app.tenant_id', :t, true)"), {"t": employer["tenant_id"]}
        )
        assert await session.scalar(call) == 0
    async with sessions(APP_URL)() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.user_id', :u, true)"), {"u": str(uuid.uuid4())}
        )
        assert await session.scalar(call) == 0
