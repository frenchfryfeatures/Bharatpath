"""Through HTTP and the database: evaluating a completed mock interview.

Evaluation is feedback. What this file holds:

  * a completed session is transcribed and rated, and the candidate reads a
    report of **words** -- no number about them anywhere in it;
  * with no provider configured nothing is invented: the session stays
    COMPLETED and the report says PENDING;
  * silence and a malformed evaluator are recorded as FAILED, never repaired;
  * **the +20 does not move**, and the database refuses an EVALUATED session
    without the evaluation that says so.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.modules.interview import service as interview_service
from app.modules.interview.bank import QUESTIONS_PER_SESSION, SET_ONE
from app.modules.interview.evaluation import (
    AnswerForEvaluation,
    EvaluationUnavailableError,
    StubEvaluationProvider,
    StubTranscriptionProvider,
    UnconfiguredEvaluationProvider,
    UnconfiguredTranscriptionProvider,
)
from tests.conftest import _seed_url, sessions
from tests.integration.test_interview import (
    APP_URL,
    BASE,
    OGG,
    _answer,
    _buy,
    _checked,
    _full_session,
    _paying,
)
from tests.integration.test_payments import _scalar
from tests.integration.test_resume_intake import FakeS3

pytestmark = pytest.mark.integration

#: Real Ogg audio as far as the upload check is concerned (over 1 KB), and
#: silence as far as the stub speech model is concerned (under 2 KB).
SILENT_OGG = b"OggS\x00\x02" + b"\x00" * 1500

SCORE_LIKE = ("score", "point", "rating", "rank", "percent", "grade", "band")


@pytest.fixture
def fake_s3(monkeypatch: pytest.MonkeyPatch) -> FakeS3:
    from app.core import storage

    fake = FakeS3()
    for name in (
        "head_object",
        "read_head_bytes",
        "read_whole_object",
        "delete_object",
        "presign_put",
    ):
        monkeypatch.setattr(storage, name, getattr(fake, name))
    return fake


async def _evaluate(
    session_id: str,
    *,
    transcriber: Any = None,
    evaluator: Any = None,
) -> str:
    """What the `interview.evaluate_session` task does, as the app role."""
    async with sessions(APP_URL)() as session, session.begin():
        await interview_service.transcribe_session(
            session,
            session_id=uuid.UUID(session_id),
            provider=transcriber or StubTranscriptionProvider(),
        )
    async with sessions(APP_URL)() as session, session.begin():
        return await interview_service.evaluate_session(
            session,
            session_id=uuid.UUID(session_id),
            provider=evaluator or StubEvaluationProvider(),
        )


def _keys(value: Any) -> list[str]:
    if isinstance(value, dict):
        return list(value) + [k for v in value.values() for k in _keys(v)]
    if isinstance(value, list):
        return [k for item in value for k in _keys(item)]
    return []


async def test_a_completed_session_becomes_a_report_in_words(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    session_id = await _full_session(client, fake_s3, me)
    report_url = f"{BASE}/sessions/{session_id}/report"

    pending = await client.get(report_url, headers=me["headers"])
    assert pending.status_code == 200 and pending.json()["status"] == "PENDING"

    assert await _evaluate(session_id) == "EVALUATED"
    report = await client.get(report_url, headers=me["headers"])
    assert report.status_code == 200, report.text
    body = report.json()
    assert body["status"] == "READY" and body["report_version"]
    assert [q["index"] for q in body["questions"]] == list(range(QUESTIONS_PER_SESSION))
    assert all(q["spoken"] and q["transcript"] and q["looking_for"] for q in body["questions"])
    assert {d["level"] for d in body["dimensions"]} <= {"STRONG", "DEVELOPING", "FOCUS_AREA"}
    assert set(body["strengths"]) | set(body["focus_areas"]) <= {
        d["code"] for d in body["dimensions"]
    }

    offending = [k for k in _keys(body) if any(word in k.lower() for word in SCORE_LIKE)]
    assert not offending, f"the report names {offending}"

    session = (await client.get(f"{BASE}/sessions/{session_id}", headers=me["headers"])).json()
    assert session["state"] == "EVALUATED"
    assert (
        await _scalar("SELECT points_awarded FROM interview_sessions WHERE id = :s", s=session_id)
        == 20
    ), "feedback never moves the contribution"
    assert (
        await _scalar(
            "SELECT count(*) FROM outbox WHERE event_type = 'interview.session_evaluated' "
            "AND aggregate_id = :s",
            s=session_id,
        )
        == 1
    )


async def test_evaluation_is_idempotent_and_transcribes_nothing_twice(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    session_id = await _full_session(client, fake_s3, me)
    assert await _evaluate(session_id) == "EVALUATED"
    assert await _evaluate(session_id) == "EVALUATED"
    for table in ("interview_evaluations", "interview_transcripts"):
        count = await _scalar(f"SELECT count(*) FROM {table} WHERE session_id = :s", s=session_id)
        assert count == (1 if table == "interview_evaluations" else QUESTIONS_PER_SESSION)


async def test_with_no_provider_nothing_is_invented(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    session_id = await _full_session(client, fake_s3, me)
    with pytest.raises(EvaluationUnavailableError):
        await _evaluate(session_id, transcriber=UnconfiguredTranscriptionProvider())
    assert (
        await _scalar(
            "SELECT count(*) FROM interview_transcripts WHERE session_id = :s", s=session_id
        )
        == 0
    )

    async with sessions(APP_URL)() as session, session.begin():
        await interview_service.transcribe_session(
            session, session_id=uuid.UUID(session_id), provider=StubTranscriptionProvider()
        )
    with pytest.raises(EvaluationUnavailableError):
        await _evaluate(session_id, evaluator=UnconfiguredEvaluationProvider())

    assert await _scalar("SELECT state FROM interview_sessions WHERE id = :s", s=session_id) == (
        "COMPLETED"
    )
    report = await client.get(f"{BASE}/sessions/{session_id}/report", headers=me["headers"])
    assert report.json()["status"] == "PENDING"


async def test_silence_is_recorded_as_no_speech_and_keeps_its_points(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    await _checked(client, me)
    await _buy(client, me)
    session_id = (await client.post(f"{BASE}/sessions", headers=me["headers"])).json()["id"]
    for index in range(QUESTIONS_PER_SESSION):
        stored = await _answer(client, fake_s3, me, session_id, index, blob=SILENT_OGG)
        assert stored.status_code == 200, stored.text
    assert (
        await client.post(f"{BASE}/sessions/{session_id}/complete", headers=me["headers"])
    ).status_code == 200

    assert await _evaluate(session_id, evaluator=UnconfiguredEvaluationProvider()) == "FAILED"
    report = (
        await client.get(f"{BASE}/sessions/{session_id}/report", headers=me["headers"])
    ).json()
    assert (report["status"], report["failure_reason"]) == ("FAILED", "no_speech")
    assert report["questions"] == []
    assert (
        await _scalar("SELECT points_awarded FROM interview_sessions WHERE id = :s", s=session_id)
        == 20
    ), "points are for completing, not for performing"


class _Malformed(StubEvaluationProvider):
    async def evaluate(self, *, answers: list[AnswerForEvaluation]) -> dict[str, Any]:
        raw = await super().evaluate(answers=answers)
        raw["questions"][0]["ratings"]["ACCENT"] = 1
        return raw


async def test_a_malformed_evaluation_is_recorded_never_repaired(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    session_id = await _full_session(client, fake_s3, me)
    assert await _evaluate(session_id, evaluator=_Malformed()) == "FAILED"
    async with sessions(_seed_url())() as session:
        row = (
            await session.execute(
                text(
                    "SELECT failure_reason, ratings::text, raw_response::text "
                    "FROM interview_evaluations WHERE session_id = :s"
                ),
                {"s": session_id},
            )
        ).one()
    assert row.failure_reason == "evaluation_invalid" and row.ratings == "[]"
    assert "ACCENT" in row.raw_response, "what the evaluator said is kept for the dispute"


async def test_the_report_is_the_candidates_own_and_only_once_complete(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    await _checked(client, me)
    await _buy(client, me)
    open_id = (await client.post(f"{BASE}/sessions", headers=me["headers"])).json()["id"]
    open_report = await client.get(f"{BASE}/sessions/{open_id}/report", headers=me["headers"])
    assert open_report.status_code == 409
    for index in range(QUESTIONS_PER_SESSION):
        await _answer(client, fake_s3, me, open_id, index, blob=OGG)
    await client.post(f"{BASE}/sessions/{open_id}/complete", headers=me["headers"])
    await _evaluate(open_id)

    other = await _paying(client, mint_token)
    stolen = await client.get(f"{BASE}/sessions/{open_id}/report", headers=other["headers"])
    assert stolen.status_code == 404


async def test_the_database_holds_the_evaluation_rules(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    me = await _paying(client, mint_token)
    session_id = await _full_session(client, fake_s3, me)

    async def refused(sql: str, marker: str, url: str = APP_URL) -> None:
        async with sessions(url)() as session:
            with pytest.raises(DBAPIError) as caught:
                async with session.begin():
                    await session.execute(text(sql), {"s": session_id})
        assert marker in str(caught.value), str(caught.value)

    await refused(
        "UPDATE interview_sessions SET state = 'EVALUATED' WHERE id = :s",
        "needs the evaluation that records it",
        _seed_url(),
    )
    await _evaluate(session_id)
    await refused(
        "UPDATE interview_sessions SET points_awarded = 0 WHERE id = :s",
        "a completion is a latch",
        _seed_url(),
    )
    for statement in (
        "UPDATE interview_transcripts SET text = 'rewritten' WHERE session_id = :s",
        "DELETE FROM interview_transcripts WHERE session_id = :s",
        "UPDATE interview_evaluations SET outcome = 'FAILED' WHERE session_id = :s",
        "DELETE FROM interview_evaluations WHERE session_id = :s",
    ):
        await refused(statement, "permission denied")


def test_the_evaluator_is_given_nothing_about_the_person() -> None:
    fields = set(AnswerForEvaluation.__dataclass_fields__)
    assert fields == {"question_code", "prompt", "looking_for", "transcript"}
    assert SET_ONE.questions[0].looking_for
