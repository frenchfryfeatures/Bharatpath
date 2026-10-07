"""jobs - Pydantic request/response DTOs

Composer, validation, publish gate, lifecycle.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**Money is integer paise**, never a float and never rupees, and the fields say
so in their names. **Salary is mandatory** (PRD 5.2): a job without a range is
refused here and by a NOT NULL in the database.

**No request carries a status.** A job moves through its lifecycle only through
the publish, pause and close actions, so the publish gate cannot be bypassed by
sending `"status": "PUBLISHED"` in an edit -- `extra="forbid"` makes that a 422.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.core.schemas import ApiSchema
from app.modules.applications.schemas import ApplicationStage
from app.modules.jobs.details import CandidateJobDetails, JobDetails, check_against_columns

WorkMode = Literal["ONSITE", "HYBRID", "REMOTE"]
JobStatus = Literal["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"]

#: The `jobs` salary columns are 32-bit integers. Refused here rather than
#: overflowing into a 500. In paise this is about Rs 2.1 crore.
_MAX_MINOR = 2_147_483_647

Skill = Annotated[str, Field(min_length=1, max_length=80)]


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class CreateJobRequest(_Base):
    title: Annotated[str, Field(min_length=3, max_length=255)]
    description: Annotated[str, Field(min_length=20, max_length=20_000)]
    skills: Annotated[list[Skill], Field(default_factory=list, max_length=50)]
    location: Annotated[str | None, Field(default=None, max_length=255)] = None
    work_mode: WorkMode | None = None
    #: Experience required, in months. Never an age, and never a proxy for one
    #: (invariant 5): a requirement is about what someone has done.
    experience_min_months: Annotated[int | None, Field(default=None, ge=0, le=600)] = None
    salary_min_minor: Annotated[int, Field(ge=0, le=_MAX_MINOR)]
    salary_max_minor: Annotated[int, Field(ge=0, le=_MAX_MINOR)]
    #: The lowest score an applicant needs. 700 is the base every candidate
    #: has, so a threshold below it filters nothing.
    min_score: Annotated[int | None, Field(default=None, ge=700, le=990)] = None
    #: The rest of the posting. Optional, so a client that sends only the
    #: columns above still creates a valid draft. See `jobs/details.py`.
    details: JobDetails = Field(default_factory=JobDetails)

    @model_validator(mode="after")
    def _salary_range(self) -> CreateJobRequest:
        if self.salary_max_minor < self.salary_min_minor:
            raise ValueError("salary_max_minor is below salary_min_minor")
        problem = check_against_columns(
            self.details, skills=self.skills, experience_min_months=self.experience_min_months
        )
        if problem:
            raise ValueError(problem)
        return self


class UpdateJobRequest(_Base):
    """A partial edit, allowed only while the job is a draft or paused. The
    salary range is re-checked against the stored values, because an edit may
    send only one end of it."""

    title: Annotated[str | None, Field(default=None, min_length=3, max_length=255)] = None
    description: Annotated[str | None, Field(default=None, min_length=20, max_length=20_000)] = None
    skills: Annotated[list[Skill] | None, Field(default=None, max_length=50)] = None
    location: Annotated[str | None, Field(default=None, max_length=255)] = None
    work_mode: WorkMode | None = None
    experience_min_months: Annotated[int | None, Field(default=None, ge=0, le=600)] = None
    salary_min_minor: Annotated[int | None, Field(default=None, ge=0, le=_MAX_MINOR)] = None
    salary_max_minor: Annotated[int | None, Field(default=None, ge=0, le=_MAX_MINOR)] = None
    min_score: Annotated[int | None, Field(default=None, ge=700, le=990)] = None
    #: Replaces the whole document when sent. Sections are not merged: the
    #: composer always holds the full posting, and a merge would make removing
    #: a responsibility or a screening question impossible to express.
    details: JobDetails | None = None

    @model_validator(mode="after")
    def _something(self) -> UpdateJobRequest:
        if not self.model_fields_set:
            raise ValueError("send at least one field to change")
        for required in (
            "title",
            "description",
            "skills",
            "salary_min_minor",
            "salary_max_minor",
            "details",
        ):
            if required in self.model_fields_set and getattr(self, required) is None:
                raise ValueError(f"{required} cannot be cleared")
        return self


class JobResponse(_Base):
    id: uuid.UUID
    title: str
    description: str
    skills: list[str]
    location: str | None = None
    work_mode: str | None = None
    experience_min_months: int | None = None
    salary_min_minor: int
    salary_max_minor: int
    min_score: int | None = None
    details: JobDetails = Field(default_factory=JobDetails)
    status: JobStatus
    published_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime


class ApplicationStageCounts(_Base):
    """A job's pipeline, counted.

    **Where the applications are now, not where they have been.** Each one is
    at exactly one stage, so `by_stage` sums to `total`: someone shortlisted
    after being viewed is counted under SHORTLISTED alone, not under both.
    Every stage is present, zeros included.
    """

    total: int = Field(description="Every application ever filed on this job.")
    by_stage: dict[ApplicationStage, int]


class JobListItem(JobResponse):
    """A job as the employer's list draws it: the job, and its funnel.

    The counts are on the row rather than behind a request per job. A list of
    thirteen jobs is thirteen more round trips otherwise, and the table needs
    all of them before it can draw anything.
    """

    application_counts: ApplicationStageCounts


EligibilityStatus = Literal["ELIGIBLE", "BELOW_THRESHOLD", "SCORE_PENDING"]


class BoardJobSummary(_Base):
    """A published job as a candidate sees it in search.

    **No `min_score`.** A candidate who sees their own score and a job's
    threshold side by side learns the gap, which is the explanation the client
    ruled out (R11). They get `eligibility` instead. No `tenant_id` and no
    status either: everything on the board is published, and which tenant row
    an employer is stored under is ours.
    """

    id: uuid.UUID
    title: str
    employer_name: str | None = None
    skills: list[str]
    location: str | None = None
    work_mode: str | None = None
    experience_min_months: int | None = None
    salary_min_minor: int
    salary_max_minor: int
    #: False when the employer chose not to show the range. The numbers are
    #: still sent (the salary filter compares against them, and PRD 5.2 makes
    #: the range mandatory); a client draws "Not disclosed" instead.
    salary_disclosed: bool = True
    published_at: datetime
    eligibility: EligibilityStatus


class BoardJobDetail(BoardJobSummary):
    description: str
    #: The candidate's projection of the posting: no hiring manager, no
    #: screening questions, no internal settings (`jobs/details.py`).
    details: CandidateJobDetails = Field(default_factory=CandidateJobDetails)
    #: True when `details.application` carries a link or an email this
    #: candidate may use. False for an ineligible or held-back candidate,
    #: whose copy of the posting has both withheld.
    can_apply_externally: bool = False


class ThresholdPreviewResponse(_Base):
    """How many visible candidates would clear a threshold -- coarsely.

    Never an exact small number; see `jobs/domain.py` for why an exact count
    here is a way to learn one person's score.
    """

    min_score: int
    approximate_count: int = Field(
        description="Rounded down to the nearest ten. 0 when fewer_than_ten is true."
    )
    fewer_than_ten: bool
