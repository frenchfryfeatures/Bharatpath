"""discovery - Pydantic request/response DTOs

Masked search, access-window checks, reveal audit.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**`MaskedCandidate` is structurally incapable of holding a name, a phone
number, an email or the score** (plan.md Day 13). Not "does not populate" --
there is no field to put them in, `extra="forbid"` refuses one arriving, and
no field is free-form. `tests/invariants/test_masked_candidate.py` holds the
field list, so widening the card is a visible change to a test.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import Field, field_validator

from app.core.schemas import ApiSchema
from app.modules.discovery.domain import (
    MAX_CARD_SKILLS,
    MAX_EXPERIENCE_YEARS,
    displayable_skills,
    looks_like_contact,
)

#: The four bands, in ascending order. The same labels as
#: `scoring.domain.BANDS`, which `discovery` may not import; an invariant test
#: fails if the two lists part company.
ScoreBand = Literal["ENTRY", "DEVELOPING", "SOLID", "STRONG"]

#: `domain.BADGE_FOR_ADDON_KIND`'s values, held equal by the same test.
Badge = Literal["COURSE_COMPLETED", "MOCK_INTERVIEW_COMPLETED"]


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class MaskedCandidate(_Base):
    """One anonymised candidate card (SRS 2.9.6).

    **The band, never the score.** Employers never see the raw number (R4,
    2026-08-24), and the band is what the design system draws.

    `candidate_id` is the handle the Day 14 reveal opens, behind the access
    window and its audit row. It is already what the employer pipeline shows
    for an applicant, so a card names no one the pipeline would not.
    """

    candidate_id: uuid.UUID
    band: ScoreBand
    experience_years: Annotated[int, Field(ge=0, le=MAX_EXPERIENCE_YEARS)]
    skills: Annotated[list[str], Field(max_length=MAX_CARD_SKILLS)]
    badges: list[Badge]
    city: Annotated[str | None, Field(default=None, max_length=100)] = None
    state_code: Annotated[str | None, Field(default=None, min_length=2, max_length=2)] = None

    @field_validator("skills", mode="before")
    @classmethod
    def _only_displayable(cls, value: object) -> list[str]:
        if not isinstance(value, list | tuple):
            raise ValueError("skills must be a list")
        return displayable_skills(value)

    @field_validator("city")
    @classmethod
    def _never_contact_data(cls, value: str | None) -> str | None:
        # The candidate module refuses such a city on the way in. This is the
        # second lock, for a row that reached the table some other way.
        return None if value is not None and looks_like_contact(value) else value


# ---------------------------------------------------------------------------
# The filter panel (2026-09-24)
# ---------------------------------------------------------------------------
# **No schema here has a count.** "Pune (3)" beside a narrow filter tells an
# employer whether one particular person is in the pool, the reason search
# returns no total. `test_search_filters.py` walks every field.


class BandChoice(_Base):
    value: ScoreBand
    label: str


class BadgeChoice(_Base):
    value: Badge
    label: str


class ExperienceChoice(_Base):
    #: Sent as `min_experience_years`.
    min_years: int
    label: str


class StateChoice(_Base):
    #: Sent as `state`.
    code: str
    name: str


class SkillChoice(_Base):
    """A catalogued skill. Send `label` (or `key`) as `skill`; its aliases are
    searched with it."""

    key: str
    label: str


class CityChoice(_Base):
    """A catalogued city. Send `label` (or `key`) as `city`; its aliases are
    searched with it."""

    key: str
    label: str
    state_code: str


class FilterLimits(_Base):
    """What the search accepts, so the panel can stop the user before a 422."""

    max_skills: int
    max_cities: int
    max_skill_length: int
    max_city_length: int
    max_experience_years: int


class FilterPanel(_Base):
    """Everything the filter panel draws before anything is typed.

    `skills` and `cities` are the featured options only; the rest are found
    by typing (`/filters/skills`, `/filters/locations`). Any text is still a
    valid filter -- the catalogue suggests, it does not restrict.
    """

    bands: list[BandChoice]
    badges: list[BadgeChoice]
    experience: list[ExperienceChoice]
    skills: list[SkillChoice]
    cities: list[CityChoice]
    states: list[StateChoice]
    limits: FilterLimits
    #: Starts `placeholder-` while the starter lists are ours, not the client's.
    catalogue_version: str


class SkillSuggestions(_Base):
    items: list[SkillChoice]


class CitySuggestions(_Base):
    items: list[CityChoice]
