"""analytics - pure domain logic

Cohort aggregates, placement tracking.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**What a college is shown about students who agreed only to be counted.**
ROSTER consent says "totals and statistics that never name you" (the words in
`college.domain`), so every number here has to be safe beside a list of names
the college already holds -- its own roster, where it can see who accepted.
Three rules do that, in order:

  1. **A cohort floor.** Below `min_cohort_size` connected students, nothing
     is shown but the count. A median of three people is one of them.
  2. **Small cells can be suppressed, with a complement.** A band or a month
     holding fewer than `min_cell_size` students is withheld; and if exactly
     one cell was withheld, the next smallest is withheld too, because a total
     minus every other cell is the withheld one. Zero is shown: it names nobody.
     **Off by default** (client, 2026-09-30): above the
     cohort floor a college sees exact numbers, because exact outcomes are what
     it pays for on its students' behalf. `min_cell_size` 1 withholds nothing;
     a config row may still raise it.
  3. **Coarse values.** The median is rounded to `median_step`; a job location
     is named only when `min_cell_size` hires share it, and the rest are pooled.

**What this does not stop**, recorded rather than hidden: a college that reads
the dashboard, watches one named student accept an invitation, and reads it
again can see which band moved. Cell suppression narrows that; nothing short
of delaying or noising every number removes it, and consent to be counted is
consent to that residual.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields
from datetime import datetime, timedelta, timezone
from typing import Final

from app.modules.scoring.domain import BANDS, band_for

# ---------------------------------------------------------------------------
# Floors
# ---------------------------------------------------------------------------
#: The platform's source label on every outcome figure (SRS 1.16.3, 2.25.3).
PLATFORM_SOURCED: Final = "PLATFORM"


@dataclass(frozen=True, slots=True)
class PrivacyFloors:
    """Every number that decides what an aggregate may show.

    Loaded from `config_values` key `analytics.privacy`; these defaults apply
    only when no row exists. The cohort floor and the median step are still
    ours; exact cells (`min_cell_size` 1) are the client's (2026-09-30).
    """

    #: Connected students below which nothing but the count is shown.
    min_cohort_size: int = 10
    #: Students (or hires) below which one band, month or location is withheld.
    #: 1 withholds nothing: exact numbers above the cohort floor (2026-09-30).
    min_cell_size: int = 1
    #: The median is rounded to the nearest multiple of this.
    median_step: int = 10


DEFAULT_FLOORS: Final = PrivacyFloors()

#: The cohort floor may be raised, never set below 5: under that a median or a
#: band is one person, and a typo should not be able to put one there. The
#: cell floor may be 1 -- exact cells, the client's decision of 2026-09-30.
LOWEST_COHORT_FLOOR: Final = 5
LOWEST_CELL_FLOOR: Final = 1
MAX_FLOOR: Final = 10_000
MAX_MEDIAN_STEP: Final = 50


class PrivacyFloorsError(ValueError):
    """An `analytics.privacy` document that cannot be applied."""


def floors_from_config(value: Mapping[str, object]) -> PrivacyFloors:
    """Parse a `config_values` document. **Strict**, as `discovery.limits` is:
    an unknown key is likelier a misspelling than a decision, and ignoring it
    would leave the default live while the row looked applied."""
    names = {f.name for f in fields(PrivacyFloors)}
    unknown = set(value) - names
    if unknown:
        raise PrivacyFloorsError(f"unknown analytics privacy keys: {sorted(unknown)}")
    parsed: dict[str, int] = {}
    for name in names:
        raw = value.get(name, getattr(DEFAULT_FLOORS, name))
        if not isinstance(raw, int) or isinstance(raw, bool):
            raise PrivacyFloorsError(f"{name} must be an integer")
        parsed[name] = raw
    floors = PrivacyFloors(**parsed)
    if not LOWEST_COHORT_FLOOR <= floors.min_cohort_size <= MAX_FLOOR:
        raise PrivacyFloorsError(
            f"min_cohort_size must be between {LOWEST_COHORT_FLOOR} and {MAX_FLOOR}"
        )
    if not LOWEST_CELL_FLOOR <= floors.min_cell_size <= floors.min_cohort_size:
        raise PrivacyFloorsError(
            f"min_cell_size must be between {LOWEST_CELL_FLOOR} and min_cohort_size"
        )
    if not 1 <= floors.median_step <= MAX_MEDIAN_STEP:
        raise PrivacyFloorsError(f"median_step must be between 1 and {MAX_MEDIAN_STEP}")
    return floors


def suppress_cells(counts: Mapping[str, int], *, min_cell_size: int) -> dict[str, int | None]:
    """Withhold every cell from 1 to `min_cell_size - 1`, and its complement.

    Order is kept. **If exactly one cell was withheld**, another is withheld
    with it -- otherwise the published total minus the rest gives it back. The
    smallest other non-zero cell (ties: first in order), or, when every other
    cell is zero, the first zero: "these two hold 3 between them" does not say
    which. Two or more withheld cells hide each other.
    """
    shown: dict[str, int | None] = {
        key: (None if 0 < n < min_cell_size else n) for key, n in counts.items()
    }
    withheld = [key for key, n in shown.items() if n is None]
    if len(withheld) == 1:
        others = [(n == 0, n, i, key) for i, (key, n) in enumerate(shown.items()) if n is not None]
        if others:
            *_, partner = min(others)
            shown[partner] = None
    return shown


def rounded_median(values: Sequence[int], *, step: int) -> int:
    """The median, to the nearest `step` (halves up). Raises on no values."""
    if not values:
        raise ValueError("no values")
    ordered = sorted(values)
    middle = len(ordered) // 2
    exact = (
        float(ordered[middle]) if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2
    )
    return int((exact + step / 2) // step * step)


# ---------------------------------------------------------------------------
# The overview (SRS 1.16.1, 2.10.4)
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class CohortCounts:
    """What `college_cohort_summary` counted, over live ROSTER consent."""

    connected: int
    individually_visible: int
    scored: int
    applicants: int
    applications: int
    interviews: int
    hires: int


@dataclass(frozen=True, slots=True)
class CohortOverview:
    connected_students: int
    individually_visible: int
    min_cohort_size: int
    #: True when the cohort is under the floor and only the counts above show.
    below_floor: bool
    scored_students: int | None
    #: Band -> students, in band order. A withheld band is None. The whole
    #: distribution is None when fewer than `min_cohort_size` are scored.
    score_distribution: dict[str, int | None] | None
    median_score: int | None
    applicants: int | None
    applications: int | None
    interviews: int | None
    platform_hires: int | None


def build_overview(
    counts: CohortCounts, scores: Sequence[int], floors: PrivacyFloors
) -> CohortOverview:
    """`scores` are display values, one per scored student, with nothing
    saying whose (`college_cohort_scores`)."""
    connected, visible = counts.connected, counts.individually_visible
    if connected < floors.min_cohort_size:
        return CohortOverview(
            connected_students=connected,
            individually_visible=visible,
            min_cohort_size=floors.min_cohort_size,
            below_floor=True,
            scored_students=None,
            score_distribution=None,
            median_score=None,
            applicants=None,
            applications=None,
            interviews=None,
            platform_hires=None,
        )
    distribution: dict[str, int | None] | None = None
    median: int | None = None
    if len(scores) >= floors.min_cohort_size:
        by_band = dict.fromkeys((label for label, _, _ in BANDS), 0)
        for value in scores:
            by_band[band_for(value)] += 1
        distribution = suppress_cells(by_band, min_cell_size=floors.min_cell_size)
        median = rounded_median(scores, step=floors.median_step)
    return CohortOverview(
        connected_students=connected,
        individually_visible=visible,
        min_cohort_size=floors.min_cohort_size,
        below_floor=False,
        scored_students=counts.scored,
        score_distribution=distribution,
        median_score=median,
        applicants=counts.applicants,
        applications=counts.applications,
        interviews=counts.interviews,
        platform_hires=counts.hires,
    )


# ---------------------------------------------------------------------------
# Placements (SRS 1.16.3, 2.10.5)
# ---------------------------------------------------------------------------
#: India keeps one offset all year, so a fixed one is exact and keeps this pure.
IST: Final = timezone(timedelta(hours=5, minutes=30))
TREND_MONTHS: Final = 12
#: Where hires in locations too small to name are counted.
OTHER_LOCATIONS: Final = "OTHER"


@dataclass(frozen=True, slots=True)
class Hire:
    """One confirmed platform hire of a consenting student. No identity."""

    hired_at: datetime
    job_location: str | None


@dataclass(frozen=True, slots=True)
class PlacementReport:
    source: str
    min_cohort_size: int
    below_floor: bool
    total_hires: int | None
    #: `(YYYY-MM, hires)`, oldest first, the last `TREND_MONTHS` in IST with
    #: the current month last. A withheld month is None.
    by_month: list[tuple[str, int | None]]
    #: `(location, hires)`, largest first, then `OTHER` if anything was pooled.
    by_location: list[tuple[str, int]]


def month_key(moment: datetime) -> str:
    return moment.astimezone(IST).strftime("%Y-%m")


def trailing_months(now: datetime, *, months: int = TREND_MONTHS) -> list[str]:
    """`months` month keys ending with the current IST month, oldest first."""
    local = now.astimezone(IST)
    year, month = local.year, local.month
    keys: list[str] = []
    for _ in range(months):
        keys.append(f"{year:04d}-{month:02d}")
        year, month = (year, month - 1) if month > 1 else (year - 1, 12)
    return list(reversed(keys))


def location_label(raw: str | None) -> str | None:
    """A job location as typed by an employer, made groupable: whitespace
    collapsed, case folded to title case. Empty is no location."""
    if raw is None:
        return None
    cleaned = re.sub(r"\s+", " ", raw).strip()
    return cleaned.title() if cleaned else None


def build_placements(
    connected: int, hires: Sequence[Hire], floors: PrivacyFloors, *, now: datetime
) -> PlacementReport:
    """Only hires both sides confirmed on the platform reach here, so every
    figure is platform-sourced by construction, and labelled so. Placements
    made elsewhere are not in the data at all, and are never estimated."""
    months = trailing_months(now)
    if connected < floors.min_cohort_size:
        return PlacementReport(
            source=PLATFORM_SOURCED,
            min_cohort_size=floors.min_cohort_size,
            below_floor=True,
            total_hires=None,
            by_month=[(key, None) for key in months],
            by_location=[],
        )
    per_month = dict.fromkeys(months, 0)
    per_location: dict[str, int] = {}
    for hire in hires:
        key = month_key(hire.hired_at)
        if key in per_month:
            per_month[key] += 1
        label = location_label(hire.job_location) or OTHER_LOCATIONS
        per_location[label] = per_location.get(label, 0) + 1

    named = sorted(
        (
            (label, n)
            for label, n in per_location.items()
            if label != OTHER_LOCATIONS and n >= floors.min_cell_size
        ),
        key=lambda item: (-item[1], item[0]),
    )
    pooled = len(hires) - sum(n for _, n in named)
    by_location = [*named, (OTHER_LOCATIONS, pooled)] if pooled else named
    trend = suppress_cells(per_month, min_cell_size=floors.min_cell_size)
    return PlacementReport(
        source=PLATFORM_SOURCED,
        min_cohort_size=floors.min_cohort_size,
        below_floor=False,
        total_hires=len(hires),
        by_month=list(trend.items()),
        by_location=by_location,
    )


# ---------------------------------------------------------------------------
# Where the cohort's applications stand (2026-09-29)
# ---------------------------------------------------------------------------
#: The stages a college is shown, current and reached. Kept here rather than
#: imported so this module stays free of `applications` (invariant 9's
#: source check covers the college-facing files).
APPLICATION_STAGES: Final = (
    "SUBMITTED",
    "VIEWED",
    "SHORTLISTED",
    "INTERVIEW",
    "DECISION",
    "HIRED",
    "REJECTED",
    "WITHDRAWN",
    "EXPIRED",
)
APPLICATION_MILESTONES: Final = ("SHORTLISTED", "INTERVIEW", "DECISION", "HIRED")


@dataclass(frozen=True, slots=True)
class CohortApplication:
    """One application of a linked student. No identity."""

    stage: str
    reached: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ApplicationFunnel:
    min_cohort_size: int
    below_floor: bool
    total: int | None
    #: Every stage, with small cells withheld as None (`suppress_cells`).
    by_stage: dict[str, int | None]
    #: Applications that ever reached each milestone, floored the same way.
    reached: dict[str, int | None]


def build_application_funnel(
    connected: int, applications: Sequence[CohortApplication], floors: PrivacyFloors
) -> ApplicationFunnel:
    """The cohort's applications by stage, and how many ever reached each
    milestone. Nothing under the cohort floor; below it, every figure is None.

    Each distribution is suppressed on its own, as the score bands are: a
    small cell and its complement are withheld, so no single student's
    application can be read off the numbers.
    """
    if connected < floors.min_cohort_size:
        return ApplicationFunnel(
            min_cohort_size=floors.min_cohort_size,
            below_floor=True,
            total=None,
            by_stage=dict.fromkeys(APPLICATION_STAGES),
            reached=dict.fromkeys(APPLICATION_MILESTONES),
        )
    by_stage = dict.fromkeys(APPLICATION_STAGES, 0)
    reached = dict.fromkeys(APPLICATION_MILESTONES, 0)
    for application in applications:
        by_stage[application.stage] = by_stage.get(application.stage, 0) + 1
        for milestone in set(application.reached) | {application.stage}:
            if milestone in reached:
                reached[milestone] += 1
    return ApplicationFunnel(
        min_cohort_size=floors.min_cohort_size,
        below_floor=False,
        total=len(applications),
        by_stage=suppress_cells(by_stage, min_cell_size=floors.min_cell_size),
        reached=suppress_cells(reached, min_cell_size=floors.min_cell_size),
    )
