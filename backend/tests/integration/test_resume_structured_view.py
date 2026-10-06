"""The structured CV, end to end against Postgres: written when a version is
created, read back on the review screen and the profile preview, and never
in the way of the text that is scored.

The model is a fake transport (`openai_responses._transport`); no test calls one.
"""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import text

from app.core import openai_responses as oa
from app.modules.resume import structuring
from app.modules.resume.structuring import STORED_KEY
from app.settings import get_settings
from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration

PASTED = (
    "Priya Sharma - Senior Backend Engineer, Bengaluru\n"
    "priya@example.com | github.com/priya\n"
    "Infosys, Senior Developer, 2019 to 2024\n"
    "B.Tech Computer Science, VIT Vellore, 2015"
)
CORRECTED = PASTED.replace("Senior Developer", "Principal Developer")


def _document(job_title: str) -> dict[str, Any]:
    doc = structuring.StructuredResume(
        full_name="Priya Sharma",
        contacts=structuring.ResumeContacts(email="priya@example.com", github="github.com/priya"),
        experience=[structuring.ResumeExperience(job_title=job_title, company="Infosys")],
        education=[structuring.ResumeEducation(qualification="B.Tech", institution="VIT")],
    )
    return doc.model_dump(mode="json")


@pytest.fixture
async def candidate() -> uuid.UUID:
    user_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, cognito_sub, pool, phone, status, locale) "
                "VALUES (:id, :sub, 'CANDIDATE', :phone, 'ACTIVE', 'en')"
            ),
            {
                "id": str(user_id),
                "sub": f"local|{user_id}",
                "phone": f"+9199{uuid.uuid4().int % 10**8:08d}",
            },
        )
    return user_id


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """A keyed model that answers with a document naming the job title it
    finds in the CV, so an edit visibly re-structures."""
    fake = get_settings().model_copy(
        update={"openai_api_key": SecretStr("sk-test"), "resume_structuring_enabled": True}
    )
    monkeypatch.setattr(oa, "get_settings", lambda: fake)
    monkeypatch.setattr(structuring, "get_settings", lambda: fake)
    inputs: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        cv = json.loads(request.content)["input"]
        inputs.append(cv)
        title = "Principal Developer" if "Principal" in cv else "Senior Developer"
        output = [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": json.dumps(_document(title))}],
            }
        ]
        return httpx.Response(200, json={"status": "completed", "output": output})

    monkeypatch.setattr(oa, "_transport", httpx.MockTransport(answer))
    return inputs


async def _paste(user_id: uuid.UUID) -> Any:
    from app.modules.resume import service

    async with sessions(_seed_url())() as session, session.begin():
        return await service.create_pasted_version(session, user_id=user_id, text=PASTED)


async def _review(user_id: uuid.UUID, version_id: uuid.UUID) -> Any:
    from app.modules.resume.router import review_version

    async with sessions(_seed_url())() as session:
        return await review_version(version_id, SimpleNamespace(user_id=user_id), session)


async def test_a_pasted_cv_is_structured_beside_its_text(
    candidate: uuid.UUID, model: list[str]
) -> None:
    row = await _paste(candidate)

    assert row.parsed["raw_text"] == PASTED, "the scored text is untouched"
    stored = row.parsed[STORED_KEY]
    assert stored["status"] == "READY"
    assert stored["data"]["experience"][0]["job_title"] == "Senior Developer"
    assert model[-1] == PASTED


async def test_the_review_screen_returns_the_structured_document_once(
    candidate: uuid.UUID, model: list[str]
) -> None:
    row = await _paste(candidate)
    response = await _review(candidate, row.id)

    assert response.structured_status == "READY"
    assert response.structured_resume.contacts.github == "https://github.com/priya"
    assert response.structured_resume.education[0].institution == "VIT"
    assert STORED_KEY not in response.parsed
    assert response.parsed["raw_text"] == PASTED
    assert response.sections, "the sections view is still there"


async def test_an_edit_is_structured_from_the_corrected_text(
    candidate: uuid.UUID, model: list[str]
) -> None:
    from app.modules.resume import service
    from app.modules.resume.schemas import ResumeEditRequest

    row = await _paste(candidate)
    async with sessions(_seed_url())() as session, session.begin():
        edited = await service.edit_version(
            session,
            user_id=candidate,
            resume_version_id=row.id,
            payload=ResumeEditRequest(text=CORRECTED),
        )

    response = await _review(candidate, edited.id)
    assert response.structured_resume.experience[0].job_title == "Principal Developer"
    assert edited.confirmed_at is None


async def test_the_profile_preview_carries_it_too(candidate: uuid.UUID, model: list[str]) -> None:
    from app.modules.resume import service

    row = await _paste(candidate)
    async with sessions(_seed_url())() as session:
        preview = await service.profile_resume_preview(
            session, user_id=candidate, resume_version_id=row.id
        )

    assert preview["text"] == PASTED
    assert preview["structured_status"] == "READY"
    assert preview["structured_resume"]["full_name"] == "Priya Sharma"


async def test_without_a_model_the_version_is_still_created(candidate: uuid.UUID) -> None:
    """Best effort: no key (as in CI) means no structured view, never no CV."""
    row = await _paste(candidate)
    assert row.parsed["raw_text"] == PASTED
    assert row.parsed[STORED_KEY]["status"] == "UNAVAILABLE"

    response = await _review(candidate, row.id)
    assert response.structured_status == "UNAVAILABLE"
    assert response.structured_resume is None
    assert response.sections
