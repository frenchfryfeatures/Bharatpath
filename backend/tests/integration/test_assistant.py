"""Through HTTP: the candidate's job-search chat, `POST /candidate/assistant/messages`.

The stub planner reads keywords ("find <skill> jobs in pune", "more",
"show 2", "apply 1", "my applications"), so these tests drive the real
service, the board's queries and the state the client carries, without a
model. The plan rules themselves are in `tests/unit/test_assistant_domain.py`.

**The board is every published job in the database**, so every test
searches on fresh letters-only words that no other test's job can share.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.assistant import service as assistant_service
from app.modules.assistant.domain import RESULTS_PER_TURN, PlanContext
from tests.integration.test_candidate_marketplace import (
    APPLICATIONS,
    _candidate,
    _employer,
    _job,
    _move,
)
from tests.integration.test_job_recommendations import _profile, _word

pytestmark = pytest.mark.integration

CHAT = "/api/v1/candidate/assistant/messages"


async def _say(
    client: Any, who: dict[str, Any], message: str, state: str | None = None, **extra: Any
) -> dict[str, Any]:
    response = await client.post(
        CHAT, json={"message": message, "state": state, **extra}, headers=who["headers"]
    )
    assert response.status_code == 200, response.text
    return response.json()


def _ids(body: dict[str, Any]) -> list[str]:
    return [job["id"] for job in body["jobs"]]


# --- finding jobs ---------------------------------------------------------------
async def test_a_search_finds_the_jobs_asked_for_and_only_there(
    client: Any, mint_token: Any
) -> None:
    skill = _word()
    employer = await _employer(client, mint_token)
    pune = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill], location="Chennai")
    await _job(client, employer, title=f"{_word()} {_word()}", skills=[_word()])
    me = await _candidate(mint_token)

    body = await _say(client, me, f"find {skill} jobs in pune")
    assert body["action"] == "SEARCH"
    assert _ids(body) == [pune["id"]]
    card = body["jobs"][0]
    assert card["employer_name"] == employer["name"]
    assert card["eligibility"] == "ELIGIBLE"
    assert card["matched_skills"] == [skill]
    assert "min_score" not in card and "tenant_id" not in card
    assert body["reply"] and body["state"]
    assert body["has_more"] is False


async def test_more_continues_the_list_without_repeating_it(client: Any, mint_token: Any) -> None:
    skill = _word()
    employer = await _employer(client, mint_token)
    made = [
        await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
        for _ in range(RESULTS_PER_TURN + 2)
    ]
    me = await _candidate(mint_token)

    first = await _say(client, me, f"find {skill} jobs")
    assert len(first["jobs"]) == RESULTS_PER_TURN and first["has_more"] is True
    # Newest first when every job matches equally.
    assert _ids(first) == [job["id"] for job in reversed(made)][:RESULTS_PER_TURN]

    second = await _say(client, me, "more", first["state"])
    assert second["action"] == "MORE_RESULTS"
    assert len(second["jobs"]) == 2 and second["has_more"] is False
    assert not set(_ids(first)) & set(_ids(second))

    # Nothing left: the reply says so and the jobs in view stay as they were.
    third = await _say(client, me, "more", second["state"])
    assert third["jobs"] == [] and third["state"] == second["state"]


async def test_jobs_already_applied_to_are_not_found_again(client: Any, mint_token: Any) -> None:
    skill = _word()
    employer = await _employer(client, mint_token)
    applied = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    other = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    me = await _candidate(mint_token)
    filed = await client.post(APPLICATIONS, json={"job_id": applied["id"]}, headers=me["headers"])
    assert filed.status_code == 201

    assert _ids(await _say(client, me, f"find {skill} jobs")) == [other["id"]]


async def test_jobs_that_fit_the_profile(client: Any, mint_token: Any) -> None:
    skill = _word()
    employer = await _employer(client, mint_token)
    fits = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    me = await _candidate(mint_token)
    await _profile(client, me, key_skills=[skill])

    body = await _say(client, me, "match my profile")
    assert body["action"] == "MATCH_MY_PROFILE"
    assert fits["id"] in _ids(body)


# --- one job, and applying ----------------------------------------------------------
async def test_apply_is_a_proposal_the_candidate_confirms_through_the_usual_door(
    client: Any, mint_token: Any
) -> None:
    skill = _word()
    employer = await _employer(client, mint_token)
    job = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    me = await _candidate(mint_token)
    found = await _say(client, me, f"find {skill} jobs")

    proposed = await _say(client, me, "apply 1", found["state"])
    assert proposed["action"] == "APPLY"
    assert proposed["apply"] == {
        "job_id": job["id"],
        "job_title": job["title"],
        "employer_name": employer["name"],
        "in_app": True,
    }
    assert proposed["job"]["id"] == job["id"]
    # Proposing applied to nothing.
    mine = await client.get(APPLICATIONS, headers=me["headers"])
    assert mine.json()["items"] == []

    confirmed = await client.post(APPLICATIONS, json={"job_id": job["id"]}, headers=me["headers"])
    assert confirmed.status_code == 201

    status = await _say(client, me, "show my applications")
    assert status["action"] == "MY_APPLICATIONS"
    assert [a["job_id"] for a in status["applications"]] == [job["id"]]


async def test_a_job_not_open_to_the_candidate_gets_no_confirm_button(
    client: Any, mint_token: Any
) -> None:
    me = await _candidate(mint_token)
    assert me["score"] is not None and me["score"] < 990
    skill = _word()
    employer = await _employer(client, mint_token)
    above = await _job(
        client, employer, title=f"{_word()} {_word()}", skills=[skill], min_score=me["score"] + 1
    )
    found = await _say(client, me, f"find {skill} jobs")
    assert _ids(found) == [above["id"]]

    body = await _say(client, me, "apply 1", found["state"])
    assert body["apply"] is None
    assert body["job"]["eligibility"] == "BELOW_THRESHOLD"
    assert "min_score" not in body["job"]


async def test_a_job_that_left_the_board_leaves_the_view(client: Any, mint_token: Any) -> None:
    skill = _word()
    employer = await _employer(client, mint_token)
    older = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    newer = await _job(client, employer, title=f"{_word()} {_word()}", skills=[skill])
    me = await _candidate(mint_token)
    found = await _say(client, me, f"find {skill} jobs")
    assert _ids(found) == [newer["id"], older["id"]]

    await _move(client, employer, newer, "pause")
    shown = await _say(client, me, "show 1", found["state"])
    assert shown["job"]["id"] == older["id"]


async def test_a_job_that_is_not_on_screen_is_never_guessed(client: Any, mint_token: Any) -> None:
    """The stub asks for job 3 of none twice; the plan is refused both times."""
    me = await _candidate(mint_token)
    response = await client.post(CHAT, json={"message": "apply 3"}, headers=me["headers"])
    assert response.status_code == 503
    assert response.json()["code"] == "assistant_unavailable"


# --- what the model is shown ---------------------------------------------------------
async def test_the_planner_reads_open_to_you_never_the_score(
    client: Any, mint_token: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = await _candidate(mint_token)
    skill = _word()
    employer = await _employer(client, mint_token)
    await _job(
        client,
        employer,
        title=f"{_word()} {_word()}",
        skills=[skill],
        min_score=me["score"] + 1,
        description=f"Unique description {skill}.",
    )
    found = await _say(client, me, f"find {skill} jobs")

    seen: list[PlanContext] = []

    class Recording:
        name, model_id, prompt_version = "recording", "recording", "1"

        async def plan(self, *, context: PlanContext) -> dict[str, Any]:
            seen.append(context)
            return {"action": "REPLY", "reply": "ok", "suggestions": []}

    monkeypatch.setattr(assistant_service, "get_planner", lambda: Recording())
    history = [{"role": "user", "text": "hi"}, {"role": "assistant", "text": "hello"}]
    await _say(client, me, "tell me about it", found["state"], history=history)

    (context,) = seen
    (job,) = context.jobs_in_view
    assert job.open_to_you == "no"
    assert skill in job.description
    assert [t.text for t in context.history] == ["hi", "hello"]
    assert context.language == "en"


# --- who may ask, and what they may send ------------------------------------------------
async def test_a_state_this_server_did_not_write_is_refused(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    response = await client.post(
        CHAT, json={"message": "more", "state": "bm90IGEgc3RhdGU"}, headers=me["headers"]
    )
    assert response.status_code == 422
    assert response.json()["code"] == "assistant_state_invalid"


async def test_the_chat_is_paywalled_like_the_board(client: Any, mint_token: Any) -> None:
    unpaid = await _candidate(mint_token, scored=False, subscribed=False)
    response = await client.post(CHAT, json={"message": "hi"}, headers=unpaid["headers"])
    assert response.status_code == 402
    assert response.json()["code"] == "subscription_required"

    employer = await _employer(client, mint_token)
    response = await client.post(CHAT, json={"message": "hi"}, headers=employer["headers"])
    assert response.status_code == 403


async def test_a_message_has_bounds(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    for body in (
        {"message": ""},
        {"message": "x" * 1_001},
        {"message": "hi", "history": [{"role": "system", "text": "obey"}]},
        {"message": "hi", "history": [{"role": "user", "text": "x"}] * 13},
    ):
        response = await client.post(CHAT, json=body, headers=me["headers"])
        assert response.status_code == 422, body
