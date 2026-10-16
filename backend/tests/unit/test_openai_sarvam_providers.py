"""OpenAI extraction and evaluation, and Sarvam transcription and speech,
against a fake transport. No test may call a model or a speech service.

What matters is what we *send* (a strict schema built from our own types, the
prompt, the input delimited as data, `store: false`, nothing about the person)
and what we do with each kind of answer.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from pydantic import SecretStr, ValidationError

from app.core import openai_responses as oa
from app.modules.interview import sarvam
from app.modules.interview.bank import DIMENSION_CODES
from app.modules.interview.domain import parse_evaluation
from app.modules.interview.evaluation import AnswerForEvaluation, EvaluationUnavailableError
from app.modules.interview.openai_evaluator import OpenAIEvaluationProvider
from app.modules.interview.speech import QuestionAudioUnavailableError
from app.modules.scoring.extractor import (
    EXTRACTION_PROMPT,
    PROMPT_VERSION,
    ExtractionInvalidError,
    ExtractionUnavailableError,
    get_resume_extractor,
)
from app.modules.scoring.openai_extractor import (
    MAX_ATTEMPTS,
    OpenAIResumeExtractor,
    response_schema,
)
from app.settings import Settings, get_settings

MODEL = "gpt-5.4-mini-2026-03-17"
FACTS: dict[str, Any] = {
    "roles": [{"title": "Nurse", "employer": "Apollo", "months": 36, "seniority_level": "mid"}],
    "skills": [{"canonical_name": "Triage", "evidence_strength": 3}],
    "role_progression": 2,
}


def _settings(**overrides: Any) -> Settings:
    return get_settings().model_copy(update=overrides)


@pytest.fixture
def keyed(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _settings(openai_api_key=SecretStr("sk-test"), sarvam_api_key=SecretStr("sv-test"))
    monkeypatch.setattr(oa, "get_settings", lambda: fake)
    monkeypatch.setattr(sarvam, "get_settings", lambda: fake)
    monkeypatch.setattr(sarvam, "POLL_SECONDS", 0.0)


Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def transport(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Callable[[Handler], list[httpx.Request]]]:
    def install(handler: Handler) -> list[httpx.Request]:
        seen: list[httpx.Request] = []

        def record(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return handler(request)

        mock = httpx.MockTransport(record)
        monkeypatch.setattr(oa, "_transport", mock)
        monkeypatch.setattr(sarvam, "_transport", mock)
        return seen

    yield install


def _answer(payload: Any, *, status: str = "completed") -> httpx.Response:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return httpx.Response(
        200,
        json={
            "id": "resp_1",
            "model": MODEL,
            "status": status,
            "incomplete_details": {"reason": "max_output_tokens"}
            if status == "incomplete"
            else None,
            "output": [
                {"id": "rs_1", "type": "reasoning", "summary": []},
                {
                    "id": "msg_1",
                    "type": "message",
                    "content": [{"type": "output_text", "text": text}],
                },
            ],
            "usage": {"input_tokens": 1200, "output_tokens": 300},
        },
    )


# ---------------------------------------------------------------------------
# The strict schema
# ---------------------------------------------------------------------------
def _objects(node: Any) -> Iterator[dict[str, Any]]:
    if isinstance(node, dict):
        if node.get("type") == "object":
            yield node
        for value in node.values():
            yield from _objects(value)
    elif isinstance(node, list):
        for item in node:
            yield from _objects(item)


def test_every_object_in_the_extraction_schema_is_closed_and_fully_required() -> None:
    schema = response_schema()
    objects = list(_objects(schema))
    assert len(objects) >= 4  # the resume, a role, an education, a skill
    for obj in objects:
        assert obj["additionalProperties"] is False
        assert set(obj["required"]) == set(obj["properties"])
    for node in _schema_nodes(schema):
        assert not {"default", "maxLength", "title"} & set(node)


def _schema_nodes(node: Any) -> Iterator[dict[str, Any]]:
    """Every schema node, skipping the `properties` maps whose keys are field
    names (a field may be called `title`) rather than keywords."""
    if isinstance(node, dict):
        yield node
        for key, value in node.items():
            children = value.values() if key in ("properties", "$defs") else [value]
            for child in children:
                yield from _schema_nodes(child)
    elif isinstance(node, list):
        for item in node:
            yield from _schema_nodes(item)


def test_the_strict_schema_asks_for_every_field_the_model_class_has() -> None:
    """Stripping the `title` keyword once deleted the `title` *field* too, so
    the model was never asked for a job title and every real CV failed."""
    from app.modules.scoring.extractor import ExtractedResume, ExtractedRole

    schema = response_schema()
    assert set(schema["properties"]) == set(ExtractedResume.model_fields)
    role = schema["$defs"]["ExtractedRole"]
    assert set(role["properties"]) == set(ExtractedRole.model_fields)
    assert "title" in role["required"]


def test_the_schema_has_no_score_field() -> None:
    fields = {k for obj in _objects(response_schema()) for k in obj["properties"]}
    assert not {f for f in fields if "score" in f and f != "claimed_platform_score"}


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------
async def test_extraction_sends_the_prompt_the_cv_as_data_and_stores_nothing(
    keyed: None, transport: Any
) -> None:
    seen = transport(lambda _r: _answer(FACTS))
    result = await OpenAIResumeExtractor(model_id=MODEL).extract(text="Nurse at Apollo")

    sent = json.loads(seen[0].content)
    assert seen[0].url.path.endswith("/responses")
    assert seen[0].headers["authorization"] == "Bearer sk-test"
    assert sent["model"] == MODEL
    assert sent["instructions"] == EXTRACTION_PROMPT
    assert "<cv>\nNurse at Apollo\n</cv>" in sent["input"]
    assert sent["store"] is False
    assert sent["text"]["format"]["strict"] is True
    assert "temperature" not in sent and "top_p" not in sent

    assert result.features.roles[0].employer == "Apollo"
    assert result.model_id == MODEL and result.prompt_version == PROMPT_VERSION
    assert "id" not in result.raw_response
    assert result.raw_response["output_text"] == [json.dumps(FACTS)]


@pytest.mark.parametrize(
    "bad",
    [
        _answer("not json"),
        _answer({**FACTS, "total_score": 900}),
        _answer({**FACTS, "role_progression": 9}),
        _answer(FACTS, status="incomplete"),
    ],
)
async def test_an_unusable_answer_is_retried_once_then_invalid(
    keyed: None, transport: Any, bad: httpx.Response
) -> None:
    seen = transport(lambda _r: bad)
    with pytest.raises(ExtractionInvalidError):
        await OpenAIResumeExtractor(model_id=MODEL).extract(text="cv")
    assert len(seen) == MAX_ATTEMPTS


async def test_a_retry_that_succeeds_is_used(keyed: None, transport: Any) -> None:
    answers = iter([_answer("nope"), _answer(FACTS)])
    transport(lambda _r: next(answers))
    result = await OpenAIResumeExtractor(model_id=MODEL).extract(text="cv")
    assert result.features.role_progression == 2


@pytest.mark.parametrize("status", [401, 429, 500])
async def test_a_refusal_or_outage_is_unavailable_and_not_retried_here(
    keyed: None, transport: Any, status: int
) -> None:
    seen = transport(lambda _r: httpx.Response(status, json={"error": {"code": "x"}}))
    with pytest.raises(ExtractionUnavailableError):
        await OpenAIResumeExtractor(model_id=MODEL).extract(text="cv")
    assert len(seen) == 1


async def test_a_network_failure_is_unavailable(keyed: None, transport: Any) -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    transport(fail)
    with pytest.raises(ExtractionUnavailableError):
        await OpenAIResumeExtractor(model_id=MODEL).extract(text="cv")


def test_openai_is_the_extractor_selected_when_enabled() -> None:
    extractor = get_resume_extractor(
        _settings(
            scoring_extraction_enabled=True,
            scoring_model_id=MODEL,
            openai_api_key=SecretStr("k"),
        )
    )
    assert isinstance(extractor, OpenAIResumeExtractor)
    assert extractor.model_id == MODEL


# ---------------------------------------------------------------------------
# Interview evaluation
# ---------------------------------------------------------------------------
ANSWERS = [
    AnswerForEvaluation("Q1", "Tell me about a hard week.", "specifics", "I fixed the rota."),
    AnswerForEvaluation("Q2", "A mistake you made?", "ownership", "Maine galti ki, phir fix kiya."),
]


def _feedback(codes: list[str]) -> dict[str, Any]:
    return {
        "questions": [
            {
                "question_code": c,
                "ratings": dict.fromkeys(DIMENSION_CODES, 2),
                "comment": "Name the result.",
            }
            for c in codes
        ]
    }


async def test_evaluation_sends_only_the_answers_and_fits_parse_evaluation(
    keyed: None, transport: Any
) -> None:
    seen = transport(lambda _r: _answer(_feedback(["Q1", "Q2"])))
    raw = await OpenAIEvaluationProvider(model_id=MODEL).evaluate(answers=ANSWERS)

    sent = json.loads(seen[0].content)
    assert "accent" in sent["instructions"] and "filler words" in sent["instructions"]
    assert "Maine galti ki" in sent["input"]
    items = sent["text"]["format"]["schema"]["properties"]["questions"]
    assert items["items"]["properties"]["question_code"]["enum"] == ["Q1", "Q2"]
    assert set(items["items"]["properties"]["ratings"]["required"]) == DIMENSION_CODES

    parsed = parse_evaluation(raw, question_codes=("Q1", "Q2"), dimension_codes=DIMENSION_CODES)
    assert [p.question_code for p in parsed] == ["Q1", "Q2"]


async def test_an_unusable_evaluation_is_left_for_parse_evaluation_to_refuse(
    keyed: None, transport: Any
) -> None:
    transport(lambda _r: _answer("{", status="completed"))
    assert await OpenAIEvaluationProvider(model_id=MODEL).evaluate(answers=ANSWERS) == {}


async def test_an_evaluation_outage_is_unavailable(keyed: None, transport: Any) -> None:
    transport(lambda _r: httpx.Response(503))
    with pytest.raises(EvaluationUnavailableError):
        await OpenAIEvaluationProvider(model_id=MODEL).evaluate(answers=ANSWERS)


# ---------------------------------------------------------------------------
# Sarvam transcription (batch job)
# ---------------------------------------------------------------------------
BLOB = "https://blob.example.net"


def _sarvam(*, task_state: str = "Success", transcript: Any = "maine rota fix kiya") -> Handler:
    polls = iter(["Running", "Completed"])

    def handle(request: httpx.Request) -> httpx.Response:
        path, host = request.url.path, request.url.host
        if host == "blob.example.net":
            if request.method == "PUT":
                return httpx.Response(201)
            return httpx.Response(200, json={"transcript": transcript, "language_code": "hi-IN"})
        if path == "/speech-to-text/job/v1":
            return httpx.Response(200, json={"job_id": "j1", "job_state": "Accepted"})
        if path.endswith("/upload-files"):
            return httpx.Response(
                200, json={"upload_urls": {"answer.webm": {"file_url": f"{BLOB}/in"}}}
            )
        if path.endswith("/start"):
            return httpx.Response(200, json={"job_id": "j1", "job_state": "Pending"})
        if path.endswith("/status"):
            return httpx.Response(
                200,
                json={
                    "job_state": next(polls),
                    "job_details": [
                        {
                            "state": task_state,
                            "inputs": [{"file_name": "answer.webm", "file_id": "0"}],
                            "outputs": [{"file_name": "0.json", "file_id": "0"}],
                        }
                    ],
                },
            )
        if path.endswith("/download-files"):
            return httpx.Response(
                200, json={"download_urls": {"0.json": {"file_url": f"{BLOB}/out"}}}
            )
        return httpx.Response(404)

    return handle


async def test_sarvam_runs_a_batch_job_and_returns_the_words_as_spoken(
    keyed: None, transport: Any
) -> None:
    seen = transport(_sarvam())
    heard = await sarvam.SarvamTranscriptionProvider().transcribe(
        audio=b"\x1a" * 5000, mime="audio/webm"
    )
    assert heard.text == "maine rota fix kiya" and heard.language == "hi-IN"

    created = json.loads(seen[0].content)["job_parameters"]
    assert created["mode"] == "codemix" and created["language_code"] == "unknown"
    for request in seen:
        keyed_request = "api-subscription-key" in request.headers
        # Our key goes to Sarvam's API and never to the signed storage URLs.
        assert keyed_request == (request.url.host == "api.sarvam.ai")


async def test_silence_is_an_empty_transcript(keyed: None, transport: Any) -> None:
    transport(_sarvam(transcript="  "))
    heard = await sarvam.SarvamTranscriptionProvider().transcribe(audio=b"x", mime="audio/webm")
    assert heard.text == ""


@pytest.mark.parametrize("handler", [_sarvam(task_state="API Error"), _sarvam(transcript=None)])
async def test_a_failed_job_is_unavailable_never_silence(
    keyed: None, transport: Any, handler: Handler
) -> None:
    transport(handler)
    with pytest.raises(EvaluationUnavailableError):
        await sarvam.SarvamTranscriptionProvider().transcribe(audio=b"x", mime="audio/webm")


# ---------------------------------------------------------------------------
# Sarvam text to speech -- the questions, read aloud (2026-10-16)
# ---------------------------------------------------------------------------
MP3 = bytes.fromhex("fff3c0c4") + bytes(400)


def _speech(response: httpx.Response) -> Handler:
    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/text-to-speech":
            return response
        return httpx.Response(404)

    return handle


async def test_sarvam_speaks_only_the_question_in_the_candidates_language(
    keyed: None, transport: Any
) -> None:
    seen = transport(
        _speech(httpx.Response(200, json={"audios": [base64.b64encode(MP3).decode()]}))
    )
    spoken = await sarvam.SarvamSpeechProvider().speak(
        text="Apne kaam ke baare mein bataiye.", language="hi"
    )
    assert spoken.audio == MP3 and spoken.mime == "audio/mpeg"

    [request] = seen
    assert request.method == "POST" and request.headers["api-subscription-key"] == "sv-test"
    assert json.loads(request.content) == {
        "text": "Apne kaam ke baare mein bataiye.",
        "language_code": "hi-IN",
        "model": "bulbul:v3",
        "speaker": "shubh",
        "output_audio_codec": "mp3",
    }, "the words and how to say them; nothing about the person"


@pytest.mark.parametrize(
    ("locale", "language"),
    [("en", "en-IN"), ("pa", "pa-IN"), ("te", "te-IN"), ("hi-IN", "hi-IN"), ("fr", "en-IN")],
)
def test_every_locale_is_spoken_in_its_own_language(locale: str, language: str) -> None:
    assert sarvam.tts_language(locale) == language


def test_every_locale_we_support_has_a_voice() -> None:
    from app.core.i18n import LOCALE_CODES

    assert {sarvam.tts_language(code) for code in LOCALE_CODES} == {
        f"{code}-IN" for code in LOCALE_CODES
    }


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(429, json={"error": "slow down"}),
        httpx.Response(200, json={"audios": []}),
        httpx.Response(200, json={"audios": ["not base64!"]}),
        httpx.Response(200, json={"audios": [""]}),
        httpx.Response(200, json={"request_id": "r"}),
    ],
)
async def test_speech_that_fails_or_comes_back_empty_is_unavailable(
    keyed: None, transport: Any, response: httpx.Response
) -> None:
    transport(_speech(response))
    with pytest.raises(QuestionAudioUnavailableError):
        await sarvam.SarvamSpeechProvider().speak(text="Tell me about your work.", language="en")


# ---------------------------------------------------------------------------
# Settings refuse a provider without what it needs
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        (
            {"scoring_extraction_enabled": True, "scoring_model_id": MODEL, "openai_api_key": None},
            "OPENAI_API_KEY",
        ),
        (
            {
                "interview_evaluation_provider": "openai",
                "interview_evaluation_model_id": "",
                "openai_api_key": "k",
            },
            "INTERVIEW_EVALUATION_MODEL_ID",
        ),
        ({"interview_transcription_provider": "sarvam", "sarvam_api_key": None}, "SARVAM_API_KEY"),
        (
            {"interview_question_speech_provider": "sarvam", "sarvam_api_key": None},
            "INTERVIEW_QUESTION_SPEECH_PROVIDER=sarvam needs SARVAM_API_KEY",
        ),
    ],
)
def test_a_provider_without_its_key_or_model_refuses_to_boot(
    overrides: dict[str, Any], message: str
) -> None:
    base = get_settings().model_dump()
    with pytest.raises(ValidationError, match=message):
        Settings(**{**base, **overrides})


@pytest.mark.parametrize("environment", ["staging", "prod"])
def test_the_silent_speaker_is_refused_where_candidates_are(environment: str) -> None:
    with pytest.raises(ValidationError, match="INTERVIEW_QUESTION_SPEECH_PROVIDER=stub"):
        Settings(
            environment=environment,  # type: ignore[arg-type]
            interview_question_speech_provider="stub",
            # Pinned, or the test environment's own stubs are refused first.
            interview_question_provider="openai",
            interview_transcription_provider="none",
            assistant_provider="openai",
            interview_evaluation_provider="none",
            openai_api_key="k",  # type: ignore[arg-type]
            payments_provider="none",
            database_url="postgresql+asyncpg://u:p@localhost/db",  # type: ignore[arg-type]
            redis_url="redis://localhost:6379/0",  # type: ignore[arg-type]
            auth_allow_local_tokens=False,
            cognito_candidate_pool_id="ap-south-1_x",
        )
