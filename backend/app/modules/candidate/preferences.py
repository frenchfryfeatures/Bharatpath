"""Job preferences (2026-11-23): what a candidate wants from their next job.

Filled from the profile's Preferences tab once the profile is complete, and
read by the job engine (`jobs.domain.score_job`). Stored as its own block,
`candidate_profiles.career["preferences"]`, so saving the onboarding form
never touches it; every writer of `career` carries it forward.

Preferred locations and preferred salary already belong to the profile
details (onboarding asks for them), so the tab edits those fields in place
rather than keeping a second copy here.

**What is deliberately not asked**: nothing about who the candidate is --
no gender, age, family or current pay -- because a ranking that read it
would steer who sees which jobs by it (invariant 5, C3). Company type
(startup, MNC...) is not asked either: jobs do not record one, so the answer
could only be stored, never used.
"""

from __future__ import annotations

from typing import Annotated, Any, Final, Literal

from pydantic import Field, field_validator

from app.core.schemas import ApiSchema

WorkMode = Literal["ONSITE", "HYBRID", "REMOTE"]
JobType = Literal["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "FREELANCE"]

#: Labels shown in both apps' dropdowns, in this order.
WORK_MODE_OPTIONS: Final[tuple[tuple[str, str], ...]] = (
    ("ONSITE", "Work from office"),
    ("HYBRID", "Hybrid"),
    ("REMOTE", "Remote"),
)
JOB_TYPE_OPTIONS: Final[tuple[tuple[str, str], ...]] = (
    ("FULL_TIME", "Full-time"),
    ("PART_TIME", "Part-time"),
    ("CONTRACT", "Contract"),
    ("INTERNSHIP", "Internship"),
    ("FREELANCE", "Freelance"),
)
MAX_CHOICES: Final = 5

Choice = Annotated[str, Field(min_length=1, max_length=160)]


def _distinct(values: list[Any]) -> list[Any]:
    """Trimmed, blank-free, first spelling of each value kept."""
    seen: set[str] = set()
    out: list[Any] = []
    for value in values:
        text = value.strip() if isinstance(value, str) else value
        key = text.casefold() if isinstance(text, str) else text
        if text and key not in seen:
            seen.add(key)
            out.append(text)
    return out


class JobPreferences(ApiSchema):
    """The stored block. Every field optional: an empty answer means "no
    preference" and the engine leaves that dimension out, never penalises."""

    preferred_roles: Annotated[list[Choice], Field(max_length=MAX_CHOICES)] = Field(
        default_factory=list
    )
    preferred_industries: Annotated[list[Choice], Field(max_length=MAX_CHOICES)] = Field(
        default_factory=list
    )
    work_modes: Annotated[list[WorkMode], Field(max_length=3)] = Field(default_factory=list)
    job_types: Annotated[list[JobType], Field(max_length=5)] = Field(default_factory=list)
    #: A job outside the preferred places still fits partly.
    open_to_relocation: bool = False

    @field_validator("preferred_roles", "preferred_industries", "work_modes", "job_types")
    @classmethod
    def _dedupe(cls, value: list[Any]) -> list[Any]:
        return _distinct(value)


class PreferencesPayload(JobPreferences):
    """What the tab sends and receives: the block, plus the three profile
    details fields it edits in place."""

    preferred_locations: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=MAX_CHOICES)
    ] = Field(default_factory=list)
    preferred_salary: Annotated[int | None, Field(default=None, ge=0, le=1_000_000_000)] = None
    preferred_salary_currency: Literal["INR", "USD"] = "INR"

    @field_validator("preferred_locations")
    @classmethod
    def _dedupe_places(cls, value: list[str]) -> list[str]:
        return _distinct(value)


class PreferencesResponse(PreferencesPayload):
    #: False until the profile is complete; the tab then asks the candidate to
    #: finish it first, and a save answers 409 `profile_incomplete`.
    profile_completed: bool
    updated_at: str | None = None


class Option(ApiSchema):
    value: str
    label: str


class PreferenceOptions(ApiSchema):
    """Every dropdown's options in one response. Industries and roles come
    from the job taxonomy staff maintain; any value may still be typed."""

    work_modes: list[Option]
    job_types: list[Option]
    industries: list[Option]
    roles: list[Option]
    salary_currencies: list[Option]


def stored_preferences(career: dict[str, Any] | None) -> JobPreferences:
    """The block as saved, or empty. A malformed block reads as empty rather
    than failing the profile: preferences only ever rank, never gate."""
    raw = (career or {}).get("preferences")
    if not isinstance(raw, dict):
        return JobPreferences()
    try:
        return JobPreferences.model_validate(raw)
    except ValueError:
        return JobPreferences()
