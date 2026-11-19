"""The console's permission catalogue, the system roles, and the access rules
(2026-11-19). No database: `tests/integration/test_access_management.py` has
the routes and the guards, and `tests/invariants/test_admin_console.py` holds
every route to its permission."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.core.staff_permissions import (
    BY_KEY,
    GRANTABLE,
    LEGACY_ROLE_TO_SYSTEM_ROLE,
    PERMISSION_KEYS,
    PERMISSIONS,
    SUPER_ADMIN,
    SUPER_ADMIN_ONLY,
    SYSTEM_ROLES,
    Grant,
    StaffAccess,
    role_permission_refusal,
)
from app.modules.access.domain import (
    assignment_refusal,
    custom_role_refusal,
    high_risk_added,
    role_key_for,
    self_change_refusal,
)

NOW = datetime(2026, 11, 19, 12, tzinfo=UTC)


# --- the catalogue ---------------------------------------------------------------------
def test_keys_are_unique_and_well_formed() -> None:
    keys = [p.key for p in PERMISSIONS]
    assert len(keys) == len(set(keys))
    for spec in PERMISSIONS:
        assert spec.key.count(".") == 1 and spec.key == spec.key.lower(), spec.key
        assert set(spec.requires) <= PERMISSION_KEYS, spec.key


def test_what_the_ask_reserved_for_super_admin_is_reserved() -> None:
    """Roles, staff, the audit log and the KYB switch: SUPER_ADMIN's alone."""
    assert {
        "roles.manage",
        "admins.invite",
        "admins.manage",
        "audit.view",
        "kyb.configure",
    } == SUPER_ADMIN_ONLY
    assert GRANTABLE == PERMISSION_KEYS - SUPER_ADMIN_ONLY


def test_the_sensitive_permissions_are_never_low_risk() -> None:
    for key in (
        "candidate_contact.view",
        "candidates.leads",
        "recordings.listen",
        "resume.download",
        "organisations.suspend",
        "admins.invite",
        "admins.manage",
        "roles.manage",
        "discounts.manage",
    ):
        assert BY_KEY[key].risk != "LOW", key
    for key in ("organisations.suspend", "admins.invite", "admins.manage", "roles.manage"):
        assert BY_KEY[key].risk == "CRITICAL", key


# --- system roles ----------------------------------------------------------------------
def test_super_admin_holds_everything_and_nothing_else_holds_the_reserved_set() -> None:
    assert SYSTEM_ROLES[SUPER_ADMIN].permissions == PERMISSION_KEYS
    for key, role in SYSTEM_ROLES.items():
        assert role.permissions <= PERMISSION_KEYS, key
        if key != SUPER_ADMIN:
            assert not role.permissions & SUPER_ADMIN_ONLY, key
            assert role_permission_refusal(role.permissions) is None, key


def test_the_old_four_roles_keep_exactly_what_they_had() -> None:
    """Migration 0022 moved every member of staff onto these, so they must
    grant what the `CONSOLE_ROLES` map gave the same role -- no more, no less."""
    assert SYSTEM_ROLES["KYB_REVIEWER"].permissions == {
        "dashboard.view",
        "kyb.view",
        "employers.approve_kyb",
        "organisations.view",
        "employers.view",
    }
    assert SYSTEM_ROLES["INTEGRITY_REVIEWER"].permissions == {
        "dashboard.view",
        "integrity.view",
        "integrity.resolve",
        "candidates.view",
        "resume.download",
    }
    support = SYSTEM_ROLES["SUPPORT_AGENT"].permissions
    assert "organisations.suspend" not in support and "audit.view" not in support
    assert {"candidate_contact.view", "recordings.listen", "candidates.leads"} <= support
    assert set(LEGACY_ROLE_TO_SYSTEM_ROLE.values()) <= set(SYSTEM_ROLES)
    assert LEGACY_ROLE_TO_SYSTEM_ROLE["PLATFORM_ADMIN"] == SUPER_ADMIN


def test_the_read_only_auditor_reads_and_sees_no_whole_contact() -> None:
    auditor = SYSTEM_ROLES["READ_ONLY_AUDITOR"].permissions
    assert all(BY_KEY[p].risk == "LOW" for p in auditor)
    assert all(p.endswith(".view") for p in auditor)


# --- custom roles ----------------------------------------------------------------------
@pytest.mark.parametrize(
    ("permissions", "refusal"),
    [
        (set(), "role_permissions_empty"),
        ({"candidates.view", "nonsense.key"}, "role_permission_unknown"),
        ({"candidates.view", "roles.manage"}, "role_permission_super_admin_only"),
        ({"candidates.leads"}, "role_permission_requires_another"),
        ({"candidates.leads", "candidate_contact.view"}, None),
    ],
)
def test_a_custom_role_is_refused_for_what_it_may_not_hold(
    permissions: set[str], refusal: str | None
) -> None:
    assert role_permission_refusal(permissions) == refusal


def test_a_custom_key_can_never_be_a_system_key() -> None:
    assert role_key_for("College Support - North Region") == "CUSTOM_COLLEGE_SUPPORT_NORTH_REGION"
    assert role_key_for("Super Admin").startswith("CUSTOM_")
    assert role_key_for("!!!") == "CUSTOM_ROLE"
    assert custom_role_refusal(name="  ", permissions={"candidates.view"}) == "role_name_invalid"


def test_the_editor_is_told_which_risky_permissions_a_change_adds() -> None:
    assert high_risk_added({"candidates.view"}, {"candidates.view", "recordings.listen"}) == [
        "recordings.listen"
    ]
    assert high_risk_added({"recordings.listen"}, {"candidates.view"}) == []


# --- assignments -----------------------------------------------------------------------
def _refusal(key: str = "SUPPORT_AGENT", **kw: object) -> str | None:
    args: dict[str, object] = {
        "role_key": key,
        "role_active": True,
        "role_permissions": SYSTEM_ROLES[key].permissions if key in SYSTEM_ROLES else set(),
        "scope_tenant_ids": None,
        "expires_at": None,
        "now": NOW,
    }
    args.update(kw)
    return assignment_refusal(**args)  # type: ignore[arg-type]


def test_super_admin_is_all_or_nothing() -> None:
    assert _refusal(SUPER_ADMIN) is None
    assert _refusal(SUPER_ADMIN, expires_at=NOW + timedelta(days=1)) == "super_admin_is_unscoped"
    assert _refusal(SUPER_ADMIN, scope_tenant_ids=[uuid.uuid4()]) == "super_admin_is_unscoped"


def test_an_expiry_is_in_the_future_and_a_scope_must_grant_something() -> None:
    assert _refusal(expires_at=NOW - timedelta(seconds=1)) == "expiry_in_the_past"
    assert _refusal(expires_at=NOW + timedelta(days=7)) is None
    assert _refusal(role_active=False) == "role_archived"
    # The integrity reviewer's permissions are all used on routes that name no
    # organisation, so a scoped grant would do nothing.
    assert _refusal("INTEGRITY_REVIEWER", scope_tenant_ids=[uuid.uuid4()]) == "scope_grants_nothing"
    assert _refusal("SUPPORT_AGENT", scope_tenant_ids=[uuid.uuid4()]) is None
    assert _refusal(scope_tenant_ids=[]) == "scope_size_invalid"


def test_nobody_changes_their_own_access() -> None:
    me = uuid.uuid4()
    assert self_change_refusal(actor_id=me, target_id=me) == "staff_self_change"
    assert self_change_refusal(actor_id=me, target_id=uuid.uuid4()) is None


# --- effective access ------------------------------------------------------------------
def test_roles_add_up_and_expired_ones_grant_nothing() -> None:
    access = StaffAccess.from_grants(
        [
            Grant("SUPPORT_AGENT", "Support", frozenset({"disputes.view"})),
            Grant("TAXONOMY_MANAGER", "Taxonomy", frozenset({"taxonomy.edit"})),
            Grant(
                "CUSTOM_X",
                "X",
                frozenset({"recordings.listen"}),
                expires_at=NOW - timedelta(minutes=1),
            ),
        ],
        now=NOW,
    )
    assert access.can("disputes.view") and access.can("taxonomy.edit")
    assert not access.can("recordings.listen")
    assert access.role_keys == ("SUPPORT_AGENT", "TAXONOMY_MANAGER")


def test_a_scoped_grant_answers_only_for_its_organisations() -> None:
    mine, other = uuid.uuid4(), uuid.uuid4()
    access = StaffAccess.from_grants(
        [Grant("CUSTOM_NORTH", "North", frozenset({"institutes.view"}), frozenset({mine}))],
        now=NOW,
    )
    assert access.can("institutes.view", tenant_id=mine)
    assert not access.can("institutes.view", tenant_id=other)
    # A route that names no organisation cannot be answered by a scoped grant.
    assert not access.can("institutes.view")
    assert "institutes.view" in access.permissions
    assert "institutes.view" not in access.unscoped_permissions


def test_an_unscoped_grant_wins_over_a_scoped_one() -> None:
    access = StaffAccess.from_grants(
        [
            Grant("A", "A", frozenset({"employers.view"}), frozenset({uuid.uuid4()})),
            Grant("B", "B", frozenset({"employers.view"})),
        ],
        now=NOW,
    )
    assert access.can("employers.view") and access.can("employers.view", tenant_id=uuid.uuid4())


def test_auth_me_keeps_the_old_role_name_for_the_portal() -> None:
    def legacy(*keys: str) -> str:
        return StaffAccess.from_grants(
            [Grant(k, k, SYSTEM_ROLES[k].permissions) for k in keys], now=NOW
        ).legacy_role

    assert legacy(SUPER_ADMIN) == "PLATFORM_ADMIN"
    assert legacy("SUPPORT_AGENT", "TAXONOMY_MANAGER") == "SUPPORT_AGENT"
    assert legacy("CONTENT_MANAGER") == "PLATFORM_STAFF"
