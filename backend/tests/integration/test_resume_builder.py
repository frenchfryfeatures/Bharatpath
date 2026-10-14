"""The resume builder through HTTP, with S3 faked (2026-10-13).

A candidate answers the onboarding questions, opens the builder, gets a first
draft filled in from those answers, edits it, previews it, downloads it and
makes it their resume -- all before paying, and with nothing scored until
they pay and confirm. Then the console's follow-up list: who downloaded and
did not pay, with the number to call.
"""

from __future__ import annotations

import base64
import io
import uuid
from typing import Any

import pypdf
import pytest
from sqlalchemy import text

from app.modules.admin.domain import lead_stage
from app.modules.resume_builder import domain
from app.modules.scoring.domain import render_structured_resume
from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _find, _staff
from tests.integration.test_candidate_marketplace import _candidate, _employer, _subscribe
from tests.integration.test_profile_images import FakeImageS3

pytestmark = pytest.mark.integration

API = "/api/v1"
BUILDER = f"{API}/candidate/resume-builder"
DRAFT = f"{BUILDER}/draft"
DETAILS = f"{API}/candidate/profile/details"
VERSIONS = f"{API}/candidate/resume/versions"
LEADS = f"{API}/admin/leads"

ANSWERS: dict[str, Any] = {
    "phone": "+919876543210",
    "work_status": "EXPERIENCED",
    "currently_employed": "YES",
    "experience_years": 3,
    "company_name": "Reliance Retail",
    "job_title": "Data Analyst",
    "employment_start": "2022-07",
    "current_city": "Pune",
    "key_skills": ["SQL", "Power BI"],
    "highest_qualification": "Graduation",
    "course": "B.Com",
    "course_type": "FULL_TIME",
    "institution": "Fergusson College",
    "starting_year": 2018,
    "passing_year": 2021,
    "gender": "FEMALE",
    "annual_salary": 900000,
}


@pytest.fixture
def s3(monkeypatch: pytest.MonkeyPatch) -> FakeImageS3:
    from app.core import storage

    fake = FakeImageS3()
    for name in ("put_object", "presign_get", "delete_object", "read_whole_object"):
        monkeypatch.setattr(storage, name, getattr(fake, name))
    return fake


async def _onboarded(client: Any, mint_token: Any, *, answers: bool = True) -> dict[str, Any]:
    """A candidate who signed up, gave a name and an email, and (by default)
    answered the onboarding questions. Not scored, not paying."""
    me = await _candidate(mint_token, scored=False, subscribed=False)
    email = f"builder-{uuid.uuid4().hex[:10]}@example.test"
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text("UPDATE users SET email = :e WHERE id = :u"), {"e": email, "u": str(me["id"])}
        )
    me["email"] = email
    named = await client.put(
        f"{API}/candidate/profile/name", json={"full_name": "Priya Sharma"}, headers=me["headers"]
    )
    assert named.status_code == 200, named.text
    if answers:
        saved = await client.put(
            DETAILS, json={"details": ANSWERS, "complete": False}, headers=me["headers"]
        )
        assert saved.status_code == 200, saved.text
    return me


async def _fill(client: Any, me: dict[str, Any], **content: Any) -> dict[str, Any]:
    """Open the builder, add to the first draft, save it."""
    first = await client.get(DRAFT, headers=me["headers"])
    assert first.status_code == 200, first.text
    draft = {**first.json()["content"], **content}
    saved = await client.put(
        DRAFT, json={"template_key": "modern", "content": draft}, headers=me["headers"]
    )
    assert saved.status_code == 200, saved.text
    body: dict[str, Any] = saved.json()
    return body


async def _parsed(version_id: str) -> tuple[str, dict[str, Any], Any]:
    async with sessions(_seed_url())() as session:
        row = (
            await session.execute(
                text("SELECT source, parsed, confirmed_at FROM resume_versions WHERE id = :v"),
                {"v": version_id},
            )
        ).one()
    return row.source, row.parsed, row.confirmed_at


# ---------------------------------------------------------------------------
# The draft
# ---------------------------------------------------------------------------
async def test_the_first_draft_is_filled_in_from_the_answers_and_not_stored(
    client: Any, mint_token: Any
) -> None:
    me = await _onboarded(client, mint_token)
    response = await client.get(DRAFT, headers=me["headers"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["saved"] is False
    assert body["template_key"] == domain.DEFAULT_TEMPLATE
    content = body["content"]
    assert content["full_name"] == "Priya Sharma"
    assert content["contacts"]["email"] == me["email"]
    assert content["contacts"]["phone"] == "+919876543210"
    assert content["experience"][0]["company"] == "Reliance Retail"
    assert content["education"][0]["institution"] == "Fergusson College"
    assert "FEMALE" not in str(content) and "900000" not in str(content)

    again = await client.get(DRAFT, headers=me["headers"])
    assert again.json()["saved"] is False  # reading never writes


async def test_saving_stores_it_and_edits_never_reach_the_profile(
    client: Any, mint_token: Any
) -> None:
    me = await _onboarded(client, mint_token)
    saved = await _fill(client, me, summary="Three years of retail analytics.", skills=["SQL"])
    assert saved["saved"] is True
    assert saved["content"]["summary"] == "Three years of retail analytics."
    assert saved["download_count"] == 0

    profile = await client.get(DETAILS, headers=me["headers"])
    assert profile.json()["details"]["key_skills"] == ["SQL", "Power BI"]

    reset = await client.post(f"{DRAFT}/reset", headers=me["headers"])
    assert reset.status_code == 200, reset.text
    assert reset.json()["template_key"] == "modern"  # kept
    assert reset.json()["content"]["skills"] == ["SQL", "Power BI"]
    assert reset.json()["content"]["summary"] == ""


@pytest.mark.parametrize(
    ("content", "code"),
    [
        (
            {"other_sections": [{"heading": "Personal", "items": ["Date of birth: 2000"]}]},
            "resume_builder_personal_detail",
        ),
        ({"experience": [{"start_date": "2022/07"}]}, "resume_builder_invalid_date"),
        ({"summary": "x" * 4_900, "achievements": ["y" * 4_900] * 8}, "resume_builder_too_long"),
    ],
)
async def test_what_a_draft_may_not_say(
    client: Any, mint_token: Any, content: dict[str, Any], code: str
) -> None:
    me = await _onboarded(client, mint_token, answers=False)
    response = await client.put(
        DRAFT, json={"template_key": "classic", "content": content}, headers=me["headers"]
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == code


async def test_only_a_candidate_builds_a_resume(client: Any, mint_token: Any) -> None:
    employer = await _employer(client, mint_token)
    for method, url in (
        ("GET", DRAFT),
        ("GET", f"{BUILDER}/templates"),
        ("POST", f"{BUILDER}/push"),
    ):
        response = await client.request(method, url, headers=employer["headers"])
        assert response.status_code == 403, (url, response.text)
    assert (await client.get(DRAFT)).status_code == 401


# ---------------------------------------------------------------------------
# Drawing it
# ---------------------------------------------------------------------------
async def test_the_templates_and_a_live_preview(client: Any, mint_token: Any) -> None:
    me = await _onboarded(client, mint_token, answers=False)
    templates = await client.get(f"{BUILDER}/templates", headers=me["headers"])
    assert templates.status_code == 200, templates.text
    assert [t["key"] for t in templates.json()["templates"]] == list(domain.TEMPLATE_KEYS)

    preview = await client.post(
        f"{BUILDER}/preview",
        json={"template_key": "sidebar", "content": {"full_name": "Unsaved Name"}},
        headers=me["headers"],
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["mime"] == "image/png" and body["page_count"] == 1
    assert base64.b64decode(body["pages"][0]).startswith(b"\x89PNG")
    # A preview stores nothing.
    assert (await client.get(DRAFT, headers=me["headers"])).json()["saved"] is False


async def test_a_download_is_the_saved_draft_and_is_counted(
    client: Any, mint_token: Any, s3: FakeImageS3
) -> None:
    me = await _onboarded(client, mint_token)
    missing = await client.post(f"{BUILDER}/download", headers=me["headers"])
    assert missing.status_code == 404
    assert missing.json()["code"] == "resume_builder_draft_missing"

    await _fill(client, me)
    for expected in (1, 2):
        response = await client.post(f"{BUILDER}/download", headers=me["headers"])
        assert response.status_code == 200, response.text
        assert response.headers["content-type"] == "application/pdf"
        assert 'filename="Priya-Sharma-Resume.pdf"' in response.headers["content-disposition"]
        reader = pypdf.PdfReader(io.BytesIO(response.content))
        assert "Reliance Retail" in reader.pages[0].extract_text()
        draft = (await client.get(DRAFT, headers=me["headers"])).json()
        assert draft["download_count"] == expected
    assert draft["first_downloaded_at"] is not None
    assert draft["first_downloaded_at"] <= draft["last_downloaded_at"]
    assert s3.objects == {}  # a download stores no file


# ---------------------------------------------------------------------------
# Making it their resume
# ---------------------------------------------------------------------------
async def test_a_push_is_an_unconfirmed_resume_with_its_pdf_and_scores_nothing(
    client: Any, mint_token: Any, s3: FakeImageS3
) -> None:
    me = await _onboarded(client, mint_token)
    await _fill(client, me, summary="Weekly dashboards for 140 stores.")

    pushed = await client.post(f"{BUILDER}/push", headers=me["headers"])
    assert pushed.status_code == 200, pushed.text
    body = pushed.json()
    assert body["created"] is True and body["confirmed"] is False
    version_id = body["resume_version_id"]

    source, parsed, confirmed_at = await _parsed(version_id)
    assert source == "BUILDER" and confirmed_at is None
    assert parsed["extractor"]["parser"] == "builder"
    assert parsed["extractor"]["template_key"] == "modern"
    assert "raw_text" not in parsed
    assert parsed["structured_resume"]["status"] == "READY"
    assert parsed["structured_resume"]["data"]["contacts"]["email"] == me["email"]

    # The scored text: what they did, never who they are.
    scored = render_structured_resume(parsed)
    assert "Data Analyst at Reliance Retail, 2022 to present" in scored
    assert "Summary: Weekly dashboards" in scored
    for absent in ("Priya", me["email"], "98765", "Pune", "2021"):
        assert absent not in scored, absent

    # The PDF is the version's file.
    [stored] = s3.objects.values()
    assert stored.startswith(b"%PDF")
    async with sessions(_seed_url())() as session:
        file_row = (
            await session.execute(
                text(
                    "SELECT f.mime, f.scan_status, f.parse_status FROM resume_files f "
                    "JOIN resume_versions v ON v.resume_file_id = f.id WHERE v.id = :v"
                ),
                {"v": version_id},
            )
        ).one()
        scores = await session.scalar(
            text("SELECT count(*) FROM scores WHERE user_id = :u"), {"u": str(me["id"])}
        )
    assert tuple(file_row) == ("application/pdf", "CLEAN", "DONE")
    assert scores == 0

    profile = (await client.get(DETAILS, headers=me["headers"])).json()
    assert profile["resume_version_id"] == version_id
    assert profile["resume_filename"] == "Priya-Sharma-Resume.pdf"
    assert profile["details"]["key_skills"] == ["SQL", "Power BI"]  # answers untouched

    versions = (await client.get(VERSIONS, headers=me["headers"])).json()
    assert any(v["resume_version_id"] == version_id and v["source"] == "BUILDER" for v in versions)


async def test_pushing_an_unchanged_draft_writes_nothing_new(
    client: Any, mint_token: Any, s3: FakeImageS3
) -> None:
    me = await _onboarded(client, mint_token)
    await _fill(client, me)
    first = (await client.post(f"{BUILDER}/push", headers=me["headers"])).json()
    again = (await client.post(f"{BUILDER}/push", headers=me["headers"])).json()
    assert again["created"] is False
    assert again["resume_version_id"] == first["resume_version_id"]
    assert len(s3.objects) == 1
    assert (await client.get(DRAFT, headers=me["headers"])).json()["pushed_is_current"] is True

    await _fill(client, me, headline="Senior analyst")
    assert (await client.get(DRAFT, headers=me["headers"])).json()["pushed_is_current"] is False
    changed = (await client.post(f"{BUILDER}/push", headers=me["headers"])).json()
    assert changed["created"] is True
    assert changed["resume_version_id"] != first["resume_version_id"]
    assert len(s3.objects) == 2


async def test_a_push_needs_a_name_and_something_to_score(
    client: Any, mint_token: Any, s3: FakeImageS3
) -> None:
    me = await _onboarded(client, mint_token, answers=False)
    await client.put(
        DRAFT, json={"template_key": "classic", "content": {"full_name": ""}}, headers=me["headers"]
    )
    response = await client.post(f"{BUILDER}/push", headers=me["headers"])
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "resume_builder_incomplete"
    assert response.json()["params"]["fields"] == ["full_name", "experience"]
    assert s3.objects == {}


async def test_a_built_resume_is_edited_in_the_builder_and_confirmed_after_paying(
    client: Any, mint_token: Any, s3: FakeImageS3
) -> None:
    me = await _onboarded(client, mint_token)
    await _fill(client, me)
    version_id = (await client.post(f"{BUILDER}/push", headers=me["headers"])).json()[
        "resume_version_id"
    ]

    edit = await client.post(
        f"{VERSIONS}/{version_id}/edit",
        json={"text": "A correction typed on the review screen, long enough to pass."},
        headers=me["headers"],
    )
    assert edit.status_code == 409, edit.text
    assert edit.json()["code"] == "resume_version_built"

    # Completing the profile later does not append to a built resume.
    completed = await client.put(
        DETAILS,
        json={"details": {**ANSWERS, "current_city": "Mumbai"}, "complete": True},
        headers=me["headers"],
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["resume_version_id"] == version_id

    unpaid = await client.post(f"{VERSIONS}/{version_id}/confirm", headers=me["headers"])
    assert unpaid.status_code == 402, unpaid.text
    await _subscribe(me["id"])
    paid = await client.post(f"{VERSIONS}/{version_id}/confirm", headers=me["headers"])
    assert paid.status_code == 200, paid.text
    assert (await _parsed(version_id))[2] is not None


# ---------------------------------------------------------------------------
# The console's follow-up list
# ---------------------------------------------------------------------------
async def test_who_downloaded_and_did_not_pay_is_listed_with_the_number_to_call(
    client: Any, mint_token: Any, s3: FakeImageS3
) -> None:
    staff = await _staff(mint_token, role="SUPPORT_AGENT")
    downloaded = await _onboarded(client, mint_token)
    await _fill(client, downloaded)
    assert (
        await client.post(f"{BUILDER}/download", headers=downloaded["headers"])
    ).status_code == 200
    signed_up = await _onboarded(client, mint_token, answers=False)
    paying = await _onboarded(client, mint_token)
    await _fill(client, paying)
    await client.post(f"{BUILDER}/download", headers=paying["headers"])
    await _subscribe(paying["id"])

    row = await _find(client, LEADS, staff["headers"], str(downloaded["id"]))
    assert row is not None
    assert row["stage"] == "RESUME_DOWNLOADED"
    assert row["email"] == downloaded["email"]  # unmasked: the list is for calling
    assert row["phone"] and "*" not in row["phone"]
    assert row["full_name"] == "Priya Sharma"
    assert row["resume_builder"]["download_count"] == 1
    assert row["resume_builder"]["template_key"] == "modern"
    assert row["contact_suppressed"] is False

    nobody = await _find(client, LEADS, staff["headers"], str(signed_up["id"]))
    assert nobody is not None and nobody["stage"] == "SIGNED_UP"
    assert nobody["resume_builder"]["download_count"] == 0

    # Paying takes them off the default list, and onto the PAID one.
    assert await _find(client, LEADS, staff["headers"], str(paying["id"])) is None
    paid = await _find(client, LEADS, staff["headers"], str(paying["id"]), stage="PAID")
    assert paid is not None and paid["stage"] == "PAID"

    only = await _find(
        client, LEADS, staff["headers"], str(signed_up["id"]), stage="RESUME_DOWNLOADED"
    )
    assert only is None

    summary = await client.get(f"{LEADS}/summary", headers=staff["headers"])
    assert summary.status_code == 200, summary.text
    assert summary.json()["resume_downloaded"] >= 1 and summary.json()["paid"] >= 1

    async with sessions(_seed_url())() as session:
        audited = await session.scalar(
            text(
                "SELECT count(*) FROM audit_events WHERE actor_id = :u "
                "AND metadata->>'view' = 'leads'"
            ),
            {"u": str(staff["user_id"])},
        )
    assert audited >= 4  # one per page read


async def test_the_sql_stage_is_the_domain_rule(
    client: Any, mint_token: Any, s3: FakeImageS3
) -> None:
    """`repository.leads` decides the stage in SQL; `domain.lead_stage` says
    what it should be. Both, for each stage a candidate can be in."""
    staff = await _staff(mint_token)
    cases: list[tuple[dict[str, Any], dict[str, bool]]] = []

    fresh = await _onboarded(client, mint_token, answers=False)
    cases.append((fresh, {"paid": False, "seated": False, "downloaded": False, "completed": False}))

    complete = await _onboarded(client, mint_token, answers=False)
    done = await client.put(
        DETAILS, json={"details": ANSWERS, "complete": True}, headers=complete["headers"]
    )
    assert done.status_code == 200, done.text
    cases.append(
        (complete, {"paid": False, "seated": False, "downloaded": False, "completed": True})
    )

    took = await _onboarded(client, mint_token)
    await _fill(client, took)
    await client.post(f"{BUILDER}/download", headers=took["headers"])
    cases.append((took, {"paid": False, "seated": False, "downloaded": True, "completed": False}))

    for me, facts in cases:
        expected = lead_stage(
            paid=facts["paid"],
            seated=facts["seated"],
            downloaded=facts["downloaded"],
            profile_completed=facts["completed"],
        )
        row = await _find(client, LEADS, staff["headers"], str(me["id"]), stage=expected)
        assert row is not None, expected
        assert row["profile_completed"] is facts["completed"]


async def test_reviewers_without_contact_access_cannot_open_the_list(
    client: Any, mint_token: Any
) -> None:
    for role in ("KYB_REVIEWER", "INTEGRITY_REVIEWER"):
        staff = await _staff(mint_token, role=role)
        assert (await client.get(LEADS, headers=staff["headers"])).status_code == 403
