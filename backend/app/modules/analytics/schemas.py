"""analytics - Pydantic request/response DTOs

Cohort aggregates, placement tracking.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**No schema here can hold a person.** There is no field for an id, a name, a
contact or a single student's score: `tests/invariants/test_invariant_09_consent.py`
walks these models. A withheld figure is `null`, never an estimate.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.core.schemas import ApiSchema


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class ScoreDistribution(_Base):
    """Students per band. `null` means withheld: too few to show safely."""

    ENTRY: int | None
    DEVELOPING: int | None
    SOLID: int | None
    STRONG: int | None


class CohortOverviewResponse(_Base):
    connected_students: int = Field(description="Students currently linked to the college.")
    individually_visible: int = Field(
        description="Of those, students who let the college see them by name."
    )
    min_cohort_size: int = Field(description="Below this many, only the two counts above show.")
    below_floor: bool
    scored_students: int | None
    score_distribution: ScoreDistribution | None = Field(
        description="`null` until at least `min_cohort_size` connected students have a score."
    )
    median_score: int | None = Field(description="Rounded. `null` with the distribution.")
    applicants: int | None
    applications: int | None
    interviews: int | None = Field(description="Applications that reached an interview.")
    platform_hires: int | None = Field(
        description="Hires both sides confirmed on BharatPath. Never includes outside placements."
    )


class MonthCount(_Base):
    month: str = Field(description="`YYYY-MM`, India time.")
    hires: int | None = Field(description="`null` means withheld: too few to show safely.")


class LocationCount(_Base):
    location: str = Field(
        description="As the employer wrote it. `OTHER` pools locations too small to name."
    )
    hires: int


class PlacementReportResponse(_Base):
    source: Literal["PLATFORM"] = Field(
        description=(
            "Every figure is a hire confirmed on BharatPath by both sides. Placements "
            "made outside the platform are not counted and are never attributed to it."
        )
    )
    min_cohort_size: int
    below_floor: bool
    total_hires: int | None
    by_month: list[MonthCount]
    by_location: list[LocationCount]


class ApplicationFunnelResponse(_Base):
    """The linked students' applications, counted. **No identifier**; a
    withheld cell is null, and below the cohort floor everything is."""

    min_cohort_size: int
    below_floor: bool
    total_applications: int | None
    by_stage: dict[str, int | None] = Field(description="Where each application is now.")
    reached: dict[str, int | None] = Field(
        description="Applications that ever reached SHORTLISTED, INTERVIEW, DECISION or HIRED."
    )
