"""Who applied, as the employer's pipeline shows them (2026-10-05).

A pipeline list row names the applicant -- name, band, experience, skills,
city -- and never their contact or score number. The opened application
carries the applicant in full: contact, display score and the confirmed CV.
Both are audited, and both follow the discovery rule: a candidate a HIGH
integrity signal is hiding is shown as an application without a person.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.scoring.domain import band_for, display_value
from tests.conftest import _seed_url, sessions
from tests.integration.test_integrity_pipeline import CLEAN_CV
from tests.integration.test_pipeline import PIPELINE, _applied, _walk

pytestmark = pytest.mark.integration


async def _named(candidate: dict[str, Any]) -> str:
    name = f"Asha Applicant {uuid.uuid4().hex[:6]}"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO candidate_profiles (user_id, full_name, city, state_code) "
                "VALUES (:u, :n, 'Pune', 'MH')"
            ),
            {"u": str(candidate["id"]), "n": name},
        )
    return name


async def _contact(candidate: dict[str, Any]) -> str:
    async with sessions(_seed_url())() as session:
        return str(
            await session.scalar(
                text("SELECT phone FROM users WHERE id = :u"), {"u": str(candidate["id"])}
            )
        )


async def _audits(action: str, tenant_id: str) -> list[dict[str, Any]]:
    async with sessions(_seed_url())() as session:
        rows = await session.execute(
            text(
                "SELECT target_id, metadata FROM audit_events "
                "WHERE action = :a AND tenant_id = :t ORDER BY occurred_at"
            ),
            {"a": action, "t": tenant_id},
        )
        return [{"target_id": str(r[0]), "metadata": r[1]} for r in rows]


async def _hide(candidate: dict[str, Any]) -> None:
    """A HIGH signal raised after they applied: discovery stops showing them."""
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO integrity_signals (id, candidate_id, rule_id, rule_version, "
                "thresholds_version, severity, evidence, state) VALUES (gen_random_uuid(), :u, "
                "'HIDDEN_TEXT', 'test', 'test', 'HIGH', '{}'::jsonb, 'OPEN')"
            ),
            {"u": str(candidate["id"])},
        )


async def test_the_list_names_each_applicant_without_their_contact_or_score(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    name = await _named(a["candidate"])
    employer = a["employer"]

    response = await client.get(
        PIPELINE, params={"job_id": a["job"]["id"]}, headers=employer["headers"]
    )
    assert response.status_code == 200, response.text
    (row,) = response.json()["items"]
    card = row["candidate"]
    assert card["full_name"] == name
    assert card["band"] == band_for(display_value(a["candidate"]["score"]))
    assert card["city"] == "Pune" and card["state_code"] == "MH"
    assert set(card) == {
        "full_name",
        "band",
        "experience_years",
        "skills",
        "badges",
        "city",
        "state_code",
    }
    assert await _contact(a["candidate"]) not in response.text
    assert "score" not in card

    (audit,) = await _audits("applicants_listed", employer["tenant_id"])
    assert audit["metadata"]["application_ids"] == [a["id"]]
    assert audit["metadata"]["candidate_ids"] == [str(a["candidate"]["id"])]
    assert name not in json.dumps(audit["metadata"]), "ids only in the audit trail"


async def test_the_opened_application_carries_the_applicant_in_full(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    name = await _named(a["candidate"])
    employer = a["employer"]

    response = await client.get(f"{PIPELINE}/{a['id']}", headers=employer["headers"])
    assert response.status_code == 200, response.text
    profile = response.json()["candidate"]
    assert profile["full_name"] == name
    assert profile["phone"] == await _contact(a["candidate"])
    assert profile["score"] == display_value(a["candidate"]["score"])
    assert profile["band"] == band_for(profile["score"])
    assert not [key for key in profile if "raw" in key]

    resume = profile["resume"]
    assert resume["text"] == CLEAN_CV
    assert resume["source"] == "PASTE" and resume["confirmed_at"]
    assert "\n".join(s["body"] for s in resume["sections"] if s["body"]).count("Ashok Leyland")
    assert resume["file_url"] is None and resume["fields"] == {}

    opened = await _audits("applicant_profile_viewed", employer["tenant_id"])
    assert [o["target_id"] for o in opened] == [str(a["candidate"]["id"])]
    assert opened[0]["metadata"]["application_id"] == a["id"]

    # A move shows the person again, so it is audited again.
    moved = await _walk(client, a, "SHORTLISTED")
    assert moved["candidate"]["full_name"] == name
    assert len(await _audits("applicant_profile_viewed", employer["tenant_id"])) == 2


async def test_a_hidden_candidate_is_an_application_without_a_person(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    await _named(a["candidate"])
    await _hide(a["candidate"])
    employer = a["employer"]

    listed = await client.get(
        PIPELINE, params={"job_id": a["job"]["id"]}, headers=employer["headers"]
    )
    assert [r["id"] for r in listed.json()["items"]] == [a["id"]]
    assert listed.json()["items"][0]["candidate"] is None

    opened = await client.get(f"{PIPELINE}/{a['id']}", headers=employer["headers"])
    assert opened.status_code == 200
    assert opened.json()["candidate"] is None
    assert opened.json()["stage"] == "VIEWED"
    assert await _audits("applicants_listed", employer["tenant_id"]) == []
    assert await _audits("applicant_profile_viewed", employer["tenant_id"]) == []


async def test_another_organisation_never_reaches_the_applicant(
    client: Any, mint_token: Any
) -> None:
    from tests.integration.test_candidate_marketplace import _employer

    a = await _applied(client, mint_token)
    other = await _employer(client, mint_token)
    response = await client.get(f"{PIPELINE}/{a['id']}", headers=other["headers"])
    assert response.status_code == 404
    listed = await client.get(PIPELINE, headers=other["headers"])
    assert listed.json()["items"] == []


async def test_a_viewer_sees_who_applied_but_not_their_contact_or_cv(
    client: Any, mint_token: Any
) -> None:
    """The roles that may open a profile from search are the ones that get
    contact and the CV here; a viewer is refused the reveal."""
    from tests.integration.test_pipeline import _member

    a = await _applied(client, mint_token)
    name = await _named(a["candidate"])
    viewer = await _member(client, mint_token, a["employer"], "EMPLOYER_VIEWER")

    response = await client.get(f"{PIPELINE}/{a['id']}", headers=viewer["headers"])
    assert response.status_code == 200, response.text
    profile = response.json()["candidate"]
    assert profile["full_name"] == name and profile["score"]
    assert profile["phone"] is None and profile["email"] is None and profile["resume"] is None
    assert await _contact(a["candidate"]) not in response.text
