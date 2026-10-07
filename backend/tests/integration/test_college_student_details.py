"""A college's widened view of a student (2026-09-29): sign-up details, the CV,
practice interviews, course progress and each application's stage.

Served **only under INDIVIDUAL consent to the words that name it** (version 2).
A student who agreed to version 1 keeps version 1's view until they agree
again, and agreeing again replaces the old grant rather than returning it.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions
from tests.integration.test_college import _college
from tests.integration.test_college_consent import (
    STUDENTS,
    _grant_individual,
    _linked_student,
    _revoke,
)
from tests.integration.test_payments import _scalar

pytestmark = pytest.mark.integration

OLD_WORDS = "placeholder-1-2026-09-17"


async def _as_migrator(sql: str, **params: Any) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(text(sql), {k: str(v) for k, v in params.items()})


async def _visible_student(client: Any, mint_token: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    college = await _college(client, mint_token)
    student = await _linked_student(client, mint_token, college)
    granted = await _grant_individual(client, student, college["tenant_id"])
    assert granted.status_code in (200, 201), granted.text
    return college, student


async def test_a_student_who_agreed_to_the_current_words_is_shown_in_full(
    client: Any, mint_token: Any
) -> None:
    college, student = await _visible_student(client, mint_token)
    await _as_migrator(
        "INSERT INTO questionnaire_responses (id, user_id, bank_version, answers) VALUES "
        "(gen_random_uuid(), :u, 'x', CAST(:a AS jsonb))",
        u=student["id"],
        a=json.dumps(
            {
                "SHIFT_WILLINGNESS": ["NIGHT"],
                "HAS_DRIVING_LICENCE": True,
                "ACCESSIBILITY_ADJUSTMENTS": "A ramp at the entrance.",
            }
        ),
    )
    details = await client.get(f"{STUDENTS}/{student['id']}/details", headers=college["headers"])
    assert details.status_code == 200, details.text
    body = details.json()
    assert body["phone"] == await _scalar("SELECT phone FROM users WHERE id = :u", u=student["id"])
    answers = {a["code"]: a["answer"] for a in body["questionnaire"]}
    assert answers == {"SHIFT_WILLINGNESS": "Night shift", "HAS_DRIVING_LICENCE": "Yes"}
    assert "ramp" not in details.text, "promised to employers applied to, and nobody else"
    assert body["interviews_completed"] == 0 and body["courses"] == []
    assert body["applications"] == [] and body["analytics"]["total"] == 0

    audited = await _scalar(
        "SELECT count(*) FROM audit_events WHERE action = 'college_student_viewed' "
        "AND target_id = :t AND metadata->>'view' = 'details'",
        t=student["id"],
    )
    assert audited == 1


async def test_a_student_on_the_earlier_words_keeps_the_narrower_view_until_they_agree_again(
    client: Any, mint_token: Any
) -> None:
    college = await _college(client, mint_token)
    student = await _linked_student(client, mint_token, college)
    await _as_migrator(
        "INSERT INTO student_consents (id, tenant_id, candidate_id, scope, granted_via, "
        "consent_version) VALUES (gen_random_uuid(), :t, :u, 'INDIVIDUAL', 'DIRECT', :v)",
        t=college["tenant_id"],
        u=student["id"],
        v=OLD_WORDS,
    )
    core = await client.get(f"{STUDENTS}/{student['id']}", headers=college["headers"])
    assert core.status_code == 200, "version 1's view is unchanged"
    refused = await client.get(f"{STUDENTS}/{student['id']}/details", headers=college["headers"])
    assert refused.status_code == 409
    assert refused.json()["code"] == "college_student_details_not_shared"
    resume = await client.get(f"{STUDENTS}/{student['id']}/resume", headers=college["headers"])
    assert resume.status_code == 409

    again = await _grant_individual(client, student, college["tenant_id"])
    assert again.status_code in (200, 201), again.text
    versions = await _scalar(
        "SELECT string_agg(consent_version || ':' || (revoked_at IS NULL)::text, ',' "
        "ORDER BY granted_at) FROM student_consents "
        "WHERE candidate_id = :u AND scope = 'INDIVIDUAL'",
        u=student["id"],
    )
    assert versions.startswith(f"{OLD_WORDS}:false,") and versions.endswith(":true")
    shown = await client.get(f"{STUDENTS}/{student['id']}/details", headers=college["headers"])
    assert shown.status_code == 200, shown.text


async def test_the_cv_is_its_own_audited_read_and_revocation_ends_it_at_once(
    client: Any, mint_token: Any
) -> None:
    college, student = await _visible_student(client, mint_token)
    missing = await client.get(f"{STUDENTS}/{student['id']}/resume", headers=college["headers"])
    assert missing.status_code == 404
    assert missing.json()["code"] == "college_student_resume_not_found"

    await _as_migrator(
        "INSERT INTO resume_versions (id, user_id, source, parsed, confirmed_at) VALUES "
        "(:v, :u, 'PASTE', CAST(:p AS jsonb), now())",
        v=uuid.uuid4(),
        u=student["id"],
        p=json.dumps({"raw_text": "Forklift operator, 2019-2024."}),
    )
    resume = await client.get(f"{STUDENTS}/{student['id']}/resume", headers=college["headers"])
    assert resume.status_code == 200, resume.text
    assert resume.json()["text"] == "Forklift operator, 2019-2024."
    assert resume.json()["file_url"] is None
    assert resume.json()["structured_status"] == "UNAVAILABLE", "made before structuring"
    assert resume.json()["structured_resume"] is None
    assert (
        await _scalar(
            "SELECT count(*) FROM audit_events WHERE action = 'college_student_resume_opened' "
            "AND target_id = :t",
            t=student["id"],
        )
        == 1
    )

    revoked = await _revoke(client, student, college["tenant_id"], "INDIVIDUAL")
    assert revoked.status_code == 200, revoked.text
    for part in ("details", "resume"):
        gone = await client.get(f"{STUDENTS}/{student['id']}/{part}", headers=college["headers"])
        assert gone.status_code == 404, part


async def test_another_college_sees_nothing(client: Any, mint_token: Any) -> None:
    _, student = await _visible_student(client, mint_token)
    other = await _college(client, mint_token)
    for part in ("details", "resume"):
        response = await client.get(f"{STUDENTS}/{student['id']}/{part}", headers=other["headers"])
        assert response.status_code == 404, part


async def test_the_cohort_funnel_is_floored_like_every_aggregate(
    client: Any, mint_token: Any
) -> None:
    from app.modules.analytics.domain import APPLICATION_MILESTONES, APPLICATION_STAGES
    from tests.integration.test_college import _code
    from tests.integration.test_college_consent import _seed_student

    college = await _college(client, mint_token)
    code = await _code(client, college)
    url = "/api/v1/college/analytics/applications"

    small = (await client.get(url, headers=college["headers"])).json()
    assert small["below_floor"] and small["total_applications"] is None
    assert set(small["by_stage"]) == set(APPLICATION_STAGES)
    assert set(small["reached"]) == set(APPLICATION_MILESTONES)
    assert set(small["by_stage"].values()) == {None}

    for _ in range(small["min_cohort_size"]):
        await _seed_student(college, code["id"])
    counted = (await client.get(url, headers=college["headers"])).json()
    assert counted["below_floor"] is False and counted["total_applications"] == 0
    assert set(counted["by_stage"].values()) == {0}
    assert "candidate" not in str(counted), "no identifier in an aggregate"


async def test_the_college_sees_the_structured_cv_beside_the_text(
    client: Any, mint_token: Any
) -> None:
    college, student = await _visible_student(client, mint_token)
    document = {"full_name": "Asha Rao", "experience": [{"job_title": "Forklift operator"}]}
    await _as_migrator(
        "INSERT INTO resume_versions (id, user_id, source, parsed, confirmed_at) VALUES "
        "(:v, :u, 'PASTE', CAST(:p AS jsonb), now())",
        v=uuid.uuid4(),
        u=student["id"],
        p=json.dumps(
            {
                "raw_text": "Asha Rao. Forklift operator, 2019-2024.",
                "extractor": {"name": "paste"},
                "structured_resume": {"status": "READY", "data": document},
            }
        ),
    )
    resume = await client.get(f"{STUDENTS}/{student['id']}/resume", headers=college["headers"])
    assert resume.status_code == 200, resume.text
    body = resume.json()
    assert body["structured_status"] == "READY"
    assert body["structured_resume"]["experience"][0]["job_title"] == "Forklift operator"
    assert body["text"] == "Asha Rao. Forklift operator, 2019-2024."
    assert body["fields"] == {}
