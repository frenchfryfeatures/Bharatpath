"""The posting's long form (`jobs.details`) through HTTP.

What an employer writes is what they read back; a candidate reads a narrower
projection; a posting cannot ask for age or gender; and only PUBLIC jobs are
listed on the board.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from tests.integration.test_candidate_marketplace import BOARD, _board_ids, _candidate, _employer
from tests.integration.test_candidate_marketplace import _job as _board_job

pytestmark = pytest.mark.integration

JOBS = "/api/v1/employer/jobs"

DETAILS: dict[str, Any] = {
    "basics": {
        "job_type": "FULL_TIME",
        "employment_type": "PERMANENT",
        "department": "Engineering - Software & QA",
        "category": "Software Development",
        "industry": "IT Services & Consulting",
        "openings": 3,
    },
    "location": {"additional_locations": ["Bengaluru"], "relocation_assistance": True},
    "compensation": {
        "experience_max_months": 60,
        "period": "MONTHLY",
        "salary_type": "FIXED_PLUS_VARIABLE",
        "disclosed": True,
        "negotiable": True,
    },
    "content": {
        "responsibilities": ["Design and build backend services."],
        "required_qualifications": ["Two years building web services."],
        "preferred_qualifications": ["Experience with Postgres."],
        "nice_to_have_skills": ["Docker"],
        "benefits": ["Health insurance"],
    },
    "skills": {
        "preferred": ["FastAPI"],
        "tools": ["Git"],
        "primary": "Python",
        "experience": [{"skill": "Python", "years": 2}],
    },
    "education": {
        "minimum": "GRADUATE",
        "ug_qualification": "B.Tech/B.E.",
        "ug_specialization": "Computers",
        "pg_qualification": "",
        "pg_specialization": "",
        "certifications": [],
    },
    "requirements": {
        "languages": ["English", "Hindi"],
        "notice_period": "30_DAYS",
        "work_authorization": "Authorised to work in India",
        "relocation": "PREFERRED",
    },
    "application": {
        "deadline": "2030-01-31",
        "method": "BHARATPATH",
        "email": "",
        "external_url": "",
        "resume_required": True,
        "cover_letter_required": False,
        "portfolio_required": True,
    },
    "screening_questions": [
        {
            "question": "Can you join within 30 days?",
            "type": "YES_NO",
            "options": [],
            "mandatory": True,
            "knockout": True,
            "accepted_answers": ["Yes"],
        }
    ],
    "hiring": {
        "hiring_manager": "Asha Rao",
        "interview_rounds": ["Technical", "HR"],
        "timeline": "WITHIN_1_MONTH",
        "priority": "URGENT",
        "expected_joining_date": "2030-03-01",
    },
    "settings": {
        "visibility": "PUBLIC",
        "featured": True,
        "allow_referrals": True,
        "applicant_access": "HIRING_TEAM",
        "publish_on": None,
    },
}


def _job_body(**overrides: Any) -> dict[str, Any]:
    return {
        "title": "Backend Engineer II",
        "description": "Build and run the services behind our hiring platform.",
        "skills": ["Python", "SQL"],
        "location": "Pune",
        "work_mode": "HYBRID",
        "experience_min_months": 24,
        "salary_min_minor": 5_000_000,
        "salary_max_minor": 8_000_000,
        "details": DETAILS,
        **overrides,
    }


def _with(section: str, **values: Any) -> dict[str, Any]:
    return {**DETAILS, section: {**DETAILS[section], **values}}


async def test_an_employer_reads_back_every_detail_they_wrote(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    created = await client.post(JOBS, json=_job_body(), headers=employer["headers"])
    assert created.status_code == 201, created.text
    assert created.json()["details"] == DETAILS

    read = await client.get(f"{JOBS}/{created.json()['id']}", headers=employer["headers"])
    assert read.json()["details"] == DETAILS


async def test_a_job_without_details_reads_as_every_default(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    body = _job_body()
    del body["details"]
    created = await client.post(JOBS, json=body, headers=employer["headers"])
    assert created.status_code == 201, created.text
    details = created.json()["details"]
    assert details["settings"]["visibility"] == "PUBLIC"
    assert details["application"]["method"] == "BHARATPATH"
    assert details["screening_questions"] == []


@pytest.mark.parametrize("smuggled", ["minimum_age", "maximum_age", "gender"])
async def test_a_job_cannot_ask_for_age_or_gender(
    client: Any, mint_token: Any, smuggled: str
) -> None:
    """Invariant 5, and the same discrimination the questionnaire refuses."""
    employer = await _employer(client, mint_token)
    for details in (
        {**DETAILS, smuggled: "x"},
        _with("requirements", **{smuggled: "x"}),
    ):
        response = await client.post(
            JOBS, json=_job_body(details=details), headers=employer["headers"]
        )
        assert response.status_code == 422, response.text


@pytest.mark.parametrize(
    "details",
    [
        _with("application", method="EXTERNAL", external_url=""),
        _with("application", external_url="http://example.com/apply"),
        _with("application", external_url="javascript:alert(1)"),
        _with("application", email="not-an-email"),
        _with("compensation", experience_max_months=12),
        _with("skills", primary="Rust"),
        _with("basics", openings=0),
        {
            **DETAILS,
            "screening_questions": [
                {"question": "Pick one", "type": "SINGLE_CHOICE", "options": ["Only"]}
            ],
        },
        {
            **DETAILS,
            "screening_questions": [
                {
                    "question": "Describe a project",
                    "type": "SHORT_ANSWER",
                    "knockout": True,
                    "accepted_answers": ["Yes"],
                }
            ],
        },
        {
            **DETAILS,
            "screening_questions": [
                {
                    "question": "Can you relocate?",
                    "type": "YES_NO",
                    "knockout": True,
                    "accepted_answers": ["Maybe"],
                }
            ],
        },
    ],
)
async def test_an_inconsistent_posting_is_refused(
    client: Any, mint_token: Any, details: dict[str, Any]
) -> None:
    employer = await _employer(client, mint_token)
    response = await client.post(JOBS, json=_job_body(details=details), headers=employer["headers"])
    assert response.status_code == 422, response.text


async def test_an_edit_is_checked_against_the_merged_values(client: Any, mint_token: Any) -> None:
    """Dropping the primary skill from the required skills, without resending
    the details that name it, still contradicts the posting."""
    employer = await _employer(client, mint_token)
    job = (await client.post(JOBS, json=_job_body(), headers=employer["headers"])).json()

    response = await client.patch(
        f"{JOBS}/{job['id']}", json={"skills": ["SQL"]}, headers=employer["headers"]
    )
    assert response.status_code == 422
    assert response.json()["code"] == "job_details_invalid"

    replaced = _with("skills", primary="SQL")
    response = await client.patch(
        f"{JOBS}/{job['id']}",
        json={"skills": ["SQL"], "details": replaced},
        headers=employer["headers"],
    )
    assert response.status_code == 200, response.text
    assert response.json()["details"]["skills"]["primary"] == "SQL"

    cleared = await client.patch(
        f"{JOBS}/{job['id']}", json={"details": None}, headers=employer["headers"]
    )
    assert cleared.status_code == 422


async def test_a_candidate_reads_the_posting_without_the_employers_internals(
    client: Any, mint_token: Any
) -> None:
    employer = await _employer(client, mint_token)
    job = await _board_job(client, employer, **_job_body())
    candidate = await _candidate(mint_token, scored=False)

    response = await client.get(f"{BOARD}/{job['id']}", headers=candidate["headers"])
    assert response.status_code == 200, response.text
    details = response.json()["details"]

    assert "screening_questions" not in details
    assert "settings" not in details
    assert "hiring_manager" not in details["hiring"]
    assert details["featured"] is True
    assert details["hiring"]["interview_rounds"] == ["Technical", "HR"]
    assert details["content"] == DETAILS["content"]
    assert details["basics"]["openings"] == 3
    assert "Asha Rao" not in response.text
    assert "accepted_answers" not in response.text


async def test_an_undisclosed_salary_is_flagged_on_the_board(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    marker = f"Undisclosed{uuid.uuid4().hex[:8]}"
    job = await _board_job(
        client,
        employer,
        **_job_body(title=marker, details=_with("compensation", disclosed=False)),
    )
    candidate = await _candidate(mint_token, scored=False)

    listed = await client.get(BOARD, params={"q": marker}, headers=candidate["headers"])
    [item] = listed.json()["items"]
    assert item["id"] == job["id"]
    assert item["salary_disclosed"] is False


@pytest.mark.parametrize("visibility", ["PRIVATE", "INVITE_ONLY"])
async def test_only_public_jobs_are_listed_on_the_board(
    client: Any, mint_token: Any, visibility: str
) -> None:
    employer = await _employer(client, mint_token)
    marker = f"Unlisted{uuid.uuid4().hex[:8]}"
    public = await _board_job(client, employer, **_job_body(title=f"{marker} public"))
    hidden = await _board_job(
        client,
        employer,
        **_job_body(title=f"{marker} hidden", details=_with("settings", visibility=visibility)),
    )
    candidate = await _candidate(mint_token, scored=False)

    listed = await _board_ids(client, candidate, q=marker)
    assert public["id"] in listed
    assert hidden["id"] not in listed

    # Unlisted, not hidden: the link an employer shares still opens it.
    opened = await client.get(f"{BOARD}/{hidden['id']}", headers=candidate["headers"])
    assert opened.status_code == 200, opened.text
