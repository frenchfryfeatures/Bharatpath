"""KYB review, end to end (2026-10-10): send back, correct, resubmit, reject, start again.

With approval switched on, a reviewer either sends a submission back -- the
same one reopens, with the fields and documents to fix pointed at -- or
rejects it, after which the next submission starts filled in from it. Every
decision is recorded with what it was made on, so a resubmission shows the
reviewer what changed. Staff hear about submissions in their inbox; the
organisation's owners hear about decisions, with the reviewer's reason.
"""

# ruff: noqa: F811 - `fake_s3` is a pytest fixture imported below.
from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import _staff
from tests.integration.test_kyb import KYB, _config, _drop_config, _organisation, _ready, _upload
from tests.integration.test_notifications import _dispatch, _event_id, _rows
from tests.integration.test_payments import APP_URL
from tests.integration.test_resume_intake import FakeS3, fake_s3  # noqa: F401 - fixture

pytestmark = pytest.mark.integration

ADMIN = "/api/v1/admin/kyb/submissions"


async def _submitted(client: Any, mint_token: Any, fake: FakeS3) -> dict[str, Any]:
    owner = await _organisation(client, mint_token)
    await _ready(client, owner["headers"], fake)
    submitted = await client.post(f"{KYB}/submit", headers=owner["headers"])
    assert submitted.json()["state"] == "SUBMITTED", submitted.text
    return {**owner, "submission_id": submitted.json()["submission_id"]}


async def _decide(client: Any, staff: dict, submission_id: str, **body: Any) -> Any:
    return await client.post(
        f"{ADMIN}/{submission_id}/decision", json=body, headers=staff["headers"]
    )


async def _queue_row(client: Any, staff: dict, submission_id: str) -> dict[str, Any]:
    cursor = None
    for _ in range(100):
        params = {"limit": 100, **({"cursor": cursor} if cursor else {})}
        page = (await client.get(ADMIN, params=params, headers=staff["headers"])).json()
        for row in page["items"]:
            if row["id"] == submission_id:
                return row
        cursor = page["next_cursor"]
        if cursor is None:
            break
    raise AssertionError(f"{submission_id} not in the queue")


# ===========================================================================
# Send back, correct, resubmit
# ===========================================================================
async def test_a_sent_back_submission_is_corrected_and_comes_back_showing_what_changed(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    version = await _config(True)
    try:
        reviewer = await _staff(mint_token, "KYB_REVIEWER")
        owner = await _submitted(client, mint_token, fake_s3)
        submission_id = owner["submission_id"]

        sent_back = await _decide(
            client,
            reviewer,
            submission_id,
            decision="MORE_INFO_REQUIRED",
            reason="The PAN does not match the card.",
            flags=[
                {"field": "pan", "note": "Use the PAN printed on the card"},
                {"field": "doc_pan", "note": "The scan is unreadable"},
            ],
        )
        assert sent_back.status_code == 200, sent_back.text

        mine = (await client.get(KYB, headers=owner["headers"])).json()
        assert mine["state"] == "MORE_INFO_REQUIRED"
        assert mine["decision_reason"] == "The PAN does not match the card."
        assert [f["field"] for f in mine["review_flags"]] == ["pan", "doc_pan"]
        [first] = mine["reviews"]
        assert first["decision"] == "MORE_INFO_REQUIRED" and "reviewed_by" not in first
        assert mine["changed_since_last_review"] == {"fields": [], "documents": []}

        fixed = await client.put(
            f"{KYB}/answers", json={"answers": {"pan": "AAECR1234F"}}, headers=owner["headers"]
        )
        assert fixed.status_code == 200, fixed.text
        reuploaded, _ = await _upload(client, owner["headers"], fake_s3)
        assert reuploaded.status_code == 200, reuploaded.text
        again = await client.post(f"{KYB}/submit", headers=owner["headers"])
        assert again.json()["state"] == "SUBMITTED"
        assert again.json()["submission_id"] == submission_id, "the same submission"
        assert again.json()["review_flags"] == []

        opened = (await client.get(f"{ADMIN}/{submission_id}", headers=reviewer["headers"])).json()
        assert opened["changed_since_last_review"] == {"fields": ["pan"], "documents": ["doc_pan"]}
        assert all(doc["url"] for doc in opened["documents"]), "a reviewer can open each file"
        row = await _queue_row(client, reviewer, submission_id)
        assert row["review_count"] == 1 and row["after_rejection"] is False

        approved = await _decide(client, reviewer, submission_id, decision="APPROVED")
        assert approved.json()["state"] == "APPROVED"
        assert approved.json()["review_flags"] == []
        assert [r["decision"] for r in approved.json()["reviews"]] == [
            "MORE_INFO_REQUIRED",
            "APPROVED",
        ]
    finally:
        await _drop_config(version)


# ===========================================================================
# Reject, then start again filled in
# ===========================================================================
async def test_after_a_rejection_the_next_submission_starts_with_the_old_answers_and_files(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    version = await _config(True)
    try:
        reviewer = await _staff(mint_token, "KYB_REVIEWER")
        owner = await _submitted(client, mint_token, fake_s3)
        old_id = owner["submission_id"]
        before = (await client.get(KYB, headers=owner["headers"])).json()

        rejected = await _decide(
            client,
            reviewer,
            old_id,
            decision="REJECTED",
            reason="The registration certificate is for another company.",
            flags=[{"field": "legal_name"}],
        )
        assert rejected.json()["state"] == "REJECTED"
        mine = (await client.get(KYB, headers=owner["headers"])).json()
        assert mine["state"] == "REJECTED" and mine["review_flags"] == [
            {"field": "legal_name", "note": None}
        ]

        # Any save starts the new submission; an empty one changes nothing.
        restarted = await client.put(
            f"{KYB}/answers", json={"answers": {}}, headers=owner["headers"]
        )
        assert restarted.status_code == 200, restarted.text
        fresh = restarted.json()
        assert fresh["state"] == "DRAFT" and fresh["submission_id"] != old_id
        assert fresh["previous_submission_id"] == old_id
        assert fresh["answers"] == before["answers"]
        assert {d["doc_type"] for d in fresh["documents"]} == {
            d["doc_type"] for d in before["documents"]
        }
        assert fresh["reviews"] == [] and fresh["review_flags"] == []

        resubmitted = await client.post(f"{KYB}/submit", headers=owner["headers"])
        assert resubmitted.json()["state"] == "SUBMITTED", resubmitted.text
        row = await _queue_row(client, reviewer, fresh["submission_id"])
        assert row["after_rejection"] is True and row["review_count"] == 0
    finally:
        await _drop_config(version)


# ===========================================================================
# What a flag may say
# ===========================================================================
async def test_a_flag_must_name_a_real_field_and_an_approval_has_none(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    version = await _config(True)
    try:
        reviewer = await _staff(mint_token, "KYB_REVIEWER")
        owner = await _submitted(client, mint_token, fake_s3)
        cases = [
            (
                {"decision": "MORE_INFO_REQUIRED", "reason": "x", "flags": [{"field": "gstn"}]},
                "kyb_flag_unknown_field",
                ["gstn"],
            ),
            (
                {
                    "decision": "MORE_INFO_REQUIRED",
                    "reason": "x",
                    "flags": [{"field": "pan"}, {"field": "pan"}],
                },
                "kyb_flag_duplicate",
                ["pan"],
            ),
            ({"decision": "APPROVED", "flags": [{"field": "pan"}]}, "kyb_flags_not_allowed", []),
        ]
        for body, code, fields in cases:
            refused = await _decide(client, reviewer, owner["submission_id"], **body)
            assert refused.status_code == 422, refused.text
            assert refused.json()["code"] == code
            assert refused.json()["params"]["fields"] == fields
        still = (await client.get(KYB, headers=owner["headers"])).json()
        assert still["state"] == "SUBMITTED" and still["reviews"] == []
    finally:
        await _drop_config(version)


async def test_a_decision_once_recorded_is_never_rewritten(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    version = await _config(True)
    try:
        reviewer = await _staff(mint_token, "KYB_REVIEWER")
        owner = await _submitted(client, mint_token, fake_s3)
        await _decide(client, reviewer, owner["submission_id"], decision="REJECTED", reason="No.")
        with pytest.raises(DBAPIError):
            async with sessions(APP_URL)() as session, session.begin():
                await session.execute(
                    text("SELECT set_config('app.tenant_id', :t, true)"),
                    {"t": owner["tenant_id"]},
                )
                await session.execute(
                    text("UPDATE kyb_reviews SET reason = 'rewritten' WHERE submission_id = :s"),
                    {"s": owner["submission_id"]},
                )
    finally:
        await _drop_config(version)


# ===========================================================================
# Who hears about it
# ===========================================================================
async def test_staff_hear_of_a_submission_and_owners_hear_the_reason(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    version = await _config(True)
    try:
        reviewer = await _staff(mint_token, "KYB_REVIEWER")
        support = await _staff(mint_token, "SUPPORT_AGENT")
        owner = await _submitted(client, mint_token, fake_s3)
        submission_id = owner["submission_id"]

        await _dispatch(await _event_id("kyb.submitted", submission_id))
        [told] = await _rows(user_id=reviewer["user_id"], template_code="IN_APP_KYB_SUBMITTED")
        assert told["channel"] == "IN_APP"
        assert not await _rows(user_id=reviewer["user_id"], channel="EMAIL")
        assert not await _rows(user_id=support["user_id"], template_code="IN_APP_KYB_SUBMITTED")

        reason = f"Upload a clearer PAN scan {uuid.uuid4().hex[:6]}."
        await _decide(client, reviewer, submission_id, decision="MORE_INFO_REQUIRED", reason=reason)
        await _dispatch(await _event_id("kyb.reviewed", submission_id))
        owner_id = await _owner_id(owner["tenant_id"])
        inbox = await _rows(user_id=owner_id, template_code="IN_APP_KYB_NEEDS_INFO")
        assert inbox and reason in inbox[0]["body"]

        await client.post(f"{KYB}/submit", headers=owner["headers"])
        await _dispatch(await _event_id("kyb.submitted", submission_id))
        assert await _rows(user_id=reviewer["user_id"], template_code="IN_APP_KYB_RESUBMITTED")

        await _decide(client, reviewer, submission_id, decision="REJECTED", reason="Final: no.")
        await _dispatch(await _event_id("kyb.reviewed", submission_id))
        [rejected] = await _rows(user_id=owner_id, template_code="IN_APP_KYB_REJECTED")
        assert "Final: no." in rejected["body"]
    finally:
        await _drop_config(version)


async def _owner_id(tenant_id: str) -> uuid.UUID:
    async with sessions(_seed_url())() as session:
        found = await session.scalar(
            text(
                "SELECT user_id FROM memberships WHERE tenant_id = :t "
                "AND role = 'EMPLOYER_OWNER' AND status = 'ACTIVE'"
            ),
            {"t": tenant_id},
        )
    assert found is not None
    return found
