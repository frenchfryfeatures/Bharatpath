"""Through HTTP: save progress, submit, the supplementary report."""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.questionnaire.bank import QUESTIONS, SECTIONS
from tests.integration.test_interview import _paying
from tests.integration.test_payments import _candidate, _scalar

pytestmark = pytest.mark.integration

BASE = "/api/v1/candidate/questionnaire"


async def test_the_questionnaire_is_a_paid_tool(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    assert (await client.get(BASE, headers=me["headers"])).status_code == 402


async def test_progress_is_saved_merged_and_cleared(client: Any, mint_token: Any) -> None:
    me = await _paying(client, mint_token)
    empty = (await client.get(BASE, headers=me["headers"])).json()
    assert empty["answers"] == {} and empty["submitted"] is False
    assert [s["code"] for s in empty["sections"]] == list(SECTIONS)
    assert sum(len(s["questions"]) for s in empty["sections"]) == len(QUESTIONS)

    first = await client.put(
        f"{BASE}/answers",
        json={"answers": {"NOTICE_PERIOD": "IMMEDIATE", "RELOCATION": "NO"}},
        headers=me["headers"],
    )
    assert first.status_code == 200, first.text
    second = await client.put(
        f"{BASE}/answers",
        json={"answers": {"RELOCATION": None, "LANGUAGES_SPOKEN": ["HINDI", "TAMIL"]}},
        headers=me["headers"],
    )
    assert second.json()["answers"] == {
        "NOTICE_PERIOD": "IMMEDIATE",
        "LANGUAGES_SPOKEN": ["HINDI", "TAMIL"],
    }

    refused = await client.put(
        f"{BASE}/answers",
        json={"answers": {"NOTICE_PERIOD": "WITHIN_15_DAYS", "TEAM_SIZE_MANAGED": -3}},
        headers=me["headers"],
    )
    assert refused.status_code == 422
    assert refused.json()["code"] == "questionnaire_answers_invalid"
    assert refused.json()["params"]["issues"] == [
        {"question": "TEAM_SIZE_MANAGED", "code": "invalid_number_answer"}
    ]
    kept = (await client.get(BASE, headers=me["headers"])).json()
    assert kept["answers"]["NOTICE_PERIOD"] == "IMMEDIATE", "a refused save saves nothing"


async def test_submitting_shares_the_answers_and_the_report_reads_them_back(
    client: Any, mint_token: Any
) -> None:
    me = await _paying(client, mint_token)
    missing = await client.get(f"{BASE}/report", headers=me["headers"])
    assert missing.status_code == 404 and missing.json()["code"] == "questionnaire_not_submitted"

    await client.put(
        f"{BASE}/answers",
        json={"answers": {"NOTICE_PERIOD": "WITHIN_30_DAYS", "HAS_DRIVING_LICENCE": True}},
        headers=me["headers"],
    )
    submitted = await client.post(f"{BASE}/submit", headers=me["headers"])
    assert submitted.status_code == 200 and submitted.json()["submitted"] is True

    report = (await client.get(f"{BASE}/report", headers=me["headers"])).json()
    availability = report["sections"][0]
    assert availability["code"] == "availability" and availability["answered"] == 1
    [notice] = [i for i in availability["items"] if i["code"] == "NOTICE_PERIOD"]
    assert notice["display"] == ["Within 30 days"]

    # Correcting after submitting keeps it shared.
    await client.put(
        f"{BASE}/answers", json={"answers": {"NOTICE_PERIOD": None}}, headers=me["headers"]
    )
    after = (await client.get(BASE, headers=me["headers"])).json()
    assert after["submitted"] is True and "NOTICE_PERIOD" not in after["answers"]

    assert (
        await _scalar(
            "SELECT count(*) FROM outbox WHERE event_type = 'questionnaire.submitted' "
            "AND payload->>'user_id' = :u",
            u=me["id"],
        )
        == 1
    )
    assert await _scalar("SELECT count(*) FROM scores WHERE user_id = :u", u=me["id"]) == 0
