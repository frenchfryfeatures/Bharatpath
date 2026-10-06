"""Candidate-owned career details. Parsing fills drafts; it never computes a score."""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from app.core.schemas import ApiSchema
from app.modules.candidate.domain import normalise_city

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
    highest_qualification: Text = ""
    course: Text = ""
    course_type: Literal["", "FULL_TIME", "PART_TIME", "DISTANCE", "ONLINE"] = ""
    specialization: Text = ""
    specialization_name: Text = ""
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
        if value.get("currently_employed") == "NO":
            return {**value, **INACTIVE_EMPLOYMENT_DEFAULTS}
        if value.get("currently_employed") == "YES":
            return {**value, "employment_end": ""}
        return value

    @model_validator(mode="after")
    def validate_details(self) -> CareerDetails:
        if self.current_city:
            self.current_city = normalise_city(self.current_city) or ""
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
    required = [
        "phone",
        "work_status",
        "current_city",
        "highest_qualification",
        "course",
        "course_type",
        "institution",
        "starting_year",
        "passing_year",
    ]
    if details.work_status == "EXPERIENCED":
        required += ["currently_employed"]
        if details.currently_employed == "YES":
            required += ["company_name", "job_title", "employment_start"]
    missing = [key for key in required if not getattr(details, key)]
    if details.work_status == "EXPERIENCED" and not (
        details.experience_years or details.experience_months
    ):
        missing.append("experience_years")
    return missing


def form_fields() -> list[dict[str, Any]]:
    """Both clients render these rules, instead of maintaining different forms."""
    groups = [
        (
            "basic",
            [
                ("phone", "Mobile number", "tel", True),
                ("work_status", "Work status", "select", True),
                ("current_city", "Current city", "text", True),
            ],
        ),
        (
            "employment",
            [
                ("currently_employed", "Are you currently employed?", "select", False),
                ("experience_years", "Total work experience - years", "number", False),
                ("experience_months", "Total work experience - months", "number", False),
                ("company_name", "Company name", "text", False),
                ("job_title", "Current / most recent job title", "text", False),
                ("employment_start", "Employment starting month", "month", False),
                ("employment_end", "Employment ending month", "month", False),
                ("annual_salary", "Annual salary (INR)", "number", False),
                ("notice_period", "Notice period", "select", False),
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
                ("specialization_name", "Specialization name", "text", False),
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
                ("preferred_salary", "Preferred annual salary (INR)", "number", False),
                ("gender", "Gender", "select", False),
            ],
        ),
    ]
    options = {
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
            "section": section,
            "options": [{"value": value, "label": text} for value, text in options.get(key, [])],
        }
        for section, fields in groups
        for key, label, kind, required in fields
    ]
