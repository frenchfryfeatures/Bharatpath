"""The board's search box, the skill filter's options and the public city
list (2026-11-23).

Before, `q` read only a job's title and description, so typing an employer,
a city or a skill found nothing unless the description repeated it; and the
candidate skill filter had nothing to offer.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from tests.integration.test_candidate_marketplace import (
    API,
    _board_ids,
    _candidate,
    _employer,
    _job,
    _move,
)

pytestmark = pytest.mark.integration


def _word() -> str:
    # Letters only: a hex token can look like a phone number to some filters.
    return "".join(chr(ord("a") + int(c, 16) % 26) for c in uuid.uuid4().hex[:10])


async def test_search_finds_a_job_by_employer_skill_and_place(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    skill, place = f"Skill{_word()}", f"Town{_word()}"
    job = await _job(
        client,
        employer,
        title="Accounts Executive",
        description="Day to day bookkeeping.",
        skills=[skill],
        location=place,
    )
    # The employer's name never appears in the title or description.
    employer_word = employer["name"].split()[2]
    assert job["id"] in await _board_ids(client, candidate, q=employer_word)
    assert job["id"] in await _board_ids(client, candidate, q=skill.lower())
    assert job["id"] in await _board_ids(client, candidate, q=place)
    # Every word must match somewhere: a skill plus an unrelated word is not it.
    assert job["id"] not in await _board_ids(client, candidate, q=f"{skill} {_word()}")


async def test_search_still_leaves_out_unpublished_jobs(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    skill = f"Skill{_word()}"
    job = await _job(client, employer, skills=[skill])
    await _move(client, employer, job, "pause")
    assert job["id"] not in await _board_ids(client, candidate, q=skill)


async def test_the_skill_filter_offers_only_skills_live_jobs_ask_for(
    client: Any, mint_token: Any
) -> None:
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    live, paused = f"Live{_word()}", f"Paused{_word()}"
    await _job(client, employer, skills=[live])
    gone = await _job(client, employer, skills=[paused])
    await _move(client, employer, gone, "pause")

    response = await client.get(
        f"{API}/candidate/jobs/skills", params={"q": live[:8]}, headers=candidate["headers"]
    )
    assert response.status_code == 200, response.text
    assert live in response.json()["items"]
    # Labels only: no count says how few jobs ask for a rare skill.
    assert set(response.json()) == {"items"}

    response = await client.get(
        f"{API}/candidate/jobs/skills", params={"q": paused}, headers=candidate["headers"]
    )
    assert paused not in response.json()["items"]


async def test_a_chosen_skill_option_filters_the_board(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token)
    employer = await _employer(client, mint_token)
    skill = f"Skill{_word()}"
    job = await _job(client, employer, skills=[skill])
    other = await _job(client, employer, skills=[f"Other{_word()}"])
    found = await _board_ids(client, candidate, skill=skill)
    assert job["id"] in found and other["id"] not in found


async def test_the_city_list_is_public_and_matches_old_names(client: Any) -> None:
    response = await client.get(f"{API}/reference/cities", params={"q": "bombay"})
    assert response.status_code == 200, response.text
    labels = [item["label"] for item in response.json()["items"]]
    assert "Mumbai" in labels
    empty = await client.get(f"{API}/reference/cities", params={"q": ""})
    assert empty.json() == {"items": []}
