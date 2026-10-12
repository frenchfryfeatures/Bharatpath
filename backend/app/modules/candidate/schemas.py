"""candidate - Pydantic request/response DTOs

Candidate profile, settings, language preference.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import Field, field_validator

from app.core.schemas import ApiSchema
from app.modules.applications.schemas import CandidateShortlistState
from app.modules.candidate.domain import (
    MAX_CITY_LENGTH,
    MAX_NAME_LENGTH,
    STATE_CODES,
    normalise_city,
    normalise_full_name,
)
from app.modules.discovery.domain import MAX_CARD_SKILLS, MAX_EXPERIENCE_YEARS, displayable_skills
from app.modules.discovery.schemas import Badge, ScoreBand
from app.modules.resume.schemas import SharedResumeView


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class LocationRequest(_Base):
    """Replaces the candidate's location. Send `null` to clear either half.

    Both halves are optional and independent: "Maharashtra" without a city is
    a real answer from someone willing to relocate within the state.
    """

    city: Annotated[str | None, Field(default=None, max_length=MAX_CITY_LENGTH * 2)] = None
    state_code: Annotated[str | None, Field(default=None, min_length=2, max_length=2)] = None

    @field_validator("city")
    @classmethod
    def _city(cls, value: str | None) -> str | None:
        return None if value is None else normalise_city(value)

    @field_validator("state_code")
    @classmethod
    def _state(cls, value: str | None) -> str | None:
        if value is not None and value not in STATE_CODES:
            raise ValueError("not a state or union territory code")
        return value


class NameRequest(_Base):
    """The candidate's name, asked at sign-up. Letters, spaces and `. ' -` only."""

    full_name: Annotated[str, Field(min_length=1, max_length=MAX_NAME_LENGTH * 2)]

    @field_validator("full_name")
    @classmethod
    def _name(cls, value: str) -> str:
        return normalise_full_name(value)


class CandidateProfileResponse(_Base):
    """The candidate's own profile, for their own screens."""

    full_name: str | None = None
    #: Their own photo, a presigned link that expires; null without one.
    #: Changed at `/profile/photo`. It never reaches an employer or a college.
    photo_url: str | None = None
    city: str | None = None
    state_code: str | None = None
    updated_at: datetime | None = None


class RevealedCandidate(_Base):
    """One candidate's profile as an employer sees it after opening it (SRS 2.9.7).

    **A different schema from `MaskedCandidate`, on purpose** (invariant 7):
    the card cannot hold contact details, and this is the only employer
    response that can.

    **`score` is the display score, never `raw_value`** (R4). There is no
    field for the raw value, `extra="forbid"` refuses one, and an invariant
    test fails if any employer response grows one.

    `full_name` is the name the candidate gave at sign-up, else the one typed
    on the structured form, else null; a name is never guessed from a CV.

    `resume` (2026-10-05) is the confirmed CV the score was built from --
    the same version the band came from -- with a presigned link to the
    uploaded file. It rides on the audited open; there is no other route to it.
    `shortlist` is the organisation's own record of this candidate.
    """

    candidate_id: uuid.UUID
    full_name: Annotated[str | None, Field(default=None, max_length=200)] = None
    phone: str | None = None
    email: str | None = None
    score: int
    band: ScoreBand
    experience_years: Annotated[int, Field(ge=0, le=MAX_EXPERIENCE_YEARS)]
    skills: Annotated[list[str], Field(max_length=MAX_CARD_SKILLS)]
    badges: list[Badge]
    city: Annotated[str | None, Field(default=None, max_length=100)] = None
    state_code: Annotated[str | None, Field(default=None, min_length=2, max_length=2)] = None
    resume: SharedResumeView | None = Field(
        default=None, description="Null only if the confirmed CV cannot be read."
    )
    shortlist: CandidateShortlistState = Field(
        default_factory=CandidateShortlistState,
        description="What the Shortlist button shows: saved or not, and each invitation "
        "your organisation sent this candidate. Act on it at `POST /employer/shortlist`.",
    )

    @field_validator("skills", mode="before")
    @classmethod
    def _only_displayable(cls, value: object) -> list[str]:
        if not isinstance(value, list | tuple):
            raise ValueError("skills must be a list")
        return displayable_skills(value)
