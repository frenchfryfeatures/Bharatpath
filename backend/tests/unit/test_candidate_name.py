"""The candidate's name, asked at sign-up: what counts as one."""

from __future__ import annotations

import pytest

from app.modules.candidate.domain import MAX_NAME_LENGTH, normalise_full_name


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("  Kavya   Iyer ", "Kavya Iyer"),
        ("S. Ramaswamy", "S. Ramaswamy"),
        ("Ashley D'Souza", "Ashley D'Souza"),
        ("Mary-Ann Thomas", "Mary-Ann Thomas"),
        ("राहुल शर्मा", "राहुल शर्मा"),
        ("முருகன்", "முருகன்"),
    ],
)
def test_names_in_any_script_are_accepted(raw: str, expected: str) -> None:
    assert normalise_full_name(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "Ravi 9876543210",
        "ravi@example.com",
        "...",
        "x" * (MAX_NAME_LENGTH + 1),
    ],
)
def test_contact_details_and_empty_names_are_refused(raw: str) -> None:
    with pytest.raises(ValueError):
        normalise_full_name(raw)
