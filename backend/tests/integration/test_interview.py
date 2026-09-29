"""Day 16 through HTTP and the database: the mock interview.

Device check before payment, a purchase by verified callback, per-question
upload with recovery, completion, and **invariant 4' re-verified end to end**:
four sessions completed through the real routes fold in +60, not +80, and the
score replays exactly without calling the model.

S3 is faked at `app.core.storage`, as in `test_resume_intake.py`. Payments go
through the stub gateway's signed callbacks (`test_payments.py` helpers).
"""

from __future__ import annotations

import os
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError, ProgrammingError

from app.modules.interview import service as interview_service
from app.modules.interview.bank import QUESTIONS_PER_SESSION
from app.modules.scoring import service as scoring_service
from tests.conftest import _seed_url, sessions
from tests.integration.test_payments import _candidate, _scalar, _settle
from tests.integration.test_resume_intake import FakeS3

pytestmark = pytest.mark.integration

API = "/api/v1"
BASE = f"{API}/candidate/interview"
APP_URL = os.environ.get("DATABASE_URL_APP") or os.environ["DATABASE_URL"]
OGG = b"OggS\x00\x02" + b"\x00" * 4096
PASSING = {
    "mic_ok": True,
    "audio_out_ok": True,
    "network_kbps": 128,
    "storage_mb": 512,
    "quiet_env_ok": True,
}


@pytest.fixture(autouse=True)
async def _catalogue() -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await interview_service.sync_catalogue(session)


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> FakeS3:
    from app.core import storage

    fake = FakeS3()
    for name in ("head_object", "read_head_bytes", "delete_object", "presign_put"):
        monkeypatch.setattr(storage, name, getattr(fake, name))
    return fake


async def _paying(client: Any, mint_token: Any) -> dict[str, Any]:
    from tests.integration.test_candidate_marketplace import _subscribe

    me = await _candidate(mint_token)
    await _subscribe(me["id"])
    return me


async def _checked(client: Any, me: dict[str, Any]) -> None:
    response = await client.post(f"{BASE}/device-checks", json=PASSING, headers=me["headers"])
    assert response.status_code == 201 and response.json()["passed"], response.text


async def _buy(client: Any, me: dict[str, Any], *, acknowledge: bool = False) -> str:
    checkout = await client.post(
        f"{BASE}/checkout",
        json={"acknowledge_no_score_increase": acknowledge},
        headers=me["headers"],
    )
    assert checkout.status_code == 201, checkout.text
    assert await _settle(client, checkout.json()["payment_id"]) == "APPLIED"
    return str(checkout.json()["payment_id"])


async def _record_all(client: Any, fake: FakeS3, me: dict[str, Any], session_id: str) -> None:
    for index in range(QUESTIONS_PER_SESSION):
        await _answer(client, fake, me, session_id, index)


async def _answer(
    client: Any,
    fake: FakeS3,
    me: dict[str, Any],
    session_id: str,
    index: int,
    *,
    blob: bytes = OGG,
    duration_ms: int = 30_000,
) -> Any:
    if index:
        # Every question is written by the model, one after each answer
        # (2026-09-29). Idempotent: it returns the question already waiting.
        written = await client.post(
            f"{BASE}/sessions/{session_id}/next-question", headers=me["headers"]
        )
        assert written.status_code == 200, written.text
    ticket = await client.post(
        f"{BASE}/sessions/{session_id}/answers/{index}/upload", headers=me["headers"]
    )
    assert ticket.status_code == 201, ticket.text
    key = ticket.json()["url"].split("bharatpath-interview-audio/", 1)[1].split("?", 1)[0]
    fake.objects[key] = blob
    return await client.post(
        f"{BASE}/sessions/{session_id}/answers/{index}/complete",
        json={"duration_ms": duration_ms},
        headers=me["headers"],
    )


async def _full_session(client: Any, fake: FakeS3, me: dict[str, Any], **buy: Any) -> str:
    await _checked(client, me)
    await _buy(client, me, **buy)
    started = await client.post(f"{BASE}/sessions", headers=me["headers"])
    assert started.status_code == 201, started.text
    session_id = str(started.json()["id"])
    await _record_all(client, fake, me, session_id)
    completed = await client.post(f"{BASE}/sessions/{session_id}/complete", headers=me["headers"])
    assert completed.status_code == 200, completed.text
    assert completed.json()["state"] == "COMPLETED"
    return session_id


# ===========================================================================
# Pay-first, and the device check before payment
# ===========================================================================
async def test_the_interview_is_a_paid_tool(client: Any, mint_token: Any) -> None:
    me = await _candidate(mint_token)
    for method, path in (("GET", "/offer"), ("POST", "/sessions"), ("POST", "/device-checks")):
        response = await client.request(
            method, f"{BASE}{path}", json=PASSING, headers=me["headers"]
        )
        assert response.status_code == 402, (path, response.text)


async def test_a_session_cannot_be_bought_before_a_passed_device_check(
    client: Any, mint_token: Any
) -> None:
    me = await _paying(client, mint_token)
    refused = await client.post(f"{BASE}/checkout", json={}, headers=me["headers"])
    assert refused.status_code == 409
    assert refused.json()["code"] == "interview_device_check_required"

    failed = await client.post(
        f"{BASE}/device-checks",
        json={**PASSING, "network_kbps": 2, "quiet_env_ok": False},
        headers=me["headers"],
    )
    assert failed.status_code == 201
    assert failed.json()["passed"] is False and failed.json()["valid_until"] is None
    assert failed.json()["failures"] == ["network_too_slow", "environment_too_noisy"]
    still = await client.post(f"{BASE}/checkout", json={}, headers=me["headers"])
    assert still.json()["code"] == "interview_device_check_required"
    assert await _scalar("SELECT count(*) FROM payments WHERE user_id = :u", u=me["id"]) == 0

    await _checked(client, me)
    offer = (await client.get(f"{BASE}/offer", headers=me["headers"])).json()
    assert offer["on_sale"] and offer["device_check_passed"] and offer["will_increase_score"]
    assert offer["requires_acknowledgement"] is False and offer["sessions_available"] == 0


async def test_a_stale_device_check_does_not_start_a_session(client: Any, mint_token: Any) -> None:
    me = await _paying(client, mint_token)
    await _checked(client, me)
    await _buy(client, me)
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "UPDATE device_checks SET checked_at = now() - interval '2 hours' "
                "WHERE user_id = :u"
            ),
            {"u": str(me["id"])},
        )
    refused = await client.post(f"{BASE}/sessions", headers=me["headers"])
    assert refused.status_code == 409
    assert refused.json()["code"] == "interview_device_check_required"
    await _checked(client, me)
    assert (await client.post(f"{BASE}/sessions", headers=me["headers"])).status_code == 201


# ===========================================================================
# Buying: nothing without a verified callback
# ===========================================================================
async def test_a_session_is_bought_only_by_a_verified_payment(client: Any, mint_token: Any) -> None:
    me = await _paying(client, mint_token)
    await _checked(client, me)
    checkout = await client.post(f"{BASE}/checkout", json={}, headers=me["headers"])
    assert checkout.status_code == 201
    payment_id = checkout.json()["payment_id"]
    payment = await client.get(f"{API}/billing/payments/{payment_id}", headers=me["headers"])
    assert payment.json()["purpose"] == "INTERVIEW_SESSION"

    no_purchase = await client.post(f"{BASE}/sessions", headers=me["headers"])
    assert no_purchase.status_code == 409
    assert no_purchase.json()["code"] == "interview_purchase_required"

    # The database refuses a purchase against the unsettled payment.
    product_id = await _scalar("SELECT item_id FROM payments WHERE id = :p", p=payment_id)
    async with sessions(_seed_url())() as session, session.begin():
        with pytest.raises((IntegrityError, DBAPIError)) as exc:
            await session.execute(
                text(
                    "INSERT INTO interview_purchases (id, user_id, product_id, payment_id) "
                    "VALUES (gen_random_uuid(), :u, :i, :p)"
                ),
                {"u": str(me["id"]), "i": str(product_id), "p": payment_id},
            )
    assert "INTERVIEW_PURCHASE_GUARD" in str(exc.value)

    assert await _settle(client, payment_id) == "APPLIED"
    # A redelivered success buys nothing twice.
    assert await _settle(client, payment_id) == "DUPLICATE"
    assert (
        await _scalar("SELECT count(*) FROM interview_purchases WHERE user_id = :u", u=me["id"])
        == 1
    )
    notices = await _scalar(
        "SELECT count(*) FROM interview_checkout_notices "
        "WHERE payment_id = :p AND will_increase_score",
        p=payment_id,
    )
    assert notices == 1
    offer = (await client.get(f"{BASE}/offer", headers=me["headers"])).json()
    assert offer["sessions_available"] == 1


# ===========================================================================
# Recording: per-question upload, validation, recovery
# ===========================================================================
async def test_answers_upload_one_at_a_time_and_an_interrupted_session_resumes(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    await _checked(client, me)
    await _buy(client, me)
    started = await client.post(f"{BASE}/sessions", headers=me["headers"])
    body = started.json()
    session_id = body["id"]
    assert body["state"] == "CREATED" and body["question_set_code"] == "ADAPTIVE"
    assert len(body["questions"]) == 1, "the rest are written after each answer"
    assert body["questions_total"] == QUESTIONS_PER_SESSION
    assert all(q["looking_for"] is None for q in body["questions"]), (
        "feedback shown before answering"
    )
    assert {a["upload_state"] for a in body["answers"]} == {"PENDING"}

    first = await _answer(client, fake_s3, me, session_id, 0)
    assert first.status_code == 200, first.text
    assert first.json()["upload_state"] == "STORED" and first.json()["looking_for"]

    # A ticket issued and never used: the app crashed mid-upload.
    await client.post(f"{BASE}/sessions/{session_id}/next-question", headers=me["headers"])
    await client.post(f"{BASE}/sessions/{session_id}/answers/1/upload", headers=me["headers"])
    not_there = await client.post(
        f"{BASE}/sessions/{session_id}/answers/1/complete",
        json={"duration_ms": 1000},
        headers=me["headers"],
    )
    assert (
        not_there.status_code == 409 and not_there.json()["code"] == "interview_answer_not_uploaded"
    )

    # Recovery: asking to start again returns the same session and its manifest.
    resumed = await client.post(f"{BASE}/sessions", headers=me["headers"])
    assert resumed.json()["id"] == session_id and resumed.json()["state"] == "IN_PROGRESS"
    states = [a["upload_state"] for a in resumed.json()["answers"]]
    assert states[:2] == ["STORED", "UPLOADING"] and set(states[2:]) == {"PENDING"}
    assert (
        resumed.json()["questions"][0]["looking_for"]
        and not resumed.json()["questions"][1]["looking_for"]
    )
    assert (
        await _scalar("SELECT count(*) FROM interview_sessions WHERE user_id = :u", u=me["id"]) == 1
    )

    # Completing a stored answer again is a retry, not an error; re-recording it is refused.
    again = await client.post(
        f"{BASE}/sessions/{session_id}/answers/0/complete",
        json={"duration_ms": 30_000},
        headers=me["headers"],
    )
    assert again.status_code == 200
    rerecord = await client.post(
        f"{BASE}/sessions/{session_id}/answers/0/upload", headers=me["headers"]
    )
    assert rerecord.status_code == 409
    assert rerecord.json()["code"] == "interview_answer_already_stored"

    # Not audio: refused, and the object is deleted.
    rejected = await _answer(client, fake_s3, me, session_id, 1, blob=b"%PDF-1.7" + b"\x00" * 4096)
    assert rejected.status_code == 422 and rejected.json()["code"] == "answer_not_audio"
    assert fake_s3.deleted and fake_s3.deleted[-1].endswith(f"{session_id}/1")

    early = await client.post(f"{BASE}/sessions/{session_id}/complete", headers=me["headers"])
    assert early.status_code == 409 and early.json()["code"] == "interview_answers_missing"
    assert early.json()["params"]["missing"] == [1, 2, 3, 4, 5]

    for index in range(1, QUESTIONS_PER_SESSION):
        assert (await _answer(client, fake_s3, me, session_id, index)).status_code == 200
    out_of_range = await client.post(
        f"{BASE}/sessions/{session_id}/answers/{QUESTIONS_PER_SESSION}/upload",
        headers=me["headers"],
    )
    assert out_of_range.status_code == 422


async def test_another_candidates_session_is_a_404(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    owner = await _paying(client, mint_token)
    other = await _paying(client, mint_token)
    await _checked(client, owner)
    await _buy(client, owner)
    session_id = (await client.post(f"{BASE}/sessions", headers=owner["headers"])).json()["id"]
    for method, suffix, body in (
        ("GET", "", None),
        ("POST", "/answers/0/upload", None),
        ("POST", "/answers/0/complete", {"duration_ms": 5000}),
        ("POST", "/complete", None),
    ):
        response = await client.request(
            method, f"{BASE}/sessions/{session_id}{suffix}", json=body, headers=other["headers"]
        )
        assert response.status_code == 404, (suffix, response.text)
        assert response.json()["code"] == "interview_session_not_found"
    assert (await client.get(f"{BASE}/sessions", headers=other["headers"])).json() == []


# ===========================================================================
# Completion, the fourth session, and invariant 4' end to end
# ===========================================================================
async def test_completion_is_audited_announced_and_idempotent(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    session_id = await _full_session(client, fake_s3, me)

    again = await client.post(f"{BASE}/sessions/{session_id}/complete", headers=me["headers"])
    assert again.status_code == 200 and again.json()["state"] == "COMPLETED"
    for sql in (
        "SELECT count(*) FROM audit_events "
        "WHERE action = 'interview_completion_recorded' AND target_id = :s",
        "SELECT count(*) FROM outbox "
        "WHERE event_type = 'interview.session_completed' AND aggregate_id = :s",
    ):
        assert await _scalar(sql, s=session_id) == 1
    assert "points" not in str(again.json()), "no response says what a session is worth"

    closed = await client.post(
        f"{BASE}/sessions/{session_id}/answers/0/upload", headers=me["headers"]
    )
    assert closed.status_code == 409


async def test_the_database_holds_the_session_rules(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    await _checked(client, me)
    await _buy(client, me)
    session_id = (await client.post(f"{BASE}/sessions", headers=me["headers"])).json()["id"]
    await _answer(client, fake_s3, me, session_id, 0)

    async def refused(sql: str, marker: str, url: str = APP_URL) -> None:
        async with sessions(url)() as session, session.begin():
            with pytest.raises((IntegrityError, DBAPIError, ProgrammingError)) as exc:
                await session.execute(text(sql), {"s": session_id})
        assert marker in str(exc.value), str(exc.value)

    # +20 without the recordings, from a direct write.
    await refused(
        "UPDATE interview_sessions SET state = 'COMPLETED', completed_at = now(), "
        "points_awarded = 20, contribution_version = 'x' WHERE id = :s",
        "every answer stored",
        _seed_url(),
    )
    await refused(
        "UPDATE interview_sessions SET state = 'EVALUATED' WHERE id = :s",
        "not a session transition",
    )
    await refused(
        "UPDATE interview_answers SET duration_ms = 1 WHERE session_id = :s AND question_index = 0",
        "a stored answer never changes",
    )
    await refused("DELETE FROM interview_sessions WHERE id = :s", "permission denied")

    for index in range(1, QUESTIONS_PER_SESSION):
        await _answer(client, fake_s3, me, session_id, index)
    await client.post(f"{BASE}/sessions/{session_id}/complete", headers=me["headers"])
    await refused(
        "UPDATE interview_sessions SET points_awarded = 0 WHERE id = :s", "a completion is a latch"
    )
    await refused(
        "INSERT INTO interview_answers (id, session_id, question_index, question_code) "
        "VALUES (gen_random_uuid(), :s, 5, 'X') ON CONFLICT DO NOTHING",
        "no longer being recorded",
        _seed_url(),
    )


async def test_four_sessions_move_the_score_by_sixty_and_replay_exactly(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    """Invariant 4', re-verified end to end on Day 16 as the plan requires."""
    from tests.integration.test_candidate_marketplace import _candidate as scored_candidate

    me = await scored_candidate(mint_token)
    async with sessions(APP_URL)() as session:
        before = await scoring_service.get_latest(session, user_id=me["id"])
    assert before is not None and before.addon_value == 0

    session_ids: list[str] = []
    for number in range(1, 4):
        session_ids.append(await _full_session(client, fake_s3, me))
        async with sessions(APP_URL)() as session, session.begin():
            result = await scoring_service.rescore_for_addons(session, user_id=me["id"])
        assert result is not None
        assert result.addon_value == 20 * number
        assert result.base_value == before.base_value

    second = await client.get(f"{BASE}/sessions/{session_ids[1]}", headers=me["headers"])
    assert second.json()["question_set_code"] == "ADAPTIVE"

    # The fourth: warned, refused unacknowledged, and the acknowledgement kept.
    await _checked(client, me)
    offer = (await client.get(f"{BASE}/offer", headers=me["headers"])).json()
    assert offer["will_increase_score"] is False and offer["requires_acknowledgement"] is True
    unacknowledged = await client.post(f"{BASE}/checkout", json={}, headers=me["headers"])
    assert unacknowledged.status_code == 409
    assert unacknowledged.json()["code"] == "interview_no_score_increase_unacknowledged"
    session_ids.append(await _full_session(client, fake_s3, me, acknowledge=True))
    assert (
        await _scalar(
            "SELECT count(*) FROM interview_checkout_notices "
            "WHERE user_id = :u AND NOT will_increase_score AND acknowledged_no_increase",
            u=me["id"],
        )
        == 1
    )

    async with sessions(APP_URL)() as session, session.begin():
        fourth = await scoring_service.rescore_for_addons(session, user_id=me["id"])
    assert fourth is not None, "a new completion is a new contributing event"
    assert fourth.addon_value == 60, "the cap holds: four sessions, +60"
    assert fourth.raw_value == min(before.base_value + 60, 990)

    async with sessions(APP_URL)() as session, session.begin():
        assert await scoring_service.rescore_for_addons(session, user_id=me["id"]) is None
        replayed = await scoring_service.replay(session, score_id=fourth.score_id)
        stored = await scoring_service.get_score(session, score_id=fourth.score_id)
    assert replayed.raw_value == fourth.raw_value
    events = [e for e in stored.contributing_events if e["kind"] == "interview"]
    assert [e["id"] for e in events] == session_ids
    assert {e["points"] for e in events} == {20}
    badges = await _scalar(
        "SELECT badges FROM candidate_search_documents WHERE user_id = :u", u=me["id"]
    )
    assert "MOCK_INTERVIEW_COMPLETED" in badges


def test_a_completed_session_routes_to_the_rescore() -> None:
    """And to its evaluation (Day 17), which is feedback and scores nothing."""
    from app.tasks.routing import (
        EVALUATE_INTERVIEW_TASK,
        RESCORE_FOR_ADDONS_TASK,
        SCORE_RESUME_TASK,
        tasks_for,
    )

    assert tasks_for("interview.session_completed") == (
        RESCORE_FOR_ADDONS_TASK,
        EVALUATE_INTERVIEW_TASK,
    )
    assert SCORE_RESUME_TASK not in tasks_for("interview.session_completed")
    assert tasks_for("interview.answer_stored") == ()
