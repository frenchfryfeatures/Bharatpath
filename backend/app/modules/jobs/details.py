"""jobs - the posting's long form, beside the columns that are searched.

A job's title, description, skills, location, work mode, minimum experience,
salary range and threshold are columns: the board filters on them, the search
document indexes them, and the database holds rules about them. Everything
else an employer writes on a posting -- openings, responsibilities,
qualifications, education, interview rounds, screening questions -- is read
whole and shown whole, so it is one validated JSONB document, `jobs.details`.

**Strict on shape, lenient on presence.** Every key is optional here, so an
older client that sends no `details` still creates a valid job, and every
value that *is* sent is checked: closed vocabularies are `Literal`s, lists are
bounded, and an unknown key is a 422 (`extra="forbid"` from `ApiSchema`).
Which fields an employer must fill is the composer's decision, not the
storage format's.

**What a posting may not ask for.** No age, no date of birth and no gender,
in any form -- not a range, not a preference, not a "suitable for". Invariant 5
forbids age-gating outright (PRD section 3 rule 4), and a gender requirement
on a job is the same discrimination the questionnaire refuses to ask about
(`blockers.md` C3). `extra="forbid"` turns either into a 422, and a screening question that
asks about either is refused by its words. `test_a_job_cannot_ask_for_age_or_gender`
and `test_a_screening_question_cannot_ask_about_age_or_gender` hold both.

**Two audiences, two models.** `JobDetails` is the employer's. A candidate
reads `CandidateJobDetails`, which drops who the hiring manager is, the
screening questions (and which answer knocks someone out), and the
organisation's internal visibility settings. Building the candidate's view by
constructing the narrower model, rather than deleting keys from the wider one,
means a field added to `JobDetails` stays employer-only until somebody adds it
to the candidate's model on purpose.
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from app.core.schemas import ApiSchema

Text = Annotated[str, Field(max_length=200)]
Line = Annotated[str, Field(min_length=1, max_length=500)]
Tag = Annotated[str, Field(min_length=1, max_length=80)]

#: Bullet lists (responsibilities, qualifications, benefits).
Lines = Annotated[list[Line], Field(max_length=30)]
#: Short labels (skills, tools, languages, certifications).
Tags = Annotated[list[Tag], Field(max_length=50)]

JobType = Literal["", "FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "FREELANCE"]
EmploymentType = Literal["", "PERMANENT", "TEMPORARY", "FIXED_TERM", "APPRENTICESHIP"]
SalaryPeriod = Literal["", "HOURLY", "DAILY", "MONTHLY", "ANNUAL"]
SalaryType = Literal["", "FIXED", "FIXED_PLUS_VARIABLE", "PERFORMANCE_BASED"]
MinimumEducation = Literal[
    "",
    "NONE",
    "CLASS_10",
    "CLASS_12",
    "DIPLOMA",
    "GRADUATE",
    "POST_GRADUATE",
    "DOCTORATE",
]
NoticePeriod = Literal["", "IMMEDIATE", "15_DAYS", "30_DAYS", "60_DAYS", "90_DAYS", "ANY"]
Relocation = Literal["", "REQUIRED", "PREFERRED", "NOT_REQUIRED"]
ApplicationMethod = Literal["BHARATPATH", "EXTERNAL"]
QuestionType = Literal["YES_NO", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "SHORT_ANSWER", "NUMERIC"]
HiringTimeline = Literal[
    "", "WITHIN_1_WEEK", "WITHIN_2_WEEKS", "WITHIN_1_MONTH", "WITHIN_3_MONTHS", "FLEXIBLE"
]
Priority = Literal["NORMAL", "URGENT"]
Visibility = Literal["PUBLIC", "PRIVATE", "INVITE_ONLY"]
ApplicantAccess = Literal["ALL_MEMBERS", "HIRING_TEAM"]

#: Choice questions carry their options; the others must not.
CHOICE_TYPES = frozenset({"SINGLE_CHOICE", "MULTIPLE_CHOICE"})
YES_NO = ("Yes", "No")

_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")

#: A screening question about age or gender, in English, romanised Hindi or
#: Devanagari. Whole words for the Latin script; Devanagari is matched as a
#: substring, because its vowel signs are not word characters to `\b`.
#: Deliberately narrow (no "man"/"men": "man-hours" is a fair question), so a
#: refusal is always about the person and never about the work.
_PERSONAL_LATIN = re.compile(
    r"\b(age|aged|ages|how\s+old|years?\s+old|birth\w*|born|d\.?o\.?b|"
    r"gender|sex|male|males|female|females|woman|women|transgender|"
    r"umar|umr|umra|ladka|ladki)\b",
    re.IGNORECASE,
)
#: Escaped so the source stays ASCII: umra, umar, aayu (age), janm (birth),
#: ling (gender), mahila (woman), purush (man).
_PERSONAL_DEVANAGARI = (
    "\u0909\u092e\u094d\u0930",
    "\u0909\u092e\u0930",
    "\u0906\u092f\u0941",
    "\u091c\u0928\u094d\u092e",
    "\u0932\u093f\u0902\u0917",
    "\u092e\u0939\u093f\u0932\u093e",
    "\u092a\u0941\u0930\u0941\u0937",
)


def _asks_about_age_or_gender(text: str) -> bool:
    return bool(_PERSONAL_LATIN.search(text)) or any(w in text for w in _PERSONAL_DEVANAGARI)


class _Section(ApiSchema):
    """`ApiSchema` forbids unknown keys and strips control characters."""


class Basics(_Section):
    job_type: JobType = ""
    employment_type: EmploymentType = ""
    department: Text = ""
    category: Text = ""
    industry: Text = ""
    openings: Annotated[int | None, Field(default=None, ge=1, le=10_000)] = None


class Location(_Section):
    """The primary location and work mode are the `jobs` columns; these are
    the rest of where the work is."""

    additional_locations: Annotated[list[Tag], Field(max_length=20)] = Field(default_factory=list)
    relocation_assistance: bool = False


class Compensation(_Section):
    """The range itself is the mandatory `salary_*_minor` columns (PRD 5.2).

    **`disclosed` is how the listing draws the range, not whether it exists.**
    An undisclosed range is still entered, still stored, still what the board's
    salary filter compares against; a candidate's screen says "Not disclosed"
    instead of the numbers. Withholding the numbers from the candidate API
    entirely would be a change to PRD 5.2's transparency rule, which is the
    client's to make.
    """

    experience_max_months: Annotated[int | None, Field(default=None, ge=0, le=600)] = None
    period: SalaryPeriod = ""
    salary_type: SalaryType = ""
    disclosed: bool = True
    negotiable: bool = False


class Content(_Section):
    """The long-form description is the `jobs.description` column."""

    responsibilities: Lines = Field(default_factory=list)
    required_qualifications: Lines = Field(default_factory=list)
    preferred_qualifications: Lines = Field(default_factory=list)
    nice_to_have_skills: Tags = Field(default_factory=list)
    benefits: Lines = Field(default_factory=list)


class SkillExperience(_Section):
    skill: Tag
    years: Annotated[int, Field(ge=0, le=50)]


class Skills(_Section):
    """Required skills are the `jobs.skills` column, which search reads."""

    preferred: Tags = Field(default_factory=list)
    tools: Tags = Field(default_factory=list)
    primary: Annotated[str, Field(max_length=80)] = ""
    experience: Annotated[list[SkillExperience], Field(max_length=50)] = Field(default_factory=list)


class Education(_Section):
    minimum: MinimumEducation = ""
    ug_qualification: Text = ""
    ug_specialization: Text = ""
    pg_qualification: Text = ""
    pg_specialization: Text = ""
    certifications: Tags = Field(default_factory=list)


class Requirements(_Section):
    """What a role needs from the person doing it. Deliberately has no age
    and no gender field: see the module docstring."""

    languages: Annotated[list[Tag], Field(max_length=20)] = Field(default_factory=list)
    notice_period: NoticePeriod = ""
    work_authorization: Text = ""
    relocation: Relocation = ""


class CandidateApplication(_Section):
    """How to apply, as a candidate reads it. `external_url` and `email` are
    empty here unless the candidate may apply (`for_candidate`), so this model
    does not insist that an EXTERNAL method carries its link."""

    deadline: dt.date | None = None
    method: ApplicationMethod = "BHARATPATH"
    email: Annotated[str, Field(max_length=254)] = ""
    external_url: Annotated[str, Field(max_length=500)] = ""
    resume_required: bool = True
    cover_letter_required: bool = False
    portfolio_required: bool = False


class Application(CandidateApplication):
    @model_validator(mode="after")
    def _method(self) -> Application:
        if self.email and not _EMAIL.fullmatch(self.email):
            raise ValueError("application email is not an email address")
        if self.external_url and not self.external_url.startswith("https://"):
            # Every candidate who opens the job is shown this link. Only
            # https, so it cannot be `javascript:` or a downgrade.
            raise ValueError("external application URL must start with https://")
        if self.method == "EXTERNAL" and not self.external_url:
            raise ValueError("an external application needs its URL")
        return self


class ScreeningQuestion(_Section):
    """Recorded with the posting. **Not yet asked at apply time**: the apply
    request is a job id and nothing else (`test_an_apply_request_is_a_job_id_
    and_nothing_else`), so collecting answers -- and a knockout acting on them
    -- is its own change to that contract."""

    question: Annotated[str, Field(min_length=3, max_length=300)]
    type: QuestionType
    options: Annotated[list[Tag], Field(max_length=10)] = Field(default_factory=list)
    mandatory: bool = False
    knockout: bool = False
    #: The answers that pass a knockout question. Empty unless `knockout`.
    accepted_answers: Annotated[list[Tag], Field(max_length=10)] = Field(default_factory=list)

    @model_validator(mode="after")
    def _shape(self) -> ScreeningQuestion:
        if any(_asks_about_age_or_gender(t) for t in (self.question, *self.options)):
            # Invariant 5 and C3. A knockout makes it a gate; even without one,
            # the answer sits beside the application.
            raise ValueError("a screening question cannot ask about age or gender")
        if self.type in CHOICE_TYPES:
            if len(self.options) < 2:
                raise ValueError("a choice question needs at least two options")
            if len({o.casefold() for o in self.options}) != len(self.options):
                raise ValueError("a choice question's options must differ")
        elif self.options:
            raise ValueError(f"a {self.type} question has no options")
        if self.knockout:
            allowed = YES_NO if self.type == "YES_NO" else tuple(self.options)
            if self.type not in CHOICE_TYPES and self.type != "YES_NO":
                raise ValueError("only yes/no and choice questions can be knockout questions")
            if not self.accepted_answers:
                raise ValueError("a knockout question needs the answers that pass it")
            if any(a not in allowed for a in self.accepted_answers):
                raise ValueError("a knockout answer must be one of the question's options")
        elif self.accepted_answers:
            raise ValueError("accepted answers belong to knockout questions only")
        return self


class CandidateHiring(_Section):
    interview_rounds: Annotated[list[Tag], Field(max_length=10)] = Field(default_factory=list)
    timeline: HiringTimeline = ""
    priority: Priority = "NORMAL"
    expected_joining_date: dt.date | None = None


class Hiring(CandidateHiring):
    #: Who owns the hire inside the organisation. Employer-only.
    hiring_manager: Text = ""


class VisibilitySettings(_Section):
    """`visibility` is enforced: only PUBLIC jobs are listed on the candidate
    board. PRIVATE and INVITE_ONLY jobs are published but unlisted -- reached
    by a link the employer shares or through a shortlist invitation, never by
    search. The rest are recorded preferences: `featured` draws a badge,
    `allow_referrals` and `applicant_access` change no permission yet, and
    `publish_on` is a planned date -- publishing is still the employer's act,
    because it re-checks KYB and the subscription at that moment."""

    visibility: Visibility = "PUBLIC"
    featured: bool = False
    allow_referrals: bool = False
    applicant_access: ApplicantAccess = "ALL_MEMBERS"
    publish_on: dt.date | None = None


class JobDetails(_Section):
    """Everything on a posting that is not a `jobs` column. Employer-facing."""

    basics: Basics = Field(default_factory=Basics)
    location: Location = Field(default_factory=Location)
    compensation: Compensation = Field(default_factory=Compensation)
    content: Content = Field(default_factory=Content)
    skills: Skills = Field(default_factory=Skills)
    education: Education = Field(default_factory=Education)
    requirements: Requirements = Field(default_factory=Requirements)
    application: Application = Field(default_factory=Application)
    screening_questions: Annotated[list[ScreeningQuestion], Field(max_length=10)] = Field(
        default_factory=list
    )
    hiring: Hiring = Field(default_factory=Hiring)
    settings: VisibilitySettings = Field(default_factory=VisibilitySettings)


class CandidateJobDetails(_Section):
    """What a candidate reads. No hiring manager, no screening questions or
    knockout answers, no internal settings beyond the featured badge."""

    basics: Basics = Field(default_factory=Basics)
    location: Location = Field(default_factory=Location)
    compensation: Compensation = Field(default_factory=Compensation)
    content: Content = Field(default_factory=Content)
    skills: Skills = Field(default_factory=Skills)
    education: Education = Field(default_factory=Education)
    requirements: Requirements = Field(default_factory=Requirements)
    application: CandidateApplication = Field(default_factory=CandidateApplication)
    hiring: CandidateHiring = Field(default_factory=CandidateHiring)
    featured: bool = False


def parse_stored(raw: Any) -> JobDetails:
    """A stored document, as the employer's model. A row written before the
    column existed holds `{}`, which reads as every default."""
    return JobDetails.model_validate(raw or {})


def for_candidate(details: JobDetails, *, may_apply: bool) -> CandidateJobDetails:
    """The candidate's view, built field by field from the narrower models.

    **The external link and the application email are routes around the apply
    endpoint**, so they are sent only when `may_apply`: the candidate meets the
    threshold and is visible to employers. Otherwise an EXTERNAL job would
    take applications from someone the score gate or a HIGH integrity signal
    refuses -- the same rule `apply` enforces with `is_candidate_visible`."""
    withheld: set[str] = set() if may_apply else {"external_url", "email"}
    return CandidateJobDetails(
        basics=details.basics,
        location=details.location,
        compensation=details.compensation,
        content=details.content,
        skills=details.skills,
        education=details.education,
        requirements=details.requirements,
        application=CandidateApplication.model_validate(
            details.application.model_dump(
                include=set(CandidateApplication.model_fields) - withheld
            )
        ),
        hiring=CandidateHiring.model_validate(
            details.hiring.model_dump(include=set(CandidateHiring.model_fields))
        ),
        featured=details.settings.featured,
    )


def check_against_columns(
    details: JobDetails, *, skills: list[str], experience_min_months: int | None
) -> str | None:
    """The cross-checks between the document and the columns beside it. The
    error message, or None. Run on create and on the merged values of an edit,
    because an edit may change either side alone."""
    maximum = details.compensation.experience_max_months
    if (
        maximum is not None
        and experience_min_months is not None
        and maximum < experience_min_months
    ):
        return "maximum experience is below the minimum"
    primary = details.skills.primary
    if primary and primary.casefold() not in {s.casefold() for s in skills}:
        return "the primary skill must be one of the required skills"
    return None
