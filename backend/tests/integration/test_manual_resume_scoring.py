"""Blocker E6: a CV entered through the form is scored like an upload.

Before this, `score_confirmed_resume` refused any version without free text,
so a candidate who used the form never got a score -- and an
unscored candidate never reaches an employer. The form now renders to text and
takes the normal Layer 1 path. Layer 1 is stubbed; no test calls a model.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.scoring.domain import render_structured_resume
from app.modules.scoring.extractor import (
    PROMPT_VERSION,
    SCHEMA_VERSION,
    ExtractedResume,
    Extraction,
    prompt_hash,
)
from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration


class RecordingExtractor:
    model_id = "stub-model-1"

    def __init__(self) -> None:
        self.texts: list[str] = []

    async def extract(self, *, text: str) -> Extraction:
        self.texts.append(text)
        return Extraction(
            features=ExtractedResume.model_validate(
                {
                    "roles": [
                        {
                            "title": "Welder",
                            "employer": "L&T",
                            "months": 60,
                            "seniority_level": "mid",
                        }
                    ]
                }
            ),
            raw_response={"stub": True},
            model_id=self.model_id,
            prompt_version=PROMPT_VERSION,
            prompt_hash=prompt_hash(),
            schema_version=SCHEMA_VERSION,
        )


@pytest.fixture
def recorder(monkeypatch: pytest.MonkeyPatch) -> RecordingExtractor:
    from app.modules.scoring import service

    stub = RecordingExtractor()
    monkeypatch.setattr(service, "get_resume_extractor", lambda settings=None: stub)
    return stub


@pytest.fixture
async def candidate() -> uuid.UUID:
    user_id = uuid.uuid4()
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, status, locale) "
                "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "p": f"+9199{uuid.uuid4().int % 10**8:08d}"},
        )
    return user_id


def _form(marker: str) -> Any:
    from app.modules.resume.schemas import ManualEducation, ManualExperience, ManualResumeRequest

    return ManualResumeRequest(
        full_name="Ravi Kumar",
        headline=f"Certified welder {marker}",
        experience=[
            ManualExperience(
                employer="L&T",
                title="Welder",
                start_year=2019,
                end_year=2024,
                summary="Pipeline welds.",
            )
        ],
        education=[
            ManualEducation(institution="ITI Pune", qualification="ITI Welder", completed_year=2018)
        ],
        skills=["TIG welding", "MIG welding"],
    )


async def test_a_form_cv_is_scored_through_layer_1(
    candidate: uuid.UUID, recorder: RecordingExtractor
) -> None:
    from app.modules.resume import service as resume_service
    from app.modules.scoring import service as scoring_service

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        version = await resume_service.create_manual_version(
            session, user_id=candidate, payload=_form(str(uuid.uuid4()))
        )
    async with factory() as session, session.begin():
        await resume_service.confirm_version(
            session, user_id=candidate, resume_version_id=version.id
        )
    async with factory() as session, session.begin():
        result = await scoring_service.score_confirmed_resume(session, user_id=candidate)

    assert 700 <= result.raw_value <= 900
    [sent] = recorder.texts
    assert "Welder at L&T, 2019 to 2024" in sent
    assert "TIG welding" in sent


async def test_the_model_is_not_sent_the_name_or_the_graduation_year(
    candidate: uuid.UUID, recorder: RecordingExtractor
) -> None:
    """Data minimisation, and invariant 5: a completion year says nothing about
    ability and a great deal about age."""
    from app.modules.resume import service as resume_service
    from app.modules.scoring import service as scoring_service

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        version = await resume_service.create_manual_version(
            session, user_id=candidate, payload=_form(str(uuid.uuid4()))
        )
    async with factory() as session, session.begin():
        await resume_service.confirm_version(
            session, user_id=candidate, resume_version_id=version.id
        )
    async with factory() as session, session.begin():
        await scoring_service.score_confirmed_resume(session, user_id=candidate)

    [sent] = recorder.texts
    assert "Ravi Kumar" not in sent
    assert "2018" not in sent


def test_rendering_is_deterministic_because_the_cache_is_keyed_on_it() -> None:
    parsed = {
        "full_name": "Anyone",
        "headline": "Nurse",
        "experience": [
            {"employer": "AIIMS", "title": "Staff nurse", "start_year": 2020, "end_year": None}
        ],
        "education": [
            {"institution": "CMC", "qualification": "B.Sc Nursing", "completed_year": 2019}
        ],
        "skills": ["ICU care"],
    }
    assert render_structured_resume(parsed) == render_structured_resume(dict(parsed))
    assert "Staff nurse at AIIMS, 2020 to present" in render_structured_resume(parsed)


def test_an_empty_form_renders_nothing_and_is_not_scored() -> None:
    assert render_structured_resume({"full_name": "Only a name"}) == ""
    assert render_structured_resume({"experience": "garbage", "skills": [None, 3]}) == ""
