"""Profile changes never create resume revisions; links remain owner-scoped."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from tests.integration.test_candidate_marketplace import _candidate

pytestmark = pytest.mark.integration

API = "/api/v1"
DETAILS = f"{API}/candidate/profile/details"
VERSIONS = f"{API}/candidate/resume/versions"

CV = (
    "Priya Sharma. Data analyst trainee. Built weekly sales dashboards in Excel "
    "and SQL for a retail chain; cleaned and reconciled stock data. "
)


def _details(**overrides: Any) -> dict[str, Any]:
    return {
        "phone": "+919876543210",
        "work_status": "FRESHER",
        "current_city": "Pune",
        "key_skills": ["SQL", "Excel"],
        "highest_qualification": "B.Com",
        "course": "Commerce",
        "specialization": "Commerce",
        "course_type": "FULL_TIME",
        "institution": "Fergusson College",
        "starting_year": 2021,
        "passing_year": 2024,
        "gender": "FEMALE",
        **overrides,
    }


async def _student(client: Any, mint_token: Any) -> tuple[dict[str, Any], str]:
    """A named candidate with one pasted CV, version A. Not scored: the
    profile is filled in before paying."""
    me = await _candidate(mint_token, scored=False, subscribed=False)
    named = await client.put(
        f"{API}/candidate/profile/name", json={"full_name": "Priya Sharma"}, headers=me["headers"]
    )
    assert named.status_code == 200, named.text
    pasted = await client.post(
        f"{API}/candidate/resume/text",
        json={"text": CV + uuid.uuid4().hex},
        headers=me["headers"],
    )
    assert pasted.status_code == 201, pasted.text
    return me, pasted.json()["resume_version_id"]


async def _save(client: Any, me: dict[str, Any], version_id: str, **details: Any) -> Any:
    return await client.put(
        DETAILS,
        json={"details": _details(**details), "resume_version_id": version_id, "complete": True},
        headers=me["headers"],
    )


async def _versions(client: Any, me: dict[str, Any]) -> list[dict[str, Any]]:
    response = await client.get(VERSIONS, headers=me["headers"])
    assert response.status_code == 200, response.text
    body: list[dict[str, Any]] = response.json()
    return body


async def test_a_save_naming_an_older_version_of_the_cv_is_not_refused(
    client: Any, mint_token: Any
) -> None:
    me, first = await _student(client, mint_token)

    completed = await _save(client, me, first)
    assert completed.status_code == 200, completed.text
    linked = completed.json()["resume_version_id"]
    assert linked == first  # profile facts remain independent of the CV

    # The resume editor creates B independently; the profile page still sends A.
    revised = await client.post(
        f"{VERSIONS}/{first}/edit",
        json={"text": CV + " Resume-only revision."},
        headers=me["headers"],
    )
    assert revised.status_code == 201, revised.text
    linked = revised.json()["resume_version_id"]
    moved = await _save(client, me, first, current_city="Chennai")
    assert moved.status_code == 200, moved.text
    assert moved.json()["details"]["current_city"] == "Chennai"
    assert moved.json()["resume_version_id"] == linked
    assert moved.json()["completed"] is True
    # The city is not in the scored text, so no identical version was written.
    assert len(await _versions(client, me)) == 2

    # Skills change the profile only, exactly like a city change.
    skilled = await _save(client, me, first, key_skills=["SQL", "Excel", "Power BI"])
    assert skilled.status_code == 200, skilled.text
    newest = skilled.json()["resume_version_id"]
    assert newest == linked
    versions = {v["resume_version_id"]: v for v in await _versions(client, me)}
    assert len(versions) == 2
    assert versions[newest]["supersedes_id"] == first


async def test_prefilling_from_an_older_version_of_the_linked_cv_changes_nothing(
    client: Any, mint_token: Any
) -> None:
    me, first = await _student(client, mint_token)
    completed = await _save(client, me, first)
    assert completed.status_code == 200, completed.text

    again = await client.post(f"{API}/candidate/profile/prefill/{first}", headers=me["headers"])
    assert again.status_code == 200, again.text
    assert again.json() == completed.json()


async def test_another_candidates_version_is_still_not_found(client: Any, mint_token: Any) -> None:
    me, _ = await _student(client, mint_token)
    _, theirs = await _student(client, mint_token)

    response = await _save(client, me, theirs)
    assert response.status_code == 404
    assert response.json()["code"] == "resume_version_not_found"


async def test_completing_a_profile_without_a_resume_does_not_create_one(
    client: Any, mint_token: Any
):
    me = await _candidate(mint_token, scored=False, subscribed=False)
    await client.put(
        f"{API}/candidate/profile/name",
        json={"full_name": "Independent Profile"},
        headers=me["headers"],
    )
    response = await client.put(
        DETAILS, json={"details": _details(), "complete": True}, headers=me["headers"]
    )
    assert response.status_code == 200, response.text
    assert response.json()["resume_version_id"] is None
    assert await _versions(client, me) == []


async def test_resume_edit_does_not_overwrite_profile_answers(client: Any, mint_token: Any):
    me, first = await _student(client, mint_token)
    saved = await _save(client, me, first, current_city="Chennai")
    assert saved.status_code == 200, saved.text
    edited = await client.post(
        f"{VERSIONS}/{first}/edit",
        json={"text": CV + " New resume-only wording."},
        headers=me["headers"],
    )
    assert edited.status_code == 201, edited.text
    profile = (await client.get(DETAILS, headers=me["headers"])).json()
    assert profile["details"] == saved.json()["details"]
