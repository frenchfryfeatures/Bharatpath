"""The console's full candidate page (2026-09-29): onboarding details, the CV,
how the score moved, interviews and their recordings, the course, and every
application with its stage -- each an audited reveal of its own."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.modules.candidate.career import CareerDetails, form_fields
from app.modules.scoring.domain import band_for, display_value
from tests.integration.test_admin_console import _audit_rows, _scalar, _staff
from tests.integration.test_pipeline import _applied, _walk

pytestmark = pytest.mark.integration

ADMIN = "/api/v1/admin"


async def _page(client: Any, staff: dict[str, Any], user_id: Any, part: str) -> Any:
    return await client.get(f"{ADMIN}/candidates/{user_id}/{part}", headers=staff["headers"])


@pytest.mark.parametrize("complete", [False, True])
async def test_saved_career_is_revealed_only_to_staff_and_the_read_is_audited(
    client: Any, mint_token: Any, complete: bool
) -> None:
    headers, _ = mint_token(email=f"career-admin-{uuid.uuid4().hex[:12]}@example.test")
    identity = await client.get("/api/v1/auth/me", headers=headers)
    assert identity.status_code == 200, identity.text
    candidate_id = identity.json()["user_id"]
    name = await client.put(
        "/api/v1/candidate/profile/name", headers=headers, json={"full_name": "Kavya Iyer"}
    )
    assert name.status_code == 200, name.text
    details = CareerDetails(
        phone="+919876543210",
        work_status="EXPERIENCED",
        currently_employed="YES",
        experience_years=3,
        experience_months=6,
        company_name="Example Technologies",
        job_title="Software Engineer",
        current_city="Pune",
        employment_start="2023-01",
        annual_salary=0,
        notice_period="30_DAYS",
        key_skills=["Python", "SQL"],
        industry="Information Technology",
        department="Engineering",
        role_category="Development",
        job_role="Backend Developer",
        highest_qualification="Graduate",
        course="Computer Science",
        course_type="FULL_TIME",
        specialization="Computer Science",
        specialization_name="Artificial Intelligence",
        institution="Example University",
        starting_year=2018,
        passing_year=2021,
        headline="Backend developer",
        preferred_locations=["Pune", "Bengaluru"],
        preferred_salary=1200000,
        gender="PREFER_NOT_TO_SAY",
    ).model_dump(mode="json")
    saved = await client.put(
        "/api/v1/candidate/profile/details",
        headers=headers,
        json={"details": details, "complete": complete},
    )
    assert saved.status_code == 200, saved.text
    staff = await _staff(mint_token)
    response = await _page(client, staff, candidate_id, "onboarding")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["career"]["details"] == details
    assert body["career"]["completed"] is complete
    assert body["career"]["updated_at"]
    assert body["career_fields"] == form_fields()
    assert body["phone"] == details["phone"], "use the mobile entered in onboarding"
    assert "password" not in str(body).lower()
    assert await _audit_rows("admin_candidate_drilldown", staff["user_id"], candidate_id) == 1

    reviewer = await _staff(mint_token, role="INTEGRITY_REVIEWER")
    assert (await _page(client, reviewer, candidate_id, "onboarding")).status_code == 403
    assert (
        await client.get(f"{ADMIN}/candidates/{candidate_id}/onboarding", headers=headers)
    ).status_code == 403
    assert (await client.get(f"{ADMIN}/candidates/{candidate_id}/onboarding")).status_code == 401
    assert await _audit_rows("admin_candidate_drilldown", reviewer["user_id"], candidate_id) == 0


async def test_older_candidate_has_no_career_but_keeps_existing_contact(
    client: Any, mint_token: Any
) -> None:
    phone = f"+91{6000000000 + uuid.uuid4().int % 4000000000}"
    headers, _ = mint_token(phone=phone)
    identity = await client.get("/api/v1/auth/me", headers=headers)
    assert identity.status_code == 200, identity.text
    staff = await _staff(mint_token)
    response = await _page(client, staff, identity.json()["user_id"], "onboarding")
    assert response.status_code == 200, response.text
    assert response.json()["career"] is None
    assert response.json()["phone"] == phone
    assert response.json()["career_fields"] == form_fields()


async def test_the_page_shows_every_part_and_audits_each_open(client: Any, mint_token: Any) -> None:
    a = await _applied(client, mint_token)
    await _walk(client, a, "VIEWED", "SHORTLISTED", "INTERVIEW")
    candidate_id = a["candidate"]["id"]
    staff = await _staff(mint_token)

    onboarding = await _page(client, staff, candidate_id, "onboarding")
    assert onboarding.status_code == 200, onboarding.text
    assert onboarding.json()["phone"] == await _scalar(
        "SELECT phone FROM users WHERE id = :u", u=candidate_id
    ), "the one console view with the whole contact"

    resume = await _page(client, staff, candidate_id, "resume")
    assert resume.status_code == 200, resume.text
    latest = resume.json()["latest"]
    assert latest["confirmed_at"] is not None and (latest["text"] or latest["fields"])

    timeline = (await _page(client, staff, candidate_id, "score-timeline")).json()
    [first, *_] = timeline["points"]
    stored = await _scalar(
        "SELECT raw_value FROM scores WHERE user_id = :u ORDER BY computed_at, id LIMIT 1",
        u=candidate_id,
    )
    assert first["display_value"] == display_value(int(stored))
    assert first["band"] == band_for(display_value(int(stored)))
    assert first["cause"] == "FIRST_SCORE" and first["change"] is None

    applications = (await _page(client, staff, candidate_id, "applications")).json()
    [row] = applications["items"]
    assert row["id"] == a["id"] and row["stage"] == "INTERVIEW"
    assert row["employer_name"] and row["job_title"]
    analytics = applications["analytics"]
    assert analytics["total"] == 1 and analytics["open"] == 1
    assert analytics["by_stage"]["INTERVIEW"] == 1
    assert analytics["reached"]["SHORTLISTED"] == 1 and analytics["reached"]["INTERVIEW"] == 1

    assert (await _page(client, staff, candidate_id, "interviews")).json() == []
    courses = (await _page(client, staff, candidate_id, "courses")).json()
    assert all(not c["purchased"] for c in courses)

    assert await _audit_rows("admin_candidate_resume_opened", staff["user_id"], candidate_id) == 1
    views = await _scalar(
        "SELECT count(*) FROM audit_events WHERE action = 'admin_candidate_drilldown' "
        "AND actor_id = :u AND target_id = :t",
        u=staff["user_id"],
        t=candidate_id,
    )
    assert views == 5, "onboarding, timeline, applications, interviews, courses"


async def test_the_integrity_reviewer_reads_the_cv_but_not_the_contact_or_the_voice(
    client: Any, mint_token: Any
) -> None:
    a = await _applied(client, mint_token)
    reviewer = await _staff(mint_token, role="INTEGRITY_REVIEWER")
    candidate_id = a["candidate"]["id"]
    assert (await _page(client, reviewer, candidate_id, "resume")).status_code == 200
    assert (await _page(client, reviewer, candidate_id, "onboarding")).status_code == 403
    recordings = await _page(client, reviewer, candidate_id, f"interviews/{a['id']}/recordings")
    assert recordings.status_code == 403


async def test_an_unknown_candidate_is_a_404_on_every_part(client: Any, mint_token: Any) -> None:
    import uuid

    staff = await _staff(mint_token)
    nobody = uuid.uuid4()
    for part in ("onboarding", "resume", "score-timeline", "interviews", "courses", "applications"):
        response = await _page(client, staff, nobody, part)
        assert response.status_code == 404, (part, response.text)
    recordings = await _page(client, staff, nobody, f"interviews/{uuid.uuid4()}/recordings")
    assert recordings.status_code == 404
