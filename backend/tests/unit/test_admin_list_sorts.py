"""The console's list sorts and person search, without a database (2026-10-21).

Each list's `sort` is a `Literal` in the router and a table of keys in a
repository. A name in one and not the other is either a sort the API
documents and refuses (422 `invalid_sort`), or one it serves and does not
document. These hold the two equal, and hold who may search by part of a
contact.
"""

from __future__ import annotations

import inspect
import typing
from typing import Any

import pytest

from app.modules.admin import repository as admin_repository
from app.modules.admin import router
from app.modules.admin.domain import (
    CONSOLE_ROLES,
    INTEGRITY_REVIEWER,
    KYB_REVIEWER,
    PLATFORM_ADMIN,
    SUPPORT_AGENT,
    PersonSearch,
    partial_contact_search,
)
from app.modules.billing import repository as billing_repository
from app.modules.discovery import repository as discovery_repository
from app.modules.identity import repository as identity_repository

#: (router function, its `sort` Literal, the sort table it is resolved against)
LISTS: list[tuple[Any, Any, dict]] = [
    (router.list_candidates, router.CandidateSort, admin_repository.CANDIDATE_SORTS),
    (router.list_leads, router.LeadSort, admin_repository.LEAD_SORTS),
    (router.list_kyb_submissions, router.KybSort, admin_repository.KYB_SORTS),
    (router.integrity_queue, router.SignalSort, admin_repository.SIGNAL_SORTS),
    (router.dispute_queue, router.DisputeSort, admin_repository.DISPUTE_SORTS),
    (router.list_tenants, router.TenantSort, identity_repository.TENANT_SORTS),
    (router.list_discount_codes, router.DiscountCodeSort, billing_repository.DISCOUNT_CODE_SORTS),
    (router.discount_redemptions, router.RedemptionSort, billing_repository.REDEMPTION_SORTS),
    (
        router.list_search_filter_options,
        router.FilterOptionSort,
        discovery_repository.FILTER_OPTION_SORTS,
    ),
]


@pytest.mark.parametrize(
    ("endpoint", "offered", "table"), LISTS, ids=lambda v: getattr(v, "__name__", "")
)
def test_the_router_offers_exactly_the_sorts_the_repository_has(
    endpoint: Any, offered: Any, table: dict
) -> None:
    assert set(typing.get_args(offered)) == set(table)
    default = inspect.signature(endpoint).parameters["sort"].default
    assert default == next(iter(table)), "the router's default is the table's first sort"


@pytest.mark.parametrize(
    ("endpoint", "offered", "table"), LISTS, ids=lambda v: getattr(v, "__name__", "")
)
def test_every_sort_ends_in_a_unique_key(endpoint: Any, offered: Any, table: dict) -> None:
    """Without one the order is not total, and a page boundary between two
    equal rows skips one of them or shows it twice."""
    for name, field in table.items():
        assert field.keys[-1].column == "id", name
        assert not field.keys[-1].nullable, name


def test_the_audit_trail_sorts_by_time_only() -> None:
    assert set(admin_repository.AUDIT_SORTS) == {"occurred_at"}


def test_part_of_a_contact_is_for_the_roles_that_read_whole_contacts() -> None:
    """On a list that masks contacts, matching part of an address spells it
    out one character at a time: `a`, then `ab`, then `abc`."""
    assert {r for r in (PLATFORM_ADMIN, SUPPORT_AGENT) if partial_contact_search(r)} == {
        PLATFORM_ADMIN,
        SUPPORT_AGENT,
    }
    assert not partial_contact_search(INTEGRITY_REVIEWER)
    assert not partial_contact_search(KYB_REVIEWER)
    for role in CONSOLE_ROLES["candidate_drilldown"]:
        assert partial_contact_search(role) == (role in CONSOLE_ROLES["candidate_contact"])


def test_a_search_is_audited_by_how_it_was_made_never_by_its_terms() -> None:
    search = PersonSearch(name="Asha", email="asha@example.com", phone="9876", partial_contact=True)
    audited = search.audit()
    assert audited == {
        "by_name": True,
        "by_email": True,
        "by_phone": True,
        "partial_contact": True,
    }
    assert not {"Asha", "asha@example.com", "9876"} & {str(v) for v in audited.values()}
    assert not PersonSearch().given
