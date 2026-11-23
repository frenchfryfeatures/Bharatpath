"""Candidate-owned career details. Parsing fills drafts; it never computes a score."""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from app.core.schemas import ApiSchema
from app.modules.candidate.domain import normalise_city
from app.modules.candidate.onboarding_policy import field_rules, matches
from app.modules.candidate.preferences import JobPreferences
from app.modules.jobs.domain import MatchTerms, education_rank

Text = Annotated[str, Field(max_length=300)]

INACTIVE_EMPLOYMENT_DEFAULTS = {
    "company_name": "",
    "job_title": "",
    "employment_start": "",
    "employment_end": "",
    "annual_salary": None,
    "notice_period": "",
    "job_role": "",
}


class CareerDetails(ApiSchema):
    phone: Annotated[str, Field(default="", max_length=20)] = ""
    work_status: Literal["", "FRESHER", "EXPERIENCED"] = ""
    currently_employed: Literal["", "YES", "NO"] = ""
    experience_years: Annotated[int, Field(ge=0, le=60)] = 0
    experience_months: Annotated[int, Field(ge=0, le=11)] = 0
    company_name: Text = ""
    job_title: Text = ""
    current_city: Text = ""
    employment_start: Annotated[str, Field(default="", max_length=7)] = ""
    employment_end: Annotated[str, Field(default="", max_length=7)] = ""
    annual_salary_currency: Literal["INR", "USD"] = "INR"
    preferred_salary_currency: Literal["INR", "USD"] = "INR"
    annual_salary: Annotated[int | None, Field(default=None, ge=0, le=1_000_000_000)] = None
    notice_period: Literal[
        "",
        "IMMEDIATE",
        "15_DAYS",
        "30_DAYS",
        "60_DAYS",
        "90_DAYS",
        "MORE_THAN_90_DAYS",
        "NOT_WORKING",
    ] = ""
    key_skills: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=80)]], Field(max_length=100)
    ] = Field(default_factory=list)
    industry: Text = ""
    department: Text = ""
    role_category: Text = ""
    job_role: Text = ""
    industry_id: uuid.UUID | None = None
    department_id: uuid.UUID | None = None
    role_category_id: uuid.UUID | None = None
    job_role_id: uuid.UUID | None = None
    taxonomy_others: dict[
        Literal["industry", "department", "role_category", "job_role"],
        Annotated[str, Field(max_length=160)],
    ] = Field(default_factory=dict)
    highest_qualification_id: uuid.UUID | None = None
    course_id: uuid.UUID | None = None
    specialization_id: uuid.UUID | None = None
    education_others: dict[Literal["highest_qualification", "course", "specialization"], Annotated[str, Field(max_length=160)]] = Field(default_factory=dict)
    highest_qualification: Text = ""
    course: Text = ""
    course_type: Literal["", "FULL_TIME", "PART_TIME", "DISTANCE", "ONLINE"] = ""
    specialization: Text = ""
    specialization_name: Text = Field(default="", exclude=True, deprecated=True)
    institution: Text = ""
    starting_year: Annotated[int | None, Field(default=None, ge=1950, le=2100)] = None
    passing_year: Annotated[int | None, Field(default=None, ge=1950, le=2100)] = None
    headline: Text = ""
    preferred_locations: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=100)]], Field(max_length=5)
    ] = Field(default_factory=list)
    preferred_salary: Annotated[int | None, Field(default=None, ge=0, le=1_000_000_000)] = None
    gender: Literal["", "FEMALE", "MALE", "NON_BINARY", "SELF_DESCRIBE", "PREFER_NOT_TO_SAY"] = ""

    @model_validator(mode="before")
    @classmethod
    def remove_inapplicable_employment(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        value = dict(value)
        if not value.get("specialization") and value.get("specialization_name"):
            value["specialization"] = value["specialization_name"]
        value["specialization_name"] = ""
        if value.get("work_status") == "FRESHER":
            return {**value, **INACTIVE_EMPLOYMENT_DEFAULTS, "currently_employed": "NO", "notice_period": "IMMEDIATE"}
        if value.get("currently_employed") == "NO":
            return {**value, "notice_period": "IMMEDIATE"}
        if value.get("currently_employed") == "YES":
            return {**value, "employment_end": ""}
        return value

    @model_validator(mode="after")
    def validate_details(self) -> CareerDetails:
        if self.work_status == "FRESHER":
            self.job_role_id = None
            self.taxonomy_others.pop("job_role", None)
        if self.current_city:
            self.current_city = normalise_city(self.current_city) or ""
        self.phone = re.sub(r"[\s-]", "", self.phone)
        if self.phone and not re.fullmatch(r"\+[1-9]\d{7,14}", self.phone):
            raise ValueError("phone must use international format, e.g. +919876543210")
        for value in (self.employment_start, self.employment_end):
            if value and not re.fullmatch(r"(?:19|20)\d{2}-(?:0[1-9]|1[0-2])", value):
                raise ValueError("employment dates must use YYYY-MM")
        if (
            self.employment_start
            and self.employment_end
            and self.employment_end < self.employment_start
        ):
            raise ValueError("employment end cannot precede start")
        if self.starting_year and self.passing_year and self.passing_year < self.starting_year:
            raise ValueError("passing year cannot precede starting year")
        if self.work_status == "FRESHER" and (self.experience_years or self.experience_months):
            raise ValueError("freshers cannot declare prior work experience")
        return self


class CareerResponse(ApiSchema):
    details: CareerDetails = Field(default_factory=CareerDetails)
    resume_version_id: uuid.UUID | None = None
    resume_file_id: uuid.UUID | None = None
    resume_filename: str | None = None
    completed: bool = False
    updated_at: str | None = None


class CareerSaveRequest(ApiSchema):
    details: CareerDetails
    resume_version_id: uuid.UUID | None = None
    resume_filename: Annotated[str | None, Field(default=None, max_length=255)] = None
    complete: bool = False


def missing_required(details: CareerDetails) -> list[str]:
    missing = []
    for field in form_fields():
        key = field["key"]
        value = getattr(details, key)
        absent = value is None if key == "annual_salary" else not value
        if matches(field["rules"]["required_when"], details) and absent:
            missing.append(key)
    if details.work_status == "EXPERIENCED" and not (
        details.experience_years or details.experience_months
    ):
        missing.append("experience_years")
    return missing


def match_terms(
    details: CareerDetails,
    *,
    city: str | None = None,
    preferences: JobPreferences | None = None,
) -> MatchTerms:
    """What "jobs that fit your profile" matches on (2026-10-09).

    Skills, the roles the candidate names, where they want to work and how
    long they have worked -- and only those. **Never `gender`**, and nothing
    else about who someone is: see `jobs.domain` on recommendations. Nor the
    salary fields: currency-tagged amounts are not compared or converted for matching.

    The desired role comes before the current title, and preferred places
    before the current city, because `MatchTerms.build` keeps the first terms
    when it caps them.
    """
    if details.work_status == "FRESHER":
        experience: int | None = 0
    elif details.work_status == "EXPERIENCED" or (
        details.experience_years or details.experience_months
    ):
        experience = details.experience_years * 12 + details.experience_months
    else:
        experience = None
    # Only what the candidate *wants* to earn, and only in rupees: their
    # current pay is never read, and amounts are never converted (2026-11-23).
    preferred = (
        details.preferred_salary * 100
        if details.preferred_salary and details.preferred_salary_currency == "INR"
        else None
    )
    # The Preferences tab (2026-11-23) comes first in each list: what someone
    # says they want outranks what they have done, and the caps keep the first.
    wanted = preferences or JobPreferences()
    return MatchTerms.build(
        skills=details.key_skills,
        titles=[
            *wanted.preferred_roles,
            details.job_role,
            details.job_title,
            details.role_category,
        ],
        locations=[*details.preferred_locations, details.current_city or city or ""],
        experience_months=experience,
        preferred_annual_salary_minor=preferred,
        industries=[
            *wanted.preferred_industries,
            *([details.industry] if details.industry else []),
        ],
        education_level=education_level_of(details.highest_qualification),
        fresher=details.work_status == "FRESHER",
        work_modes=wanted.work_modes,
        job_types=wanted.job_types,
        open_to_relocation=wanted.open_to_relocation,
    )


#: The education taxonomy's qualification names, read as the job composer's
#: minimum-education levels. First match wins, most specific first.
_QUALIFICATION_LEVELS: tuple[tuple[str, str], ...] = (
    ("below 10", "NONE"),
    ("doctor", "DOCTORATE"),
    ("phd", "DOCTORATE"),
    ("post grad", "POST_GRADUATE"),
    ("master", "POST_GRADUATE"),
    ("graduat", "GRADUATE"),
    ("bachelor", "GRADUATE"),
    ("professional", "GRADUATE"),
    ("diploma", "DIPLOMA"),
    ("polytechnic", "DIPLOMA"),
    ("iti", "DIPLOMA"),
    ("vocational", "DIPLOMA"),
    ("12", "CLASS_12"),
    ("10", "CLASS_10"),
)


def education_level_of(qualification: str) -> int | None:
    """`jobs.domain.education_rank` of a highest qualification, or None when
    it names nothing we recognise -- unknown is left out, never guessed."""
    text = qualification.strip().lower()
    if not text:
        return None
    for needle, level in _QUALIFICATION_LEVELS:
        if needle in text:
            return education_rank(level)
    return None


def form_fields() -> list[dict[str, Any]]:
    """Both clients render these rules, instead of maintaining different forms."""
    groups = [
        (
            "basic",
            [
                ("phone", "Mobile number", "tel", True),
                ("current_city", "Current city", "text", True),
            ],
        ),
        (
            "employment",
            [
                ("work_status", "Work status", "select", True),
                ("currently_employed", "Are you currently employed?", "select", False),
                ("experience_years", "Total work experience - years", "number", False),
                ("experience_months", "Total work experience - months", "number", False),
                ("company_name", "Current Company", "text", False),
                ("job_title", "Current Job Title", "text", False),
                ("employment_start", "Employment starting month", "month", False),
                ("employment_end", "Employment ending month", "month", False),
                ("annual_salary_currency", "Salary currency", "select", False),
                ("annual_salary", "Annual Salary", "number", False),
                ("notice_period", "Notice Period", "select", True),
                ("key_skills", "Key skills", "list", False),
                ("industry", "Industry", "text", False),
                ("department", "Department", "text", False),
                ("role_category", "Role category", "text", False),
                ("job_role", "Job role", "text", False),
            ],
        ),
        (
            "education",
            [
                ("highest_qualification", "Highest qualification", "text", True),
                ("course", "Course", "text", True),
                ("course_type", "Course type", "select", True),
                ("specialization", "Specialization", "text", False),
                ("institution", "University / Institute", "text", True),
                ("starting_year", "Starting year", "number", True),
                ("passing_year", "Passing / expected passing year", "number", True),
            ],
        ),
        (
            "preferences",
            [
                ("headline", "Profile headline", "text", False),
                ("preferred_locations", "Preferred work locations", "list", False),
                ("preferred_salary_currency", "Preferred salary currency", "select", False),
                ("preferred_salary", "Preferred Annual Salary", "number", False),
                ("gender", "Gender", "select", True),
            ],
        ),
    ]
    options = {
        "annual_salary_currency": [("INR", "₹ INR"), ("USD", "$ USD")],
        "preferred_salary_currency": [("INR", "₹ INR"), ("USD", "$ USD")],
        "work_status": [("EXPERIENCED", "I'm experienced"), ("FRESHER", "I'm a fresher")],
        "currently_employed": [("YES", "Yes"), ("NO", "No")],
        "notice_period": [
            ("IMMEDIATE", "Immediately"),
            ("15_DAYS", "15 days"),
            ("30_DAYS", "30 days"),
            ("60_DAYS", "60 days"),
            ("90_DAYS", "90 days"),
            ("MORE_THAN_90_DAYS", "More than 90 days"),
            ("NOT_WORKING", "Not working"),
        ],
        "course_type": [
            ("FULL_TIME", "Full time"),
            ("PART_TIME", "Part time"),
            ("DISTANCE", "Distance learning"),
            ("ONLINE", "Online"),
        ],
        "gender": [
            ("FEMALE", "Female"),
            ("MALE", "Male"),
            ("NON_BINARY", "Non-binary"),
            ("SELF_DESCRIBE", "Self describe"),
            ("PREFER_NOT_TO_SAY", "Prefer not to say"),
        ],
    }
    return [
        {
            "key": key,
            "label": label,
            "type": kind,
            "required": required,
            "rules": field_rules(key, required),
            "section": section,
            "options": [{"value": value, "label": text} for value, text in options.get(key, [])],
        }
        for section, fields in groups
        for key, label, kind, required in fields
    ]


def employment_dates_ordered(details: CareerDetails) -> bool:
    """Apply strict ordering on save without invalidating historical profile reads."""
    return not (details.employment_start and details.employment_end) or details.employment_end > details.employment_start
