"""applications - Pydantic request/response DTOs

Apply, stages, withdraw, expiry, hire confirm.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**An apply request is a job id and nothing else.** No stage, no tenant, and no
score: eligibility is judged against the stored score, and `extra="forbid"`
makes a smuggled field a 422 rather than something quietly ignored.

**Two readers, two shapes.** The candidate sees their own board: stages, who
moved them, the interview. The employer's team sees its pipeline, including
its own notes and which team member acted. A note is never in a candidate
schema -- it is what a recruiter writes about someone, not to them.
"""

from __future__ import annotations

import uuid
from datetime import date as date_
from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, Field

from app.core.schemas import ApiSchema

ApplicationStage = Literal[
    "SUBMITTED",
    "VIEWED",
    "SHORTLISTED",
    "INTERVIEW",
    "DECISION",
    "HIRED",
    "REJECTED",
    "WITHDRAWN",
    "EXPIRED",
]
#: `applications.domain.EMPLOYER_TARGETS`, as a type.
EmployerTarget = Literal["VIEWED", "SHORTLISTED", "INTERVIEW", "DECISION", "REJECTED"]
HireConfirmation = Literal["NONE", "PENDING", "DISPUTED", "CONFIRMED"]
EventKind = Literal["STAGE_CHANGED", "INTERVIEW_SCHEDULED", "HIRE_PROPOSED", "HIRE_DISPUTED"]
Actor = Literal["CANDIDATE", "EMPLOYER", "SYSTEM"]


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class ApplyRequest(_Base):
    job_id: uuid.UUID


class InterviewDetails(_Base):
    """The interview card (SRS 1.13.2). The platform hosts no call; the link
    is the employer's own."""

    interview_at: datetime
    meeting_url: str


# ---------------------------------------------------------------------------
# The candidate's board
# ---------------------------------------------------------------------------
class ApplicationResponse(_Base):
    """One of the candidate's own applications, for their Application Board.

    The job is named but not reproduced: its threshold, like everywhere a
    candidate reads a job, is absent.
    """

    id: uuid.UUID
    job_id: uuid.UUID
    job_title: str | None = None
    employer_name: str | None = None
    stage: ApplicationStage
    #: PENDING is the candidate's cue to confirm or dispute.
    hire_confirmation: HireConfirmation = "NONE"
    interview: InterviewDetails | None = None
    created_at: datetime
    updated_at: datetime


class CandidateHistoryItem(_Base):
    """One step on the board. Who acted, as a party -- never which recruiter."""

    kind: EventKind
    from_stage: ApplicationStage | None
    to_stage: ApplicationStage
    by: Actor
    occurred_at: datetime


class ApplicationDetailResponse(ApplicationResponse):
    history: list[CandidateHistoryItem]


# ---------------------------------------------------------------------------
# The employer's pipeline
# ---------------------------------------------------------------------------
class MoveStageRequest(_Base):
    stage: EmployerTarget
    note: str | None = Field(default=None, max_length=1000)


class ScheduleInterviewRequest(_Base):
    """A time with its zone, and a link. A naive time is a 422: "10:00" means
    something different in Pune and in the server's UTC."""

    interview_at: AwareDatetime
    meeting_url: str = Field(min_length=1, max_length=1024)


class EmployerApplicationSummary(_Base):
    """An application in the employer's pipeline.

    **Not a candidate profile.** No name, contact details or score: who the
    candidate is, and what an employer may see of them, is the reveal on
    Days 13-14, behind the access window and its audit row. `candidate_id` is
    the handle that reveal will take.
    """

    id: uuid.UUID
    job_id: uuid.UUID
    candidate_id: uuid.UUID
    stage: ApplicationStage
    hire_confirmation: HireConfirmation
    interview: InterviewDetails | None = None
    created_at: datetime
    updated_at: datetime


class EmployerHistoryItem(_Base):
    kind: EventKind
    from_stage: ApplicationStage | None
    to_stage: ApplicationStage
    by: Actor
    #: The team member, for an employer action. Absent for the candidate's and
    #: the system's.
    actor_id: uuid.UUID | None
    note: str | None
    occurred_at: datetime


class EmployerApplicationListItem(EmployerApplicationSummary):
    """A row of the pipeline list, carrying its job's label.

    The list spans every job when no `job_id` is given, so each row names its
    own job -- otherwise a board of forty cards is forty more requests to
    learn what each was an application for. The job is the organisation's
    own; nothing here is about the candidate.
    """

    job_title: str | None = None
    job_location: str | None = None


class EmployerApplicationDetail(EmployerApplicationSummary):
    history: list[EmployerHistoryItem]


# ---------------------------------------------------------------------------
# The employer dashboard
# ---------------------------------------------------------------------------
# Counts of the organisation's own pipeline. **Still not a candidate profile**:
# no name, contact or score anywhere below, and no candidate id either -- every
# item names an application, which is the handle the pipeline screens take.
class JobCounts(_Base):
    """The organisation's jobs by state. `active` is PUBLISHED: on the board."""

    total: int
    active: int
    draft: int
    paused: int
    closed: int


class ApplicationCounts(_Base):
    total: int = Field(description="Every application ever received, whatever its stage.")
    open: int = Field(
        description="Still in the pipeline: not hired, rejected, withdrawn or expired."
    )
    distinct_candidates: int = Field(
        description="People, not applications. A candidate who reapplied counts once."
    )
    new_last_7_days: int
    new_last_30_days: int
    #: Where the applications stand now; every stage present, summing to `total`.
    by_stage: dict[ApplicationStage, int]


class NeedsAttention(_Base):
    """What is waiting on the employer's team, or on a candidate's answer."""

    unreviewed: int = Field(description="SUBMITTED: nobody has opened them yet.")
    interviews_to_schedule: int = Field(description="At INTERVIEW with no time booked.")
    interviews_next_7_days: int
    hires_awaiting_candidate: int = Field(
        description="Hire proposed; the candidate has not confirmed."
    )
    hires_disputed: int = Field(description="The candidate says the hire did not happen.")
    expiring_within_7_days: int = Field(
        description=(
            "Open applications the employer has not acted on for long enough that "
            "they expire within seven days unless someone moves them."
        )
    )


class RevealCounts(_Base):
    """Candidates whose full profile the organisation has opened (the reveal).

    Distinct people: opening the same candidate again is not counted twice,
    as it is not charged against the organisation's caps twice.
    """

    total: int
    last_7_days: int


class TopJob(_Base):
    job_id: uuid.UUID
    title: str
    status: Literal["DRAFT", "PUBLISHED", "PAUSED", "CLOSED"]
    applications: int
    open: int
    new_last_7_days: int
    last_applied_at: datetime


class UpcomingInterview(_Base):
    application_id: uuid.UUID
    job_id: uuid.UUID
    job_title: str
    interview_at: datetime
    meeting_url: str


class DailyApplications(_Base):
    #: A calendar day in India (IST).
    date: date_
    count: int


class EmployerDashboard(_Base):
    generated_at: datetime
    jobs: JobCounts
    applications: ApplicationCounts
    needs_attention: NeedsAttention
    candidates_revealed: RevealCounts
    #: Busiest first, jobs with at least one application only.
    top_jobs: list[TopJob]
    #: The next few booked interviews, soonest first.
    upcoming_interviews: list[UpcomingInterview]
    #: Thirty IST days ending today, oldest first, zeros included.
    applications_per_day: list[DailyApplications]


class ActivityItem(_Base):
    """One step in the organisation's pipeline, for the recent-activity feed.

    The history item a pipeline detail shows, with the job it belongs to. No
    note: a feed is read by the whole team at a glance, and a note is read on
    the application it was written about.
    """

    id: uuid.UUID
    application_id: uuid.UUID
    job_id: uuid.UUID
    job_title: str | None
    kind: EventKind
    from_stage: ApplicationStage | None
    to_stage: ApplicationStage
    by: Actor
    #: The team member, for an employer action. Absent for the candidate's and
    #: the system's.
    actor_id: uuid.UUID | None
    occurred_at: datetime


# --- messages to an applicant (2026-09-29) ------------------------------------------
class SendMessageRequest(_Base):
    """INTERVIEW needs `scheduled_at` (and may carry a meeting `link`);
    ASSESSMENT needs the assessment's `link` (and may carry a deadline in
    `scheduled_at`); GENERAL needs neither."""

    kind: Literal["INTERVIEW", "ASSESSMENT", "GENERAL"]
    body: str = Field(min_length=1, max_length=2000)
    scheduled_at: AwareDatetime | None = Field(
        default=None, description="The interview time, or the assessment's deadline."
    )
    link: str | None = Field(default=None, max_length=1024, description="An https link.")


class EmployerMessageResponse(_Base):
    id: uuid.UUID
    kind: Literal["INTERVIEW", "ASSESSMENT", "GENERAL"]
    body: str
    scheduled_at: datetime | None
    link: str | None
    sender_id: uuid.UUID | None = Field(description="The member of the team who sent it.")
    created_at: datetime


class CandidateMessageResponse(_Base):
    """A message as the candidate reads it. **Which recruiter wrote it is the
    employer's** and is not here, as with a stage change's actor."""

    id: uuid.UUID
    kind: Literal["INTERVIEW", "ASSESSMENT", "GENERAL"]
    body: str
    scheduled_at: datetime | None
    link: str | None
    employer_name: str | None
    created_at: datetime
