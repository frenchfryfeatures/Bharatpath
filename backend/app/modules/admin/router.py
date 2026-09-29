"""admin - HTTP layer

Queues, drill-downs, disputes, suspensions.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Two surfaces.** `router` is the console (`/admin`), for our own staff, who
belong to the PLATFORM tenant. `raiser_router` is `/disputes`, where a
candidate, an employer or a college raises a dispute and reads the answer.

**Every console route names its capability** from `domain.CONSOLE_ROLES`, so
the permission table is the one place to read who may do what, and
`tests/invariants/test_admin_console.py` holds it: no external role reaches
any `/admin` route, and every drill-down writes an audit row.

**No payment gate here.** The console is ours; a dispute about a payment must
not require one.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, status

from app.core.deps import CurrentUser, DbSession, get_request_id, require_role
from app.modules.admin import service
from app.modules.admin.domain import CONSOLE_ROLES, DISPUTE_RAISER_ROLES, Capability
from app.modules.admin.schemas import (
    AddOrganisationMemberRequest,
    AdminCourseView,
    AdminDashboard,
    AdminLessonView,
    AllocateSeatsRequest,
    AuditEventsPage,
    CandidateApplications,
    CandidateDrilldown,
    CandidateOnboarding,
    CandidateResumeView,
    CandidatesPage,
    CollegeDrilldown,
    CourseStatusRow,
    CreateCourseLessonRequest,
    CreateCourseModuleRequest,
    CreateDiscountCodeRequest,
    CreateSearchFilterOptionRequest,
    DiscountCodeResponse,
    DiscountCodesPage,
    DiscountRedemptionsPage,
    DisputeDetail,
    DisputesPage,
    EmployerDrilldown,
    ImportSearchFilterOptionsRequest,
    ImportSearchFilterOptionsResponse,
    IntegritySignalDetail,
    IntegritySignalsPage,
    InterviewRecordingRow,
    InterviewSessionRow,
    InvitationResentResponse,
    KybDecisionRequest,
    KybSubmissionsPage,
    LessonUploadResponse,
    MyDisputeResponse,
    ProvisionCandidateRequest,
    ProvisionCollegeRequest,
    ProvisionedAccountResponse,
    ProvisionEmployerRequest,
    PublishCourseRequest,
    RaiseDisputeRequest,
    ResolveDisputeRequest,
    ResolveSignalRequest,
    ScoreTimeline,
    SearchFilterOptionResponse,
    SearchFilterOptionsPage,
    SeatAllocationResponse,
    SuspendTenantRequest,
    SuspensionResponse,
    TenantsPage,
    UpdateCourseLessonRequest,
    UpdateCourseModuleRequest,
    UpdateSearchFilterOptionRequest,
)
from app.modules.kyb.schemas import KybSubmissionResponse
from app.modules.notifications import service as notifications_service
from app.modules.notifications.schemas import SuppressRequest, SuppressResponse

router = APIRouter()
raiser_router = APIRouter()


def can(capability: Capability) -> list[Any]:
    return [Depends(require_role(*sorted(CONSOLE_ROLES[capability])))]


Limit = Query(default=None, ge=1, le=100)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@router.get(
    "/dashboard",
    response_model=AdminDashboard,
    dependencies=can("dashboard"),
    summary="The console's landing page: every queue the caller can open, counted (audited)",
)
async def dashboard(request: Request, user: CurrentUser, session: DbSession) -> AdminDashboard:
    """A queue section (`kyb`, `integrity`, `disputes`, `organisations`) is
    null for a role that cannot open that queue. `oldest_waiting` and
    `throughput` are drawn from the queues shown. Days are IST."""
    return await service.dashboard(session, ctx=user, request_id=get_request_id(request))


# ---------------------------------------------------------------------------
# KYB
# ---------------------------------------------------------------------------
@router.get(
    "/kyb/submissions",
    response_model=KybSubmissionsPage,
    dependencies=can("kyb"),
    summary="Every KYB submission, newest first",
)
async def list_kyb_submissions(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    state: str | None = None,
    cursor: str | None = None,
    limit: int | None = Limit,
) -> KybSubmissionsPage:
    """While `review_required` is false this is a record, not a queue: every
    submission was approved on arrival (R15)."""
    return await service.kyb_submissions(
        session,
        ctx=user,
        state=state,
        cursor=cursor,
        limit=limit,
        request_id=get_request_id(request),
    )


@router.get(
    "/kyb/submissions/{submission_id}",
    response_model=KybSubmissionResponse,
    dependencies=can("kyb"),
    summary="One submission with its answers and documents (audited)",
)
async def open_kyb_submission(
    submission_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> KybSubmissionResponse:
    return await service.open_kyb_submission(
        session, ctx=user, submission_id=submission_id, request_id=get_request_id(request)
    )


@router.post(
    "/kyb/submissions/{submission_id}/decision",
    response_model=KybSubmissionResponse,
    dependencies=can("kyb"),
    summary="Record a KYB decision",
)
async def decide_kyb(
    submission_id: uuid.UUID,
    payload: KybDecisionRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> KybSubmissionResponse:
    """Rejecting or asking for more information needs a reason, which the
    organisation reads. Only a submission awaiting review can be decided."""
    return await service.decide_kyb(
        session,
        ctx=user,
        submission_id=submission_id,
        decision=payload.decision,
        reason=payload.reason,
        request_id=get_request_id(request),
    )


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------
@router.get(
    "/integrity/signals",
    response_model=IntegritySignalsPage,
    dependencies=can("integrity"),
    summary="The integrity review queue, oldest first",
)
async def integrity_queue(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    state: Literal["OPEN", "CLEARED", "CONFIRMED"] = "OPEN",
    severity: Literal["LOW", "MEDIUM", "HIGH"] | None = None,
    cursor: str | None = None,
    limit: int | None = Limit,
) -> IntegritySignalsPage:
    return await service.integrity_queue(
        session,
        ctx=user,
        state=state,
        severity=severity,
        cursor=cursor,
        limit=limit,
        request_id=get_request_id(request),
    )


@router.get(
    "/integrity/signals/{signal_id}",
    response_model=IntegritySignalDetail,
    dependencies=can("integrity"),
    summary="One signal with its evidence (audited)",
)
async def open_signal(
    signal_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> IntegritySignalDetail:
    return await service.open_signal(
        session, ctx=user, signal_id=signal_id, request_id=get_request_id(request)
    )


@router.post(
    "/integrity/signals/{signal_id}/resolve",
    response_model=IntegritySignalDetail,
    dependencies=can("integrity"),
    summary="Clear or confirm a signal",
)
async def resolve_signal(
    signal_id: uuid.UUID, payload: ResolveSignalRequest, user: CurrentUser, session: DbSession
) -> IntegritySignalDetail:
    """CLEARED returns a HIGH-flagged candidate to employer search; CONFIRMED
    keeps them out. Neither moves a score (SRS 1.4.5). A decision is final."""
    return await service.resolve_signal(
        session, ctx=user, signal_id=signal_id, outcome=payload.outcome, note=payload.note
    )


# ---------------------------------------------------------------------------
# Organisations, suspension, seats
# ---------------------------------------------------------------------------
@router.get(
    "/tenants",
    response_model=TenantsPage,
    dependencies=can("tenants"),
    summary="Employers and colleges by name",
)
async def list_tenants(
    session: DbSession,
    tenant_type: Literal["EMPLOYER", "COLLEGE"] | None = Query(default=None, alias="type"),
    status_filter: Literal["ACTIVE", "SUSPENDED", "CLOSED"] | None = Query(
        default=None, alias="status"
    ),
    q: str | None = Query(default=None, max_length=100),
    cursor: str | None = None,
    limit: int | None = Limit,
) -> TenantsPage:
    return await service.list_tenants(
        session,
        tenant_type=tenant_type,
        status=status_filter,
        name_contains=q,
        cursor=cursor,
        limit=limit,
    )


@router.post(
    "/tenants/{tenant_id}/suspend",
    response_model=SuspensionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("suspend"),
    summary="Stop an organisation operating, immediately",
)
async def suspend_tenant(
    tenant_id: uuid.UUID,
    payload: SuspendTenantRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SuspensionResponse:
    """Every member is refused on their next request, the organisation's jobs
    leave the board, and nothing is deleted. 409 if already suspended."""
    return await service.suspend_tenant(
        session,
        ctx=user,
        tenant_id=tenant_id,
        reason=payload.reason,
        request_id=get_request_id(request),
    )


@router.post(
    "/tenants/{tenant_id}/reinstate",
    response_model=SuspensionResponse,
    dependencies=can("suspend"),
    summary="Lift an organisation's suspension",
)
async def reinstate_tenant(
    tenant_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> SuspensionResponse:
    return await service.reinstate_tenant(
        session, ctx=user, tenant_id=tenant_id, request_id=get_request_id(request)
    )


@router.get(
    "/tenants/{tenant_id}/suspensions",
    response_model=list[SuspensionResponse],
    dependencies=can("tenants"),
    summary="An organisation's suspension history, newest first",
)
async def suspension_history(tenant_id: uuid.UUID, session: DbSession) -> list[SuspensionResponse]:
    return await service.suspensions(session, tenant_id=tenant_id)


@router.put(
    "/colleges/{tenant_id}/seats",
    response_model=SeatAllocationResponse,
    dependencies=can("seats"),
    summary="Set a college's seat allowance",
)
async def allocate_seats(
    tenant_id: uuid.UUID,
    payload: AllocateSeatsRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SeatAllocationResponse:
    """Never below the seats in use, never above what the college's live plan
    pays for. Growing it seats linked students waiting for one."""
    return await service.allocate_seats(
        session,
        ctx=user,
        tenant_id=tenant_id,
        seats=payload.seats,
        request_id=get_request_id(request),
    )


# ---------------------------------------------------------------------------
# Drill-downs
# ---------------------------------------------------------------------------
@router.get(
    "/candidates",
    response_model=CandidatesPage,
    dependencies=can("candidate_drilldown"),
    summary="Candidate accounts, newest first (audited)",
)
async def list_candidates(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    status_filter: Literal["ACTIVE", "SUSPENDED", "DELETED"] | None = Query(
        default=None, alias="status"
    ),
    q: str | None = Query(default=None, max_length=100, description="Part of the full name"),
    email: str | None = Query(default=None, max_length=320, description="The exact address"),
    cursor: str | None = None,
    limit: int | None = Limit,
) -> CandidatesPage:
    """Candidates are not tenants, so `GET /admin/tenants` never lists them;
    this does. Whoever may open a candidate may find one -- the same
    capability. Contacts are masked; open `/candidates/{user_id}` for the rest."""
    return await service.list_candidates(
        session,
        ctx=user,
        status=status_filter,
        name_contains=q,
        email=email,
        cursor=cursor,
        limit=limit,
        request_id=get_request_id(request),
    )


@router.get(
    "/candidates/{user_id}",
    response_model=CandidateDrilldown,
    dependencies=can("candidate_drilldown"),
    summary="One candidate across every module (audited)",
)
async def candidate_drilldown(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> CandidateDrilldown:
    return await service.candidate_drilldown(
        session, ctx=user, user_id=user_id, request_id=get_request_id(request)
    )


# --- the full candidate page (2026-09-29) --------------------------------------
@router.get(
    "/candidates/{user_id}/onboarding",
    response_model=CandidateOnboarding,
    dependencies=can("candidate_contact"),
    summary="Everything the candidate gave at onboarding, contact unmasked (audited)",
)
async def candidate_onboarding(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> CandidateOnboarding:
    return await service.candidate_onboarding(
        session, ctx=user, user_id=user_id, request_id=get_request_id(request)
    )


@router.get(
    "/candidates/{user_id}/resume",
    response_model=CandidateResumeView,
    dependencies=can("candidate_resume"),
    summary="The candidate's CV: text and the uploaded file (audited)",
)
async def candidate_resume(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> CandidateResumeView:
    """`latest` is the newest version; `confirmed` the newest confirmed one,
    what the score was built from, when that is a different version.
    `file_url` is a presigned GET that expires."""
    return await service.candidate_resume(
        session, ctx=user, user_id=user_id, request_id=get_request_id(request)
    )


@router.get(
    "/candidates/{user_id}/score-timeline",
    response_model=ScoreTimeline,
    dependencies=can("candidate_drilldown"),
    summary="Every change in the candidate's score, oldest first (audited)",
)
async def candidate_score_timeline(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> ScoreTimeline:
    """Display value and band per point -- the number the candidate saw --
    with the change from the previous point and its cause."""
    return await service.candidate_score_timeline(
        session, ctx=user, user_id=user_id, request_id=get_request_id(request)
    )


@router.get(
    "/candidates/{user_id}/interviews",
    response_model=list[InterviewSessionRow],
    dependencies=can("candidate_drilldown"),
    summary="The mock interviews the candidate sat (audited)",
)
async def candidate_interviews(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> list[InterviewSessionRow]:
    return await service.candidate_interviews(
        session, ctx=user, user_id=user_id, request_id=get_request_id(request)
    )


@router.get(
    "/candidates/{user_id}/interviews/{session_id}/recordings",
    response_model=list[InterviewRecordingRow],
    dependencies=can("candidate_recordings"),
    summary="Play back one interview's recorded answers (audited)",
)
async def candidate_interview_recordings(
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> list[InterviewRecordingRow]:
    """One presigned GET per stored answer, with the question and the
    transcript. The links expire; ask again rather than keeping them."""
    return await service.candidate_interview_recordings(
        session,
        ctx=user,
        user_id=user_id,
        session_id=session_id,
        request_id=get_request_id(request),
    )


@router.get(
    "/candidates/{user_id}/courses",
    response_model=list[CourseStatusRow],
    dependencies=can("candidate_drilldown"),
    summary="The candidate's course purchases and progress (audited)",
)
async def candidate_courses(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> list[CourseStatusRow]:
    return await service.candidate_courses(
        session, ctx=user, user_id=user_id, request_id=get_request_id(request)
    )


@router.get(
    "/candidates/{user_id}/applications",
    response_model=CandidateApplications,
    dependencies=can("candidate_drilldown"),
    summary="Every job the candidate applied to, its stage, and stage analytics (audited)",
)
async def candidate_applications(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> CandidateApplications:
    return await service.candidate_applications(
        session, ctx=user, user_id=user_id, request_id=get_request_id(request)
    )


@router.get(
    "/employers/{tenant_id}",
    response_model=EmployerDrilldown,
    dependencies=can("employer_drilldown"),
    summary="One employer across every module (audited)",
)
async def employer_drilldown(
    tenant_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> EmployerDrilldown:
    return await service.employer_drilldown(
        session, ctx=user, tenant_id=tenant_id, request_id=get_request_id(request)
    )


@router.get(
    "/colleges/{tenant_id}",
    response_model=CollegeDrilldown,
    dependencies=can("college_drilldown"),
    summary="One college across every module (audited)",
)
async def college_drilldown(
    tenant_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> CollegeDrilldown:
    return await service.college_drilldown(
        session, ctx=user, tenant_id=tenant_id, request_id=get_request_id(request)
    )


@router.post(
    "/users/{user_id}/notification-suppressions",
    response_model=SuppressResponse,
    dependencies=can("suppress_notifications"),
    summary="Stop messages to one account on a channel (audited)",
)
async def suppress_notifications(
    user_id: uuid.UUID,
    payload: SuppressRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SuppressResponse:
    """Our stop, recorded apart from the person's own preferences. The in-app
    inbox is never suppressed."""
    return await notifications_service.suppress(
        session,
        ctx=user,
        user_id=user_id,
        channel=payload.channel,
        reason=payload.reason,
        request_id=get_request_id(request),
    )


# ---------------------------------------------------------------------------
# Disputes
# ---------------------------------------------------------------------------
@router.get(
    "/disputes",
    response_model=DisputesPage,
    dependencies=can("disputes"),
    summary="The dispute queue across candidates, employers and colleges",
)
async def dispute_queue(
    user: CurrentUser,
    session: DbSession,
    state: Literal["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"] | None = None,
    kind: Literal["HIRE", "PAYMENT", "ACCOUNT", "OTHER"] | None = None,
    party: Literal["CANDIDATE", "EMPLOYER", "COLLEGE"] | None = None,
    cursor: str | None = None,
    limit: int | None = Limit,
) -> DisputesPage:
    """Without `state`, what still needs someone: OPEN and IN_REVIEW."""
    return await service.dispute_queue(
        session, ctx=user, state=state, kind=kind, party=party, cursor=cursor, limit=limit
    )


@router.get(
    "/disputes/{dispute_id}",
    response_model=DisputeDetail,
    dependencies=can("disputes"),
    summary="One dispute, cross-linked to its people and records (audited)",
)
async def open_dispute(
    dispute_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> DisputeDetail:
    return await service.open_dispute(
        session, ctx=user, dispute_id=dispute_id, request_id=get_request_id(request)
    )


@router.post(
    "/disputes/{dispute_id}/assign",
    response_model=DisputeDetail,
    dependencies=can("disputes"),
    summary="Take a dispute",
)
async def assign_dispute(
    dispute_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> DisputeDetail:
    return await service.assign_dispute(
        session, ctx=user, dispute_id=dispute_id, request_id=get_request_id(request)
    )


@router.post(
    "/disputes/{dispute_id}/resolve",
    response_model=DisputeDetail,
    dependencies=can("disputes"),
    summary="Close a dispute with an answer for the raiser",
)
async def resolve_dispute(
    dispute_id: uuid.UUID,
    payload: ResolveDisputeRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> DisputeDetail:
    """Records the answer and nothing else: no application moves and no
    payment is refunded by closing a dispute."""
    return await service.resolve_dispute(
        session,
        ctx=user,
        dispute_id=dispute_id,
        outcome=payload.outcome,
        resolution=payload.resolution,
        request_id=get_request_id(request),
    )


# ---------------------------------------------------------------------------
# Audit search
# ---------------------------------------------------------------------------
@router.get(
    "/audit-events",
    response_model=AuditEventsPage,
    dependencies=can("audit_search"),
    summary="Search the audit trail by actor, action, target and time",
)
async def search_audit(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    actor_id: uuid.UUID | None = None,
    action: str | None = Query(default=None, max_length=64),
    target_type: str | None = Query(default=None, max_length=64),
    target_id: str | None = Query(default=None, max_length=64),
    tenant_id: uuid.UUID | None = None,
    occurred_from: datetime | None = Query(default=None, alias="from"),
    occurred_to: datetime | None = Query(default=None, alias="to"),
    cursor: str | None = None,
    limit: int | None = Limit,
) -> AuditEventsPage:
    """Newest first. `from` is inclusive, `to` exclusive. The search is itself
    written to the trail, with its filters."""
    return await service.search_audit(
        session,
        ctx=user,
        actor_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        tenant_id=tenant_id,
        occurred_from=occurred_from,
        occurred_to=occurred_to,
        cursor=cursor,
        limit=limit,
        request_id=get_request_id(request),
    )


# ---------------------------------------------------------------------------
# Accounts made on someone's behalf (2026-09-18)
# ---------------------------------------------------------------------------
@router.post(
    "/accounts/candidates",
    response_model=ProvisionedAccountResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("accounts"),
    summary="Create a candidate account; Cognito emails a temporary password",
)
async def provision_candidate(
    payload: ProvisionCandidateRequest, request: Request, user: CurrentUser, session: DbSession
) -> ProvisionedAccountResponse:
    """409 `identity_account_exists` if the address has any account. The
    candidate signs in with the emailed password, sets their own, and
    onboards as usual."""
    return await service.provision_candidate(
        session, ctx=user, payload=payload, request_id=get_request_id(request)
    )


@router.post(
    "/accounts/employers",
    response_model=ProvisionedAccountResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("accounts"),
    summary="Create an employer and its owner; Cognito emails a temporary password",
)
async def provision_employer(
    payload: ProvisionEmployerRequest, request: Request, user: CurrentUser, session: DbSession
) -> ProvisionedAccountResponse:
    """The owner completes KYB and pays as any employer does. 409
    `identity_already_in_organisation` if the address already runs one."""
    return await service.provision_employer(
        session, ctx=user, payload=payload, request_id=get_request_id(request)
    )


@router.post(
    "/accounts/colleges",
    response_model=ProvisionedAccountResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("accounts"),
    summary="Create a college and its admin; Cognito emails a temporary password",
)
async def provision_college(
    payload: ProvisionCollegeRequest, request: Request, user: CurrentUser, session: DbSession
) -> ProvisionedAccountResponse:
    return await service.provision_college(
        session, ctx=user, payload=payload, request_id=get_request_id(request)
    )


@router.post(
    "/tenants/{tenant_id}/members",
    response_model=ProvisionedAccountResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("accounts"),
    summary="Add a member to an employer or college, inviting them if new",
)
async def add_organisation_member(
    tenant_id: uuid.UUID,
    payload: AddOrganisationMemberRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> ProvisionedAccountResponse:
    return await service.add_organisation_member(
        session,
        ctx=user,
        tenant_id=tenant_id,
        payload=payload,
        request_id=get_request_id(request),
    )


@router.post(
    "/accounts/{user_id}/resend-invitation",
    response_model=InvitationResentResponse,
    dependencies=can("resend_invitation"),
    summary="Email a provisioned account's temporary password again",
)
async def resend_invitation(
    user_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> InvitationResentResponse:
    """Only for an account that has never signed in (409
    `identity_account_already_active` otherwise). The new password gets a
    fresh expiry."""
    return await service.resend_invitation(
        session, ctx=user, user_id=user_id, request_id=get_request_id(request)
    )


# ---------------------------------------------------------------------------
# Discount codes (2026-09-18)
# ---------------------------------------------------------------------------
@router.post(
    "/discount-codes",
    response_model=DiscountCodeResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("discounts"),
    summary="Create a discount code for candidates, employers or colleges",
)
async def create_discount_code(
    payload: CreateDiscountCodeRequest, request: Request, user: CurrentUser, session: DbSession
) -> DiscountCodeResponse:
    """A code's terms never change once made; switch it off and make
    another. 409 `discount_code_taken` for a chosen code that exists."""
    return await service.create_discount_code(
        session, ctx=user, payload=payload, request_id=get_request_id(request)
    )


@router.get(
    "/discount-codes",
    response_model=DiscountCodesPage,
    dependencies=can("discounts_read"),
    summary="Every discount code with its usage and status, newest first",
)
async def list_discount_codes(
    session: DbSession,
    audience: Literal["CANDIDATE", "EMPLOYER", "COLLEGE"] | None = None,
    cursor: str | None = None,
    limit: int | None = Limit,
) -> DiscountCodesPage:
    return await service.list_discount_codes(session, audience=audience, cursor=cursor, limit=limit)


@router.get(
    "/discount-codes/{code_id}",
    response_model=DiscountCodeResponse,
    dependencies=can("discounts_read"),
    summary="One discount code",
)
async def get_discount_code(code_id: uuid.UUID, session: DbSession) -> DiscountCodeResponse:
    return await service.get_discount_code(session, code_id=code_id)


@router.post(
    "/discount-codes/{code_id}/disable",
    response_model=DiscountCodeResponse,
    dependencies=can("discounts"),
    summary="Switch a discount code off, for good",
)
async def disable_discount_code(
    code_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> DiscountCodeResponse:
    """Idempotent. Payments already made with the code are untouched."""
    return await service.disable_discount_code(
        session, ctx=user, code_id=code_id, request_id=get_request_id(request)
    )


@router.get(
    "/discount-codes/{code_id}/redemptions",
    response_model=DiscountRedemptionsPage,
    dependencies=can("discounts_read"),
    summary="Who used a discount code, on which payment, and when",
)
async def discount_redemptions(
    code_id: uuid.UUID,
    session: DbSession,
    cursor: str | None = None,
    limit: int | None = Limit,
) -> DiscountRedemptionsPage:
    """A use is recorded when its payment succeeds, not at checkout."""
    return await service.discount_redemptions(session, code_id=code_id, cursor=cursor, limit=limit)


# ---------------------------------------------------------------------------
# Search filter options (2026-09-24)
# ---------------------------------------------------------------------------
@router.get(
    "/search-filters",
    response_model=SearchFilterOptionsPage,
    dependencies=can("search_filters"),
    summary="The skills and cities employers filter by",
)
async def list_search_filter_options(
    session: DbSession,
    kind: Literal["SKILL", "CITY"] | None = None,
    q: str | None = Query(default=None, max_length=100, description="In the key or an alias"),
    include_inactive: bool = False,
    cursor: str | None = None,
    limit: int | None = Limit,
) -> SearchFilterOptionsPage:
    """By kind, then key. Switched-off options only with `include_inactive`."""
    return await service.list_search_filter_options(
        session,
        kind=kind,
        query=q,
        include_inactive=include_inactive,
        cursor=cursor,
        limit=limit,
    )


@router.post(
    "/search-filters",
    response_model=SearchFilterOptionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("search_filters"),
    summary="Add a skill or a city to the search filters",
)
async def create_search_filter_option(
    payload: CreateSearchFilterOptionRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SearchFilterOptionResponse:
    """422 `search_filter_option_invalid` with a reason; 409
    `search_filter_option_conflict` naming a spelling (label or alias) that
    another option already holds, switched off or not."""
    [created] = await service.create_search_filter_options(
        session, ctx=user, items=[payload], request_id=get_request_id(request)
    )
    return created


@router.post(
    "/search-filters/import",
    response_model=ImportSearchFilterOptionsResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("search_filters"),
    summary="Import up to 500 skills or cities at once, all or none",
)
async def import_search_filter_options(
    payload: ImportSearchFilterOptionsRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> ImportSearchFilterOptionsResponse:
    """One bad item refuses the lot: 422 with `params.index`, or 409 with the
    clashing spellings."""
    items = await service.create_search_filter_options(
        session, ctx=user, items=payload.items, request_id=get_request_id(request)
    )
    return ImportSearchFilterOptionsResponse(items=items)


@router.get(
    "/search-filters/{option_id}",
    response_model=SearchFilterOptionResponse,
    dependencies=can("search_filters"),
    summary="One search filter option",
)
async def get_search_filter_option(
    option_id: uuid.UUID, session: DbSession
) -> SearchFilterOptionResponse:
    return await service.get_search_filter_option(session, option_id=option_id)


@router.patch(
    "/search-filters/{option_id}",
    response_model=SearchFilterOptionResponse,
    dependencies=can("search_filters"),
    summary="Change, feature, reorder or switch off a search filter option",
)
async def update_search_filter_option(
    option_id: uuid.UUID,
    payload: UpdateSearchFilterOptionRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SearchFilterOptionResponse:
    """Only the fields sent change; `aliases` replaces the list. Options are
    switched off (`active: false`), never deleted."""
    return await service.update_search_filter_option(
        session,
        ctx=user,
        option_id=option_id,
        payload=payload,
        request_id=get_request_id(request),
    )


# ---------------------------------------------------------------------------
# /disputes -- raised by candidates, employers and colleges
# ---------------------------------------------------------------------------
Raisers = [Depends(require_role(*sorted(DISPUTE_RAISER_ROLES)))]


@raiser_router.post(
    "",
    response_model=MyDisputeResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=Raisers,
    summary="Raise a dispute",
)
async def raise_dispute(
    payload: RaiseDisputeRequest, user: CurrentUser, session: DbSession
) -> MyDisputeResponse:
    """HIRE needs the application it is about; PAYMENT, ACCOUNT and OTHER take
    none. A college cannot dispute a hire. Five a day per person."""
    return await service.raise_dispute(
        session,
        ctx=user,
        kind=payload.kind,
        application_id=payload.application_id,
        description=payload.description,
    )


@raiser_router.get(
    "",
    response_model=list[MyDisputeResponse],
    dependencies=Raisers,
    summary="Disputes raised by me, or by my organisation",
)
async def my_disputes(user: CurrentUser, session: DbSession) -> list[MyDisputeResponse]:
    return await service.my_disputes(session, ctx=user)


# ---------------------------------------------------------------------------
# Building the course (2026-09-29)
# ---------------------------------------------------------------------------
@router.get(
    "/courses",
    response_model=list[AdminCourseView],
    dependencies=can("courses"),
    summary="Every course with all its modules and lessons",
)
async def list_courses(session: DbSession) -> list[AdminCourseView]:
    return await service.list_courses(session)


@router.post(
    "/courses/{code}/modules",
    response_model=AdminCourseView,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("courses"),
    summary="Add a module to a course",
)
async def create_course_module(
    code: str,
    payload: CreateCourseModuleRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> AdminCourseView:
    return await service.create_course_module(
        session, ctx=user, code=code, payload=payload, request_id=get_request_id(request)
    )


@router.patch(
    "/course-modules/{module_id}",
    response_model=AdminCourseView,
    dependencies=can("courses"),
    summary="Rename, reorder or switch off a module",
)
async def update_course_module(
    module_id: uuid.UUID,
    payload: UpdateCourseModuleRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> AdminCourseView:
    return await service.update_course_module(
        session, ctx=user, module_id=module_id, payload=payload, request_id=get_request_id(request)
    )


@router.post(
    "/course-modules/{module_id}/lessons",
    response_model=AdminLessonView,
    status_code=status.HTTP_201_CREATED,
    dependencies=can("courses"),
    summary="Add a lesson: a YouTube link, or a video to upload",
)
async def create_course_lesson(
    module_id: uuid.UUID,
    payload: CreateCourseLessonRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> AdminLessonView:
    """With `youtube_url` the lesson is playable at once (an unlisted video
    is watchable by anyone holding its link). Without it, upload the file:
    `POST .../upload`, PUT to the URL, then `POST .../upload/confirm`. 422
    `course_lesson_media_invalid` with `params.reason` for a link that is not
    YouTube's."""
    return await service.create_course_lesson(
        session, ctx=user, module_id=module_id, payload=payload, request_id=get_request_id(request)
    )


@router.patch(
    "/course-lessons/{lesson_id}",
    response_model=AdminLessonView,
    dependencies=can("courses"),
    summary="Edit a lesson, replace its YouTube video, or switch it off",
)
async def update_course_lesson(
    lesson_id: uuid.UUID,
    payload: UpdateCourseLessonRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> AdminLessonView:
    return await service.update_course_lesson(
        session, ctx=user, lesson_id=lesson_id, payload=payload, request_id=get_request_id(request)
    )


@router.post(
    "/course-lessons/{lesson_id}/upload",
    response_model=LessonUploadResponse,
    dependencies=can("courses"),
    summary="A presigned URL to PUT a lesson's video (MP4 or WebM)",
)
async def issue_lesson_upload(lesson_id: uuid.UUID, session: DbSession) -> LessonUploadResponse:
    """Re-issuing replaces the video: the lesson leaves the course until the
    new file is confirmed."""
    return await service.issue_lesson_upload(session, lesson_id=lesson_id)


@router.post(
    "/course-lessons/{lesson_id}/upload/confirm",
    response_model=AdminLessonView,
    dependencies=can("courses"),
    summary="Check the uploaded video and make the lesson playable",
)
async def confirm_lesson_upload(
    lesson_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> AdminLessonView:
    """Size from S3, format from the bytes. A file that is not MP4 or WebM is
    deleted: 422 `course_lesson_media_invalid` with `params.reason`."""
    return await service.confirm_lesson_upload(
        session, ctx=user, lesson_id=lesson_id, request_id=get_request_id(request)
    )


@router.put(
    "/courses/{code}/published",
    response_model=AdminCourseView,
    dependencies=can("courses"),
    summary="Put a course on sale, or take it off",
)
async def publish_course(
    code: str,
    payload: PublishCourseRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> AdminCourseView:
    """409 `course_not_publishable` without at least one playable lesson.
    Taking a course off sale stops new purchases; buyers keep their lessons."""
    return await service.publish_course(
        session,
        ctx=user,
        code=code,
        published=payload.published,
        request_id=get_request_id(request),
    )
