"""Masked search as pure rules: what a card may say, and what a city may be.

The card's field list is an invariant (`tests/invariants/test_masked_candidate.py`).
These are the rules for the free text that still reaches it -- skills from a
CV, and a city the candidate typed -- because a schema with no `phone` field
can still be handed a phone number inside a string.
"""

from __future__ import annotations

import pytest

from app.modules.candidate.domain import STATE_CODES, normalise_city
from app.modules.discovery.domain import (
    MAX_CARD_SKILLS,
    MAX_EXPERIENCE_YEARS,
    displayable_skills,
    experience_years,
    looks_like_contact,
    skill_key,
)


@pytest.mark.parametrize(
    "value",
    [
        "ravi.k@example.com",
        "+91 98765 43210",
        "9876543210",
        "call 98765-43210 now",
        "(022) 2345 6789",
    ],
)
def test_contact_details_are_recognised(value: str) -> None:
    assert looks_like_contact(value)


@pytest.mark.parametrize(
    "value",
    [
        "Six Sigma",
        "SAP S/4HANA",
        "ISO 9001:2015",
        "IEC 61131-3",
        "Python 3.12",
        "AutoCAD 2024",
        "5S",
    ],
)
def test_ordinary_skills_are_not_mistaken_for_contact_details(value: str) -> None:
    """A filter that ate real skills would quietly make certified people
    unsearchable for the certification they hold."""
    assert not looks_like_contact(value)


def test_a_card_drops_contact_details_blanks_and_overlong_skills() -> None:
    shown = displayable_skills(
        ["  SAP ", "", "ravi@example.com", "x" * 81, 42, "Lean", "+91 98765 43210"]
    )
    assert shown == ["SAP", "Lean"]


def test_a_card_shows_a_bounded_number_of_skills_in_order() -> None:
    skills = [f"Skill{i}" for i in range(50)]
    assert displayable_skills(skills) == skills[:MAX_CARD_SKILLS]


@pytest.mark.parametrize(
    ("months", "years"),
    [(0, 0), (11, 0), (12, 1), (77, 6), (-5, 0), (10_000, MAX_EXPERIENCE_YEARS)],
)
def test_experience_rounds_down_to_whole_years(months: int, years: int) -> None:
    assert experience_years(months) == years


def test_a_skill_is_matched_trimmed_and_case_folded() -> None:
    assert skill_key("  Six SIGMA ") == "six sigma"


@pytest.mark.parametrize(
    ("raw", "city"),
    [
        ("Pune", "Pune"),
        ("  New   Delhi ", "New Delhi"),
        ("नई दिल्ली", "नई दिल्ली"),
        ("Pimpri-Chinchwad", "Pimpri-Chinchwad"),
        ("St. Thomas' Mount", "St. Thomas' Mount"),
    ],
)
def test_a_city_is_normalised(raw: str, city: str) -> None:
    assert normalise_city(raw) == city


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "Pune 411001",
        "ravi@example.com",
        "...",
        "x" * 101,
        "Pune" + chr(0),
        "Pune/Mumbai",
    ],
)
def test_a_city_that_could_carry_anything_else_is_refused(raw: str) -> None:
    with pytest.raises(ValueError):
        normalise_city(raw)


def test_state_codes_are_the_reference_list() -> None:
    assert len(STATE_CODES) == 36
    assert {"MH", "KA", "DL", "LA"} <= STATE_CODES
