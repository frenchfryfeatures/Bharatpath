"""Through HTTP: the home screen's two recommended-jobs sections.

`/candidate/recommended-jobs/similar-to-applied` and `/matching-profile`.
The ranking rule is pure and tested in `tests/unit/test_job_recommendations.py`;
these hold what only the database can: the board's rules (published, listed),
the applications left out, the paywall, and eligibility without a threshold.

**The board is every published job in the database**, so every test matches
on fresh letters-only words -- as skills and as title words -- that no other
test's job can share, and asserts only about its own jobs.
"""

from __future__ import annotations

import random
import string
from typing import Any

import pytest

from tests.integration.test_candidate_marketplace import (
    APPLICATIONS,
    _apply,
    _candidate,
    _employer,
    _job,
    _move,
)
from tests.integration.test_job_details import _job_body, _with

pytestmark = pytest.mark.integration

API = "/api/v1"
SIMILAR = f"{API}/candidate/recommended-jobs/similar-to-applied"
PROFILE = f"{API}/candidate/recommended-jobs/matching-profile"
DETAILS = f"{API}/candidate/profile/details"


def _word() -> str:
    """Letters only: a title word the matcher keeps, and no other job has."""
    return "".join(random.choices(string.ascii_lowercase, k=14))


async def _section(client: Any, url: str, who: dict[str, Any], **params: Any) -> dict[str, Any]:
    response = await client.get(url, params={"limit": 50, **params}, headers=who["headers"])
    assert response.status_code == 200, response.text
    return response.json()


def _ids(body: dict[str, Any], among: list[dict[str, Any]]) -> list[str]:
    """The section's ids, in order, that belong to this test's jobs."""
    ours = {job["id"] for job in among}
    return [item["id"] for item in body["items"] if item["id"] in ours]


async def _profile(client: Any, who: dict[str, Any], **details: Any) -> None:
    saved = await client.put(
        DETAILS, json={"details": details, "complete": False}, headers=who["headers"]
    )
    assert saved.status_code == 200, saved.text


# --- similar to what you applied for ------------------------------------------
async def test_jobs_like_the_ones_applied_to_and_never_those(client: Any, mint_token: Any) -> None:
    skill, role = _word(), _word()
    employer = await _employer(client, mint_token)
    applied = await _job(client, employer, title=f"{role} {_word()}", skills=[skill])
    both = await _job(client, employer, title=f"{role} {_word()}", skills=[skill])
    by_skill = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    by_title = await _job(client, employer, title=f"{role} {_word()}", skills=[_word()])
    unrelated = await _job(client, employer, title=f"{_word()} {_word()}", skills=[_word()])
    paused = await _job(client, employer, title=f"{role} {_word()}", skills=[skill])
    await _move(client, employer, paused, "pause")
    jobs = [applied, both, by_skill, by_title, unrelated, paused]

    me = await _candidate(mint_token)
    assert (await _apply(client, me, applied)).status_code == 201

    body = await _section(client, SIMILAR, me)
    assert body["has_basis"] is True
    # Skill and title word, then the title word (worth more), then the skill.
    assert _ids(body, jobs) == [both["id"], by_title["id"], by_skill["id"]]
    item = next(i for i in body["items"] if i["id"] == both["id"])
    assert item["matched_skills"] == [skill]
    assert item["employer_name"] == employer["name"]
    assert item["eligibility"] == "ELIGIBLE"
    for item in body["items"]:
        assert "min_score" not in item and "relevance" not in item and "tenant_id" not in item


async def test_no_applications_is_no_basis(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    assert await _section(client, SIMILAR, me) == {"items": [], "has_basis": False}


async def test_a_withdrawn_application_is_not_a_preference(client: Any, mint_token: Any) -> None:
    skill = _word()
    employer = await _employer(client, mint_token)
    applied = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    me = await _candidate(mint_token)
    application = (await _apply(client, me, applied)).json()
    withdrawn = await client.post(
        f"{APPLICATIONS}/{application['id']}/withdraw", headers=me["headers"]
    )
    assert withdrawn.status_code == 200, withdrawn.text

    assert await _section(client, SIMILAR, me) == {"items": [], "has_basis": False}


# --- jobs that fit your profile -------------------------------------------------
async def test_jobs_that_fit_the_profile_best_first(client: Any, mint_token: Any) -> None:
    skill, role = _word(), _word()
    employer = await _employer(client, mint_token)
    skill_here = await _job(
        client, employer, title=f"{_word()} {_word()}", skills=[skill], location="Pune"
    )
    skill_elsewhere = await _job(
        client, employer, title=f"{_word()} {_word()}", skills=[skill], location="Bengaluru"
    )
    role_elsewhere = await _job(
        client, employer, title=f"{role} {_word()}", skills=[_word()], location="Chennai"
    )
    unrelated = await _job(client, employer, title=f"{_word()} {_word()}", skills=[_word()])
    applied = await _job(client, employer, title=f"{role} {_word()}", skills=[skill])
    unlisted = await _job(
        client,
        employer,
        **_job_body(title=f"{role} {_word()}", details=_with("settings", visibility="PRIVATE")),
    )
    jobs = [skill_here, skill_elsewhere, role_elsewhere, unrelated, applied, unlisted]

    me = await _candidate(mint_token)
    assert (await _apply(client, me, applied)).status_code == 201
    await _profile(
        client,
        me,
        work_status="FRESHER",
        key_skills=[skill.upper()],
        job_role=role,
        preferred_locations=["Pune"],
        gender="FEMALE",
    )

    body = await _section(client, PROFILE, me)
    assert body["has_basis"] is True
    # skill + city (3 + 2) > role word (4) > skill (3); each fits a fresher.
    assert _ids(body, jobs) == [skill_here["id"], role_elsewhere["id"], skill_elsewhere["id"]]


async def test_a_profile_with_no_skill_and_no_role_is_no_basis(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    assert await _section(client, PROFILE, me) == {"items": [], "has_basis": False}
    await _profile(client, me, preferred_locations=["Pune"])
    assert await _section(client, PROFILE, me) == {"items": [], "has_basis": False}


async def test_eligible_only_filters_and_the_threshold_never_shows(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    assert me["score"] is not None and me["score"] < 990
    skill = _word()
    employer = await _employer(client, mint_token)
    open_job = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    above = await _job(
        client, employer, title=f"{_word()} {_word()}", skills=[skill], min_score=me["score"] + 1
    )
    await _profile(client, me, key_skills=[skill])

    every = await _section(client, PROFILE, me)
    states = {
        i["id"]: i["eligibility"]
        for i in every["items"]
        if i["id"] in {open_job["id"], above["id"]}
    }
    assert states == {open_job["id"]: "ELIGIBLE", above["id"]: "BELOW_THRESHOLD"}

    eligible = await _section(client, PROFILE, me, eligible_only="true")
    assert _ids(eligible, [open_job, above]) == [open_job["id"]]


# --- who may ask --------------------------------------------------------------
@pytest.mark.parametrize("url", [SIMILAR, PROFILE])
async def test_the_sections_are_paywalled_like_the_board(
    client: Any, mint_token: Any, url: str
) -> None:
    unpaid = await _candidate(mint_token, scored=False, subscribed=False)
    response = await client.get(url, headers=unpaid["headers"])
    assert response.status_code == 402
    assert response.json()["code"] == "subscription_required"

    employer = await _employer(client, mint_token)
    assert (await client.get(url, headers=employer["headers"])).status_code == 403


@pytest.mark.parametrize("url", [SIMILAR, PROFILE])
async def test_a_section_is_at_most_fifty_long(client: Any, mint_token: Any, url: str) -> None:
    me = await _candidate(mint_token, scored=False)
    response = await client.get(url, params={"limit": 51}, headers=me["headers"])
    assert response.status_code == 422
