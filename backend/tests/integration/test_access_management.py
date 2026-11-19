"""Access management (2026-11-19): staff roles, permissions, scope, the step-up,
and the guards that hold them.

The route table is `tests/invariants/test_admin_console.py`; the catalogue and
the pure rules are `tests/unit/test_staff_permissions.py`. This file is what
needs a database and a running app.

Tests share one database with every other test, which holds many super admins,
so "the last super admin" is proved inside a transaction that is rolled back.
"""

from __future__ import annotations

import re
import time
import uuid
from typing import Any
from urllib.parse import quote

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.auth.directory import get_account_directory
from app.core.staff_permissions import GRANTABLE
from tests.conftest import _seed_url, sessions
from tests.integration.test_admin_console import ADMIN, API, REASON, _staff
from tests.integration.test_college import _college

pytestmark = pytest.mark.integration

ACCESS = f"{ADMIN}/access"


def _name() -> str:
    return f"Test role {uuid.uuid4().hex[:10]}"


async def _role_id(client: Any, headers: dict[str, str], key: str) -> str:
    response = await client.get(f"{ACCESS}/roles", headers=headers)
    assert response.status_code == 200, response.text
    return str(next(r["id"] for r in response.json() if r["key"] == key))


async def _custom_role(client: Any, admin: dict[str, Any], permissions: list[str]) -> dict:
    response = await client.post(
        f"{ACCESS}/roles",
        json={"name": _name(), "permissions": permissions},
        headers=admin["headers"],
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def _assign(client: Any, admin: dict[str, Any], user_id: Any, **grant: Any) -> Any:
    return await client.post(
        f"{ACCESS}/staff/{user_id}/roles", json=grant, headers=admin["headers"]
    )


async def _audit(action: str, target_id: Any) -> list[dict[str, Any]]:
    async with sessions(_seed_url())() as session:
        rows = await session.execute(
            text(
                "SELECT metadata FROM audit_events WHERE action = :a AND target_id = :t ORDER BY id"
            ),
            {"a": action, "t": str(target_id)},
        )
        return [dict(r[0]) for r in rows.all()]


# --- the caller's own access -----------------------------------------------------------
async def test_me_and_auth_me_say_what_a_member_of_staff_holds(
    client: Any, mint_token: Any
) -> None:
    support = await _staff(mint_token, "SUPPORT_AGENT", roles=("SUPPORT_AGENT", "TAXONOMY_MANAGER"))
    me = await client.get(f"{ACCESS}/me", headers=support["headers"])
    assert me.status_code == 200, me.text
    body = me.json()
    assert {r["key"] for r in body["roles"]} == {"SUPPORT_AGENT", "TAXONOMY_MANAGER"}
    assert "candidate_contact.view" in body["permissions"]
    assert not body["is_super_admin"]

    auth = (await client.get(f"{API}/auth/me", headers=support["headers"])).json()
    # Kept for the portal, which still routes on it.
    assert auth["role"] == "SUPPORT_AGENT"
    assert auth["staff"]["roles"] == ["SUPPORT_AGENT", "TAXONOMY_MANAGER"]

    admin = await _staff(mint_token)
    assert (await client.get(f"{API}/auth/me", headers=admin["headers"])).json()["role"] == (
        "PLATFORM_ADMIN"
    )


# --- inviting ------------------------------------------------------------------------
async def test_a_super_admin_invites_staff_with_roles_and_the_email_goes_last(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    kyb = await _role_id(client, admin["headers"], "KYB_REVIEWER")
    email = f"new-staff-{uuid.uuid4().hex[:10]}@example.test"
    sent_before = len(get_account_directory().sent)  # type: ignore[attr-defined]

    response = await client.post(
        f"{ACCESS}/staff",
        json={"email": email, "roles": [{"role_id": kyb}]},
        headers={**admin["headers"], "User-Agent": "pytest-console"},
    )
    assert response.status_code == 201, response.text
    member = response.json()["member"]
    assert response.json()["invitation"] == "SENT"
    assert [r["role_key"] for r in member["roles"]] == ["KYB_REVIEWER"]
    assert "employers.approve_kyb" in member["effective_permissions"]
    sent = get_account_directory().sent[sent_before:]  # type: ignore[attr-defined]
    assert {"pool": "BUSINESS", "email": email, "kind": "INVITE"} in sent

    (row,) = await _audit("staff_invited", member["user_id"])
    assert row["reason"] == REASON["X-Access-Reason"]
    assert row["user_agent"] == "pytest-console"
    assert row["roles"][0]["role_key"] == "KYB_REVIEWER"

    # The invited person signs in and is a KYB reviewer at once.
    headers, _ = mint_token(pool="BUSINESS", email=email)
    queue = await client.get(f"{ADMIN}/kyb/submissions", headers=headers)
    assert queue.status_code == 200, queue.text

    again = await client.post(
        f"{ACCESS}/staff",
        json={"email": email, "roles": [{"role_id": kyb}]},
        headers=admin["headers"],
    )
    assert again.status_code == 409
    assert again.json()["code"] == "staff_already_member"


async def test_a_refused_invitation_emails_nobody(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    super_admin = await _role_id(client, admin["headers"], "SUPER_ADMIN")
    sent_before = len(get_account_directory().sent)  # type: ignore[attr-defined]
    response = await client.post(
        f"{ACCESS}/staff",
        json={
            "email": f"x-{uuid.uuid4().hex[:8]}@example.test",
            "roles": [{"role_id": super_admin, "expires_at": "2099-01-01T00:00:00Z"}],
        },
        headers=admin["headers"],
    )
    assert response.status_code == 422
    assert response.json()["code"] == "super_admin_is_unscoped"
    assert len(get_account_directory().sent) == sent_before  # type: ignore[attr-defined]


# --- roles ---------------------------------------------------------------------------
async def test_a_custom_role_grants_on_the_next_request_and_stops_on_the_next(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    person = await _staff(mint_token, "CONTENT_MANAGER")
    role = await _custom_role(client, admin, ["dashboard.view", "disputes.view"])
    assert (await client.get(f"{ADMIN}/disputes", headers=person["headers"])).status_code == 403

    assigned = await _assign(client, admin, person["user_id"], role_id=role["id"])
    assert assigned.status_code == 201, assigned.text
    assert (await client.get(f"{ADMIN}/disputes", headers=person["headers"])).status_code == 200

    impact = await client.post(
        f"{ACCESS}/roles/{role['id']}/impact",
        json={"name": role["name"], "permissions": ["dashboard.view", "recordings.listen"]},
        headers=admin["headers"],
    )
    assert impact.json() == {
        "holders": 1,
        "added": ["recordings.listen"],
        "removed": ["disputes.view"],
        "high_risk_added": ["recordings.listen"],
        "refusal": None,
    }

    updated = await client.put(
        f"{ACCESS}/roles/{role['id']}",
        json={"name": role["name"], "permissions": ["dashboard.view"]},
        headers=admin["headers"],
    )
    assert updated.status_code == 200, updated.text
    # No wait for a cache: the change is read on the very next request.
    assert (await client.get(f"{ADMIN}/disputes", headers=person["headers"])).status_code == 403
    (row,) = await _audit("staff_role_updated", role["id"])
    assert row["removed"] == ["disputes.view"] and row["holders_affected"] == 1

    held = await client.post(f"{ACCESS}/roles/{role['id']}/archive", headers=admin["headers"])
    assert held.status_code == 409 and held.json()["code"] == "role_in_use"
    assignment = next(r for r in assigned.json()["roles"] if r["role_id"] == role["id"])
    revoked = await client.post(
        f"{ACCESS}/staff/{person['user_id']}/roles/{assignment['id']}/revoke",
        headers=admin["headers"],
    )
    assert revoked.status_code == 200, revoked.text
    archived = await client.post(f"{ACCESS}/roles/{role['id']}/archive", headers=admin["headers"])
    assert archived.status_code == 200 and archived.json()["status"] == "ARCHIVED"


async def test_a_custom_role_cannot_hold_what_only_super_admin_may(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    for permissions, code in (
        (["roles.manage"], "role_permission_super_admin_only"),
        (["candidates.leads"], "role_permission_requires_another"),
        (["not.a_permission"], "role_permission_unknown"),
    ):
        response = await client.post(
            f"{ACCESS}/roles",
            json={"name": _name(), "permissions": permissions},
            headers=admin["headers"],
        )
        assert response.status_code == 422, response.text
        assert response.json()["code"] == code


async def test_a_system_role_is_code(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    support = await _role_id(client, admin["headers"], "SUPPORT_AGENT")
    edited = await client.put(
        f"{ACCESS}/roles/{support}",
        json={"name": "Support", "permissions": ["dashboard.view"]},
        headers=admin["headers"],
    )
    assert edited.status_code == 409 and edited.json()["code"] == "system_role_fixed"
    with pytest.raises(DBAPIError, match="STAFF_ROLE_GUARD"):
        async with sessions(_seed_url())() as session, session.begin():
            await session.execute(
                text("INSERT INTO staff_role_permissions VALUES (:r, 'dashboard.view')"),
                {"r": support},
            )


async def test_the_stored_check_is_the_catalogue() -> None:
    async with sessions(_seed_url())() as session:
        definition = await session.scalar(
            text(
                "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE conname = 'ck_staff_role_permissions_grantable'"
            )
        )
    stored = set(re.findall(r"'([^']+)'", str(definition)))
    assert stored == GRANTABLE


# --- scope and expiry ----------------------------------------------------------------
async def test_an_organisation_scoped_grant_opens_that_organisation_only(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    mine = await _college(client, mint_token)
    other = await _college(client, mint_token)
    person = await _staff(mint_token, "CONTENT_MANAGER")
    role = await _custom_role(client, admin, ["institutes.view"])
    assigned = await _assign(
        client, admin, person["user_id"], role_id=role["id"], scope_tenant_ids=[mine["tenant_id"]]
    )
    assert assigned.status_code == 201, assigned.text

    ok = await client.get(f"{ADMIN}/colleges/{mine['tenant_id']}", headers=person["headers"])
    assert ok.status_code == 200, ok.text
    no = await client.get(f"{ADMIN}/colleges/{other['tenant_id']}", headers=person["headers"])
    assert no.status_code == 403

    me = (await client.get(f"{ACCESS}/me", headers=person["headers"])).json()
    assert "institutes.view" in me["scoped_permissions"]


async def test_a_scope_that_would_grant_nothing_is_refused(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    person = await _staff(mint_token, "CONTENT_MANAGER")
    integrity = await _role_id(client, admin["headers"], "INTEGRITY_REVIEWER")
    response = await _assign(
        client, admin, person["user_id"], role_id=integrity, scope_tenant_ids=[str(uuid.uuid4())]
    )
    assert response.status_code == 422 and response.json()["code"] == "scope_grants_nothing"
    past = await _assign(
        client, admin, person["user_id"], role_id=integrity, expires_at="2020-01-01T00:00:00Z"
    )
    assert past.status_code == 422 and past.json()["code"] == "expiry_in_the_past"


# --- the step-up ---------------------------------------------------------------------
async def test_a_sensitive_permission_needs_a_reason_an_authenticator_and_is_audited(
    client: Any, mint_token: Any
) -> None:
    url = f"{ADMIN}/leads/summary"
    quiet = await _staff(mint_token, "SUPPORT_AGENT", reason=False)
    refused = await client.get(url, headers=quiet["headers"])
    assert refused.status_code == 403 and refused.json()["code"] == "access_reason_required"

    no_mfa = await _staff(mint_token, "SUPPORT_AGENT", mfa=False)
    refused = await client.get(url, headers=no_mfa["headers"])
    assert refused.status_code == 403 and refused.json()["code"] == "mfa_required"

    # A reason in Hindi, percent-encoded because a header is Latin-1.
    reason = "उम्मीदवार ने फ़ोन किया"
    headers = {**quiet["headers"], "X-Access-Reason": quote(reason)}
    ok = await client.get(url, headers=headers)
    assert ok.status_code == 200, ok.text
    async with sessions(_seed_url())() as session:
        row = await session.scalar(
            text(
                "SELECT metadata FROM audit_events WHERE action = 'staff_sensitive_access' "
                "AND actor_id = :u ORDER BY id DESC LIMIT 1"
            ),
            {"u": str(quiet["user_id"])},
        )
    assert row["reason"] == reason
    assert row["permissions"] == ["candidates.leads", "candidate_contact.view"]
    assert row["path"] == url and row["route"].endswith("/leads/summary") and row["ip"]


async def test_a_critical_permission_needs_a_recent_sign_in(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    stale, _ = mint_token(
        pool="BUSINESS",
        subject=admin["subject"],
        email=admin["email"],
        auth_time=int(time.time()) - 3600,
    )
    response = await client.get(
        f"{ACCESS}/history", headers={**stale, **REASON}
    )  # HIGH: an hour-old sign-in is fine
    assert response.status_code == 200, response.text
    response = await client.post(
        f"{ACCESS}/roles",
        json={"name": _name(), "permissions": ["dashboard.view"]},
        headers={**stale, **REASON},
    )
    assert response.status_code == 401 and response.json()["code"] == "reauthentication_required"


# --- suspending staff, and the rules nobody may break -----------------------------------
async def test_suspending_staff_bites_on_their_next_request_and_ends_their_sessions(
    client: Any, mint_token: Any
) -> None:
    admin = await _staff(mint_token)
    person = await _staff(mint_token, "SUPPORT_AGENT")
    assert (await client.get(f"{ADMIN}/disputes", headers=person["headers"])).status_code == 200
    suspended = await client.post(
        f"{ACCESS}/staff/{person['user_id']}/suspend", headers=admin["headers"]
    )
    assert suspended.status_code == 200 and suspended.json()["status"] == "REVOKED"
    assert suspended.json()["effective_permissions"] == []
    assert (await client.get(f"{ADMIN}/disputes", headers=person["headers"])).status_code == 403
    assert {"pool": "BUSINESS", "subject": person["subject"]} in (
        get_account_directory().signed_out  # type: ignore[attr-defined]
    )

    back = await client.post(
        f"{ACCESS}/staff/{person['user_id']}/reinstate", headers=admin["headers"]
    )
    assert back.status_code == 200 and back.json()["status"] == "ACTIVE"
    assert (await client.get(f"{ADMIN}/disputes", headers=person["headers"])).status_code == 200


async def test_nobody_changes_their_own_access(client: Any, mint_token: Any) -> None:
    admin = await _staff(mint_token)
    me = (await client.get(f"{ACCESS}/staff/{admin['user_id']}", headers=admin["headers"])).json()
    for response in (
        await client.post(f"{ACCESS}/staff/{admin['user_id']}/suspend", headers=admin["headers"]),
        await client.post(
            f"{ACCESS}/staff/{admin['user_id']}/roles/{me['roles'][0]['id']}/revoke",
            headers=admin["headers"],
        ),
    ):
        assert response.status_code == 409 and response.json()["code"] == "staff_self_change"


async def test_the_last_active_super_admin_is_kept_by_the_database() -> None:
    """Every writer, the migrator included. Revoking every super admin's staff
    membership at once must fail on the last of them; so must revoking every
    super admin assignment. Both inside a transaction that rolls back."""
    staff_of_super_admins = """
        FROM staff_role_assignments a JOIN staff_roles r ON r.id = a.role_id
         WHERE r.key = 'SUPER_ADMIN' AND a.revoked_at IS NULL
    """
    for statement in (
        "UPDATE memberships SET status = 'REVOKED' WHERE status = 'ACTIVE' "
        f"AND user_id IN (SELECT a.user_id {staff_of_super_admins})",
        "UPDATE staff_role_assignments SET revoked_at = now() "
        f"WHERE id IN (SELECT a.id {staff_of_super_admins})",
    ):
        with pytest.raises(DBAPIError, match="LAST_SUPER_ADMIN"):
            async with sessions(_seed_url())() as session, session.begin():
                await session.execute(text(statement))


async def test_an_assignment_is_revoked_never_rewritten() -> None:
    async with sessions(_seed_url())() as session:
        assignment = await session.scalar(
            text("SELECT id FROM staff_role_assignments WHERE revoked_at IS NULL LIMIT 1")
        )
    for statement in (
        "UPDATE staff_role_assignments SET expires_at = now() + interval '1 day' WHERE id = :a",
        "UPDATE staff_role_assignments SET scope_tenant_ids = ARRAY[gen_random_uuid()] "
        "WHERE id = :a",
    ):
        with pytest.raises(DBAPIError, match="STAFF_ASSIGNMENT_GUARD"):
            async with sessions(_seed_url())() as session, session.begin():
                await session.execute(text(statement), {"a": str(assignment)})


async def test_kyb_reviewers_told_are_whoever_may_decide(client: Any, mint_token: Any) -> None:
    from app.modules.access import service as access_service

    admin = await _staff(mint_token)
    reviewer = await _staff(mint_token, "KYB_REVIEWER")
    support = await _staff(mint_token, "SUPPORT_AGENT")
    custom = await _staff(mint_token, "CONTENT_MANAGER")
    role = await _custom_role(client, admin, ["kyb.view", "employers.approve_kyb"])
    assert (await _assign(client, admin, custom["user_id"], role_id=role["id"])).status_code == 201

    async with sessions(_seed_url())() as session:
        told = set(await access_service.staff_holding(session, permission="employers.approve_kyb"))
    assert {reviewer["user_id"], custom["user_id"], admin["user_id"]} <= told
    assert support["user_id"] not in told
