"""college - Pydantic request/response DTOs

Institution tenant, roster, invites, consent, referral codes.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**No college-facing schema reveals a candidate before individual consent.**
The roster list may repeat a name the college itself uploaded for an invitation,
but its `candidate_id` stays null until the student grants INDIVIDUAL visibility.
`CollegeStudentResponse` is the only detailed view, behind live INDIVIDUAL
consent and audited on every open. It has no phone number, email, CV, raw score,
breakdown, or anything an employer wrote:
`tests/invariants/test_invariant_09_consent.py` holds its field list.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.core.schemas import ApiSchema
from app.modules.college.domain import (
    CODE_LENGTH,
    MAX_CODE_USES,
    MAX_CODE_VALID_DAYS,
    MAX_ROSTER_BYTES,
    StudentLinkState,
)
from app.modules.resume.structuring import StructuredResume, StructuredStatus

InstitutionType = Literal[
    "UNIVERSITY",
    "DEEMED_UNIVERSITY",
    "AUTONOMOUS_COLLEGE",
    "AFFILIATED_COLLEGE",
    "ENGINEERING_COLLEGE",
    "MANAGEMENT_INSTITUTE",
    "POLYTECHNIC",
    "ITI",
    "TRAINING_INSTITUTE",
    "OTHER",
]


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


# --- the organisation ------------------------------------------------------------
class CreateCollegeRequest(_Base):
    name: str = Field(min_length=2, max_length=255)
    institution_type: InstitutionType


class UpdateCollegeRequest(_Base):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    institution_type: InstitutionType | None = None


class CollegeResponse(_Base):
    tenant_id: uuid.UUID
    name: str
    institution_type: str
    onboarding_submitted_at: datetime | None = None
    verified_at: datetime | None = None
    created_at: datetime


class TeamMemberResponse(_Base):
    user_id: uuid.UUID
    email: str | None
    role: str
    added_at: datetime


class AddTeamMemberRequest(_Base):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: Literal["COLLEGE_ADMIN", "COLLEGE_STAFF"]


class ChangeRoleRequest(_Base):
    role: Literal["COLLEGE_ADMIN", "COLLEGE_STAFF"]


# --- onboarding ------------------------------------------------------------------
class FormOption(_Base):
    code: str
    label: str


class OnboardingResponse(_Base):
    """The form definition, its options, and what has been saved against it."""

    form: dict[str, Any]
    options: dict[str, list[FormOption]]
    answers: dict[str, Any]
    form_version: str | None
    submitted_at: datetime | None


class SaveOnboardingRequest(_Base):
    answers: dict[str, Any]


# --- seats -----------------------------------------------------------------------
class SeatsResponse(_Base):
    """Counts only. Which students hold them is not the college's to see."""

    seats_allocated: int
    seats_used: int
    seats_available: int
    subscription_active: bool = Field(
        description="Seats grant access only while the college's own subscription does."
    )


# --- referral codes --------------------------------------------------------------
class IssueCodeRequest(_Base):
    expires_in_days: int = Field(default=90, ge=1, le=MAX_CODE_VALID_DAYS)
    max_uses: int | None = Field(default=None, ge=1, le=MAX_CODE_USES)


class ReferralCodeResponse(_Base):
    id: uuid.UUID
    code: str = Field(description="Formatted for printing, e.g. `ABCD-EFGH-JKMN`.")
    state: Literal["ACTIVE", "EXPIRED", "REVOKED", "EXHAUSTED"]
    uses: int
    max_uses: int | None
    expires_at: datetime
    revoked_at: datetime | None
    created_at: datetime


class ReferralCodesPage(_Base):
    items: list[ReferralCodeResponse]
    next_cursor: str | None = None


# --- roster imports --------------------------------------------------------------
class RosterUploadRequest(_Base):
    """A CSV with a header row: `name`, `phone`, `email`, `student_ref`. Phone
    or email is required; other columns are ignored and listed back."""

    file_name: str = Field(min_length=1, max_length=255)
    csv: str = Field(min_length=1, max_length=MAX_ROSTER_BYTES)


class InvitationCounts(_Base):
    pending: int = 0
    sent: int = 0
    accepted: int = 0
    declined: int = 0
    expired: int = 0


class RosterImportResponse(_Base):
    id: uuid.UUID
    file_name: str
    state: Literal["PREVIEW", "COMMITTED", "DISCARDED"]
    total_rows: int
    valid_rows: int
    invalid_rows: int
    duplicate_rows: int
    unreachable_rows: int = Field(
        default=0,
        description=(
            "Valid rows no invitation can be delivered to. A roster row needs a "
            "phone or an email, and with SMS deferred a phone-only row is "
            "committed, invited, and then silently dropped. Ask these students "
            "for email addresses before committing."
        ),
    )
    ignored_columns: list[str]
    created_at: datetime
    committed_at: datetime | None
    invitations: InvitationCounts


class RosterImportsPage(_Base):
    items: list[RosterImportResponse]
    next_cursor: str | None = None
    invitation_totals: InvitationCounts


class RosterRowResponse(_Base):
    row_number: int
    full_name: str | None
    phone: str | None
    email: str | None
    student_ref: str | None
    row_state: Literal["VALID", "INVALID", "DUPLICATE"]
    issues: list[str]
    invite_state: Literal["PENDING", "SENT", "ACCEPTED", "DECLINED", "EXPIRED"] | None


class RosterRowsPage(_Base):
    items: list[RosterRowResponse]
    next_cursor: str | None = None


class InvitationsSentResponse(_Base):
    sent: int
    invitations: InvitationCounts


# --- the student's side ----------------------------------------------------------
class ConsentTermsResponse(_Base):
    consent_version: str
    scope: Literal["ROSTER", "INDIVIDUAL"]
    key: str = Field(description="Translation key. `text` is the English source.")
    text: str


class LinkByCodeRequest(_Base):
    code: str = Field(min_length=CODE_LENGTH, max_length=32)
    consent_version: str = Field(
        min_length=1,
        max_length=32,
        description="The version of the terms the app showed. A stale one is refused.",
    )


class AnswerInvitationRequest(_Base):
    consent_version: str = Field(min_length=1, max_length=32)


class CollegeLinkResponse(_Base):
    """One college the student is linked to. `seat_held` says whether that
    college is paying for their access; it is never a promise that it will."""

    college_id: uuid.UUID
    college_name: str | None
    scope: Literal["ROSTER", "INDIVIDUAL"]
    granted_via: Literal["REFERRAL_CODE", "INVITE", "DIRECT"]
    granted_at: datetime
    revoked_at: datetime | None
    seat_held: bool


class CandidateInvitationResponse(_Base):
    id: uuid.UUID
    college_name: str
    sent_at: datetime
    expires_at: datetime


# --- consent after linking (Day 18) -----------------------------------------------
class GrantIndividualVisibilityRequest(_Base):
    consent_version: str = Field(
        min_length=1,
        max_length=32,
        description="The version of the INDIVIDUAL terms the app showed. A stale one is refused.",
    )


class RevokeConsentRequest(_Base):
    scope: Literal["ROSTER", "INDIVIDUAL"] = Field(
        description=(
            "`INDIVIDUAL` stops the college seeing you as a person and keeps the link. "
            "`ROSTER` disconnects: the college stops counting you, your seat there is "
            "released, and individual visibility ends with it."
        )
    )


class RevokeConsentResponse(_Base):
    college_id: uuid.UUID
    revoked: list[Literal["ROSTER", "INDIVIDUAL"]] = Field(
        description="What this request ended. Empty if it had already ended."
    )
    revoked_at: datetime | None


# --- students who let their college see them (Day 18) ------------------------------
class VisibleStudentResponse(_Base):
    candidate_id: uuid.UUID | None = Field(
        description="Present only after the student grants individual visibility."
    )
    roster_entry_id: uuid.UUID | None = Field(
        description="Present for invited and consent-pending roster rows."
    )
    full_name: str | None = Field(
        description="Student-approved name when LINKED; otherwise the college's roster name."
    )
    stage_since: datetime
    visible_since: datetime | None = Field(
        description="When individual visibility began; present only for LINKED students."
    )
    link_state: StudentLinkState


class VisibleStudentsPage(_Base):
    items: list[VisibleStudentResponse]
    next_cursor: str | None = None


class StudentHireResponse(_Base):
    job_title: str
    employer_name: str
    hired_at: datetime
    source: Literal["PLATFORM"] = Field(
        default="PLATFORM",
        description=(
            "Always PLATFORM: a hire both sides confirmed on BharatPath. Placements "
            "made elsewhere are never attributed to BharatPath."
        ),
    )


class CollegeStudentResponse(_Base):
    """One student, shown only while they allow it. Every open is audited."""

    candidate_id: uuid.UUID
    full_name: str | None
    visible_since: datetime
    score: int | None = Field(description="The score as the student sees it. None until scored.")
    band: Literal["ENTRY", "DEVELOPING", "SOLID", "STRONG"] | None
    scored_at: datetime | None
    applications: int
    interviews: int = Field(description="Applications that reached an interview.")
    hires: list[StudentHireResponse]


# --- a student's details (2026-09-29): consent version 2 only -----------------------
class StudentAnswer(_Base):
    code: str
    question: str
    answer: str


class StudentCourseResponse(_Base):
    code: str
    title: str
    purchased_at: datetime
    lessons_total: int
    lessons_completed: int
    percent_complete: int = Field(ge=0, le=100)
    completed_at: datetime | None


class StudentApplicationResponse(_Base):
    job_title: str
    employer_name: str
    job_location: str | None
    stage: str
    applied_at: datetime
    updated_at: datetime


class StudentApplicationAnalytics(_Base):
    total: int
    open: int
    by_stage: dict[str, int]
    reached: dict[str, int] = Field(
        description="Applications that were ever at SHORTLISTED, INTERVIEW, DECISION or "
        "HIRED, wherever they are now."
    )


class CollegeStudentDetailsResponse(_Base):
    """What the current INDIVIDUAL consent words name beyond the core view:
    served only to a college whose student agreed to them. Every open is
    audited. The CV is its own endpoint and its own audit row."""

    candidate_id: uuid.UUID
    consent_version: str
    email: str | None
    phone: str | None
    city: str | None
    state_code: str | None
    locale: str
    questionnaire: list[StudentAnswer]
    questionnaire_submitted_at: datetime | None
    resume_confirmed_at: datetime | None = Field(
        description="When the CV the score was built from was confirmed. None: no CV yet."
    )
    has_resume_file: bool
    interviews_completed: int = Field(description="Practice interviews completed on BharatPath.")
    courses: list[StudentCourseResponse]
    applications: list[StudentApplicationResponse]
    analytics: StudentApplicationAnalytics


class CollegeStudentResumeResponse(_Base):
    confirmed_at: datetime | None
    source: str
    text: str | None = Field(description="The CV as read, or as the student edited it.")
    fields: dict[str, Any] = Field(
        default_factory=dict, description="A form-built CV's fields, when it has no text."
    )
    structured_resume: StructuredResume | None = Field(
        default=None,
        description="The same CV sorted into fields by a model, for display. Never "
        "scored. Null unless `structured_status` is READY; draw `text` then.",
    )
    structured_status: StructuredStatus = Field(
        default="UNAVAILABLE",
        description="READY, FAILED, or UNAVAILABLE (not configured, or a CV from "
        "before 2026-10-06).",
    )
    file_url: str | None = Field(description="Presigned GET of the uploaded file; expires.")
    file_mime: str | None = None
