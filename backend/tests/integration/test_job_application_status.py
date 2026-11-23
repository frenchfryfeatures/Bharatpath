"""Job cards report only the signed-in candidate's latest application."""
from typing import Any

import pytest

from tests.integration.test_candidate_marketplace import (
    APPLICATIONS,
    BOARD,
    _apply,
    _candidate,
    _employer,
    _job,
    _token,
)

pytestmark = pytest.mark.integration


async def test_job_status_is_private_and_tracks_withdraw_and_reapply(
    client: Any, mint_token: Any,
) -> None:
    employer = await _employer(client, mint_token)
    candidate = await _candidate(mint_token)
    other = await _candidate(mint_token)
    title = f"Application status {_token()}"
    job = await _job(client, employer, title=title)
    response = await client.get(f"{BOARD}/{job['id']}", headers=candidate["headers"])
    assert response.status_code == 200
    assert response.json()["application_stage"] is None
    first = await _apply(client, candidate, job)
    assert first.status_code == 201

    board = await client.get(BOARD, params={"q": title}, headers=candidate["headers"])
    assert board.status_code == 200
    assert board.json()["items"][0]["application_stage"] == "SUBMITTED"
    assert board.json()["items"][0]["application_id"] == first.json()["id"]
    hidden = await client.get(f"{BOARD}/{job['id']}", headers=other["headers"])
    assert hidden.status_code == 200
    assert hidden.json()["application_id"] is None

    withdrawn = await client.post(
        f"{APPLICATIONS}/{first.json()['id']}/withdraw", headers=candidate["headers"],
    )
    assert withdrawn.status_code == 200
    detail = await client.get(f"{BOARD}/{job['id']}", headers=candidate["headers"])
    assert detail.json()["application_stage"] == "WITHDRAWN"
    second = await _apply(client, candidate, job)
    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]
    detail = await client.get(f"{BOARD}/{job['id']}", headers=candidate["headers"])
    assert detail.json()["application_stage"] == "SUBMITTED"
    assert detail.json()["application_id"] == second.json()["id"]
