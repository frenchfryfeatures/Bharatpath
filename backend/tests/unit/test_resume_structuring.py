"""The display-only structured CV (`resume/structuring.py`), against a fake
transport. No test may call a model.

What matters: what we send (our strict schema, the CV as data, `store: false`),
that every failure is a stored status rather than an exception, and that the
document carries facts only -- no rating, nothing about age or family.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from pydantic import BaseModel, SecretStr

from app.core import openai_responses as oa
from app.modules.resume import structuring
from app.modules.resume.structuring import (
    STORED_KEY,
    StructuredResume,
    response_schema,
    structure_resume,
    structured_view,
)
from app.settings import Settings, get_settings

MODEL = "gpt-5.4-mini-2026-03-17"
CV = "Priya Sharma\npriya@example.com | linkedin.com/in/priya\nInfosys, Senior Developer, 2019-2024"

ANSWER: dict[str, Any] = {
    "full_name": "Priya Sharma",
    "headline": "Senior Developer",
    "location": "Bengaluru",
    "summary": "",
    "contacts": {
        "email": "mailto:priya@example.com",
        "phone": "+919876543210",
        "linkedin": "linkedin.com/in/priya",
        "github": "https://github.com/priya",
        "behance": "",
        "website": "priya.dev",
        "instagram": "",
        "tiktok": "",
        "pinterest": "",
        "x_twitter": "",
        "medium": "",
        "dev_to": "",
        "stack_overflow": "",
        "others": [{"label": "Kaggle", "url": "kaggle.com/priya"}],
    },
    "experience": [
        {
            "job_title": "Senior Developer",
            "company": "Infosys",
            "location": "Bengaluru",
            "employment_type": "Full-time",
            "start_date": "2019-04",
            "end_date": "2024-03",
            "is_current": False,
            "description": "",
            "highlights": ["Cut p99 latency by 40%"],
            "skills_used": ["Python"],
        }
    ],
    "education": [
        {
            "qualification": "B.Tech",
            "field_of_study": "Computer Science",
            "institution": "VIT Vellore",
            "location": "",
            "start_date": "2011",
            "end_date": "2015",
            "grade": "8.6 CGPA",
            "description": "",
        }
    ],
    "skills": ["Python", "PostgreSQL"],
    "projects": [],
    "certifications": [],
    "languages": [{"name": "Hindi", "proficiency": "Native"}],
    "achievements": [],
    "interests": ["Chess"],
    "other_sections": [
        {
            "heading": "Personal Details",
            "items": ["Marital status: Single", "Date of Birth: 01/01/1990", "Hobbies: trekking"],
        }
    ],
}


def _settings(**overrides: Any) -> Settings:
    return get_settings().model_copy(update=overrides)


@pytest.fixture
def keyed(monkeypatch: pytest.MonkeyPatch) -> Settings:
    fake = _settings(
        openai_api_key=SecretStr("sk-test"),
        resume_structuring_enabled=True,
        resume_structuring_model_id=MODEL,
    )
    monkeypatch.setattr(oa, "get_settings", lambda: fake)
    monkeypatch.setattr(structuring, "get_settings", lambda: fake)
    return fake


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

        monkeypatch.setattr(oa, "_transport", httpx.MockTransport(record))
        return seen

    yield install


def _answer(payload: Any) -> httpx.Response:
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return httpx.Response(
        200,
        json={
            "model": MODEL,
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
        },
    )


# --- the schema ------------------------------------------------------------
def _objects(node: Any) -> Iterator[dict[str, Any]]:
    if isinstance(node, dict):
        if node.get("type") == "object":
            yield node
        for value in node.values():
            yield from _objects(value)
    elif isinstance(node, list):
        for item in node:
            yield from _objects(item)


def test_every_object_in_the_schema_is_closed_and_fully_required() -> None:
    for node in _objects(response_schema()):
        assert node["additionalProperties"] is False
        assert sorted(node["required"]) == sorted(node["properties"])


def _field_names(model: type[BaseModel]) -> Iterator[str]:
    for name, info in model.model_fields.items():
        yield name
        for arg in getattr(info.annotation, "__args__", ()) or ():
            if isinstance(arg, type) and issubclass(arg, BaseModel):
                yield from _field_names(arg)
        if isinstance(info.annotation, type) and issubclass(info.annotation, BaseModel):
            yield from _field_names(info.annotation)


def test_the_document_carries_facts_and_never_a_judgement() -> None:
    """A rating here would explain the score (R11); an age field breaks
    invariant 5. Neither has a place in a view of what the CV says."""
    names = set(_field_names(StructuredResume))
    assert {"contacts", "experience", "education", "linkedin", "github"} <= names
    for name in names:
        for forbidden in ("score", "rating", "rank", "band", "seniority", "level", "age", "gender"):
            assert forbidden not in name.split("_"), name


# --- never raises -----------------------------------------------------------
async def test_without_a_key_nothing_is_sent(
    transport: Callable[[Handler], list[httpx.Request]],
) -> None:
    seen = transport(lambda _: _answer(ANSWER))
    result = await structure_resume(CV, settings=_settings(openai_api_key=None))
    assert result["status"] == "UNAVAILABLE"
    assert result["reason"] == "not_configured"
    assert result["data"] is None
    assert seen == []


async def test_switched_off_nothing_is_sent(
    keyed: Settings, transport: Callable[[Handler], list[httpx.Request]]
) -> None:
    seen = transport(lambda _: _answer(ANSWER))
    off = keyed.model_copy(update={"resume_structuring_enabled": False})
    result = await structure_resume(CV, settings=off)
    assert (result["status"], result["reason"]) == ("UNAVAILABLE", "disabled")
    assert seen == []


@pytest.mark.parametrize(
    ("response", "reason"),
    [
        (httpx.Response(500, json={"error": {"code": "server_error"}}), "unavailable:http_500"),
        (_answer("not json"), "invalid:not_json"),
        (_answer({**ANSWER, "invented_field": 1}), "invalid:schema"),
        (_answer({**ANSWER, "full_name": "x" * 301}), "invalid:schema"),
    ],
)
async def test_a_failure_is_a_status_never_an_exception(
    keyed: Settings,
    transport: Callable[[Handler], list[httpx.Request]],
    response: httpx.Response,
    reason: str,
) -> None:
    transport(lambda _: response)
    result = await structure_resume(CV, settings=keyed)
    assert result["status"] == "FAILED"
    assert result["reason"] == reason
    assert result["data"] is None


# --- what is sent and what is kept -------------------------------------------
async def test_the_cv_is_sent_as_data_under_our_schema(
    keyed: Settings, transport: Callable[[Handler], list[httpx.Request]]
) -> None:
    seen = transport(lambda _: _answer(ANSWER))
    result = await structure_resume(CV, settings=keyed)

    assert result["status"] == "READY"
    assert result["model_id"] == MODEL
    assert result["prompt_version"] == structuring.PROMPT_VERSION
    assert result["schema_version"] == structuring.SCHEMA_VERSION
    (request,) = seen
    body = json.loads(request.content)
    assert body["model"] == MODEL
    assert body["store"] is False
    assert body["input"] == CV
    assert body["text"]["format"]["schema"] == response_schema()
    assert "untrusted data" in body["instructions"]


async def test_links_become_full_urls_and_the_email_loses_mailto(
    keyed: Settings, transport: Callable[[Handler], list[httpx.Request]]
) -> None:
    transport(lambda _: _answer(ANSWER))
    contacts = (await structure_resume(CV, settings=keyed))["data"]["contacts"]
    assert contacts["email"] == "priya@example.com"
    assert contacts["linkedin"] == "https://linkedin.com/in/priya"
    assert contacts["github"] == "https://github.com/priya"
    assert contacts["website"] == "https://priya.dev"
    assert contacts["others"] == [{"label": "Kaggle", "url": "https://kaggle.com/priya"}]


async def test_personal_details_the_model_let_through_are_dropped(
    keyed: Settings, transport: Callable[[Handler], list[httpx.Request]]
) -> None:
    transport(lambda _: _answer(ANSWER))
    data = (await structure_resume(CV, settings=keyed))["data"]
    assert data["other_sections"] == [
        {"heading": "Personal Details", "items": ["Hobbies: trekking"]}
    ]
    assert data["experience"][0]["company"] == "Infosys"
    assert data["education"][0]["institution"] == "VIT Vellore"


# --- reading it back ----------------------------------------------------------
async def test_a_stored_document_reads_back_as_written(
    keyed: Settings, transport: Callable[[Handler], list[httpx.Request]]
) -> None:
    transport(lambda _: _answer(ANSWER))
    stored = await structure_resume(CV, settings=keyed)
    doc, status = structured_view({"raw_text": CV, STORED_KEY: stored})
    assert status == "READY"
    assert doc is not None and doc.full_name == "Priya Sharma"


def test_a_failed_document_reads_failed() -> None:
    parsed = {"raw_text": CV, STORED_KEY: {"status": "FAILED", "data": None}}
    assert structured_view(parsed) == (None, "FAILED")


def test_a_version_from_before_structuring_reads_unavailable() -> None:
    assert structured_view({"raw_text": CV}) == (None, "UNAVAILABLE")
    assert structured_view({}) == (None, "UNAVAILABLE")


def test_a_form_built_version_is_mapped_without_a_model() -> None:
    parsed = {
        "full_name": "Ravi Kumar",
        "headline": "Accountant",
        "experience": [
            {"employer": "TCS", "title": "Analyst", "start_year": 2018, "end_year": 2021},
            {"employer": "KPMG", "title": "Associate", "start_year": 2021, "end_year": None},
        ],
        "education": [{"institution": "DU", "qualification": "B.Com", "completed_year": 2018}],
        "skills": ["Tally"],
        "extractor": {"parser": "manual", "parser_version": "1"},
    }
    doc, status = structured_view(parsed)
    assert status == "READY"
    assert doc is not None
    assert [(e.company, e.start_date, e.end_date, e.is_current) for e in doc.experience] == [
        ("TCS", "2018", "2021", False),
        ("KPMG", "2021", "", True),
    ]
    assert doc.education[0].qualification == "B.Com"
    assert doc.skills == ["Tally"]
