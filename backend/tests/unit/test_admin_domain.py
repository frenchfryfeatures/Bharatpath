"""The dispute machine, staff tenancy, the dashboard. The console's permissions
are `tests/unit/test_staff_permissions.py` since 2026-11-19."""

from __future__ import annotations

import pytest

from app.core.deps import ALL_ROLES, CANDIDATE
from app.core.staff_permissions import SYSTEM_ROLES
from app.modules.admin.domain import (
    DISPUTE_KINDS,
    DISPUTE_PARTIES,
    DISPUTE_RAISER_ROLES,
    DISPUTE_STATES,
    DISPUTE_TRANSITIONS,
    dispute_refusal,
    dispute_transition_refusal,
    mask_email,
    mask_phone,
    party_for_role,
)
from app.modules.identity.domain import (
    PLATFORM_ROLES,
    ROLE_TENANT_TYPE,
    role_fits_tenant,
    suspendable,
)


def test_every_role_but_the_candidate_has_exactly_one_kind_of_tenant() -> None:
    assert set(ROLE_TENANT_TYPE) == ALL_ROLES - {CANDIDATE}
    assert {role for role, kind in ROLE_TENANT_TYPE.items() if kind == "PLATFORM"} == PLATFORM_ROLES
    assert role_fits_tenant("EMPLOYER_OWNER", "EMPLOYER")
    assert {"PLATFORM_STAFF"} == PLATFORM_ROLES
    assert not role_fits_tenant("PLATFORM_STAFF", "EMPLOYER")
    assert not role_fits_tenant("PLATFORM_ADMIN", "PLATFORM")  # gone since 0022
    assert not role_fits_tenant("COLLEGE_ADMIN", "PLATFORM")


def test_only_customers_can_be_suspended() -> None:
    assert suspendable("EMPLOYER") and suspendable("COLLEGE")
    assert not suspendable("PLATFORM")


def test_no_staff_role_and_no_viewer_raises_a_dispute() -> None:
    assert not DISPUTE_RAISER_ROLES & PLATFORM_ROLES
    assert "EMPLOYER_VIEWER" not in DISPUTE_RAISER_ROLES
    assert {party_for_role(role) for role in DISPUTE_RAISER_ROLES} == set(DISPUTE_PARTIES)


@pytest.mark.parametrize(
    ("party", "kind", "has_application", "refusal"),
    [
        ("CANDIDATE", "HIRE", True, None),
        ("EMPLOYER", "HIRE", True, None),
        ("COLLEGE", "HIRE", True, "dispute_kind_not_allowed"),
        ("CANDIDATE", "HIRE", False, "dispute_application_required"),
        ("CANDIDATE", "PAYMENT", True, "dispute_application_unexpected"),
        ("COLLEGE", "PAYMENT", False, None),
    ],
)
def test_a_dispute_names_an_application_exactly_when_it_is_about_a_hire(
    party: str, kind: str, has_application: bool, refusal: str | None
) -> None:
    assert dispute_refusal(party=party, kind=kind, has_application=has_application) == refusal


def test_a_closed_dispute_never_moves_and_nothing_reopens_one() -> None:
    closed = {"RESOLVED", "REJECTED"}
    for current in DISPUTE_STATES:
        for target in DISPUTE_STATES:
            refusal = dispute_transition_refusal(current, target)
            if current in closed:
                assert refusal == "dispute_closed"
            elif (current, target) in DISPUTE_TRANSITIONS:
                assert refusal is None
    assert not {target for _, target in DISPUTE_TRANSITIONS} & {"OPEN"}
    assert set(DISPUTE_KINDS) == {"HIRE", "PAYMENT", "ACCOUNT", "OTHER"}


def test_a_drilldown_shows_the_last_four_digits_and_the_domain() -> None:
    assert mask_phone("+919876543210") == "+91******3210"
    assert mask_phone("9876543210") == "******3210"
    assert mask_phone("1234") == "****"
    assert mask_phone(None) is None
    assert mask_email("priya.sharma@example.com") == "p***@example.com"
    assert mask_email("not-an-address") is None


# --- the dashboard -----------------------------------------------------------------------
def test_every_system_role_has_a_dashboard() -> None:
    for role in SYSTEM_ROLES.values():
        assert "dashboard.view" in role.permissions, role.key


def test_a_role_sees_exactly_the_queues_it_can_open() -> None:
    from app.modules.admin.domain import dashboard_sections

    def shown(key: str) -> frozenset[str]:
        return dashboard_sections(SYSTEM_ROLES[key].permissions)

    assert shown("SUPER_ADMIN") == {"kyb", "integrity", "disputes", "tenants"}
    assert shown("KYB_REVIEWER") == {"kyb", "tenants"}
    assert shown("INTEGRITY_REVIEWER") == {"integrity"}
    assert shown("SUPPORT_AGENT") == {"disputes", "tenants"}
    assert shown("CONTENT_MANAGER") == frozenset()
    assert dashboard_sections(frozenset()) == frozenset()


def test_the_throughput_chart_is_fourteen_indian_days_ending_today() -> None:
    from datetime import UTC, date, datetime, timedelta

    from app.modules.admin.domain import THROUGHPUT_DAYS, throughput_series

    now = datetime(2026, 9, 22, 19, 0, tzinfo=UTC)  # 00:30 on the 23rd in India
    today = date(2026, 9, 23)
    series = throughput_series({today: 3}, {today - timedelta(days=1): 2}, now=now)
    assert len(series) == THROUGHPUT_DAYS
    assert series[-1] == (today, 3, 0)
    assert series[-2] == (today - timedelta(days=1), 0, 2)
    assert series[0][0] == today - timedelta(days=THROUGHPUT_DAYS - 1)
    with pytest.raises(ValueError):
        throughput_series({}, {}, now=datetime(2026, 9, 23))
