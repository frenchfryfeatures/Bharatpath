"""Reveal abuse controls, as pure rules: the limits document, the caps, the alerts."""

from __future__ import annotations

import uuid
from dataclasses import replace
from typing import Any

import pytest

from app.core.deps import require_active_access_window
from app.core.errors import PermissionDeniedError
from app.core.tenant import TenantContext
from app.modules.discovery.domain import (
    DEFAULT_LIMITS,
    MAX_VELOCITY_WINDOW_MINUTES,
    DiscoveryLimits,
    DiscoveryLimitsError,
    ViewCounts,
    anomalies,
    cap_refusal,
    limits_from_config,
)


def _counts(**overrides: Any) -> ViewCounts:
    base: dict[str, Any] = {
        "tenant_last_hour": 0,
        "tenant_last_day": 0,
        "actor_in_window": 0,
        "seen_by_tenant_last_hour": False,
        "seen_by_tenant_last_day": False,
        "seen_by_actor_in_window": False,
    }
    return ViewCounts(**{**base, **overrides})


LIMITS = DiscoveryLimits(
    views_per_hour=5,
    views_per_day=10,
    reveals_per_minute=20,
    search_pages_per_hour=300,
    velocity_window_minutes=10,
    velocity_views=3,
)


# --- the document -------------------------------------------------------------
def test_an_empty_document_is_the_defaults() -> None:
    assert limits_from_config({}) == DEFAULT_LIMITS


def test_a_partial_document_keeps_the_defaults_for_what_it_omits() -> None:
    limits = limits_from_config({"views_per_day": 500})
    assert limits == replace(DEFAULT_LIMITS, views_per_day=500)


@pytest.mark.parametrize(
    "document",
    [
        {"views_per_dya": 10},  # a misspelling must not leave the default live
        {"views_per_day": "300"},
        {"views_per_day": 12.5},
        {"views_per_day": True},
        {"views_per_day": 0},
        {"views_per_day": -1},
        {"views_per_day": 10**9},
        {"views_per_hour": 50, "views_per_day": 40},
        {"velocity_window_minutes": MAX_VELOCITY_WINDOW_MINUTES + 1},
    ],
)
def test_a_doubtful_document_is_refused_rather_than_guessed(document: dict[str, Any]) -> None:
    with pytest.raises(DiscoveryLimitsError):
        limits_from_config(document)


def test_the_defaults_satisfy_their_own_rules() -> None:
    assert limits_from_config({f: getattr(DEFAULT_LIMITS, f) for f in DEFAULT_LIMITS.__slots__})


# --- caps -----------------------------------------------------------------------
def test_under_both_caps_nothing_is_refused() -> None:
    assert cap_refusal(LIMITS, _counts(tenant_last_hour=4, tenant_last_day=9)) is None


def test_the_hourly_cap_refuses_a_new_candidate() -> None:
    assert cap_refusal(LIMITS, _counts(tenant_last_hour=5, tenant_last_day=5)) == "HOURLY"


def test_the_daily_cap_is_reported_before_the_hourly() -> None:
    assert cap_refusal(LIMITS, _counts(tenant_last_hour=5, tenant_last_day=10)) == "DAILY"


def test_reopening_a_candidate_already_seen_costs_nothing() -> None:
    at_caps = {"tenant_last_hour": 5, "tenant_last_day": 10}
    seen = _counts(**at_caps, seen_by_tenant_last_hour=True, seen_by_tenant_last_day=True)
    assert cap_refusal(LIMITS, seen) is None


def test_seen_earlier_today_but_not_this_hour_still_needs_hourly_room() -> None:
    counts = _counts(tenant_last_hour=5, tenant_last_day=10, seen_by_tenant_last_day=True)
    assert cap_refusal(LIMITS, counts) == "HOURLY"


# --- alerts ---------------------------------------------------------------------
def test_velocity_is_flagged_on_the_view_that_crosses_the_threshold_only() -> None:
    assert anomalies(LIMITS, _counts(actor_in_window=1)) == ()
    assert anomalies(LIMITS, _counts(actor_in_window=2)) == ("ACTOR_VELOCITY",)
    assert anomalies(LIMITS, _counts(actor_in_window=3)) == ()


def test_a_reopen_never_raises_an_alert() -> None:
    counts = _counts(
        actor_in_window=2,
        tenant_last_day=9,
        seen_by_actor_in_window=True,
        seen_by_tenant_last_day=True,
        seen_by_tenant_last_hour=True,
    )
    assert anomalies(LIMITS, counts) == ()


def test_filling_the_daily_cap_is_flagged() -> None:
    assert anomalies(LIMITS, _counts(tenant_last_day=9)) == ("DAILY_CAP_REACHED",)


# --- the access window -----------------------------------------------------------
async def test_only_a_tenant_has_an_access_window() -> None:
    """Refused before any subscription is read -- hence no session."""
    for role, pool in (("CANDIDATE", "CANDIDATE"), ("EMPLOYER_OWNER", "BUSINESS")):
        ctx = TenantContext(user_id=uuid.uuid4(), tenant_id=None, role=role, pool=pool)
        with pytest.raises(PermissionDeniedError):
            await require_active_access_window(ctx, None)  # type: ignore[arg-type]
