"""admin - Pydantic request/response DTOs

Queues, drill-downs, disputes, suspensions.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**What the console never shows, by field list rather than by care:**

* **the stored score** -- a drill-down carries `display_value` and `band`, the
  same number the candidate sees (invariant 2), and no field whose name
  contains "raw" (`test_no_employer_response_has_a_field_for_the_raw_score`
  walks `/admin` too);
* **a whole phone number or email** in a list or the drill-down --
  `phone_masked`, `email_masked`. The full contact is on the candidate's
  onboarding page only (2026-09-29), opened one person at a time and audited;
* **a CV** in the drill-down, which counts resume versions. The client asked
  for the CV itself on 2026-09-29: it is its own endpoint, its own capability
  (`candidate_resume`) and its own audit row, and so are interview recordings
  (`candidate_recordings`);
* **the provider subject** -- no schema here has a field for it.
"""

from __future__ import annotations

import uuid
from datetime import date as date_
from datetime import datetime
from typing import Any, Literal

from pydantic import Field

from app.core.schemas import ApiSchema
from app.modules.admin.domain import MAX_DISPUTE_DESCRIPTION, MAX_RESOLUTION, DisputeKind


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


# ---------------------------------------------------------------------------
# KYB -- a read-only record while approval is automatic
# ---------------------------------------------------------------------------
class KybSubmissionRow(_Base):
    id: uuid.UUID
    tenant_id: uuid.UUID
    organisation: str
    state: str
    form_version: str | None
    submitted_at: datetime | None
    reviewed_at: datetime | None
    auto_approved: bool
    created_at: datetime


class KybSubmissionsPage(_Base):
    items: list[KybSubmissionRow]
    next_cursor: str | None
    #: `kyb.require_approval`. While false, every submission was approved on
    #: arrival and this list is a record, not a queue (R15).
    review_required: bool


class KybDecisionRequest(_Base):
    decision: Literal["UNDER_REVIEW", "APPROVED", "REJECTED", "MORE_INFO_REQUIRED"]
    reason: str | None = Field(default=None, max_length=1000)


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------
class SignalCandidate(_Base):
    """Who a signal is about, enough to tell two people apart -- the same as a
    row of the candidate list. The full contact stays behind `/onboarding`."""

    id: uuid.UUID
    status: str
    full_name: str | None
    phone_masked: str | None
    email_masked: str | None


class IntegritySignalRow(_Base):
    id: uuid.UUID
    candidate_id: uuid.UUID
    resume_version_id: uuid.UUID | None
    rule_id: str
    rule_title: str = Field(description="The rule in plain English, for the queue.")
    rule_description: str = Field(description="One sentence on what the rule looks for.")
    rule_version: str
    thresholds_version: str
    severity: str
    state: str
    hides_candidate: bool = Field(
        description="True while this signal keeps the candidate out of employer search "
        "(HIGH, and OPEN or CONFIRMED). Only CLEARED restores them."
    )
    created_at: datetime
    resolved_at: datetime | None
    resolved_by: uuid.UUID | None = None
    resolved_by_email: str | None = Field(
        default=None, description="The staff member who resolved it."
    )
    resolution_note: str | None = None
    candidate: SignalCandidate | None = Field(
        default=None, description="Absent only on the resolve response; re-open the signal."
    )
    other_open_signals: int | None = Field(
        default=None, description="Other OPEN signals on the same candidate."
    )


class IntegritySignalsPage(_Base):
    items: list[IntegritySignalRow]
    next_cursor: str | None


class SignalResumeVersion(_Base):
    """The CV version the signal was raised on. Its text is at
    `/admin/candidates/{id}/resume`, behind its own capability and audit row."""

    id: uuid.UUID
    source: str
    created_at: datetime
    confirmed_at: datetime | None
    is_latest: bool = Field(description="False once the candidate has edited or re-uploaded.")


class SignalScore(_Base):
    """The candidate's current score as they see it. A signal never moves it."""

    display_value: int
    band: str
    computed_at: datetime


class RelatedSignal(_Base):
    id: uuid.UUID
    rule_id: str
    rule_title: str
    severity: str
    state: str
    hides_candidate: bool
    created_at: datetime


class IntegritySignalDetail(IntegritySignalRow):
    #: What the rule saw. Can quote the CV, which is why opening a signal is
    #: audited and the queue above never carries it.
    evidence: dict[str, Any]
    resume_version: SignalResumeVersion | None = None
    score: SignalScore | None = None
    visible_to_employers: bool | None = Field(
        default=None,
        description="Whether employers can find this candidate now, all signals considered.",
    )
    other_signals: list[RelatedSignal] = Field(
        default_factory=list, description="Every other signal on this candidate, newest first."
    )


class ResolveSignalRequest(_Base):
    outcome: Literal["CLEARED", "CONFIRMED"]
    note: str | None = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------------
# Organisations, suspension, seats
# ---------------------------------------------------------------------------
class TenantRow(_Base):
    id: uuid.UUID
    type: str
    name: str
    status: str
    created_at: datetime


class TenantsPage(_Base):
    items: list[TenantRow]
    next_cursor: str | None


class SuspendTenantRequest(_Base):
    #: Kept on the suspension row for whoever lifts it. Never in the audit
    #: metadata or an event: it is free text about a named organisation.
    reason: str = Field(min_length=3, max_length=500)


class SuspensionResponse(_Base):
    id: uuid.UUID
    tenant_id: uuid.UUID
    reason: str
    suspended_by: uuid.UUID
    suspended_at: datetime
    lifted_by: uuid.UUID | None
    lifted_at: datetime | None


class AllocateSeatsRequest(_Base):
    seats: int = Field(ge=0, le=1_000_000)


class SeatAllocationResponse(_Base):
    allocated: int
    used: int
    #: Linked students seated by this change, longest-linked first.
    filled: int


# ---------------------------------------------------------------------------
# Candidates -- the list is how staff find someone to drill into. Audited,
# because unlike an organisation list every row names a person.
# ---------------------------------------------------------------------------
class CandidateRow(_Base):
    """Enough to tell two people apart and pick one. The score, the CV and
    everything else the drill-down counts stay behind the drill-down, which
    audits the one person opened."""

    id: uuid.UUID
    status: str
    full_name: str | None
    city: str | None
    state_code: str | None
    phone_masked: str | None
    email_masked: str | None
    created_at: datetime


class CandidatesPage(_Base):
    items: list[CandidateRow]
    next_cursor: str | None


# ---------------------------------------------------------------------------
# Drill-downs -- every open is audited
# ---------------------------------------------------------------------------
class SubscriptionSummary(_Base):
    state: str
    plan_code: str
    current_period_end: datetime | None


class ScoreSummary(_Base):
    display_value: int
    band: str
    computed_at: datetime
    scores_computed: int


class ResumeSummary(_Base):
    files: int
    versions: int
    last_confirmed_at: datetime | None


class SignalCount(_Base):
    severity: str
    state: str
    count: int


class CollegeLinkSummary(_Base):
    tenant_id: uuid.UUID
    college: str
    scope: str
    granted_at: datetime


class CandidateDrilldown(_Base):
    id: uuid.UUID
    status: str
    locale: str
    created_at: datetime
    full_name: str | None
    city: str | None
    state_code: str | None
    phone_masked: str | None
    email_masked: str | None
    score: ScoreSummary | None
    resume: ResumeSummary
    visible_to_employers: bool
    integrity_signals: list[SignalCount]
    applications_by_stage: dict[str, int]
    hire_disputes: int
    subscription: SubscriptionSummary | None
    college_links: list[CollegeLinkSummary]
    seat_held: bool
    disputes_by_state: dict[str, int]


class SuspensionSummary(_Base):
    id: uuid.UUID
    suspended_at: datetime
    suspended_by: uuid.UUID


class KybSummary(_Base):
    id: uuid.UUID
    state: str
    submitted_at: datetime | None
    reviewed_at: datetime | None
    auto_approved: bool


class EmployerDrilldown(_Base):
    tenant_id: uuid.UUID
    name: str
    status: str
    created_at: datetime
    legal_name: str | None
    employer_type: str | None
    industry: str | None
    kyb_status: str | None
    verified_at: datetime | None
    latest_kyb: KybSummary | None
    members_by_role: dict[str, int]
    jobs_by_status: dict[str, int]
    applications_by_stage: dict[str, int]
    subscription: SubscriptionSummary | None
    suspension: SuspensionSummary | None
    #: Distinct candidates opened, not opens (Day 14 counts caps the same way).
    candidates_viewed_last_day: int
    candidates_viewed_last_30_days: int
    view_anomaly_flags_last_30_days: int
    disputes_by_state: dict[str, int]


class SeatSummary(_Base):
    allocated: int
    used: int
    plan_allowance: int | None


class CollegeDrilldown(_Base):
    tenant_id: uuid.UUID
    name: str
    status: str
    created_at: datetime
    institution_type: str | None
    onboarding_submitted_at: datetime | None
    verified_at: datetime | None
    members_by_role: dict[str, int]
    seats: SeatSummary | None
    live_referral_codes: int
    #: Live ROSTER consents: students the college may count.
    connected_students: int
    #: Live INDIVIDUAL consents: students the college may see by name.
    individually_visible: int
    roster_imports_by_state: dict[str, int]
    invitations_by_state: dict[str, int]
    subscription: SubscriptionSummary | None
    suspension: SuspensionSummary | None
    disputes_by_state: dict[str, int]


# ---------------------------------------------------------------------------
# Disputes -- the console's side
# ---------------------------------------------------------------------------
class DisputeRow(_Base):
    id: uuid.UUID
    kind: str
    party: str
    source: str
    raised_by: uuid.UUID
    tenant_id: uuid.UUID | None
    application_id: uuid.UUID | None
    state: str
    assigned_to: uuid.UUID | None
    created_at: datetime
    resolved_at: datetime | None


class DisputesPage(_Base):
    items: list[DisputeRow]
    next_cursor: str | None


class ApplicationLink(_Base):
    id: uuid.UUID
    candidate_id: uuid.UUID
    employer_tenant_id: uuid.UUID
    job_id: uuid.UUID
    stage: str
    employer_confirmed_at: datetime | None
    candidate_confirmed_at: datetime | None
    hire_disputed_at: datetime | None


class DisputeLinks(_Base):
    """Where to go next: the person, the organisation, the application, and
    whether the person's CV is under an integrity signal right now."""

    candidate_id: uuid.UUID | None
    raiser_tenant_id: uuid.UUID | None
    application: ApplicationLink | None
    #: OPEN or CONFIRMED signals on the candidate, by severity.
    live_integrity_signals: dict[str, int]


class DisputeDetail(DisputeRow):
    description: str
    resolution: str | None
    resolved_by: uuid.UUID | None
    links: DisputeLinks


class ResolveDisputeRequest(_Base):
    outcome: Literal["RESOLVED", "REJECTED"]
    #: The raiser reads this. Write it for them.
    resolution: str = Field(min_length=1, max_length=MAX_RESOLUTION)


# ---------------------------------------------------------------------------
# Audit search
# ---------------------------------------------------------------------------
class AuditEventRow(_Base):
    id: int
    actor_id: uuid.UUID | None
    actor_role: str
    action: str
    target_type: str
    target_id: str | None
    tenant_id: uuid.UUID | None
    request_id: str | None
    metadata: dict[str, Any]
    occurred_at: datetime


class AuditEventsPage(_Base):
    items: list[AuditEventRow]
    next_cursor: str | None


# ---------------------------------------------------------------------------
# Disputes -- the raiser's side (`/disputes`)
# ---------------------------------------------------------------------------
class RaiseDisputeRequest(_Base):
    kind: DisputeKind
    #: Required for HIRE, refused otherwise. Must be an application the caller
    #: can see: their own, or their organisation's.
    application_id: uuid.UUID | None = None
    description: str = Field(min_length=10, max_length=MAX_DISPUTE_DESCRIPTION)


class MyDisputeResponse(_Base):
    """No `assigned_to` and no `resolved_by`: which member of our staff handled
    it is ours to know, and the answer is the same whoever wrote it."""

    id: uuid.UUID
    kind: str
    source: str
    application_id: uuid.UUID | None
    description: str
    state: str
    resolution: str | None
    created_at: datetime
    resolved_at: datetime | None


# ---------------------------------------------------------------------------
# Accounts made on someone's behalf (2026-09-18)
# ---------------------------------------------------------------------------
_EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class ProvisionCandidateRequest(_Base):
    """The account, and optionally the name and location the app would ask
    for at sign-up (2026-10-03). Checked by the candidate profile's own rules."""

    email: str = Field(min_length=3, max_length=320, pattern=_EMAIL_PATTERN)
    full_name: str | None = None
    city: str | None = None
    state_code: str | None = None


_PREFILL_NOTE = (
    "Saved as a draft the person finds filled at first sign-in (2026-10-03). Field codes "
    "come from GET /admin/accounts/forms. Undertakings and documents are refused "
    "(`not_staff_fillable`): the person accepts and uploads them, and submits."
)


class ProvisionEmployerRequest(_Base):
    """The organisation and its first owner. The owner completes KYB and
    pays like any other employer; this only saves them typing the form.
    `legal_name`, `employer_type` and `industry` are KYB answers too, and win
    over the same codes in `kyb_answers`."""

    owner_email: str = Field(min_length=3, max_length=320, pattern=_EMAIL_PATTERN)
    legal_name: str = Field(min_length=2, max_length=255)
    employer_type: str | None = None
    industry: str | None = None
    kyb_answers: dict[str, Any] | None = Field(default=None, description=_PREFILL_NOTE)


class ProvisionCollegeRequest(_Base):
    """`name` and `institution_type` are onboarding answers too (`legal_name`,
    `institution_type`), and win over the same codes in `onboarding_answers`."""

    admin_email: str = Field(min_length=3, max_length=320, pattern=_EMAIL_PATTERN)
    name: str = Field(min_length=2, max_length=255)
    institution_type: str
    onboarding_answers: dict[str, Any] | None = Field(default=None, description=_PREFILL_NOTE)


class AddOrganisationMemberRequest(_Base):
    email: str = Field(min_length=3, max_length=320, pattern=_EMAIL_PATTERN)
    role: str = Field(description="A role of the organisation's kind: EMPLOYER_* or COLLEGE_*.")


class ProvisionedAccountResponse(_Base):
    """Who was made, and whether Cognito emailed them. The address is not
    echoed: staff typed it, and the response is logged by proxies."""

    user_id: uuid.UUID
    kind: Literal["CANDIDATE", "EMPLOYER", "COLLEGE", "MEMBER"]
    tenant_id: uuid.UUID | None = None
    role: str | None = None
    invitation: Literal["SENT", "ALREADY_REGISTERED"] = Field(
        description="SENT: Cognito emailed a temporary password. ALREADY_REGISTERED: the "
        "person has a sign-in already, no email went out, and they should sign in as usual."
    )
    prefilled: list[str] = Field(
        default_factory=list,
        description="Codes of the answers saved for the person to find at first sign-in.",
    )


class AccountFormOption(_Base):
    code: str
    label: str


class AccountForm(_Base):
    """An onboarding form as staff see it: its definition without the
    undertakings and documents, which only the person can give."""

    code: str
    version: str
    sections: list[dict[str, Any]]
    options: dict[str, list[AccountFormOption]]


class AccountFormsResponse(_Base):
    employer: AccountForm = Field(description="The KYB form, keys for `kyb_answers`.")
    college: AccountForm = Field(description="The onboarding form, keys for `onboarding_answers`.")


class InvitationResentResponse(_Base):
    user_id: uuid.UUID
    resent: bool = True


# ---------------------------------------------------------------------------
# Discount codes (2026-09-18)
# ---------------------------------------------------------------------------
class CreateDiscountCodeRequest(_Base):
    """Exactly one of `percent_off` (1-99) and `amount_off_minor` (paise).
    Leave `code` out to have one generated."""

    code: str | None = Field(default=None, min_length=4, max_length=32)
    audience: Literal["CANDIDATE", "EMPLOYER", "COLLEGE"]
    percent_off: int | None = Field(default=None, ge=1, le=99)
    amount_off_minor: int | None = Field(default=None, gt=0)
    valid_from: datetime | None = Field(default=None, description="Defaults to now.")
    valid_until: datetime | None = None
    usage_limit: int | None = Field(default=None, gt=0, description="Null: no limit.")
    label: str | None = Field(default=None, max_length=120)


class DiscountCodeResponse(_Base):
    id: uuid.UUID
    code: str
    audience: str
    percent_off: int | None
    amount_off_minor: int | None
    valid_from: datetime
    valid_until: datetime | None
    usage_limit: int | None
    usage_count: int
    status: Literal["ACTIVE", "SCHEDULED", "EXPIRED", "EXHAUSTED", "DISABLED"]
    label: str | None
    created_by: uuid.UUID
    created_at: datetime
    disabled_at: datetime | None
    disabled_by: uuid.UUID | None


class DiscountCodesPage(_Base):
    items: list[DiscountCodeResponse]
    next_cursor: str | None
    #: `placeholder-...` until the client has answered what a code may do.
    policy_version: str


class DiscountRedemptionRow(_Base):
    """One use: the payer, who the subscription was for, the amounts, when.
    An organisation is named; a candidate is an id (open their drill-down,
    which is audited, to see more)."""

    id: uuid.UUID
    payment_id: uuid.UUID
    user_id: uuid.UUID
    subscriber_type: str
    subscriber_id: uuid.UUID
    organisation: str | None = None
    list_amount_minor: int
    discount_minor: int
    amount_minor: int
    redeemed_at: datetime


class DiscountRedemptionsPage(_Base):
    items: list[DiscountRedemptionRow]
    next_cursor: str | None


# ---------------------------------------------------------------------------
# The dashboard
# ---------------------------------------------------------------------------
# A queue section is null for a role that cannot open that queue; see
# `domain.dashboard_sections`. Nothing below names a person: candidates are
# ids, as in the integrity queue, and organisations are named as in the KYB
# queue and the tenants list.
Severity = Literal["HIGH", "MEDIUM", "LOW"]


class KybBacklog(_Base):
    #: R15's switch. While false every submission is approved on arrival and
    #: nothing waits here.
    review_required: bool
    awaiting_review: int = Field(description="SUBMITTED or UNDER_REVIEW: waiting on a reviewer.")
    awaiting_employer: int = Field(description="MORE_INFO_REQUIRED: waiting on the employer.")
    oldest_waiting_since: datetime | None


class IntegrityBacklog(_Base):
    open: int
    open_by_severity: dict[Severity, int]
    candidates_held_back: int = Field(
        description=(
            "People with an OPEN HIGH signal: already out of employer search, "
            "waiting on a reviewer to clear or confirm."
        )
    )
    oldest_waiting_since: datetime | None


class DisputeBacklog(_Base):
    open: int
    in_review: int
    unassigned: int = Field(description="OPEN or IN_REVIEW with nobody assigned.")
    by_kind: dict[DisputeKind, int]
    oldest_waiting_since: datetime | None


class OrganisationStatusCounts(_Base):
    active: int
    suspended: int
    closed: int


class OrganisationCounts(_Base):
    employers: OrganisationStatusCounts
    colleges: OrganisationStatusCounts


class PlatformTotals(_Base):
    candidates: int = Field(description="Active candidate accounts.")
    employers: int = Field(description="Active employer organisations.")
    colleges: int = Field(description="Active college organisations.")
    jobs_published: int
    applications: int
    hires: int = Field(description="Confirmed by both sides.")


class WaitingItem(_Base):
    """One item in a queue, oldest first across the queues the caller sees.

    `detail` is the KYB state, the integrity rule, or the dispute kind.
    """

    type: Literal["KYB", "INTEGRITY", "DISPUTE"]
    id: uuid.UUID
    waiting_since: datetime
    detail: str
    organisation: str | None = None
    tenant_id: uuid.UUID | None = None
    candidate_id: uuid.UUID | None = None
    severity: Severity | None = None
    party: Literal["CANDIDATE", "EMPLOYER", "COLLEGE"] | None = None


class ThroughputDay(_Base):
    #: A calendar day in India (IST).
    date: date_
    intake: int
    cleared: int


class AdminDashboard(_Base):
    generated_at: datetime
    kyb: KybBacklog | None
    integrity: IntegrityBacklog | None
    disputes: DisputeBacklog | None
    organisations: OrganisationCounts | None
    platform_totals: PlatformTotals
    oldest_waiting: list[WaitingItem]
    #: Fourteen IST days ending today, oldest first, over the queues shown.
    throughput: list[ThroughputDay]


# ---------------------------------------------------------------------------
# Search filter options (2026-09-24)
# ---------------------------------------------------------------------------
FilterKind = Literal["SKILL", "CITY"]


class CreateSearchFilterOptionRequest(_Base):
    """A skill or a city employers can pick. A city needs `state_code`; a
    skill has none. Aliases are other spellings that choosing it also
    searches -- "Bangalore" for Bengaluru, "Excel" for MS Excel."""

    kind: FilterKind
    label: str = Field(min_length=1, max_length=100)
    aliases: list[str] = Field(default_factory=list, max_length=10)
    state_code: str | None = Field(default=None, min_length=2, max_length=2)
    featured: bool = Field(default=False, description="Shown on the panel before typing.")
    sort_order: int = Field(default=0, ge=0, le=10_000, description="Lower is shown first.")


class ImportSearchFilterOptionsRequest(_Base):
    """All or none: one bad item refuses the lot, naming its index."""

    items: list[CreateSearchFilterOptionRequest] = Field(min_length=1, max_length=500)


class UpdateSearchFilterOptionRequest(_Base):
    """Only the fields sent change. `aliases` replaces the whole list.
    `active: false` hides an option; options are never deleted."""

    label: str | None = Field(default=None, min_length=1, max_length=100)
    aliases: list[str] | None = Field(default=None, max_length=10)
    state_code: str | None = Field(default=None, min_length=2, max_length=2)
    featured: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    active: bool | None = None


class SearchFilterOptionResponse(_Base):
    id: uuid.UUID
    kind: FilterKind
    label: str
    key: str
    aliases: list[str]
    state_code: str | None
    featured: bool
    sort_order: int
    active: bool
    created_by: uuid.UUID | None
    updated_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class SearchFilterOptionsPage(_Base):
    items: list[SearchFilterOptionResponse]
    next_cursor: str | None
    #: `placeholder-...` while the starter lists are ours, not the client's.
    catalogue_version: str


class ImportSearchFilterOptionsResponse(_Base):
    items: list[SearchFilterOptionResponse]


# ---------------------------------------------------------------------------
# The full candidate page (2026-09-29)
# ---------------------------------------------------------------------------
class OnboardingAnswer(_Base):
    code: str
    question: str
    answer: str


class CandidateOnboarding(_Base):
    """Everything the candidate told us at sign-up and on their profile."""

    id: uuid.UUID
    status: str
    locale: str
    created_at: datetime
    full_name: str | None
    email: str | None
    phone: str | None
    city: str | None
    state_code: str | None
    questionnaire_submitted_at: datetime | None
    questionnaire: list[OnboardingAnswer]
    college_links: list[CollegeLinkSummary]


class ResumeVersionView(_Base):
    id: uuid.UUID
    source: str
    created_at: datetime
    confirmed_at: datetime | None
    text: str | None = Field(description="The CV as read, or as the candidate edited it.")
    fields: dict[str, Any] = Field(
        default_factory=dict, description="A form-built CV's fields, when it has no text."
    )
    file_url: str | None = Field(
        default=None, description="Presigned GET of the uploaded file; expires."
    )
    file_mime: str | None = None


class CandidateResumeView(_Base):
    latest: ResumeVersionView | None
    #: The newest confirmed version -- what the score was built from. Absent
    #: when it is the same as `latest`.
    confirmed: ResumeVersionView | None


class ScorePoint(_Base):
    """One score as the candidate saw it. Display value and band only."""

    computed_at: datetime
    display_value: int
    band: str
    change: int | None = Field(description="Against the previous point. None for the first.")
    cause: Literal["FIRST_SCORE", "RESUME_CHANGED", "ADD_ON", "RECOMPUTED"]


class ScoreTimeline(_Base):
    points: list[ScorePoint]


class InterviewSessionRow(_Base):
    id: uuid.UUID
    session_number: int
    state: str
    question_set_title: str
    created_at: datetime
    completed_at: datetime | None
    questions_asked: int
    answers_stored: int
    report_status: str


class InterviewRecordingRow(_Base):
    question_index: int
    question_code: str
    prompt: str
    url: str
    expires_in_seconds: int
    mime: str | None
    duration_ms: int | None
    uploaded_at: datetime | None
    transcript: str | None


class CourseStatusRow(_Base):
    code: str
    title: str
    purchased: bool
    purchased_at: datetime | None
    lessons_total: int
    lessons_completed: int
    percent_complete: int
    completed_at: datetime | None


class CandidateApplicationRow(_Base):
    id: uuid.UUID
    job_id: uuid.UUID
    job_title: str
    job_location: str | None
    employer_tenant_id: uuid.UUID
    employer_name: str | None
    stage: str
    applied_at: datetime
    updated_at: datetime
    interview_at: datetime | None


class ApplicationAnalytics(_Base):
    total: int
    open: int
    by_stage: dict[str, int]
    reached: dict[str, int] = Field(
        description="Applications that were ever at SHORTLISTED, INTERVIEW, DECISION or "
        "HIRED, wherever they are now."
    )


class CandidateApplications(_Base):
    items: list[CandidateApplicationRow]
    analytics: ApplicationAnalytics


# ---------------------------------------------------------------------------
# Building the course (2026-09-29)
# ---------------------------------------------------------------------------
class AdminLessonView(_Base):
    id: uuid.UUID
    title: str
    description: str | None
    sort_order: int
    duration_seconds: int
    media_kind: Literal["YOUTUBE", "UPLOAD"]
    youtube_video_id: str | None
    media_ready: bool = Field(description="Playable: a YouTube id, or an upload that was checked.")
    mime: str | None
    size_bytes: int | None
    active: bool
    created_at: datetime
    updated_at: datetime


class AdminModuleView(_Base):
    id: uuid.UUID
    title: str
    sort_order: int
    active: bool
    lessons: list[AdminLessonView]


class AdminCourseView(_Base):
    id: uuid.UUID
    code: str
    title: str
    version: int
    price_minor: int
    published: bool = Field(description="On sale to candidates.")
    modules: list[AdminModuleView]


class CreateCourseModuleRequest(_Base):
    title: str = Field(min_length=1, max_length=200)
    sort_order: int = Field(default=0, ge=0, le=10_000)


class UpdateCourseModuleRequest(_Base):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    active: bool | None = None


class CreateCourseLessonRequest(_Base):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    duration_seconds: int = Field(gt=0, le=14_400)
    sort_order: int = Field(default=0, ge=0, le=10_000)
    youtube_url: str | None = Field(
        default=None,
        max_length=500,
        description="An (unlisted) YouTube link. Leave out to upload a file instead: then "
        "POST .../upload, PUT the file, and POST .../upload/confirm.",
    )


class UpdateCourseLessonRequest(_Base):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    duration_seconds: int | None = Field(default=None, gt=0, le=14_400)
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
    active: bool | None = None
    youtube_url: str | None = Field(
        default=None, max_length=500, description="A new video for a YouTube lesson."
    )


class LessonUploadResponse(_Base):
    url: str
    method: Literal["PUT"] = "PUT"
    expires_in_seconds: int
    max_bytes: int
    accepted_types: list[str]


class PublishCourseRequest(_Base):
    published: bool
