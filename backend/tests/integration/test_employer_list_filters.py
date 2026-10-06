"""Filters on the employer's two lists (2026-10-06).

`GET /employer/jobs`: several statuses, work mode, a skill, the IST days it
was created. `GET /employer/applications`: several stages, the ACTIVE/CLOSED
tab, the applicant's name, the IST days they applied, and newest first.
Filters intersect. The name search goes through the visibility rule, so a
candidate an integrity review is hiding cannot be found by typing their name.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

import pytest

from app.core.pagination import IST
from tests.integration.test_applicant_profiles import _hide, _named
from tests.integration.test_jobs import JOBS, _draft, _organisation, _set_kyb
from tests.integration.test_masked_search import _token
from tests.integration.test_pipeline import PIPELINE, _applied, _move

pytestmark = pytest.mark.integration


def _days() -> tuple[str, str]:
    today = datetime.now(IST).date()
    return today.isoformat(), (today - timedelta(days=1)).isoformat()


# --- jobs -------------------------------------------------------------------------
async def test_the_job_list_filters_combine(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    await _set_kyb(owner["tenant_id"], "APPROVED")
    skill = _token()
    draft = await _draft(client, owner["headers"], work_mode="REMOTE", skills=[skill.upper()])
    live = await _draft(client, owner["headers"], work_mode="ONSITE", skills=[skill])
    paused = await _draft(client, owner["headers"], work_mode="REMOTE")
    for job in (live, paused):
        await client.post(f"{JOBS}/{job['id']}/publish", headers=owner["headers"])
    await client.post(f"{JOBS}/{paused['id']}/pause", headers=owner["headers"])

    async def ids(**params: Any) -> list[str]:
        response = await client.get(JOBS, params=params, headers=owner["headers"])
        assert response.status_code == 200, response.text
        return [j["id"] for j in response.json()["items"]]

    assert set(await ids(status=["DRAFT", "PAUSED"])) == {draft["id"], paused["id"]}
    assert set(await ids(work_mode="REMOTE")) == {draft["id"], paused["id"]}
    assert set(await ids(skill=skill)) == {draft["id"], live["id"]}, "a skill ignores case"
    assert await ids(skill=skill, work_mode="REMOTE") == [draft["id"]]
    assert await ids(skill=skill[:-1]) == [], "a skill matches whole, not a prefix"

    today, yesterday = _days()
    assert len(await ids(created_from=today, created_to=today)) == 3
    assert await ids(created_to=yesterday) == []
    inverted = await client.get(
        JOBS, params={"created_from": today, "created_to": yesterday}, headers=owner["headers"]
    )
    assert inverted.status_code == 422
    assert inverted.json()["code"] == "invalid_date_range"
    unknown = await client.get(JOBS, params={"work_mode": "ANYWHERE"}, headers=owner["headers"])
    assert unknown.status_code == 422


# --- applications -----------------------------------------------------------------
async def test_the_application_list_filters_combine(client: Any, mint_token: Any) -> None:
    first = await _applied(client, mint_token)
    employer = first["employer"]
    second = await _applied(client, mint_token, employer)
    third = await _applied(client, mint_token, employer)
    names = [await _named(a["candidate"]) for a in (first, second, third)]
    assert (await _move(client, second, "REJECTED")).status_code == 200
    await client.get(f"{PIPELINE}/{third['id']}", headers=employer["headers"])  # VIEWED

    async def ids(**params: Any) -> list[str]:
        response = await client.get(PIPELINE, params=params, headers=employer["headers"])
        assert response.status_code == 200, response.text
        return [a["id"] for a in response.json()["items"]]

    everyone = [first["id"], second["id"], third["id"]]
    assert await ids() == everyone
    assert await ids(order="newest") == list(reversed(everyone))
    assert await ids(stage=["SUBMITTED", "VIEWED"]) == [first["id"], third["id"]]
    assert await ids(status="CLOSED") == [second["id"]]
    assert await ids(status="ACTIVE") == [first["id"], third["id"]]
    assert await ids(status="ACTIVE", stage=["REJECTED"]) == []
    assert await ids(status="ACTIVE", stage=["VIEWED", "REJECTED"]) == [third["id"]]

    suffix = names[2].rsplit(" ", 1)[-1]
    assert await ids(q=suffix.upper()) == [third["id"]], "a name ignores case"
    assert await ids(q=suffix, status="CLOSED") == []
    assert await ids(q="Nobody By This Name") == []
    assert await ids(q="   ") == everyone, "a blank search is no search"

    today, yesterday = _days()
    assert await ids(applied_from=today, applied_to=today) == everyone
    assert await ids(applied_to=yesterday) == []
    inverted = await client.get(
        PIPELINE,
        params={"applied_from": today, "applied_to": yesterday},
        headers=employer["headers"],
    )
    assert inverted.status_code == 422
    assert inverted.json()["code"] == "invalid_date_range"

    newest = await client.get(
        PIPELINE, params={"order": "newest", "limit": 2}, headers=employer["headers"]
    )
    rest = await client.get(
        PIPELINE,
        params={"order": "newest", "limit": 2, "cursor": newest.json()["next_cursor"]},
        headers=employer["headers"],
    )
    paged = [a["id"] for a in newest.json()["items"] + rest.json()["items"]]
    assert paged == list(reversed(everyone))


async def test_a_hidden_candidate_is_not_found_by_name(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    name = await _named(a["candidate"])
    suffix = name.rsplit(" ", 1)[-1]
    params = {"job_id": a["job"]["id"], "q": suffix}
    headers = a["employer"]["headers"]

    found = await client.get(PIPELINE, params=params, headers=headers)
    assert [r["id"] for r in found.json()["items"]] == [a["id"]]

    await _hide(a["candidate"])
    hidden = await client.get(PIPELINE, params=params, headers=headers)
    assert hidden.status_code == 200 and hidden.json()["items"] == []
    listed = await client.get(PIPELINE, params={"job_id": a["job"]["id"]}, headers=headers)
    assert [r["id"] for r in listed.json()["items"]] == [a["id"]], "still listed, unnamed"
