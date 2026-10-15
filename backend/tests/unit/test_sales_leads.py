"""The sales follow-up list's rules, without a database (2026-10-13)."""

from __future__ import annotations

import itertools
import typing

import pytest

from app.modules.admin.domain import (
    CONSOLE_ROLES,
    LEAD_STAGES,
    UNPAID_STAGES,
    LeadStage,
    lead_stage,
)


def test_the_list_is_no_wider_a_door_to_contacts_than_the_candidate_page() -> None:
    """It carries whole phone numbers and emails, so exactly the roles that
    already read one may open it. Widening either is one decision, made twice."""
    assert CONSOLE_ROLES["sales_leads"] == CONSOLE_ROLES["candidate_contact"]


def test_the_stage_names_agree() -> None:
    assert set(typing.get_args(LeadStage)) == set(LEAD_STAGES)
    assert set(UNPAID_STAGES) == set(LEAD_STAGES) - {"PAID", "COLLEGE_SEAT"}


@pytest.mark.parametrize(
    ("paid", "seated", "downloaded", "completed", "stage"),
    [
        (True, True, True, True, "PAID"),
        (False, True, True, True, "COLLEGE_SEAT"),
        (False, False, True, False, "RESUME_DOWNLOADED"),
        (False, False, False, True, "PROFILE_COMPLETE"),
        (False, False, False, False, "SIGNED_UP"),
    ],
)
def test_the_first_stage_that_holds_wins(
    paid: bool, seated: bool, downloaded: bool, completed: bool, stage: str
) -> None:
    assert (
        lead_stage(paid=paid, seated=seated, downloaded=downloaded, profile_completed=completed)
        == stage
    )


def test_every_combination_has_exactly_one_stage() -> None:
    for facts in itertools.product((False, True), repeat=4):
        paid, seated, downloaded, completed = facts
        assert (
            lead_stage(paid=paid, seated=seated, downloaded=downloaded, profile_completed=completed)
            in LEAD_STAGES
        )
