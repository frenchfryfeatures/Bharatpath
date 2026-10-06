"""The shortlist through HTTP (2026-10-05).

An employer who opened a candidate from search keeps them (SAVED, private) or
invites them to a job (INVITED). Only the candidate's yes files an
application, which lands at SHORTLISTED with the employer's steps recorded as
the employer's. A no stands for that job. The candidates here have no
subscription: being asked, and saying yes, is not paywalled.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import _seed_url, sessions
from tests.integration.test_candidate_marketplace import (
    API,
    APPLICATIONS,
    _apply,
    _employer,
    _job,
    _move,
    _subscribe,
)
from tests.integration.test_masked_search import SEARCH, _candidate, _token
from tests.integration.test_pipeline import PIPELINE, _events

pytestmark = pytest.mark.integration

SHORTLIST = f"{API}/employer/shortlist"
INVITATIONS = f"{API}/candidate/shortlist-invitations"


async def _opened(client: Any, mint_token: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """An employer that has opened one candidate's profile."""
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)
    revealed = await client.get(f"{SEARCH}/{candidate['id']}", headers=employer["headers"])
    assert revealed.status_code == 200, revealed.text
    return employer, candidate


async def _shortlist(
    client: Any, employer: dict[str, Any], candidate: dict[str, Any], job: dict | None = None
) -> Any:
    body: dict[str, Any] = {"candidate_id": str(candidate["id"])}
    if job is not None:
        body["job_id"] = job["id"]
    return await client.post(SHORTLIST, json=body, headers=employer["headers"])


async def _outbox(event_type: str, aggregate_id: str) -> list[dict[str, Any]]:
    async with sessions(_seed_url())() as session:
        rows = await session.execute(
            text("SELECT payload FROM outbox WHERE event_type = :e AND aggregate_id = :a"),
            {"e": event_type, "a": aggregate_id},
        )
        return [r[0] for r in rows]


# --- saving ---------------------------------------------------------------------
async def test_only_a_candidate_you_opened_can_be_shortlisted(client: Any, mint_token: Any) -> None:
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)

    unopened = await _shortlist(client, employer, candidate)
    assert unopened.status_code == 404
    assert unopened.json()["code"] == "candidate_not_found"

    await client.get(f"{SEARCH}/{candidate['id']}", headers=employer["headers"])
    saved = await _shortlist(client, employer, candidate)
    assert saved.status_code == 201, saved.text
    assert saved.json()["status"] == "SAVED" and saved.json()["job_id"] is None


async def test_saving_is_private_idempotent_and_removable(client: Any, mint_token: Any) -> None:
    employer, candidate = await _opened(client, mint_token)
    first = await _shortlist(client, employer, candidate)
    again = await _shortlist(client, employer, candidate)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["id"] == first.json()["id"]

    profile = await client.get(f"{SEARCH}/{candidate['id']}", headers=employer["headers"])
    assert profile.json()["shortlist"] == {"saved_id": first.json()["id"], "invitations": []}

    listed = await client.get(SHORTLIST, headers=employer["headers"])
    (row,) = listed.json()["items"]
    assert row["candidate"]["band"] and "phone" not in row["candidate"]

    mine = await client.get(INVITATIONS, headers=candidate["headers"])
    assert mine.status_code == 200 and mine.json()["items"] == [], "a SAVED row is private"

    removed = await client.delete(f"{SHORTLIST}/{first.json()['id']}", headers=employer["headers"])
    assert removed.status_code == 204
    assert (await client.get(SHORTLIST, headers=employer["headers"])).json()["items"] == []


# --- inviting and accepting ------------------------------------------------------
async def test_accepting_files_an_application_already_shortlisted(
    client: Any, mint_token: Any
) -> None:
    employer, candidate = await _opened(client, mint_token)
    job = await _job(client, employer)

    invited = await _shortlist(client, employer, candidate, job)
    assert invited.status_code == 201, invited.text
    entry = invited.json()
    assert entry["status"] == "INVITED" and entry["job_title"] == job["title"]
    (told,) = await _outbox("applications.shortlist_invited", entry["id"])
    assert told == {
        "tenant_id": employer["tenant_id"],
        "job_id": job["id"],
        "candidate_id": str(candidate["id"]),
    }

    (invitation,) = (await client.get(INVITATIONS, headers=candidate["headers"])).json()["items"]
    assert invitation["status"] == "INVITED"
    assert invitation["job_title"] == job["title"]
    assert invitation["employer_name"] == employer["name"]
    assert "created_by" not in invitation

    accepted = await client.post(
        f"{INVITATIONS}/{entry['id']}/accept", headers=candidate["headers"]
    )
    assert accepted.status_code == 200, accepted.text
    application_id = accepted.json()["application_id"]
    assert accepted.json()["status"] == "ACCEPTED" and application_id

    board = await client.get(f"{APPLICATIONS}/{application_id}", headers=candidate["headers"])
    assert board.json()["stage"] == "SHORTLISTED"
    events = await _events(application_id)
    assert [(e[1], e[2], e[3]) for e in events] == [
        (None, "SUBMITTED", "CANDIDATE"),
        ("SUBMITTED", "VIEWED", "EMPLOYER"),
        ("VIEWED", "SHORTLISTED", "EMPLOYER"),
    ]
    assert await _outbox("applications.application_submitted", application_id)

    pipeline = await client.get(
        PIPELINE, params={"stage": "SHORTLISTED"}, headers=employer["headers"]
    )
    assert application_id in [r["id"] for r in pipeline.json()["items"]]
    (row,) = (await client.get(SHORTLIST, headers=employer["headers"])).json()["items"]
    assert row["status"] == "ACCEPTED" and row["application_id"] == application_id

    repeat = await client.post(f"{INVITATIONS}/{entry['id']}/accept", headers=candidate["headers"])
    assert repeat.json()["application_id"] == application_id
    in_pipeline = await _shortlist(client, employer, candidate, job)
    assert in_pipeline.status_code == 409
    assert in_pipeline.json()["code"] == "already_applied"
    assert in_pipeline.json()["params"]["application_id"] == application_id


async def test_accepting_moves_an_application_they_already_made(
    client: Any, mint_token: Any
) -> None:
    employer, candidate = await _opened(client, mint_token)
    job = await _job(client, employer)
    entry = (await _shortlist(client, employer, candidate, job)).json()

    await _subscribe(candidate["id"])
    applied = await _apply(client, candidate, job)
    assert applied.status_code == 201, applied.text

    accepted = await client.post(
        f"{INVITATIONS}/{entry['id']}/accept", headers=candidate["headers"]
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["application_id"] == applied.json()["id"]
    board = await client.get(f"{APPLICATIONS}/{applied.json()['id']}", headers=candidate["headers"])
    assert board.json()["stage"] == "SHORTLISTED"


async def test_a_decline_stands_for_that_job(client: Any, mint_token: Any) -> None:
    employer, candidate = await _opened(client, mint_token)
    job = await _job(client, employer)
    entry = (await _shortlist(client, employer, candidate, job)).json()

    declined = await client.post(
        f"{INVITATIONS}/{entry['id']}/decline", headers=candidate["headers"]
    )
    assert declined.status_code == 200 and declined.json()["status"] == "DECLINED"
    again = await client.post(f"{INVITATIONS}/{entry['id']}/decline", headers=candidate["headers"])
    assert again.status_code == 200

    late = await client.post(f"{INVITATIONS}/{entry['id']}/accept", headers=candidate["headers"])
    assert late.status_code == 409 and late.json()["code"] == "shortlist_not_pending"
    reinvite = await _shortlist(client, employer, candidate, job)
    assert reinvite.status_code == 409 and reinvite.json()["code"] == "shortlist_declined"


async def test_a_cancelled_invitation_cannot_be_accepted_and_can_be_sent_again(
    client: Any, mint_token: Any
) -> None:
    employer, candidate = await _opened(client, mint_token)
    job = await _job(client, employer)
    entry = (await _shortlist(client, employer, candidate, job)).json()

    cancelled = await client.post(f"{SHORTLIST}/{entry['id']}/cancel", headers=employer["headers"])
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "CANCELLED"
    refused = await client.post(f"{INVITATIONS}/{entry['id']}/accept", headers=candidate["headers"])
    assert refused.status_code == 409 and refused.json()["code"] == "shortlist_not_pending"
    cant_delete = await client.delete(f"{SHORTLIST}/{entry['id']}", headers=employer["headers"])
    assert cant_delete.status_code == 409

    resent = await _shortlist(client, employer, candidate, job)
    assert resent.status_code == 201 and resent.json()["id"] == entry["id"]
    assert resent.json()["status"] == "INVITED"


async def test_an_invitation_to_a_job_that_closed_cannot_be_accepted(
    client: Any, mint_token: Any
) -> None:
    employer, candidate = await _opened(client, mint_token)
    job = await _job(client, employer)
    draft = await _job(client, employer, publish=False)
    unpublished = await _shortlist(client, employer, candidate, draft)
    assert unpublished.status_code == 409
    assert unpublished.json()["code"] == "shortlist_job_not_open"

    entry = (await _shortlist(client, employer, candidate, job)).json()
    await _move(client, employer, job, "close")
    accepted = await client.post(
        f"{INVITATIONS}/{entry['id']}/accept", headers=candidate["headers"]
    )
    assert accepted.status_code == 409
    assert accepted.json()["code"] == "shortlist_job_not_open"


async def test_another_organisation_never_reaches_an_entry(client: Any, mint_token: Any) -> None:
    employer, candidate = await _opened(client, mint_token)
    job = await _job(client, employer)
    entry = (await _shortlist(client, employer, candidate, job)).json()
    other = await _employer(client, mint_token)
    stranger = await _candidate(mint_token, _token())

    assert (
        await client.post(f"{SHORTLIST}/{entry['id']}/cancel", headers=other["headers"])
    ).status_code == 404
    assert (await client.get(SHORTLIST, headers=other["headers"])).json()["items"] == []
    assert (
        await client.post(f"{INVITATIONS}/{entry['id']}/accept", headers=stranger["headers"])
    ).status_code == 404
    # Another organisation's job is not one to invite anyone to.
    await client.get(f"{SEARCH}/{candidate['id']}", headers=other["headers"])
    foreign = await _shortlist(client, other, candidate, job)
    assert foreign.status_code == 404 and foreign.json()["code"] == "job_not_found"


# --- the guard ---------------------------------------------------------------------
async def test_the_database_holds_the_states_for_every_writer(client: Any, mint_token: Any) -> None:
    employer, candidate = await _opened(client, mint_token)
    job = await _job(client, employer)
    entry = (await _shortlist(client, employer, candidate, job)).json()
    await client.post(f"{INVITATIONS}/{entry['id']}/decline", headers=candidate["headers"])

    for sql in (
        "UPDATE employer_shortlists SET status = 'INVITED', answered_at = NULL WHERE id = :s",
        "DELETE FROM employer_shortlists WHERE id = :s",
        "UPDATE employer_shortlists SET job_id = NULL, status = 'SAVED', answered_at = NULL "
        "WHERE id = :s",
    ):
        with pytest.raises(DBAPIError, match="SHORTLIST_GUARD"):
            async with sessions(_seed_url())() as session, session.begin():
                await session.execute(text(sql), {"s": entry["id"]})

    with pytest.raises(DBAPIError, match="SHORTLIST_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text(
                    "INSERT INTO employer_shortlists (id, tenant_id, candidate_id, job_id, "
                    "status, created_by, application_id) SELECT :i, tenant_id, candidate_id, "
                    "job_id, 'ACCEPTED', created_by, NULL FROM employer_shortlists WHERE id = :s"
                ),
                {"i": str(uuid.uuid4()), "s": entry["id"]},
            )


def test_the_states_frozen_in_sql_are_the_domains() -> None:
    import importlib.util
    from pathlib import Path

    from app.modules.applications.domain import (
        SHORTLIST_MOVES,
        SHORTLIST_STATUSES,
        TERMINAL_STAGES,
    )

    path = Path(__file__).parents[2] / "alembic" / "versions" / "0010_employer_shortlists.py"
    spec = importlib.util.spec_from_file_location("shortlist_migration", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.MOVES == SHORTLIST_MOVES
    assert module.STATUSES == SHORTLIST_STATUSES
    assert ", ".join(f"'{s}'" for s in TERMINAL_STAGES) == module._TERMINAL
    assert "DELETE FROM employer_shortlists" in module.erase_with_shortlists()
