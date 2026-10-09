"""KYB end to end, through HTTP, with S3 faked.

The two modes of R15 are both exercised: approval off (the default), where a
complete submission verifies the organisation at once, and approval on, where it
waits for a reviewer. **Invariant 8 is tested with the switch on**, so the gate
is genuinely exercised whatever production is set to.

A `kyb.require_approval` row is global -- it applies to every organisation in
the database -- so each test that inserts one removes it in a `finally`.
"""

# ruff: noqa: F811 - `fake_s3` is a pytest fixture imported from the resume intake
# tests; each test that takes it as a parameter looks like a redefinition to ruff.
from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions, subscribe_tenant
from tests.integration.test_resume_intake import FakeS3, fake_s3  # noqa: F401 - fixture

pytestmark = pytest.mark.integration

API = "/api/v1/employer"
KYB = f"{API}/kyb"
PDF = b"%PDF-1.7\n" + b"0" * 256
JOB = {
    "title": "Accounts executive",
    "description": "Day-to-day bookkeeping and GST filings for a Pune office.",
    "salary_min_minor": 2_500_000,
    "salary_max_minor": 3_500_000,
}
ANSWERS: dict[str, Any] = {
    "legal_name": "Acme Hiring Private Limited",
    "employer_type": "PRIVATE_LIMITED",
    "industry": "IT_SOFTWARE",
    "pan": "AABCU9603R",
    "address_line1": "12 MG Road",
    "city": "Pune",
    "state": "MH",
    "pincode": "411001",
    "signatory_name": "Asha Rao",
    "signatory_designation": "Director",
    "work_email": "asha.rao@example.test",
    "work_phone": "9876543210",
    "undertaking_genuine_hiring": True,
    "undertaking_no_redistribution": True,
    "undertaking_authorised": True,
}


def _email() -> str:
    return f"{uuid.uuid4().hex[:12]}@example.test"


async def _organisation(client: Any, mint_token: Any) -> dict[str, Any]:
    headers, _ = mint_token(pool="BUSINESS", email=_email())
    created = await client.post(
        f"{API}/organisation", json={"legal_name": "KYB Test Pvt Ltd"}, headers=headers
    )
    assert created.status_code == 201, created.text
    await subscribe_tenant(created.json()["tenant_id"])
    return {"headers": headers, "tenant_id": created.json()["tenant_id"]}


async def _upload(
    client: Any, headers: dict, fake: FakeS3, doc_type: str = "doc_pan", body: bytes = PDF
) -> Any:
    ticket = await client.post(f"{KYB}/documents", json={"doc_type": doc_type}, headers=headers)
    assert ticket.status_code == 201, ticket.text
    key = urlparse(ticket.json()["url"]).path.split("/", 2)[2]
    fake.objects[key] = body
    return await client.post(
        f"{KYB}/documents/{ticket.json()['upload_id']}/complete",
        json={"doc_type": doc_type},
        headers=headers,
    ), key


async def _ready(client: Any, headers: dict, fake: FakeS3) -> None:
    """Every required answer and document in place."""
    saved = await client.put(f"{KYB}/answers", json={"answers": ANSWERS}, headers=headers)
    assert saved.status_code == 200, saved.text
    completed, _ = await _upload(client, headers, fake)
    assert completed.status_code == 200, completed.text


async def _config(enabled: bool) -> int:
    version = 1_000_000 + uuid.uuid4().int % 1_000_000
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO config_values (id, key, value, version, effective_from) "
                "VALUES (:i, 'kyb.require_approval', CAST(:v AS jsonb), :n, :f)"
            ),
            {
                "i": str(uuid.uuid4()),
                "v": json.dumps({"enabled": enabled}),
                "n": version,
                "f": datetime(2026, 1, 1, tzinfo=UTC),
            },
        )
    return version


async def _drop_config(version: int) -> None:
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text("DELETE FROM config_values WHERE key = 'kyb.require_approval' AND version = :n"),
            {"n": version},
        )


async def _employer_status(tenant_id: str) -> str:
    factory = sessions(_seed_url())
    async with factory() as session:
        return await session.scalar(
            text("SELECT kyb_status FROM employers WHERE tenant_id = :t"), {"t": tenant_id}
        )


async def _reviewer() -> uuid.UUID:
    user_id = uuid.uuid4()
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, email, status, locale) "
                "VALUES (:u, 'BUSINESS', :e, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "e": f"reviewer-{user_id.hex[:12]}@example.test"},
        )
    return user_id


async def _review(
    tenant_id: str, submission_id: str, decision: str, reason: str | None = None
) -> Any:
    from app.modules.kyb import service

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        return await service.review(
            session,
            tenant_id=uuid.UUID(tenant_id),
            submission_id=uuid.UUID(submission_id),
            reviewer_id=await _reviewer(),
            reviewer_role="KYB_REVIEWER",
            decision=decision,
            reason=reason,
        )


# --- the form -------------------------------------------------------------
async def test_the_form_publishes_its_definition_and_every_option(
    client: Any, mint_token: Any
) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.get(f"{KYB}/form", headers=owner["headers"])
    assert response.status_code == 200
    body = response.json()
    assert {s["code"] for s in body["sections"]} >= {"organisation", "identifiers", "documents"}
    assert "MH" in {o["code"] for o in body["options"]["reference.INDIAN_STATES"]}


def test_every_select_in_the_form_has_options_the_service_can_check() -> None:
    """A source the service does not supply makes validation raise in production."""
    from app.modules.kyb.forms import KYB_FORM
    from app.modules.kyb.service import KYB_OPTIONS

    sources = {f.options_source for f in KYB_FORM.fields if f.type in ("SELECT", "MULTISELECT")}
    assert sources <= set(KYB_OPTIONS)


# --- answers --------------------------------------------------------------
async def test_answers_can_be_saved_half_finished(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.put(
        f"{KYB}/answers", json={"answers": {"pan": "AABCU9603R"}}, headers=owner["headers"]
    )
    assert response.status_code == 200
    assert response.json()["state"] == "DRAFT"
    assert response.json()["answers"] == {"pan": "AABCU9603R"}


async def test_malformed_answers_are_all_listed_at_once(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.put(
        f"{KYB}/answers",
        json={
            "answers": {
                "pan": "AABCU96031",
                "state": "Maharashtra",
                "work_email": "nope",
                "tenant": "x",
            }
        },
        headers=owner["headers"],
    )
    assert response.status_code == 422
    issues = {(i["field"], i["code"]) for i in response.json()["params"]["issues"]}
    assert issues == {
        ("pan", "invalid_format"),
        ("state", "not_an_option"),
        ("work_email", "invalid_format"),
        ("tenant", "unknown_field"),
    }


async def test_a_submission_state_cannot_be_sent(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.put(
        f"{KYB}/answers", json={"answers": {}, "state": "APPROVED"}, headers=owner["headers"]
    )
    assert response.status_code == 422


async def test_only_the_owner_touches_kyb(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    email = _email()
    await client.post(
        f"{API}/team", json={"email": email, "role": "EMPLOYER_RECRUITER"}, headers=owner["headers"]
    )
    recruiter, _ = mint_token(pool="BUSINESS", email=email)
    for method, path in [("get", KYB), ("get", f"{KYB}/form"), ("post", f"{KYB}/submit")]:
        assert (await getattr(client, method)(path, headers=recruiter)).status_code == 403


# --- documents ------------------------------------------------------------
async def test_a_document_is_attached_once_even_if_completed_twice(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
) -> None:
    owner = await _organisation(client, mint_token)
    ticket = await client.post(
        f"{KYB}/documents", json={"doc_type": "doc_pan"}, headers=owner["headers"]
    )
    key = urlparse(ticket.json()["url"]).path.split("/", 2)[2]
    fake_s3.objects[key] = PDF
    path = f"{KYB}/documents/{ticket.json()['upload_id']}/complete"

    first = await client.post(path, json={"doc_type": "doc_pan"}, headers=owner["headers"])
    second = await client.post(path, json={"doc_type": "doc_pan"}, headers=owner["headers"])
    assert first.status_code == second.status_code == 200
    assert [d["doc_type"] for d in second.json()["documents"]] == ["doc_pan"]
    assert second.json()["documents"][0]["mime"] == "application/pdf"


@pytest.mark.parametrize(
    ("body", "reason"),
    [
        (b"PK\x03\x04word/" + b"0" * 64, "unsupported_type"),
        (b"GIF89a" + b"0" * 64, "unsupported_type"),
    ],
    ids=["docx", "gif"],
)
async def test_a_document_that_is_not_a_pdf_or_image_is_refused_and_deleted(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
    body: bytes,
    reason: str,
) -> None:
    owner = await _organisation(client, mint_token)
    response, key = await _upload(client, owner["headers"], fake_s3, body=body)
    assert response.status_code == 422
    assert response.json()["params"]["reason"] == reason
    assert key in fake_s3.deleted


async def test_an_oversized_document_is_refused(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    from app.modules.kyb.domain import MAX_DOCUMENT_BYTES

    owner = await _organisation(client, mint_token)
    response, key = await _upload(
        client, owner["headers"], fake_s3, body=PDF + b"0" * MAX_DOCUMENT_BYTES
    )
    assert response.status_code == 422
    assert response.json()["params"]["reason"] == "too_large"
    assert key in fake_s3.deleted


async def test_an_unknown_document_type_is_refused(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.post(
        f"{KYB}/documents", json={"doc_type": "doc_selfie"}, headers=owner["headers"]
    )
    assert response.status_code == 422


async def test_completing_an_upload_that_never_arrived_is_a_404(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    owner = await _organisation(client, mint_token)
    ticket = await client.post(
        f"{KYB}/documents", json={"doc_type": "doc_pan"}, headers=owner["headers"]
    )
    response = await client.post(
        f"{KYB}/documents/{ticket.json()['upload_id']}/complete",
        json={"doc_type": "doc_pan"},
        headers=owner["headers"],
    )
    assert response.status_code == 404


# --- submitting, approval off (the default) -------------------------------
async def test_an_incomplete_submission_lists_everything_missing(
    client: Any, mint_token: Any
) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.post(f"{KYB}/submit", headers=owner["headers"])
    assert response.status_code == 422
    missing = {i["field"] for i in response.json()["params"]["issues"] if i["code"] == "required"}
    assert {"pan", "legal_name", "doc_pan", "undertaking_authorised"} <= missing


async def test_with_approval_off_submitting_verifies_the_organisation_and_it_can_publish(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
) -> None:
    """**The employer path, end to end.** An employer signs up, completes KYB,
    and publishes a job -- nothing set behind the API's back."""
    owner = await _organisation(client, mint_token)
    await _ready(client, owner["headers"], fake_s3)

    job = (await client.post(f"{API}/jobs", json=JOB, headers=owner["headers"])).json()
    blocked = await client.post(f"{API}/jobs/{job['id']}/publish", headers=owner["headers"])
    assert blocked.status_code == 403

    submitted = await client.post(f"{KYB}/submit", headers=owner["headers"])
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["state"] == "APPROVED"
    assert submitted.json()["auto_approved"] is True
    assert await _employer_status(owner["tenant_id"]) == "APPROVED"

    published = await client.post(f"{API}/jobs/{job['id']}/publish", headers=owner["headers"])
    assert published.status_code == 200
    assert published.json()["status"] == "PUBLISHED"


async def test_auto_approval_is_audited_as_automatic(
    client: Any, mint_token: Any, fake_s3: FakeS3
) -> None:
    """Worth being able to tell apart later: nobody looked at this one."""
    owner = await _organisation(client, mint_token)
    await _ready(client, owner["headers"], fake_s3)
    submission = (await client.post(f"{KYB}/submit", headers=owner["headers"])).json()

    factory = sessions(_seed_url())
    async with factory() as session:
        meta = await session.scalar(
            text(
                "SELECT metadata FROM audit_events "
                "WHERE action = 'kyb_decision_recorded' AND target_id = :t"
            ),
            {"t": submission["submission_id"]},
        )
    assert meta == {"decision": "APPROVED", "auto_approved": True}


async def test_a_verified_organisation_does_not_start_a_new_submission(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
) -> None:
    owner = await _organisation(client, mint_token)
    await _ready(client, owner["headers"], fake_s3)
    await client.post(f"{KYB}/submit", headers=owner["headers"])

    response = await client.put(
        f"{KYB}/answers", json={"answers": {"city": "Mumbai"}}, headers=owner["headers"]
    )
    assert response.status_code == 409
    assert response.json()["code"] == "kyb_already_verified"


# --- submitting, approval on: invariant 8 with the switch on --------------
async def test_with_approval_on_a_submission_waits_and_cannot_publish(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
) -> None:
    row = await _config(True)
    try:
        owner = await _organisation(client, mint_token)
        await _ready(client, owner["headers"], fake_s3)
        submission = await client.post(f"{KYB}/submit", headers=owner["headers"])
        assert submission.json()["state"] == "SUBMITTED"
        assert submission.json()["auto_approved"] is False
        assert await _employer_status(owner["tenant_id"]) == "SUBMITTED"

        job = (await client.post(f"{API}/jobs", json=JOB, headers=owner["headers"])).json()
        publish = await client.post(f"{API}/jobs/{job['id']}/publish", headers=owner["headers"])
        assert publish.status_code == 403
        assert publish.json()["code"] == "kyb_required"

        edit = await client.put(
            f"{KYB}/answers", json={"answers": {"city": "Mumbai"}}, headers=owner["headers"]
        )
        assert edit.status_code == 409, "a submitted form was editable under review"

        await _review(owner["tenant_id"], submission.json()["submission_id"], "APPROVED")
        assert await _employer_status(owner["tenant_id"]) == "APPROVED"
        assert (
            await client.post(f"{API}/jobs/{job['id']}/publish", headers=owner["headers"])
        ).status_code == 200
    finally:
        await _drop_config(row)


async def test_a_rejection_needs_a_reason_and_lets_the_organisation_start_again(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
) -> None:
    from app.modules.kyb.service import KybReasonRequiredError

    row = await _config(True)
    try:
        owner = await _organisation(client, mint_token)
        await _ready(client, owner["headers"], fake_s3)
        submission_id = (await client.post(f"{KYB}/submit", headers=owner["headers"])).json()[
            "submission_id"
        ]

        with pytest.raises(KybReasonRequiredError):
            await _review(owner["tenant_id"], submission_id, "REJECTED")

        rejected = await _review(
            owner["tenant_id"], submission_id, "REJECTED", "PAN does not match name"
        )
        assert rejected.state == "REJECTED"
        assert await _employer_status(owner["tenant_id"]) == "REJECTED"

        fresh = await client.put(
            f"{KYB}/answers", json={"answers": {"city": "Pune"}}, headers=owner["headers"]
        )
        assert fresh.status_code == 200
        assert fresh.json()["state"] == "DRAFT"
        assert fresh.json()["submission_id"] != submission_id
    finally:
        await _drop_config(row)


async def test_a_request_for_more_information_reopens_the_form(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
) -> None:
    row = await _config(True)
    try:
        owner = await _organisation(client, mint_token)
        await _ready(client, owner["headers"], fake_s3)
        submission_id = (await client.post(f"{KYB}/submit", headers=owner["headers"])).json()[
            "submission_id"
        ]

        await _review(
            owner["tenant_id"], submission_id, "MORE_INFO_REQUIRED", "Upload the GST certificate"
        )
        edit = await client.put(
            f"{KYB}/answers",
            json={"answers": {"gstin": "27AAPFU0939F1ZV"}},
            headers=owner["headers"],
        )
        assert edit.status_code == 200
        assert edit.json()["state"] == "MORE_INFO_REQUIRED"

        again = await client.post(f"{KYB}/submit", headers=owner["headers"])
        assert again.json()["state"] == "SUBMITTED"
        assert again.json()["submission_id"] == submission_id
    finally:
        await _drop_config(row)


async def test_a_misconfigured_switch_refuses_rather_than_guessing(
    client: Any,
    mint_token: Any,
    fake_s3: FakeS3,
) -> None:
    """Guessing "off" would approve organisations nobody meant to approve."""
    version = 1_000_000 + uuid.uuid4().int % 1_000_000
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO config_values (id, key, value, version, effective_from) "
                "VALUES (:i, 'kyb.require_approval', CAST(:v AS jsonb), :n, :f)"
            ),
            {
                "i": str(uuid.uuid4()),
                "v": json.dumps({"enabled": "yes"}),
                "n": version,
                "f": datetime(2026, 1, 1, tzinfo=UTC),
            },
        )
    try:
        owner = await _organisation(client, mint_token)
        await _ready(client, owner["headers"], fake_s3)
        response = await client.post(f"{KYB}/submit", headers=owner["headers"])
        assert response.status_code == 500
        assert response.json()["code"] == "kyb_config_invalid"
        assert await _employer_status(owner["tenant_id"]) == "DRAFT"
    finally:
        await _drop_config(version)
