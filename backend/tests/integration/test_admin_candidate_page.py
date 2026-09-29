"""The console's full candidate page (2026-09-29): onboarding details, the CV,
how the score moved, interviews and their recordings, the course, and every
application with its stage -- each an audited reveal of its own."""

from __future__ import annotations

from typing import Any

import pytest

from app.modules.scoring.domain import band_for, display_value
from tests.integration.test_admin_console import _audit_rows, _scalar, _staff
from tests.integration.test_pipeline import _applied, _walk

pytestmark = pytest.mark.integration

ADMIN = "/api/v1/admin"


async def _page(client: Any, staff: dict[str, Any], user_id: Any, part: str) -> Any:
    return await client.get(f"{ADMIN}/candidates/{user_id}/{part}", headers=staff["headers"])


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
