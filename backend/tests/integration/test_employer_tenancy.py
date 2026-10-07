"""Day 9: employer organisations, the three roles, and the team.

Through HTTP, the real `current_user`, the real token verifier and the real
membership lookup -- because the guarantees here are about which requests get
through, and a test that called the service directly would skip the guards it
exists to check.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration

BASE = "/api/v1/employer"
ORG = {
    "legal_name": "Acme Hiring Pvt Ltd",
    "employer_type": "PRIVATE_LIMITED",
    "industry": "IT_SOFTWARE",
}


def _email() -> str:
    return f"{uuid.uuid4().hex[:12]}@example.test"


async def _owner(client: Any, mint_token: Any) -> tuple[dict[str, str], str, str]:
    """A fresh business account that has created its organisation.
    Returns `(headers, tenant_id, email)`."""
    email = _email()
    headers, _ = mint_token(pool="BUSINESS", email=email)
    response = await client.post(f"{BASE}/organisation", json=ORG, headers=headers)
    assert response.status_code == 201, response.text
    return headers, response.json()["tenant_id"], email


async def _invite(client: Any, owner: dict[str, str], role: str) -> tuple[str, str]:
    """Add someone by email. Returns `(email, user_id)`.

    Sign in as them by minting a business token for that email."""
    email = _email()
    response = await client.post(f"{BASE}/team", json={"email": email, "role": role}, headers=owner)
    assert response.status_code == 201, response.text
    return email, response.json()["user_id"]


async def _user_id(email: str) -> uuid.UUID:
    factory = sessions(_seed_url())
    async with factory() as session:
        return await session.scalar(text("SELECT id FROM users WHERE email = :e"), {"e": email})


# --- creating an organisation --------------------------------------------
async def test_an_unaffiliated_business_account_can_create_its_organisation(
    client: Any, mint_token: Any
) -> None:
    headers, tenant_id, _ = await _owner(client, mint_token)

    response = await client.get(f"{BASE}/organisation", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["tenant_id"] == tenant_id
    assert body["industry"] == "IT_SOFTWARE"
    assert body["kyb_status"] == "DRAFT"


async def test_the_creator_is_the_owner(client: Any, mint_token: Any) -> None:
    headers, _, email = await _owner(client, mint_token)
    team = (await client.get(f"{BASE}/team", headers=headers)).json()
    assert [(m["email"], m["role"]) for m in team] == [(email, "EMPLOYER_OWNER")]


async def test_a_candidate_cannot_create_an_organisation(client: Any, mint_token: Any) -> None:
    headers, _ = mint_token(pool="CANDIDATE", email=_email())
    response = await client.post(f"{BASE}/organisation", json=ORG, headers=headers)
    assert response.status_code == 403


async def test_an_account_cannot_create_a_second_organisation(client: Any, mint_token: Any) -> None:
    """One organisation per account, or "which tenant is this caller?" has
    two answers."""
    headers, _, _ = await _owner(client, mint_token)
    response = await client.post(f"{BASE}/organisation", json=ORG, headers=headers)
    assert response.status_code == 409
    assert response.json()["code"] == "identity_already_in_organisation"


async def test_a_suspended_organisations_owner_cannot_start_afresh(
    client: Any, mint_token: Any
) -> None:
    """**A suspension bypass, closed.** Authorisation hides a suspended
    tenant's membership, so without a raw check the owner would look
    unaffiliated and could create a new organisation to carry on under."""
    headers, tenant_id, email = await _owner(client, mint_token)
    owner_id = await _user_id(email)

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO tenant_suspensions "
                "(id, tenant_id, reason, suspended_by, suspended_at) "
                "VALUES (:i, :t, 'fraud review', :u, now())"
            ),
            {"i": str(uuid.uuid4()), "t": tenant_id, "u": str(owner_id)},
        )
    from app.core.auth import membership as membership_lookup

    await membership_lookup.invalidate(owner_id)

    response = await client.post(f"{BASE}/organisation", json=ORG, headers=headers)
    assert response.status_code == 409


@pytest.mark.parametrize(
    "payload",
    [
        {**ORG, "industry": "Information Technology"},
        {**ORG, "employer_type": "LLP"},
        {**ORG, "legal_name": " x "},
        {**ORG, "tenant_id": str(uuid.uuid4())},
    ],
    ids=["free-text-industry", "unknown-type", "blank-name", "smuggled-tenant"],
)
async def test_an_invalid_organisation_is_refused(
    client: Any, mint_token: Any, payload: dict
) -> None:
    headers, _ = mint_token(pool="BUSINESS", email=_email())
    response = await client.post(f"{BASE}/organisation", json=payload, headers=headers)
    assert response.status_code == 422


async def test_an_unaffiliated_account_sees_no_tenant_data(client: Any, mint_token: Any) -> None:
    headers, _ = mint_token(pool="BUSINESS", email=_email())
    assert (await client.get(f"{BASE}/organisation", headers=headers)).status_code == 403
    assert (await client.get(f"{BASE}/team", headers=headers)).status_code == 403


async def test_the_reference_lists_need_a_business_account(client: Any, mint_token: Any) -> None:
    business, _ = mint_token(pool="BUSINESS", email=_email())
    response = await client.get(f"{BASE}/reference", headers=business)
    assert response.status_code == 200
    body = response.json()
    assert "IT_SOFTWARE" in {t["code"] for t in body["industries"]}
    assert "MNC" in {t["code"] for t in body["employer_types"]}

    candidate, _ = mint_token(pool="CANDIDATE", email=_email())
    assert (await client.get(f"{BASE}/reference", headers=candidate)).status_code == 403


async def test_an_owner_can_rename_the_organisation(client: Any, mint_token: Any) -> None:
    headers, tenant_id, _ = await _owner(client, mint_token)
    response = await client.patch(
        f"{BASE}/organisation",
        json={"legal_name": "Acme Talent Pvt Ltd", "industry": None},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["legal_name"] == "Acme Talent Pvt Ltd"
    assert response.json()["industry"] is None

    factory = sessions(_seed_url())
    async with factory() as session:
        name = await session.scalar(
            text("SELECT name FROM tenants WHERE id = :t"), {"t": tenant_id}
        )
    assert name == "Acme Talent Pvt Ltd", "tenants.name drifted from the legal name"


async def test_an_owner_keeps_the_public_profile_on_the_server(
    client: Any, mint_token: Any
) -> None:
    """The settings page saves these four through the API -- not to the
    browser, where they would be lost on another device and shown to the
    next person who signs in on the same one."""
    headers, _, _ = await _owner(client, mint_token)
    profile = {
        "trade_name": "  Acme   Talent ",
        "employee_count_band": "51_200",
        "website": "https://acme.example.in",
        "about": "We place engineers.\n\nMostly in Pune.",
    }
    saved = await client.patch(f"{BASE}/organisation", json=profile, headers=headers)
    assert saved.status_code == 200, saved.text

    read = (await client.get(f"{BASE}/organisation", headers=headers)).json()
    assert read["trade_name"] == "Acme Talent"
    assert read["employee_count_band"] == "51_200"
    assert read["website"] == "https://acme.example.in"
    assert read["about"] == "We place engineers.\n\nMostly in Pune."

    cleared = await client.patch(
        f"{BASE}/organisation",
        json={"trade_name": "", "website": None, "about": "   "},
        headers=headers,
    )
    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["trade_name"] is None and body["website"] is None and body["about"] is None
    assert body["employee_count_band"] == "51_200", "a field left out is unchanged"


@pytest.mark.parametrize(
    "change",
    [
        {"website": "http://acme.example.in"},
        {"website": "javascript:alert(1)"},
        {"website": "acme.example.in"},
        {"employee_count_band": "LOTS"},
        {"about": "x" * 1001},
        {"trade_name": "x" * 256},
    ],
)
async def test_a_bad_public_profile_is_refused(
    client: Any, mint_token: Any, change: dict[str, str]
) -> None:
    headers, _, _ = await _owner(client, mint_token)
    response = await client.patch(f"{BASE}/organisation", json=change, headers=headers)
    assert response.status_code == 422, response.text


async def test_kyb_status_cannot_be_set_through_the_profile(client: Any, mint_token: Any) -> None:
    """Invariant 8 is one PATCH from bypassed if this ever returns 200."""
    headers, _, _ = await _owner(client, mint_token)
    response = await client.patch(
        f"{BASE}/organisation", json={"kyb_status": "APPROVED"}, headers=headers
    )
    assert response.status_code == 422


# --- the team -------------------------------------------------------------
async def test_an_invited_recruiter_gets_access_on_first_sign_in(
    client: Any, mint_token: Any
) -> None:
    """The invitation is a user row waiting to be claimed by email; first
    sign-in adopts it, and the membership is already there."""
    owner, tenant_id, _ = await _owner(client, mint_token)
    email, user_id = await _invite(client, owner, "EMPLOYER_RECRUITER")

    recruiter, _ = mint_token(pool="BUSINESS", email=email)
    response = await client.get(f"{BASE}/organisation", headers=recruiter)
    assert response.status_code == 200
    assert response.json()["tenant_id"] == tenant_id
    assert str(await _user_id(email)) == user_id, "sign-in created a second account"


async def test_a_recruiter_and_a_viewer_can_read_but_not_manage(
    client: Any, mint_token: Any
) -> None:
    owner, _, _ = await _owner(client, mint_token)
    for role in ("EMPLOYER_RECRUITER", "EMPLOYER_VIEWER"):
        email, _ = await _invite(client, owner, role)
        member, _ = mint_token(pool="BUSINESS", email=email)

        assert (await client.get(f"{BASE}/team", headers=member)).status_code == 200
        assert (
            await client.post(
                f"{BASE}/team", json={"email": _email(), "role": "EMPLOYER_VIEWER"}, headers=member
            )
        ).status_code == 403
        assert (
            await client.patch(
                f"{BASE}/organisation", json={"legal_name": "Mine now"}, headers=member
            )
        ).status_code == 403


async def test_the_last_owner_cannot_leave_or_step_down(client: Any, mint_token: Any) -> None:
    """An organisation with no owner can be recovered only by a platform admin
    with a database session."""
    owner, _, email = await _owner(client, mint_token)
    owner_id = await _user_id(email)

    demote = await client.patch(
        f"{BASE}/team/{owner_id}", json={"role": "EMPLOYER_VIEWER"}, headers=owner
    )
    assert demote.status_code == 409
    assert demote.json()["code"] == "identity_last_owner"

    remove = await client.delete(f"{BASE}/team/{owner_id}", headers=owner)
    assert remove.status_code == 409


async def test_with_a_second_owner_the_first_can_step_down(client: Any, mint_token: Any) -> None:
    owner, _, email = await _owner(client, mint_token)
    await _invite(client, owner, "EMPLOYER_OWNER")

    owner_id = await _user_id(email)
    response = await client.patch(
        f"{BASE}/team/{owner_id}", json={"role": "EMPLOYER_VIEWER"}, headers=owner
    )
    assert response.status_code == 200
    assert response.json()["role"] == "EMPLOYER_VIEWER"


async def test_removing_a_member_ends_their_access_on_the_next_request(
    client: Any, mint_token: Any
) -> None:
    """Revocation not waiting out the 60-second membership cache is the whole
    argument for reading membership from our database."""
    owner, _, _ = await _owner(client, mint_token)
    email, user_id = await _invite(client, owner, "EMPLOYER_RECRUITER")
    recruiter, _ = mint_token(pool="BUSINESS", email=email)
    assert (await client.get(f"{BASE}/organisation", headers=recruiter)).status_code == 200

    assert (await client.delete(f"{BASE}/team/{user_id}", headers=owner)).status_code == 204
    assert (await client.get(f"{BASE}/organisation", headers=recruiter)).status_code == 403


async def test_another_organisations_member_is_a_404_not_a_403(
    client: Any, mint_token: Any
) -> None:
    """A 403 would confirm the person exists in some other tenant."""
    owner_a, _, _ = await _owner(client, mint_token)
    owner_b, _, _ = await _owner(client, mint_token)
    _, member_of_b = await _invite(client, owner_b, "EMPLOYER_VIEWER")

    patch = await client.patch(
        f"{BASE}/team/{member_of_b}", json={"role": "EMPLOYER_OWNER"}, headers=owner_a
    )
    delete = await client.delete(f"{BASE}/team/{member_of_b}", headers=owner_a)
    assert patch.status_code == 404
    assert delete.status_code == 404


async def test_adding_an_address_never_says_why_it_was_refused(
    client: Any, mint_token: Any
) -> None:
    """**Enumeration.** A candidate's address and another employer's
    member's address must be refused identically, or any employer can test
    whether a person is registered on the platform."""
    owner_a, _, _ = await _owner(client, mint_token)

    candidate_email = _email()
    candidate, _ = mint_token(pool="CANDIDATE", email=candidate_email)
    assert (await client.get("/api/v1/auth/me", headers=candidate)).status_code == 200

    owner_b, _, _ = await _owner(client, mint_token)
    elsewhere_email, _ = await _invite(client, owner_b, "EMPLOYER_VIEWER")

    codes = set()
    for address in (candidate_email, elsewhere_email):
        response = await client.post(
            f"{BASE}/team", json={"email": address, "role": "EMPLOYER_VIEWER"}, headers=owner_a
        )
        assert response.status_code == 409
        codes.add(response.json()["code"])
    assert codes == {"identity_cannot_add_member"}


async def test_adding_an_existing_member_says_so(client: Any, mint_token: Any) -> None:
    """Their own team is not a secret from an owner, so this one can be specific."""
    owner, _, _ = await _owner(client, mint_token)
    email, _ = await _invite(client, owner, "EMPLOYER_VIEWER")
    response = await client.post(
        f"{BASE}/team", json={"email": email, "role": "EMPLOYER_VIEWER"}, headers=owner
    )
    assert response.status_code == 409
    assert response.json()["code"] == "identity_already_a_member"


async def test_team_changes_are_audited_without_the_address(client: Any, mint_token: Any) -> None:
    owner, tenant_id, _ = await _owner(client, mint_token)
    email, user_id = await _invite(client, owner, "EMPLOYER_RECRUITER")
    await client.patch(f"{BASE}/team/{user_id}", json={"role": "EMPLOYER_VIEWER"}, headers=owner)
    await client.delete(f"{BASE}/team/{user_id}", headers=owner)

    factory = sessions(_seed_url())
    async with factory() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT action, metadata::text AS meta FROM audit_events "
                    "WHERE tenant_id = :t AND target_id = :u ORDER BY occurred_at"
                ),
                {"t": tenant_id, "u": user_id},
            )
        ).all()
    assert [r.action for r in rows] == [
        "team_member_added",
        "team_member_role_changed",
        "team_member_removed",
    ]
    assert all(email not in (r.meta or "") for r in rows), "an email address reached the audit log"
