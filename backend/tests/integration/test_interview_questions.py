"""Questions written for the candidate, the interview history and playback
(2026-09-29), through HTTP and the database.

The stub question writer stands in for the model and the stub transcriber
for Sarvam, patched where the service looks them up. S3 is `FakeS3`.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.interview import service as interview_service
from app.modules.interview.bank import QUESTIONS_PER_SESSION
from app.modules.interview.domain import normalise_prompt
from app.modules.interview.evaluation import StubEvaluationProvider, StubTranscriptionProvider
from app.modules.interview.questions import (
    QuestionContext,
    QuestionUnavailableError,
    StubQuestionProvider,
)
from tests.conftest import _seed_url, sessions
from tests.integration.test_interview import (
    BASE,
    _answer,
    _buy,
    _checked,
    _paying,
)
from tests.integration.test_payments import _scalar
from tests.integration.test_resume_intake import FakeS3

pytestmark = pytest.mark.integration

#: Heard by the stub transcriber as speech (it hears 2 KB or less as silence).
SPOKEN = b"OggS\x00\x02" + b"\x07" * 4096


class RecordingProvider(StubQuestionProvider):
    """The stub, keeping every context it was shown."""

    def __init__(self) -> None:
        self.contexts: list[QuestionContext] = []

    async def draft(self, *, context: QuestionContext) -> dict[str, Any]:
        self.contexts.append(context)
        return await super().draft(context=context)


class RepeatingProvider(StubQuestionProvider):
    """A model that ignores the instruction not to repeat itself -- until it
    is told its draft was refused."""

    def __init__(self, *, stubborn: bool = False) -> None:
        self.stubborn = stubborn
        self.calls = 0

    async def draft(self, *, context: QuestionContext) -> dict[str, Any]:
        self.calls += 1
        drafted = await super().draft(context=context)
        if context.earlier_questions and (self.stubborn or not context.refused):
            drafted["prompt"] = context.earlier_questions[0].upper() + "  "
        return drafted


class UnreachableProvider(StubQuestionProvider):
    async def draft(self, *, context: QuestionContext) -> dict[str, Any]:
        raise QuestionUnavailableError()


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

    async def presign_get(*, bucket: str, key: str, expires_in: int) -> str:
        return f"https://s3.example/{bucket}/{key}?get&ttl={expires_in}"

    monkeypatch.setattr(storage, "presign_get", presign_get)
    return fake


@pytest.fixture
def writer(monkeypatch: pytest.MonkeyPatch) -> RecordingProvider:
    provider = RecordingProvider()
    monkeypatch.setattr(interview_service, "get_question_provider", lambda: provider)
    monkeypatch.setattr(
        interview_service, "get_transcription_provider", lambda: StubTranscriptionProvider()
    )
    return provider


async def _start(client: Any, me: dict[str, Any]) -> dict[str, Any]:
    await _checked(client, me)
    await _buy(client, me)
    started = await client.post(f"{BASE}/sessions", headers=me["headers"])
    assert started.status_code == 201, started.text
    return dict(started.json())


async def _next(client: Any, me: dict[str, Any], session_id: str) -> Any:
    return await client.post(f"{BASE}/sessions/{session_id}/next-question", headers=me["headers"])


async def _sit_written_session(
    client: Any, fake: FakeS3, me: dict[str, Any]
) -> tuple[str, list[dict[str, Any]]]:
    session = await _start(client, me)
    session_id = str(session["id"])
    for index in range(QUESTIONS_PER_SESSION):
        if index:
            response = await _next(client, me, session_id)
            assert response.status_code == 200, response.text
            session = response.json()
        assert len(session["questions"]) == index + 1
        stored = await _answer(client, fake, me, session_id, index, blob=SPOKEN)
        assert stored.status_code == 200, stored.text
    done = await client.post(f"{BASE}/sessions/{session_id}/complete", headers=me["headers"])
    assert done.status_code == 200, done.text
    return session_id, list(done.json()["questions"])


# ===========================================================================
# With a writer: one question at a time, each after the answer before it
# ===========================================================================
async def test_questions_are_written_one_at_a_time_following_what_was_said(
    client: Any, mint_token: Any, fake_s3: FakeS3, writer: RecordingProvider
) -> None:
    me = await _paying(client, mint_token)
    session = await _start(client, me)
    session_id = str(session["id"])
    assert session["question_set_code"] == "ADAPTIVE"
    [first] = session["questions"]
    assert first["key"] is None and first["code"] == "S1Q1"
    assert len(session["answers"]) == QUESTIONS_PER_SESSION

    # The second question does not exist until the first answer is stored.
    early = await client.post(
        f"{BASE}/sessions/{session_id}/answers/1/upload", headers=me["headers"]
    )
    assert early.status_code == 409 and early.json()["code"] == "interview_question_not_ready"
    waiting = await _next(client, me, session_id)
    assert waiting.status_code == 200, "a retry before answering gets the same question"
    assert [q["code"] for q in waiting.json()["questions"]] == ["S1Q1"]

    await _answer(client, fake_s3, me, session_id, 0, blob=SPOKEN)
    second = await _next(client, me, session_id)
    assert second.status_code == 200, second.text
    assert [q["code"] for q in second.json()["questions"]] == ["S1Q1", "S1Q2"]
    again = await _next(client, me, session_id)
    assert again.json()["questions"] == second.json()["questions"], "idempotent"

    # The writer heard the first answer before writing the second question.
    context = writer.contexts[-1]
    assert context.index == 1 and context.this_session[0].transcript
    kinds = await _scalar(
        "SELECT string_agg(kind || ':' || source, ',' ORDER BY question_index) "
        "FROM interview_session_questions WHERE session_id = :s",
        s=session_id,
    )
    assert kinds == "OPENING:MODEL,FOLLOW_UP:MODEL"
    assert (
        await _scalar(
            "SELECT count(*) FROM interview_transcripts WHERE session_id = :s", s=session_id
        )
        == 1
    ), "heard once, and the evaluation will reuse it"


async def test_a_written_session_completes_evaluates_and_reports_its_own_questions(
    client: Any, mint_token: Any, fake_s3: FakeS3, writer: RecordingProvider
) -> None:
    me = await _paying(client, mint_token)
    session_id, questions = await _sit_written_session(client, fake_s3, me)
    assert [q["code"] for q in questions] == [f"S1Q{i + 1}" for i in range(6)]

    async with sessions(_seed_url())() as session, session.begin():
        await interview_service.transcribe_session(
            session, session_id=session_id, provider=StubTranscriptionProvider()
        )
    async with sessions(_seed_url())() as session, session.begin():
        outcome = await interview_service.evaluate_session(
            session, session_id=session_id, provider=StubEvaluationProvider()
        )
    assert outcome == "EVALUATED"
    report = (
        await client.get(f"{BASE}/sessions/{session_id}/report", headers=me["headers"])
    ).json()
    assert report["status"] == "READY"
    assert [q["prompt"] for q in report["questions"]] == [q["prompt"] for q in questions]


async def test_no_question_from_an_earlier_session_is_asked_again(
    client: Any, mint_token: Any, fake_s3: FakeS3, writer: RecordingProvider
) -> None:
    me = await _paying(client, mint_token)
    _, first = await _sit_written_session(client, fake_s3, me)
    second = await _start(client, me)
    context = writer.contexts[-1]
    assert context.session_number == 2
    assert set(context.earlier_questions) == {q["prompt"] for q in first}
    assert normalise_prompt(second["questions"][0]["prompt"]) not in {
        normalise_prompt(q["prompt"]) for q in first
    }


async def _sat_one_session(client: Any, fake: FakeS3, me: dict[str, Any]) -> list[str]:
    _, questions = await _sit_written_session(client, fake, me)
    return [q["prompt"] for q in questions]


async def test_a_repeated_question_is_refused_and_written_again(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
    writer: RecordingProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model repeats an earlier question despite being told not to; the
    server refuses it and asks again, saying why. The candidate never hears a
    repeat and never hears a fixed question."""
    me = await _paying(client, mint_token)
    first = await _sat_one_session(client, fake_s3, me)
    repeating = RepeatingProvider()
    monkeypatch.setattr(interview_service, "get_question_provider", lambda: repeating)
    second = await _start(client, me)
    [question] = second["questions"]
    assert repeating.calls == 2, "refused once, then written again"
    assert normalise_prompt(question["prompt"]) not in {normalise_prompt(p) for p in first}
    assert (
        await _scalar(
            "SELECT source FROM interview_session_questions WHERE session_id = :s", s=second["id"]
        )
        == "MODEL"
    )


async def test_a_question_that_cannot_be_written_spends_nothing(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
    writer: RecordingProvider,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No fixed question stands in: a 503 the app retries, with the purchase
    still unspent and no session started."""
    me = await _paying(client, mint_token)
    await _sat_one_session(client, fake_s3, me)
    for provider in (UnreachableProvider(), RepeatingProvider(stubborn=True)):
        monkeypatch.setattr(interview_service, "get_question_provider", lambda p=provider: p)
        await _checked(client, me)
        await _buy(client, me)
        refused = await client.post(f"{BASE}/sessions", headers=me["headers"])
        assert refused.status_code == 503, refused.text
        assert refused.json()["code"] == "interview_question_unavailable"
        offer = (await client.get(f"{BASE}/offer", headers=me["headers"])).json()
        assert offer["open_session_id"] is None and offer["sessions_available"] >= 1
    assert (
        await _scalar("SELECT count(*) FROM interview_sessions WHERE user_id = :u", u=me["id"]) == 1
    ), "only the session that was sat"


# ===========================================================================
# History and playback
# ===========================================================================
async def test_the_candidate_can_go_back_through_their_sessions_and_hear_them(
    client: Any, mint_token: Any, fake_s3: FakeS3, writer: RecordingProvider
) -> None:
    me = await _paying(client, mint_token)
    session_id, questions = await _sit_written_session(client, fake_s3, me)

    history = await client.get(f"{BASE}/history", headers=me["headers"])
    assert history.status_code == 200
    [item] = history.json()
    assert item["id"] == session_id and item["state"] == "COMPLETED"
    assert (item["questions_asked"], item["answers_stored"]) == (6, 6)
    assert item["report_status"] == "PENDING"

    recordings = await client.get(f"{BASE}/sessions/{session_id}/recordings", headers=me["headers"])
    assert recordings.status_code == 200, recordings.text
    rows = recordings.json()
    assert [r["question_index"] for r in rows] == list(range(6))
    assert [r["prompt"] for r in rows] == [q["prompt"] for q in questions]
    assert all(r["url"].startswith("https://s3.example/") for r in rows)
    assert all(f"/{me['id']}/{session_id}/" in r["url"] for r in rows)

    stranger = await _paying(client, mint_token)
    theirs = await client.get(
        f"{BASE}/sessions/{session_id}/recordings", headers=stranger["headers"]
    )
    assert theirs.status_code == 404


async def test_staff_hear_a_session_through_an_audited_read_of_its_own(
    client: Any, mint_token: Any, fake_s3: FakeS3, writer: RecordingProvider
) -> None:
    from tests.integration.test_admin_console import _audit_rows, _staff

    me = await _paying(client, mint_token)
    session_id, _ = await _sit_written_session(client, fake_s3, me)
    staff = await _staff(mint_token, role="SUPPORT_AGENT")
    base = f"/api/v1/admin/candidates/{me['id']}/interviews"

    [listed] = (await client.get(base, headers=staff["headers"])).json()
    assert listed["id"] == session_id and listed["answers_stored"] == QUESTIONS_PER_SESSION

    heard = await client.get(f"{base}/{session_id}/recordings", headers=staff["headers"])
    assert heard.status_code == 200, heard.text
    assert len(heard.json()) == QUESTIONS_PER_SESSION
    # Each answer is heard when the next question is written; the last one
    # waits for the evaluation.
    assert all(r["transcript"] for r in heard.json()[:-1]), "heard in-session by the stub"
    assert await _audit_rows("admin_interview_recordings_opened", staff["user_id"], session_id) == 1

    stranger = await _paying(client, mint_token)
    wrong = await client.get(
        f"/api/v1/admin/candidates/{stranger['id']}/interviews/{session_id}/recordings",
        headers=staff["headers"],
    )
    assert wrong.status_code == 404, "a session is only reached through its own candidate"
