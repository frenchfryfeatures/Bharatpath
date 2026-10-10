"""Discount codes (2026-09-18): the pure rules, and the placeholders they carry.

Three questions went to the client (a 100% code, renewals, reuse). The
first is answered -- a code may be 100% (2026-10-09) -- and the other two are
still ours. These tests hold what the policy promises, and that it still says
it is a placeholder.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.modules.billing.domain import (
    CODE_ALPHABET,
    DISCOUNT_POLICY_VERSION,
    MAX_PERCENT_OFF,
    MIN_NET_AMOUNT_MINOR,
    DiscountCodeFormatError,
    discount_refusal,
    discount_status,
    discounted_price,
    generate_discount_code,
    normalise_discount_code,
    validate_discount_value,
)

NOW = datetime(2026, 9, 18, 12, 0, tzinfo=UTC)


def test_the_policy_is_still_flagged_as_ours_rather_than_the_clients() -> None:
    """Flipping this is a client decision, not a tidy-up (CLAUDE.md)."""
    assert DISCOUNT_POLICY_VERSION.startswith("placeholder-")


# --- the code itself ----------------------------------------------------------
def test_a_code_is_matched_whatever_case_the_payer_types() -> None:
    assert normalise_discount_code("  launch-50 ") == "LAUNCH-50"


@pytest.mark.parametrize("raw", ["ab", "x" * 33, "LAUNCH 50", "LAUNCH_50", "-LAUNCH", "LAUNCH-"])
def test_a_code_that_cannot_be_typed_back_is_refused(raw: str) -> None:
    with pytest.raises(DiscountCodeFormatError):
        normalise_discount_code(raw)


def test_a_generated_code_avoids_the_characters_people_misread() -> None:
    code = generate_discount_code(bytes(range(256))[:16])
    assert len(code) == 10
    assert set(code) <= set(CODE_ALPHABET)
    assert not set(code) & set("0O1IL")
    assert normalise_discount_code(code) == code


def test_generation_is_pure() -> None:
    entropy = b"0123456789abcdef"
    assert generate_discount_code(entropy) == generate_discount_code(entropy)


# --- what a code is worth -------------------------------------------------------
def test_a_code_is_a_percentage_or_an_amount_never_both_or_neither() -> None:
    with pytest.raises(ValueError):
        validate_discount_value(percent_off=10, amount_off_minor=100)
    with pytest.raises(ValueError):
        validate_discount_value(percent_off=None, amount_off_minor=None)


@pytest.mark.parametrize("percent", [0, 101, -5])
def test_a_percentage_is_one_to_a_hundred(percent: int) -> None:
    with pytest.raises(ValueError):
        validate_discount_value(percent_off=percent, amount_off_minor=None)


def test_a_hundred_percent_code_makes_the_price_zero() -> None:
    """The client's answer to question 1 (2026-10-09)."""
    assert MAX_PERCENT_OFF == 100
    price = discounted_price(14_999, percent_off=100, amount_off_minor=None)
    assert price is not None
    assert (price.list_amount_minor, price.discount_minor, price.amount_minor) == (
        14_999,
        14_999,
        0,
    )


def test_a_percentage_rounds_the_discount_down_to_the_paisa() -> None:
    price = discounted_price(14_999, percent_off=10, amount_off_minor=None)
    assert price is not None
    assert (price.list_amount_minor, price.discount_minor, price.amount_minor) == (
        14_999,
        1_499,
        13_500,
    )


def test_a_fixed_amount_may_make_it_free_but_never_leave_a_few_paise() -> None:
    free = discounted_price(14_900, percent_off=None, amount_off_minor=14_900)
    assert free is not None and free.amount_minor == 0
    # More than the price is not "free plus change": the code was not made
    # for this plan.
    assert discounted_price(14_900, percent_off=None, amount_off_minor=15_000) is None
    # A gateway order for 50 paise is a fee, not a price.
    assert discounted_price(14_900, percent_off=None, amount_off_minor=14_850) is None
    floor = discounted_price(
        14_900, percent_off=None, amount_off_minor=14_900 - MIN_NET_AMOUNT_MINOR
    )
    assert floor is not None and floor.amount_minor == MIN_NET_AMOUNT_MINOR


def test_the_parts_always_add_up() -> None:
    for percent in range(1, 101):
        price = discounted_price(499_900, percent_off=percent, amount_off_minor=None)
        assert price is not None
        assert price.list_amount_minor == price.amount_minor + price.discount_minor
        assert price.amount_minor == 0 or price.amount_minor >= MIN_NET_AMOUNT_MINOR


# --- status -------------------------------------------------------------------
def _status(**overrides: object) -> str:
    values: dict[str, object] = {
        "disabled": False,
        "valid_from": NOW - timedelta(days=1),
        "valid_until": NOW + timedelta(days=1),
        "usage_limit": 10,
        "used": 0,
        "now": NOW,
    }
    values.update(overrides)
    return discount_status(**values)  # type: ignore[arg-type]


def test_status_is_worked_out_from_the_row_and_the_clock() -> None:
    assert _status() == "ACTIVE"
    assert _status(valid_from=NOW + timedelta(hours=1)) == "SCHEDULED"
    assert _status(valid_until=NOW) == "EXPIRED"
    assert _status(used=10) == "EXHAUSTED"
    assert _status(usage_limit=None, used=10_000, valid_until=None) == "ACTIVE"


def test_a_code_someone_switched_off_says_so_before_anything_else() -> None:
    assert _status(disabled=True, used=10, valid_until=NOW - timedelta(days=5)) == "DISABLED"


# --- whether this checkout may use it --------------------------------------------
def _refusal(**overrides: object) -> str | None:
    values: dict[str, object] = {
        "status": "ACTIVE",
        "audience_matches": True,
        "already_used_by_subscriber": False,
        "held": 0,
        "usage_limit": 10,
        "used": 0,
    }
    values.update(overrides)
    return discount_refusal(**values)  # type: ignore[arg-type]


def test_an_active_code_for_this_kind_of_account_is_accepted() -> None:
    assert _refusal() is None


def test_one_answer_for_every_reason_that_is_about_whether_a_code_exists() -> None:
    """Unknown (handled by the service), switched off, not started, or for
    another kind of account: the form must not reveal which codes exist."""
    assert _refusal(status="DISABLED") == "discount_code_invalid"
    assert _refusal(status="SCHEDULED") == "discount_code_invalid"
    assert _refusal(audience_matches=False) == "discount_code_invalid"


def test_expired_exhausted_and_already_used_are_told_apart() -> None:
    assert _refusal(status="EXPIRED") == "discount_code_expired"
    assert _refusal(status="EXHAUSTED") == "discount_code_exhausted"
    assert _refusal(already_used_by_subscriber=True) == "discount_code_already_used"


def test_a_checkout_in_progress_holds_the_last_use() -> None:
    """Ten people must not all check out against the last use of a code."""
    assert _refusal(usage_limit=3, used=2, held=1) == "discount_code_exhausted"
    assert _refusal(usage_limit=3, used=1, held=1) is None
    assert _refusal(usage_limit=None, used=500, held=500) is None
