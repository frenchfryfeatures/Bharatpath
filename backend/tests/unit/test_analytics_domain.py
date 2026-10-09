"""What an aggregate may show about students who agreed only to be counted.

The floors are the protection, so they are tested as rules rather than as
numbers: below the cohort floor nothing but the count shows; a small cell is
withheld and so is its complement, so a published total cannot give it back;
a config row can raise a floor and never remove one.

**The default shows exact cells** (client, 2026-09-30):
`min_cell_size` 1. The suppression rules are still tested with an explicit
floor of 5, because a config row can switch them back on.
"""

from __future__ import annotations

import itertools
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.analytics.domain import (
    DEFAULT_FLOORS,
    IST,
    OTHER_LOCATIONS,
    PLATFORM_SOURCED,
    CohortCounts,
    Hire,
    PrivacyFloors,
    PrivacyFloorsError,
    build_overview,
    build_placements,
    floors_from_config,
    location_label,
    month_key,
    rounded_median,
    suppress_cells,
    trailing_months,
)

FLOORS = PrivacyFloors(min_cohort_size=10, min_cell_size=5, median_step=10)


def _counts(connected: int, **overrides: int) -> CohortCounts:
    base = {
        "connected": connected,
        "individually_visible": 1,
        "scored": connected,
        "applicants": 4,
        "applications": 9,
        "interviews": 3,
        "hires": 2,
    }
    return CohortCounts(**{**base, **overrides})


# --- config ------------------------------------------------------------------------
def test_no_row_means_the_defaults_and_an_empty_row_means_them_too() -> None:
    assert floors_from_config({}) == DEFAULT_FLOORS
    assert PrivacyFloors(min_cohort_size=10, min_cell_size=1, median_step=10) == DEFAULT_FLOORS


@pytest.mark.parametrize(
    ("value", "why"),
    [
        ({"min_cohort_sise": 20}, "a misspelt key would leave the default live"),
        ({"min_cohort_size": "20"}, "a string is not a number"),
        ({"min_cohort_size": True}, "a boolean is not a number"),
        ({"min_cohort_size": 4}, "a floor below five is barely a floor"),
        ({"min_cohort_size": 1}, "a floor of one is a person"),
        ({"min_cell_size": 0}, "a cell floor of zero is not a number of hires"),
        ({"min_cohort_size": 6, "min_cell_size": 7}, "a cell cannot be bigger than the cohort"),
        ({"median_step": 0}, "a step of zero divides by zero"),
        ({"median_step": 51}, "a step that wide is not a median"),
    ],
)
def test_a_config_row_can_raise_a_floor_and_never_remove_one(
    value: dict[str, object], why: str
) -> None:
    with pytest.raises(PrivacyFloorsError):
        floors_from_config(value)


def test_the_client_default_shows_every_cell_exactly() -> None:
    """2026-09-30: above the cohort floor a college sees exact numbers. One
    hire in a month is 1, one STRONG student is 1, one hire's city is named."""
    assert suppress_cells({"A": 0, "B": 1, "C": 3}, min_cell_size=1) == {"A": 0, "B": 1, "C": 3}
    view = build_overview(_counts(10), [720] * 6 + [800, 800, 850, 950], DEFAULT_FLOORS)
    assert not view.below_floor
    assert view.score_distribution is not None
    assert None not in view.score_distribution.values()
    report = build_placements(40, [Hire(NOW, "Pune")], DEFAULT_FLOORS, now=NOW)
    months = dict(report.by_month)
    assert months["2026-09"] == 1 and None not in months.values()
    assert report.by_location == [("Pune", 1)]


def test_the_cohort_floor_still_holds_by_default() -> None:
    """Exact cells are above the floor only: under ten connected students a
    median or a band would be one of a handful of people."""
    view = build_overview(_counts(9), [800] * 9, DEFAULT_FLOORS)
    assert view.below_floor and view.score_distribution is None and view.median_score is None


def test_raising_the_floors_is_accepted() -> None:
    floors = floors_from_config({"min_cohort_size": 25, "min_cell_size": 10})
    assert (floors.min_cohort_size, floors.min_cell_size, floors.median_step) == (25, 10, 10)


# --- suppression -------------------------------------------------------------------
def test_small_cells_are_withheld_and_zero_is_shown() -> None:
    shown = suppress_cells({"A": 0, "B": 3, "C": 12, "D": 4}, min_cell_size=5)
    assert shown == {"A": 0, "B": None, "C": 12, "D": None}


def test_one_withheld_cell_takes_the_next_smallest_with_it() -> None:
    """Otherwise total minus the rest is the withheld cell."""
    shown = suppress_cells({"A": 7, "B": 2, "C": 20, "D": 6}, min_cell_size=5)
    assert shown == {"A": 7, "B": None, "C": 20, "D": None}


def test_nothing_small_means_nothing_withheld() -> None:
    counts = {"A": 5, "B": 0, "C": 11}
    assert suppress_cells(counts, min_cell_size=5) == counts


def test_no_withheld_cell_can_be_recovered_from_the_total() -> None:
    """Exhaustive over four cells of 0-7: whenever something is withheld, at
    least two cells are, so total minus the shown cells is never one cell.

    It found the case the first version missed: one small cell and every other
    cell zero, where there was no non-zero partner to withhold beside it."""
    for cells in itertools.product(range(8), repeat=4):
        counts = dict(zip("ABCD", cells, strict=True))
        shown = suppress_cells(counts, min_cell_size=5)
        withheld = [key for key, value in shown.items() if value is None]
        assert len(withheld) != 1, cells
        for key, value in shown.items():
            if value is not None:
                assert value == counts[key], cells
                assert value == 0 or value >= 5, cells


def test_a_lone_small_cell_is_hidden_beside_a_zero() -> None:
    assert suppress_cells({"A": 0, "B": 3, "C": 0}, min_cell_size=5) == {
        "A": None,
        "B": None,
        "C": 0,
    }


# --- median ------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("values", "step", "expected"),
    [
        ([812], 10, 810),
        ([700, 990], 10, 850),
        ([801, 803, 999], 10, 800),
        ([805], 10, 810),
        ([804], 10, 800),
        ([700, 701, 702, 703], 1, 702),
    ],
)
def test_the_median_is_rounded(values: list[int], step: int, expected: int) -> None:
    assert rounded_median(values, step=step) == expected


def test_there_is_no_median_of_nobody() -> None:
    with pytest.raises(ValueError):
        rounded_median([], step=10)


# --- overview ----------------------------------------------------------------------
def test_below_the_cohort_floor_only_the_counts_show() -> None:
    view = build_overview(_counts(9), [800] * 9, FLOORS)
    assert view.below_floor and (view.connected_students, view.individually_visible) == (9, 1)
    assert view.score_distribution is None and view.median_score is None
    assert (view.applicants, view.applications, view.interviews, view.platform_hires) == (
        None,
        None,
        None,
        None,
    )


def test_at_the_floor_the_cohort_is_described() -> None:
    scores = [720] * 6 + [800] * 2 + [900] * 2
    view = build_overview(_counts(10), scores, FLOORS)
    assert not view.below_floor
    assert view.score_distribution == {
        "ENTRY": 6,
        "DEVELOPING": None,
        "SOLID": 0,
        "STRONG": None,
    }
    assert view.median_score == 720
    assert (view.applications, view.interviews, view.platform_hires) == (9, 3, 2)


def test_a_connected_cohort_with_too_few_scores_shows_no_distribution() -> None:
    view = build_overview(_counts(30, scored=9), [800] * 9, FLOORS)
    assert not view.below_floor and view.scored_students == 9
    assert view.score_distribution is None and view.median_score is None


# --- placements --------------------------------------------------------------------
NOW = datetime(2026, 9, 17, 6, 0, tzinfo=UTC)


def test_months_are_india_months_ending_now() -> None:
    months = trailing_months(NOW)
    assert len(months) == 12 and months[0] == "2025-10" and months[-1] == "2026-09"
    assert trailing_months(datetime(2026, 1, 5, tzinfo=UTC), months=3) == [
        "2025-11",
        "2025-12",
        "2026-01",
    ]
    # 20:00 UTC on 31 August is 01:30 on 1 September in India.
    assert month_key(datetime(2026, 8, 31, 20, 0, tzinfo=UTC)) == "2026-09"
    assert month_key(datetime(2026, 8, 31, 18, 0, tzinfo=UTC)) == "2026-08"
    assert IST.utcoffset(None) == timedelta(hours=5, minutes=30)


def test_placements_are_labelled_platform_sourced_and_floored() -> None:
    report = build_placements(9, [Hire(NOW, "Pune")] * 6, FLOORS, now=NOW)
    assert report.source == PLATFORM_SOURCED
    assert report.below_floor and report.total_hires is None and report.by_location == []
    assert all(n is None for _, n in report.by_month)


def test_small_months_are_withheld_and_small_places_are_pooled() -> None:
    hires = (
        [Hire(NOW, "Pune")] * 5
        + [Hire(NOW, "  bengaluru ")] * 3
        + [Hire(NOW, "BENGALURU")] * 3
        + [Hire(NOW - timedelta(days=31), "Mumbai")] * 6
        + [Hire(NOW - timedelta(days=62), "Nagpur")] * 2
        + [Hire(NOW - timedelta(days=62), None)]
        + [Hire(NOW - timedelta(days=800), "Pune")]
    )
    report = build_placements(40, hires, FLOORS, now=NOW)
    assert report.total_hires == 21
    months = dict(report.by_month)
    assert months["2026-09"] == 11
    assert months["2026-07"] is None, "three hires in July is too few to show"
    assert months["2026-08"] is None, "and the smallest other month goes with it"
    assert months["2026-06"] == 0
    assert report.by_location == [
        ("Bengaluru", 6),
        ("Mumbai", 6),
        ("Pune", 6),
        (OTHER_LOCATIONS, 3),
    ]


def test_withholding_one_of_two_months_withholds_both() -> None:
    hires = [Hire(NOW, "Pune")] * 11 + [Hire(NOW - timedelta(days=62), "Pune")] * 3
    months = dict(build_placements(40, hires, FLOORS, now=NOW).by_month)
    assert months["2026-09"] is None and months["2026-07"] is None


def test_a_location_is_grouped_however_it_was_typed() -> None:
    assert location_label("  new   delhi ") == location_label("NEW DELHI") == "New Delhi"
    assert location_label("   ") is None and location_label(None) is None
