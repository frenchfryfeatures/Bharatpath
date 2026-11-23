"""The Preferences tab's endpoints (2026-11-23): only after the profile is
complete, never lost when the onboarding form is saved again, and read by
the job engine."""

from __future__ import annotations

import json
from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions
from tests.integration.test_candidate_marketplace import API, _candidate, _employer, _job
from tests.integration.test_job_recommendations import _word

pytestmark = pytest.mark.integration

PREFS = f"{API}/candidate/profile/preferences"
DETAILS = f"{API}/candidate/profile/details"
PROFILE_SECTION = f"{API}/candidate/recommended-jobs/matching-profile"


async def _draft(client: Any, who: dict[str, Any], **details: Any) -> None:
    saved = await client.put(
        DETAILS, json={"details": details, "complete": False}, headers=who["headers"]
    )
    assert saved.status_code == 200, saved.text


async def _mark_complete(who: dict[str, Any]) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "UPDATE candidate_profiles SET career = jsonb_set(career, '{completed}', 'true') "
                "WHERE user_id = :u"
            ),
            {"u": str(who["id"])},
        )


async def test_preferences_wait_for_a_finished_profile(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    await _draft(client, me, key_skills=["SQL"])
    read = await client.get(PREFS, headers=me["headers"])
    assert read.status_code == 200, read.text
    assert read.json()["profile_completed"] is False
    refused = await client.put(PREFS, json={"work_modes": ["REMOTE"]}, headers=me["headers"])
    assert refused.status_code == 409
    assert refused.json()["code"] == "profile_incomplete"


async def test_preferences_save_and_survive_an_onboarding_save(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    await _draft(client, me, key_skills=["SQL"], preferred_locations=["Pune"])
    await _mark_complete(me)

    body = {
        "preferred_roles": ["Data Analyst"],
        "preferred_industries": ["Banking"],
        "work_modes": ["REMOTE", "HYBRID"],
        "job_types": ["FULL_TIME"],
        "open_to_relocation": True,
        "preferred_locations": ["Pune", "Nagpur"],
        "preferred_salary": 600000,
        "preferred_salary_currency": "INR",
    }
    saved = await client.put(PREFS, json=body, headers=me["headers"])
    assert saved.status_code == 200, saved.text
    assert {k: saved.json()[k] for k in body} == body

    # Locations and salary live in the details: one copy, not two.
    details = (await client.get(DETAILS, headers=me["headers"])).json()
    assert details["details"]["preferred_locations"] == ["Pune", "Nagpur"]
    assert details["completed"] is True

    # Saving the onboarding form rebuilds the stored document; the block stays.
    await _draft(client, me, key_skills=["SQL", "Excel"], preferred_locations=["Pune", "Nagpur"])
    again = (await client.get(PREFS, headers=me["headers"])).json()
    assert again["work_modes"] == ["REMOTE", "HYBRID"]
    assert again["preferred_roles"] == ["Data Analyst"]


async def test_the_options_list_every_choice(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    options = await client.get(f"{PREFS}/options", headers=me["headers"])
    assert options.status_code == 200, options.text
    body = options.json()
    assert [o["value"] for o in body["work_modes"]] == ["ONSITE", "HYBRID", "REMOTE"]
    assert "INTERNSHIP" in [o["value"] for o in body["job_types"]]
    assert set(body) == {"work_modes", "job_types", "industries", "roles", "salary_currencies"}


async def test_a_chosen_work_mode_moves_the_ranking(client: Any, mint_token: Any) -> None:
    skill = _word()
    employer = await _employer(client, mint_token)
    onsite = await _job(
        client,
        employer,
        title=f"{_word()} {_word()}",
        skills=[skill],
        work_mode="ONSITE",
        location="Pune",
    )
    remote = await _job(
        client,
        employer,
        title=f"{_word()} {_word()}",
        skills=[skill],
        work_mode="REMOTE",
        location="Pune",
    )
    me = await _candidate(mint_token)
    await _draft(client, me, key_skills=[skill])
    await _mark_complete(me)

    async def order() -> list[str]:
        section = await client.get(PROFILE_SECTION, params={"limit": 50}, headers=me["headers"])
        assert section.status_code == 200, section.text
        ours = {onsite["id"], remote["id"]}
        return [item["id"] for item in section.json()["items"] if item["id"] in ours]

    saved = await client.put(PREFS, json={"work_modes": ["ONSITE"]}, headers=me["headers"])
    assert saved.status_code == 200, saved.text
    assert (await order())[0] == onsite["id"]
    reasons = json.dumps(
        (await client.get(PROFILE_SECTION, params={"limit": 50}, headers=me["headers"])).json()
    )
    assert "WORK_MODE_MATCH" in reasons
