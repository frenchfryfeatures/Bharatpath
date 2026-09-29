"""Day 10: jobs through HTTP -- composing, the lifecycle, and invariant 8.

Organisations are created through the API, so they start at KYB `DRAFT` exactly
as a real one does. Approval is set directly as the migrator here; the KYB
submission flow that sets it for real has its own tests.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.core.pagination import encode_cursor
from tests.conftest import _seed_url, sessions, subscribe_tenant

pytestmark = pytest.mark.integration

API = "/api/v1/employer"
JOBS = f"{API}/jobs"
JOB = {
    "title": "Senior Welder",
    "description": "TIG and MIG welding on pipeline projects in Pune.",
    "skills": ["TIG welding", "MIG welding"],
    "location": "Pune",
    "work_mode": "ONSITE",
    "experience_min_months": 36,
    "salary_min_minor": 3_000_000,
    "salary_max_minor": 4_500_000,
    "min_score": 760,
}


def _email() -> str:
    return f"{uuid.uuid4().hex[:12]}@example.test"


async def _organisation(client: Any, mint_token: Any) -> dict[str, Any]:
    headers, _ = mint_token(pool="BUSINESS", email=_email())
    created = await client.post(
        f"{API}/organisation", json={"legal_name": "Jobs Test Pvt Ltd"}, headers=headers
    )
    assert created.status_code == 201, created.text
    await subscribe_tenant(created.json()["tenant_id"])
    return {"headers": headers, "tenant_id": created.json()["tenant_id"]}


async def _member(client: Any, mint_token: Any, owner: dict, role: str) -> dict[str, str]:
    email = _email()
    added = await client.post(
        f"{API}/team", json={"email": email, "role": role}, headers=owner["headers"]
    )
    assert added.status_code == 201, added.text
    headers, _ = mint_token(pool="BUSINESS", email=email)
    return headers


async def _set_kyb(tenant_id: str, status: str) -> None:
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text("UPDATE employers SET kyb_status = :s WHERE tenant_id = :t"),
            {"s": status, "t": tenant_id},
        )


async def _draft(client: Any, headers: dict[str, str], **overrides: Any) -> dict[str, Any]:
    response = await client.post(JOBS, json={**JOB, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# --- composing ------------------------------------------------------------
async def test_an_owner_and_a_recruiter_can_draft_but_a_viewer_cannot(
    client: Any, mint_token: Any
) -> None:
    owner = await _organisation(client, mint_token)
    recruiter = await _member(client, mint_token, owner, "EMPLOYER_RECRUITER")
    viewer = await _member(client, mint_token, owner, "EMPLOYER_VIEWER")

    assert (await _draft(client, owner["headers"]))["status"] == "DRAFT"
    assert (await _draft(client, recruiter))["status"] == "DRAFT"
    assert (await client.post(JOBS, json=JOB, headers=viewer)).status_code == 403
    assert (await client.get(JOBS, headers=viewer)).status_code == 200


@pytest.mark.parametrize(
    "overrides",
    [
        {"salary_min_minor": None},
        {"salary_max_minor": 100, "salary_min_minor": 200},
        {"min_score": 650},
        {"min_score": 1000},
        {"salary_min_minor": 1.5},
        {"status": "PUBLISHED"},
        {"work_mode": "ANYWHERE"},
    ],
    ids=[
        "no-salary",
        "inverted-range",
        "threshold-below-base",
        "threshold-above-ceiling",
        "float-money",
        "smuggled-status",
        "unknown-work-mode",
    ],
)
async def test_an_invalid_job_is_refused(client: Any, mint_token: Any, overrides: dict) -> None:
    owner = await _organisation(client, mint_token)
    body = {**JOB, **overrides}
    if overrides.get("salary_min_minor", 0) is None:
        body.pop("salary_min_minor")
    response = await client.post(JOBS, json=body, headers=owner["headers"])
    assert response.status_code == 422


# --- invariant 8 ----------------------------------------------------------
async def test_an_unverified_employer_cannot_publish(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    job = await _draft(client, owner["headers"])

    response = await client.post(f"{JOBS}/{job['id']}/publish", headers=owner["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "kyb_required"
    assert (await client.get(f"{JOBS}/{job['id']}", headers=owner["headers"])).json()[
        "status"
    ] == "DRAFT"


async def test_a_verified_employer_can_publish(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    await _set_kyb(owner["tenant_id"], "APPROVED")
    job = await _draft(client, owner["headers"])

    published = await client.post(f"{JOBS}/{job['id']}/publish", headers=owner["headers"])
    assert published.status_code == 200
    assert published.json()["status"] == "PUBLISHED"
    assert published.json()["published_at"] is not None


async def test_a_revoked_employer_cannot_bring_a_paused_job_back(
    client: Any, mint_token: Any
) -> None:
    """The trigger re-checks on PAUSED -> PUBLISHED. Losing verification while
    a job is paused must keep it off the board."""
    owner = await _organisation(client, mint_token)
    await _set_kyb(owner["tenant_id"], "APPROVED")
    job = await _draft(client, owner["headers"])
    await client.post(f"{JOBS}/{job['id']}/publish", headers=owner["headers"])
    assert (
        await client.post(f"{JOBS}/{job['id']}/pause", headers=owner["headers"])
    ).status_code == 200

    await _set_kyb(owner["tenant_id"], "REJECTED")
    response = await client.post(f"{JOBS}/{job['id']}/publish", headers=owner["headers"])
    assert response.status_code == 403
    assert response.json()["code"] == "kyb_required"


async def test_the_database_refuses_a_publish_that_skips_the_service(
    client: Any, mint_token: Any
) -> None:
    """Invariant 8's hardest form: past the API *and* the service, straight
    through the repository on an app-role session with the tenant bound. The
    trigger must still say no."""
    from app.core.db import get_session_factory, set_transaction_tenant
    from app.modules.jobs import repository

    owner = await _organisation(client, mint_token)
    job = await _draft(client, owner["headers"])
    tenant_id = uuid.UUID(owner["tenant_id"])

    with pytest.raises(Exception) as raised:
        async with get_session_factory()() as session, session.begin():
            await set_transaction_tenant(session, tenant_id)
            row = await repository.get_job(
                session, tenant_id=tenant_id, job_id=uuid.UUID(job["id"])
            )
            assert row is not None
            await repository.set_status(session, job=row, status="PUBLISHED")
    assert "KYB_REQUIRED" in str(raised.value)


# --- lifecycle ------------------------------------------------------------
async def test_the_full_lifecycle(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    await _set_kyb(owner["tenant_id"], "APPROVED")
    job = await _draft(client, owner["headers"])
    base = f"{JOBS}/{job['id']}"

    assert (await client.post(f"{base}/publish", headers=owner["headers"])).json()[
        "status"
    ] == "PUBLISHED"
    assert (await client.post(f"{base}/pause", headers=owner["headers"])).json()[
        "status"
    ] == "PAUSED"
    assert (await client.post(f"{base}/publish", headers=owner["headers"])).json()[
        "status"
    ] == "PUBLISHED"
    closed = await client.post(f"{base}/close", headers=owner["headers"])
    assert closed.json()["status"] == "CLOSED"
    assert closed.json()["closed_at"] is not None

    reopen = await client.post(f"{base}/publish", headers=owner["headers"])
    assert reopen.status_code == 409
    assert reopen.json()["code"] == "job_invalid_transition"


async def test_a_draft_cannot_be_paused(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    job = await _draft(client, owner["headers"])
    response = await client.post(f"{JOBS}/{job['id']}/pause", headers=owner["headers"])
    assert response.status_code == 409


async def test_a_live_job_must_be_paused_before_it_is_edited(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    await _set_kyb(owner["tenant_id"], "APPROVED")
    job = await _draft(client, owner["headers"])
    base = f"{JOBS}/{job['id']}"
    await client.post(f"{base}/publish", headers=owner["headers"])

    live_edit = await client.patch(
        base, json={"salary_max_minor": 9_000_000}, headers=owner["headers"]
    )
    assert live_edit.status_code == 409
    assert live_edit.json()["code"] == "job_not_editable"

    await client.post(f"{base}/pause", headers=owner["headers"])
    paused_edit = await client.patch(
        base, json={"salary_max_minor": 9_000_000}, headers=owner["headers"]
    )
    assert paused_edit.status_code == 200
    assert paused_edit.json()["salary_max_minor"] == 9_000_000


async def test_an_edit_cannot_invert_the_stored_salary_range(client: Any, mint_token: Any) -> None:
    """Only one end is sent; the range is checked against the stored other end."""
    owner = await _organisation(client, mint_token)
    job = await _draft(client, owner["headers"])
    response = await client.patch(
        f"{JOBS}/{job['id']}", json={"salary_min_minor": 9_000_000}, headers=owner["headers"]
    )
    assert response.status_code == 422
    assert response.json()["code"] == "job_salary_range_invalid"


async def test_an_edit_cannot_change_the_status(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    job = await _draft(client, owner["headers"])
    response = await client.patch(
        f"{JOBS}/{job['id']}", json={"status": "PUBLISHED"}, headers=owner["headers"]
    )
    assert response.status_code == 422


async def test_the_job_list_can_be_filtered_by_status(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    await _set_kyb(owner["tenant_id"], "APPROVED")
    draft = await _draft(client, owner["headers"])
    live = await _draft(client, owner["headers"])
    await client.post(f"{JOBS}/{live['id']}/publish", headers=owner["headers"])

    published = await client.get(JOBS, params={"status": "PUBLISHED"}, headers=owner["headers"])
    ids = {j["id"] for j in published.json()["items"]}
    assert live["id"] in ids and draft["id"] not in ids


async def test_the_job_list_honours_limit_and_pages_by_cursor(client: Any, mint_token: Any) -> None:
    """`limit` used to be ignored -- the route did not declare it, so FastAPI
    dropped it and every job came back. Five jobs at two a page is three pages,
    newest first, nothing repeated or skipped, and no cursor on the last."""
    owner = await _organisation(client, mint_token)
    made = [(await _draft(client, owner["headers"]))["id"] for _ in range(5)]

    seen: list[str] = []
    cursor: str | None = None
    for expected in (2, 2, 1):
        params = {"limit": 2} if cursor is None else {"limit": 2, "cursor": cursor}
        page = await client.get(JOBS, params=params, headers=owner["headers"])
        assert page.status_code == 200, page.text
        body = page.json()
        assert len(body["items"]) == expected
        assert body["total"] is None
        seen += [j["id"] for j in body["items"]]
        cursor = body["next_cursor"]
    assert cursor is None
    assert seen == list(reversed(made))


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}])
async def test_the_job_list_refuses_a_limit_out_of_range(
    client: Any, mint_token: Any, params: dict
) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.get(JOBS, params=params, headers=owner["headers"])
    assert response.status_code == 422, response.text


@pytest.mark.parametrize(
    "cursor",
    [
        "not-a-cursor",
        # A candidate board cursor is keyed on `published_at`, not `created_at`.
        encode_cursor({"p": "2026-09-23T00:00:00+00:00", "i": str(uuid.uuid4())}),
    ],
)
async def test_the_job_list_refuses_a_cursor_it_did_not_issue(
    client: Any, mint_token: Any, cursor: str
) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.get(JOBS, params={"cursor": cursor}, headers=owner["headers"])
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "invalid_cursor"


# --- threshold preview ----------------------------------------------------
async def test_the_threshold_preview_is_coarse(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.get(
        f"{JOBS}/threshold-preview", params={"min_score": 980}, headers=owner["headers"]
    )
    assert response.status_code == 200
    body = response.json()
    assert body["min_score"] == 980
    assert body["approximate_count"] % 10 == 0
    if body["fewer_than_ten"]:
        assert body["approximate_count"] == 0


@pytest.mark.parametrize("min_score", [765, 690, 995])
async def test_the_threshold_preview_only_accepts_steps_of_ten_in_range(
    client: Any, mint_token: Any, min_score: int
) -> None:
    owner = await _organisation(client, mint_token)
    response = await client.get(
        f"{JOBS}/threshold-preview", params={"min_score": min_score}, headers=owner["headers"]
    )
    assert response.status_code == 422


async def test_the_threshold_preview_is_rate_limited_per_organisation(
    client: Any, mint_token: Any
) -> None:
    """Shared across the team: the risk is the organisation learning a score."""
    from app.modules.jobs.service import THRESHOLD_PREVIEWS_PER_HOUR

    owner = await _organisation(client, mint_token)
    recruiter = await _member(client, mint_token, owner, "EMPLOYER_RECRUITER")

    for i in range(THRESHOLD_PREVIEWS_PER_HOUR):
        who = owner["headers"] if i % 2 else recruiter
        ok = await client.get(f"{JOBS}/threshold-preview", params={"min_score": 800}, headers=who)
        assert ok.status_code == 200, (i, ok.text)

    over = await client.get(
        f"{JOBS}/threshold-preview", params={"min_score": 800}, headers=owner["headers"]
    )
    assert over.status_code == 429


async def test_a_viewer_cannot_preview_thresholds(client: Any, mint_token: Any) -> None:
    owner = await _organisation(client, mint_token)
    viewer = await _member(client, mint_token, owner, "EMPLOYER_VIEWER")
    response = await client.get(
        f"{JOBS}/threshold-preview", params={"min_score": 800}, headers=viewer
    )
    assert response.status_code == 403
