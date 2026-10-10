"""admin - business rules and transaction boundaries

Queues, drill-downs, disputes, suspensions.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**The shape of every cross-tenant read** (`_reveal`): write the audit row on
the request's own transaction, then open the read-only bypass session and
read. The audit row therefore exists before anything is read, commits or
rolls back with the request, and names the member of staff, their role and
the target. A console read with no audit row is not a code path that exists.

**Writes stay in the owning module.** A KYB decision is `kyb.service.review`,
a resolution is `integrity.service.resolve_signal`, seats are
`college.service.allocate_seats`, a suspension is `identity.service`. The
console decides who may press the button and records that they did; the rules
about what the button does live where they always did, and so do their tests.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any

from fastapi import status
from pydantic import ValidationError as PydanticValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.audit import AuditAction, audit_event
from app.core.db import get_admin_session_factory, set_transaction_tenant, set_transaction_user
from app.core.errors import AppError, NotFoundError, PermissionDeniedError, ValidationError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.core.pagination import clamp_limit, decode_cursor, encode_cursor
from app.core.ratelimit import hit
from app.core.tenant import TenantContext
from app.modules.admin import repository
from app.modules.admin.domain import (
    CLOSED_DISPUTE_STATES,
    DISPUTE_KINDS,
    DISPUTE_STATES,
    IST_ZONE_NAME,
    OLDEST_ITEMS,
    dashboard_sections,
    dispute_refusal,
    dispute_transition_refusal,
    mask_email,
    mask_phone,
    party_for_role,
    throughput_series,
    throughput_start,
)
from app.modules.admin.events import (
    DISPUTE_CLOSED,
    DISPUTE_OPENED,
    TENANT_REINSTATED,
    TENANT_SUSPENDED,
)
from app.modules.admin.models import Dispute
from app.modules.admin.schemas import (
    AccountForm,
    AccountFormOption,
    AccountFormsResponse,
    AddOrganisationMemberRequest,
    AdminCourseView,
    AdminDashboard,
    AdminLessonView,
    AdminModuleView,
    ApplicationAnalytics,
    ApplicationLink,
    AuditEventRow,
    AuditEventsPage,
    CandidateApplicationRow,
    CandidateApplications,
    CandidateDrilldown,
    CandidateOnboarding,
    CandidateResumeView,
    CandidateRow,
    CandidatesPage,
    CollegeDrilldown,
    CollegeLinkSummary,
    CourseStatusRow,
    CreateCourseLessonRequest,
    CreateCourseModuleRequest,
    CreateDiscountCodeRequest,
    CreateSearchFilterOptionRequest,
    DiscountCodeResponse,
    DiscountCodesPage,
    DiscountRedemptionRow,
    DiscountRedemptionsPage,
    DisputeBacklog,
    DisputeDetail,
    DisputeLinks,
    DisputeRow,
    DisputesPage,
    EmployerDrilldown,
    IntegrityBacklog,
    IntegritySignalDetail,
    IntegritySignalRow,
    IntegritySignalsPage,
    InterviewRecordingRow,
    InterviewSessionRow,
    InvitationResentResponse,
    KybApprovalMode,
    KybBacklog,
    KybSubmissionRow,
    KybSubmissionsPage,
    KybSummary,
    LessonUploadResponse,
    MyDisputeResponse,
    OnboardingAnswer,
    OrganisationCounts,
    OrganisationStatusCounts,
    PlatformTotals,
    ProvisionCandidateRequest,
    ProvisionCollegeRequest,
    ProvisionedAccountResponse,
    ProvisionEmployerRequest,
    RelatedSignal,
    ResumeSummary,
    ResumeVersionView,
    ScorePoint,
    ScoreSummary,
    ScoreTimeline,
    SearchFilterOptionResponse,
    SearchFilterOptionsPage,
    SeatAllocationResponse,
    SeatSummary,
    SignalCandidate,
    SignalCount,
    SignalResumeVersion,
    SignalScore,
    SubscriptionSummary,
    SuspensionResponse,
    SuspensionSummary,
    TenantRow,
    TenantsPage,
    ThroughputDay,
    UpdateCourseLessonRequest,
    UpdateCourseModuleRequest,
    UpdateSearchFilterOptionRequest,
    WaitingItem,
)
from app.modules.applications.domain import stage_summary
from app.modules.billing import service as billing_service
from app.modules.billing.domain import DISCOUNT_POLICY_VERSION
from app.modules.candidate import service as candidate_service
from app.modules.candidate.career import CareerResponse
from app.modules.candidate.schemas import LocationRequest, NameRequest
from app.modules.college import service as college_service
from app.modules.college.schemas import CreateCollegeRequest
from app.modules.courses import service as courses_service
from app.modules.discovery import service as discovery_service
from app.modules.discovery.catalogue import FILTER_CATALOGUE_VERSION
from app.modules.discovery.domain import FilterKind
from app.modules.employer import service as employer_service
from app.modules.employer.schemas import CreateOrganisationRequest
from app.modules.identity import service as identity_service
from app.modules.integrity import service as integrity_service
from app.modules.integrity.domain import hides_candidate, rule_text
from app.modules.interview import service as interview_service
from app.modules.jobs import service as jobs_service
from app.modules.kyb import service as kyb_service
from app.modules.kyb.schemas import KybSubmissionResponse
from app.modules.profile_images import service as profile_images_service
from app.modules.questionnaire.domain import answers_in_words
from app.modules.resume import service as resume_service
from app.modules.resume.structuring import structured_view
from app.modules.scoring.domain import band_for, display_value
from app.settings import Settings, get_settings

logger = get_logger(__name__)

#: A dispute is a support ticket with consequences; five a day per person is
#: generous for a real grievance and a ceiling for someone flooding the queue.
DISPUTES_PER_DAY = 5
HIRE_DISPUTE_DESCRIPTION = "The candidate says this hire did not happen."


class DisputeNotFoundError(NotFoundError):
    code = "dispute_not_found"
    title = "Dispute not found"


class DisputeApplicationNotFoundError(NotFoundError):
    code = "dispute_application_not_found"
    title = "Application not found"


class DisputeRefusedError(AppError):
    status_code = status.HTTP_422_UNPROCESSABLE_CONTENT
    code = "dispute_refused"
    title = "This dispute cannot be raised"


class DisputeStateError(AppError):
    status_code = status.HTTP_409_CONFLICT
    code = "dispute_transition_invalid"
    title = "The dispute cannot move to that state"


class CandidateNotFoundError(NotFoundError):
    code = "admin_candidate_not_found"
    title = "Candidate not found"


class OrganisationNotFoundError(NotFoundError):
    code = "admin_organisation_not_found"
    title = "Organisation not found"


class KybSubmissionNotFoundError(NotFoundError):
    code = "kyb_submission_not_found"
    title = "KYB submission not found"


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


async def _bind_platform(session: AsyncSession, ctx: TenantContext) -> None:
    """Bind the caller's own tenant -- which, for a staff role, can only be the
    PLATFORM tenant (`guard_membership_tenant_type`). The dispute policy for
    staff reads that binding; nothing else does."""
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, ctx.tenant_id)


@asynccontextmanager
async def _reveal(
    session: AsyncSession,
    ctx: TenantContext,
    *,
    action: AuditAction,
    target_type: str,
    target_id: uuid.UUID | str | None,
    tenant_id: uuid.UUID | None = None,
    request_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AsyncIterator[AsyncSession]:
    """Audit, then open the read-only bypass session. See the module docstring."""
    await audit_event(
        session,
        action=action,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type=target_type,
        target_id=target_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata=metadata,
    )
    await session.flush()
    async with get_admin_session_factory()() as reader, reader.begin():
        await reader.execute(text("SET TRANSACTION READ ONLY"))
        yield reader


def _keyset(cursor: str | None, *, id_type: type = uuid.UUID) -> tuple[datetime, Any] | None:
    if cursor is None:
        return None
    payload = decode_cursor(cursor)
    try:
        return datetime.fromisoformat(str(payload["t"])), id_type(payload["i"])
    except (KeyError, ValueError, TypeError) as exc:
        raise ValidationError(code="invalid_cursor") from exc


def _next(rows: list[Any], limit: int, *, at: str) -> str | None:
    if len(rows) < limit:
        return None
    last = rows[-1]
    return encode_cursor({"t": last[at].isoformat(), "i": str(last["id"])})


# ---------------------------------------------------------------------------
# KYB
# ---------------------------------------------------------------------------
async def kyb_submissions(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    state: str | None,
    cursor: str | None,
    limit: int | None,
    request_id: str | None = None,
    now: datetime | None = None,
) -> KybSubmissionsPage:
    """Every organisation's submissions. **A record while approval is
    automatic** (R15, plan v4): the switch is shown with the page so a
    reviewer knows whether anything here is waiting on them."""
    size = clamp_limit(limit)
    review_required = await kyb_service.require_approval(session, now=_now(now))
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_BYPASS_SESSION_OPENED,
        target_type="kyb_submissions",
        target_id=None,
        request_id=request_id,
        metadata={"view": "kyb_submissions", "state": state},
    ) as reader:
        rows = await repository.kyb_submissions(
            reader, state=state, after=_keyset(cursor), limit=size
        )
    return KybSubmissionsPage(
        items=[KybSubmissionRow.model_validate(dict(r)) for r in rows],
        next_cursor=_next(rows, size, at="created_at"),
        review_required=review_required,
    )


async def kyb_approval_mode(
    session: AsyncSession, *, now: datetime | None = None
) -> KybApprovalMode:
    """The switch as it stands. Global config, naming nobody: no reveal."""
    return KybApprovalMode(
        review_required=await kyb_service.require_approval(session, now=_now(now))
    )


async def set_kyb_approval_mode(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    review_required: bool,
    request_id: str | None = None,
) -> KybApprovalMode:
    """`kyb.service.set_require_approval` writes the row and the audit row."""
    enabled = await kyb_service.set_require_approval(
        session,
        enabled=review_required,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        request_id=request_id,
    )
    return KybApprovalMode(review_required=enabled)


async def _submission_tenant(
    session: AsyncSession, ctx: TenantContext, submission_id: uuid.UUID, request_id: str | None
) -> uuid.UUID:
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_KYB_SUBMISSION_OPENED,
        target_type="kyb_submission",
        target_id=submission_id,
        request_id=request_id,
    ) as reader:
        tenant_id = await repository.kyb_submission_tenant(reader, submission_id=submission_id)
    if tenant_id is None:
        raise KybSubmissionNotFoundError()
    return tenant_id


async def open_kyb_submission(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    submission_id: uuid.UUID,
    request_id: str | None = None,
) -> KybSubmissionResponse:
    tenant_id = await _submission_tenant(session, ctx, submission_id, request_id)
    return await kyb_service.submission_for_review(
        session, tenant_id=tenant_id, submission_id=submission_id
    )


async def decide_kyb(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    submission_id: uuid.UUID,
    decision: str,
    reason: str | None,
    request_id: str | None = None,
) -> KybSubmissionResponse:
    """`kyb.service.review` decides and audits; this finds the tenant."""
    tenant_id = await _submission_tenant(session, ctx, submission_id, request_id)
    return await kyb_service.review(
        session,
        tenant_id=tenant_id,
        submission_id=submission_id,
        reviewer_id=ctx.user_id,
        reviewer_role=ctx.role,
        decision=decision,
        reason=reason,
    )


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------
async def integrity_queue(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    state: str,
    severity: str | None,
    cursor: str | None,
    limit: int | None,
    request_id: str | None = None,
) -> IntegritySignalsPage:
    size = clamp_limit(limit)
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_BYPASS_SESSION_OPENED,
        target_type="integrity_signals",
        target_id=None,
        request_id=request_id,
        metadata={"view": "integrity_queue", "state": state, "severity": severity},
    ) as reader:
        rows = await repository.integrity_signals(
            reader, state=state, severity=severity, after=_keyset(cursor), limit=size
        )
    return IntegritySignalsPage(
        items=[IntegritySignalRow.model_validate(_signal_fields(r)) for r in rows],
        next_cursor=_next(rows, size, at="created_at"),
    )


def _signal_fields(row: Any) -> dict[str, Any]:
    """A stored signal, with its rule in words and whether it hides someone.
    Candidate columns, when the row was read with them, become the masked
    `candidate` block; a full phone or email never leaves here."""
    title, description = rule_text(row["rule_id"])
    fields: dict[str, Any] = {
        **{k: row[k] for k in _SIGNAL_KEYS if k in row},
        "rule_title": title,
        "rule_description": description,
        "hides_candidate": hides_candidate(row["severity"], row["state"]),
    }
    if "candidate_status" in row:
        fields["candidate"] = SignalCandidate(
            id=row["candidate_id"],
            status=row["candidate_status"],
            full_name=row["candidate_full_name"],
            phone_masked=mask_phone(row["candidate_phone"]),
            email_masked=mask_email(row["candidate_email"]),
        )
    return fields


_SIGNAL_KEYS = (
    "id",
    "candidate_id",
    "resume_version_id",
    "rule_id",
    "rule_version",
    "thresholds_version",
    "severity",
    "state",
    "created_at",
    "resolved_at",
    "resolved_by",
    "resolved_by_email",
    "resolution_note",
    "other_open_signals",
    "evidence",
)


async def open_signal(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    signal_id: uuid.UUID,
    request_id: str | None = None,
) -> IntegritySignalDetail:
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_INTEGRITY_SIGNAL_OPENED,
        target_type="integrity_signal",
        target_id=signal_id,
        request_id=request_id,
    ) as reader:
        row = await repository.integrity_signal(reader, signal_id=signal_id)
        if row is None:
            raise integrity_service.SignalNotFoundError()
        context = await repository.signal_context(
            reader,
            candidate_id=row["candidate_id"],
            signal_id=signal_id,
            resume_version_id=row["resume_version_id"],
        )
        visible = await discovery_service.is_candidate_visible(
            reader, candidate_id=row["candidate_id"]
        )
    version, latest = context["resume_version"], context["score"]
    shown = display_value(int(latest["stored_value"])) if latest else None
    return IntegritySignalDetail(
        **_signal_fields(row),
        resume_version=SignalResumeVersion.model_validate(dict(version)) if version else None,
        score=(
            SignalScore(
                display_value=shown, band=band_for(shown), computed_at=latest["computed_at"]
            )
            if latest and shown is not None
            else None
        ),
        visible_to_employers=visible,
        other_signals=[
            RelatedSignal(
                id=o["id"],
                rule_id=o["rule_id"],
                rule_title=rule_text(o["rule_id"])[0],
                severity=o["severity"],
                state=o["state"],
                hides_candidate=hides_candidate(o["severity"], o["state"]),
                created_at=o["created_at"],
            )
            for o in context["others"]
        ],
    )


async def resolve_signal(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    signal_id: uuid.UUID,
    outcome: str,
    note: str | None,
) -> IntegritySignalDetail:
    """Only CLEARED restores the candidate to search; CONFIRMED keeps them
    hidden. `integrity.service.resolve_signal` audits the decision."""
    row = await integrity_service.resolve_signal(
        session,
        signal_id=signal_id,
        reviewer_id=ctx.user_id,
        reviewer_role=ctx.role,
        outcome="CLEARED" if outcome == "CLEARED" else "CONFIRMED",
        note=note,
    )
    columns = {c.name: getattr(row, c.name) for c in row.__table__.columns}
    return IntegritySignalDetail.model_validate(_signal_fields(columns))


# ---------------------------------------------------------------------------
# Organisations, suspension, seats
# ---------------------------------------------------------------------------
async def list_tenants(
    session: AsyncSession,
    *,
    tenant_type: str | None,
    status: str | None,
    name_contains: str | None,
    cursor: str | None,
    limit: int | None,
) -> TenantsPage:
    """Organisation names and states. Not a reveal -- no person is named --
    so not audited, and read on the app role: `tenants` is not under RLS."""
    size = clamp_limit(limit)
    after: tuple[str, uuid.UUID] | None = None
    if cursor is not None:
        payload = decode_cursor(cursor)
        try:
            after = (str(payload["n"]), uuid.UUID(str(payload["i"])))
        except (KeyError, ValueError) as exc:
            raise ValidationError(code="invalid_cursor") from exc
    rows = await identity_service.list_tenants(
        session,
        tenant_type=tenant_type,
        status=status,
        name_contains=name_contains,
        after=after,
        limit=size,
    )
    next_cursor = (
        encode_cursor({"n": rows[-1].name, "i": str(rows[-1].id)}) if len(rows) == size else None
    )
    return TenantsPage(
        items=[TenantRow.model_validate(row) for row in rows], next_cursor=next_cursor
    )


async def suspend_tenant(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    tenant_id: uuid.UUID,
    reason: str,
    request_id: str | None = None,
    now: datetime | None = None,
) -> SuspensionResponse:
    """Stop an employer or college operating, now. Deletes nothing.

    What stops: every member's next request (`tenant_suspended`), the
    organisation's jobs on the candidate board and applications to them, and
    -- for a college -- its students' seat-based access, because every check
    that reads `tenants.status` sees SUSPENDED. What does not:
    any row. Audited; the reason stays on the suspension row.
    """
    row = await identity_service.suspend_tenant(
        session,
        tenant_id=tenant_id,
        reason=reason.strip(),
        suspended_by=ctx.user_id,
        now=_now(now),
    )
    await audit_event(
        session,
        action=AuditAction.TENANT_SUSPENDED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="tenant",
        target_id=tenant_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"suspension_id": str(row.id)},
    )
    await emit(
        session,
        event_type=TENANT_SUSPENDED,
        aggregate_type="tenant",
        aggregate_id=tenant_id,
        payload={"tenant_id": str(tenant_id), "suspension_id": str(row.id)},
    )
    return SuspensionResponse.model_validate(row)


async def reinstate_tenant(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    tenant_id: uuid.UUID,
    request_id: str | None = None,
    now: datetime | None = None,
) -> SuspensionResponse:
    row = await identity_service.reinstate_tenant(
        session, tenant_id=tenant_id, lifted_by=ctx.user_id, now=_now(now)
    )
    await audit_event(
        session,
        action=AuditAction.TENANT_REINSTATED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="tenant",
        target_id=tenant_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"suspension_id": str(row.id)},
    )
    await emit(
        session,
        event_type=TENANT_REINSTATED,
        aggregate_type="tenant",
        aggregate_id=tenant_id,
        payload={"tenant_id": str(tenant_id), "suspension_id": str(row.id)},
    )
    return SuspensionResponse.model_validate(row)


async def suspensions(session: AsyncSession, *, tenant_id: uuid.UUID) -> list[SuspensionResponse]:
    await identity_service.get_tenant(session, tenant_id=tenant_id)
    rows = await identity_service.suspensions_for(session, tenant_id=tenant_id)
    return [SuspensionResponse.model_validate(row) for row in rows]


async def allocate_seats(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    tenant_id: uuid.UUID,
    seats: int,
    request_id: str | None = None,
) -> SeatAllocationResponse:
    """`college.service.allocate_seats` holds every rule and writes the audit
    row: capped by the live plan, never below the seats in use."""
    result = await college_service.allocate_seats(
        session,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        tenant_id=tenant_id,
        seats=seats,
        request_id=request_id,
    )
    return SeatAllocationResponse(
        allocated=result.allocated, used=result.used, filled=result.filled
    )


# ---------------------------------------------------------------------------
# Drill-downs
# ---------------------------------------------------------------------------
def _subscription(row: Any) -> SubscriptionSummary | None:
    if not row:
        return None
    return SubscriptionSummary(
        state=row["state"], plan_code=row["plan_code"], current_period_end=row["current_period_end"]
    )


def _suspension(row: Any) -> SuspensionSummary | None:
    return SuspensionSummary.model_validate(dict(row)) if row else None


async def list_candidates(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    status: str | None,
    name_contains: str | None,
    email: str | None,
    cursor: str | None,
    limit: int | None,
    request_id: str | None = None,
) -> CandidatesPage:
    """Candidate accounts, newest first -- the way in to a drill-down.

    Candidates are not tenants, so `GET /admin/tenants` cannot list them. This
    is audited where that is not: every row names a person. The search terms
    stay out of the audit metadata (a name or an address is not an id); the
    row records that a search was made, and by whom."""
    size = clamp_limit(limit)
    name = (name_contains or "").strip() or None
    address = identity_service.normalise_email(email) if email and email.strip() else None
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_BYPASS_SESSION_OPENED,
        target_type="candidates",
        target_id=None,
        request_id=request_id,
        metadata={
            "view": "candidates",
            "status": status,
            "by_name": name is not None,
            "by_email": address is not None,
        },
    ) as reader:
        rows = await repository.candidates(
            reader,
            status=status,
            name_contains=name,
            email=address,
            after=_keyset(cursor),
            limit=size,
        )
    return CandidatesPage(
        items=[
            CandidateRow(
                id=r["id"],
                status=r["status"],
                full_name=r["full_name"],
                city=r["city"],
                state_code=r["state_code"],
                phone_masked=mask_phone(r["phone"]),
                email_masked=mask_email(r["email"]),
                created_at=r["created_at"],
            )
            for r in rows
        ],
        next_cursor=_next(rows, size, at="created_at"),
    )


async def candidate_drilldown(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> CandidateDrilldown:
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_CANDIDATE_DRILLDOWN,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
    ) as reader:
        account = await repository.candidate_account(reader, user_id=user_id)
        if account is None:
            raise CandidateNotFoundError()
        facts = await repository.candidate_facts(reader, user_id=user_id)
        visible = await discovery_service.is_candidate_visible(reader, candidate_id=user_id)

    latest, resume = facts["latest_score"], facts["resume"]
    score = (
        ScoreSummary(
            display_value=display_value(int(latest["stored_value"])),
            band=band_for(display_value(int(latest["stored_value"]))),
            computed_at=latest["computed_at"],
            scores_computed=int(latest["history"]),
        )
        if latest
        else None
    )
    return CandidateDrilldown(
        id=account["id"],
        status=account["status"],
        locale=account["locale"],
        created_at=account["created_at"],
        full_name=account["full_name"],
        city=account["city"],
        state_code=account["state_code"],
        phone_masked=mask_phone(account["phone"]),
        email_masked=mask_email(account["email"]),
        score=score,
        resume=ResumeSummary(
            files=int(resume["files"]),
            versions=int(resume["versions"]),
            last_confirmed_at=resume["last_confirmed_at"],
        ),
        visible_to_employers=visible,
        integrity_signals=[
            SignalCount(severity=r["severity"], state=r["state"], count=int(r["n"]))
            for r in facts["signals"]
        ],
        applications_by_stage=facts["applications"],
        hire_disputes=facts["hire_disputes"],
        subscription=_subscription(facts["subscription"]),
        college_links=[CollegeLinkSummary.model_validate(dict(r)) for r in facts["colleges"]],
        seat_held=facts["seat_held"],
        disputes_by_state=facts["disputes"],
    )


async def employer_drilldown(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    tenant_id: uuid.UUID,
    request_id: str | None = None,
    now: datetime | None = None,
) -> EmployerDrilldown:
    now = _now(now)
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_EMPLOYER_DRILLDOWN,
        target_type="tenant",
        target_id=tenant_id,
        tenant_id=tenant_id,
        request_id=request_id,
    ) as reader:
        org = await repository.organisation(reader, tenant_id=tenant_id, tenant_type="EMPLOYER")
        if org is None:
            raise OrganisationNotFoundError()
        shared = await repository.organisation_facts(reader, tenant_id=tenant_id)
        facts = await repository.employer_facts(reader, tenant_id=tenant_id, now=now)

    views = facts["views"]
    return EmployerDrilldown(
        tenant_id=org["id"],
        name=org["name"],
        status=org["status"],
        created_at=org["created_at"],
        legal_name=org["legal_name"],
        employer_type=org["employer_type"],
        industry=org["industry"],
        kyb_status=org["kyb_status"],
        verified_at=org["verified_at"],
        latest_kyb=KybSummary.model_validate(dict(facts["latest_kyb"]))
        if facts["latest_kyb"]
        else None,
        members_by_role=shared["members"],
        jobs_by_status=facts["jobs"],
        applications_by_stage=facts["applications"],
        subscription=_subscription(shared["subscription"]),
        suspension=_suspension(shared["suspension"]),
        candidates_viewed_last_day=int(views["last_day"]) if views else 0,
        candidates_viewed_last_30_days=int(views["last_30_days"]) if views else 0,
        view_anomaly_flags_last_30_days=facts["anomaly_flags_30_days"],
        disputes_by_state=shared["disputes"],
    )


async def college_drilldown(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    tenant_id: uuid.UUID,
    request_id: str | None = None,
    now: datetime | None = None,
) -> CollegeDrilldown:
    """Counts only. Which students are linked is the college's to see under
    INDIVIDUAL consent (invariant 9), and a member of staff opens a named
    student through the candidate drill-down, which is audited separately."""
    now = _now(now)
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_COLLEGE_DRILLDOWN,
        target_type="tenant",
        target_id=tenant_id,
        tenant_id=tenant_id,
        request_id=request_id,
    ) as reader:
        org = await repository.organisation(reader, tenant_id=tenant_id, tenant_type="COLLEGE")
        if org is None:
            raise OrganisationNotFoundError()
        shared = await repository.organisation_facts(reader, tenant_id=tenant_id)
        facts = await repository.college_facts(reader, tenant_id=tenant_id, now=now)

    seats, subscription = facts["seats"], shared["subscription"]
    return CollegeDrilldown(
        tenant_id=org["id"],
        name=org["college_name"] or org["name"],
        status=org["status"],
        created_at=org["created_at"],
        institution_type=org["institution_type"],
        onboarding_submitted_at=org["onboarding_submitted_at"],
        verified_at=org["verified_at"],
        members_by_role=shared["members"],
        seats=SeatSummary(
            allocated=int(seats["seats_allocated"]),
            used=int(seats["seats_used"]),
            plan_allowance=subscription["seat_allowance"] if subscription else None,
        )
        if seats
        else None,
        live_referral_codes=facts["live_codes"],
        connected_students=facts["consents"].get("ROSTER", 0),
        individually_visible=facts["consents"].get("INDIVIDUAL", 0),
        roster_imports_by_state=facts["roster_imports"],
        invitations_by_state=facts["invitations"],
        subscription=_subscription(subscription),
        suspension=_suspension(shared["suspension"]),
        disputes_by_state=shared["disputes"],
    )


# ---------------------------------------------------------------------------
# Disputes -- the console
# ---------------------------------------------------------------------------
async def dispute_queue(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    state: str | None,
    kind: str | None,
    party: str | None,
    cursor: str | None,
    limit: int | None,
) -> DisputesPage:
    """Open and in-review disputes by default, oldest first, across all three
    groups. Rows carry identifiers; the description is read by opening one."""
    await _bind_platform(session, ctx)
    size = clamp_limit(limit)
    states = (
        (state,) if state else tuple(s for s in DISPUTE_STATES if s not in CLOSED_DISPUTE_STATES)
    )
    rows = await repository.dispute_queue(
        session, states=states, kind=kind, party=party, after=_keyset(cursor), limit=size
    )
    next_cursor = (
        encode_cursor({"t": rows[-1].created_at.isoformat(), "i": str(rows[-1].id)})
        if len(rows) == size
        else None
    )
    return DisputesPage(
        items=[DisputeRow.model_validate(row) for row in rows], next_cursor=next_cursor
    )


async def _staff_dispute(
    session: AsyncSession, ctx: TenantContext, dispute_id: uuid.UUID, *, lock: bool = False
) -> Dispute:
    await _bind_platform(session, ctx)
    row = await repository.get_dispute(session, dispute_id=dispute_id, lock=lock)
    if row is None:
        raise DisputeNotFoundError()
    return row


async def _detail(row: Dispute) -> DisputeDetail:
    """The row plus its cross-links, read on the bypass session. The caller
    has already audited the open."""
    async with get_admin_session_factory()() as reader, reader.begin():
        await reader.execute(text("SET TRANSACTION READ ONLY"))
        links = await repository.dispute_links(
            reader,
            application_id=row.application_id,
            candidate_id=row.raised_by if row.party == "CANDIDATE" else None,
        )
    application = links["application"]
    return DisputeDetail(
        **DisputeRow.model_validate(row).model_dump(),
        description=row.description,
        resolution=row.resolution,
        resolved_by=row.resolved_by,
        links=DisputeLinks(
            candidate_id=links["candidate_id"],
            raiser_tenant_id=row.tenant_id,
            application=ApplicationLink(
                id=application["id"],
                candidate_id=application["candidate_id"],
                employer_tenant_id=application["tenant_id"],
                job_id=application["job_id"],
                stage=application["stage"],
                employer_confirmed_at=application["employer_confirmed_at"],
                candidate_confirmed_at=application["candidate_confirmed_at"],
                hire_disputed_at=application["hire_disputed_at"],
            )
            if application
            else None,
            live_integrity_signals=links["signals"],
        ),
    )


async def open_dispute(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    dispute_id: uuid.UUID,
    request_id: str | None = None,
) -> DisputeDetail:
    row = await _staff_dispute(session, ctx, dispute_id)
    await audit_event(
        session,
        action=AuditAction.ADMIN_DISPUTE_OPENED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="dispute",
        target_id=row.id,
        tenant_id=row.tenant_id,
        request_id=request_id,
    )
    await session.flush()
    return await _detail(row)


async def assign_dispute(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    dispute_id: uuid.UUID,
    request_id: str | None = None,
) -> DisputeDetail:
    """Take it: the caller becomes the assignee and the dispute is IN_REVIEW.
    Taking one somebody else holds is allowed and audited -- people go on
    leave, and a queue that cannot be reassigned stalls."""
    row = await _staff_dispute(session, ctx, dispute_id, lock=True)
    if row.state != "IN_REVIEW":
        refusal = dispute_transition_refusal(row.state, "IN_REVIEW")
        if refusal is not None:
            raise DisputeStateError(code=refusal, params={"state": row.state})
    previous = row.assigned_to
    row = await repository.update_dispute(
        session, dispute_id=row.id, state="IN_REVIEW", assigned_to=ctx.user_id
    )
    await audit_event(
        session,
        action=AuditAction.DISPUTE_ASSIGNED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="dispute",
        target_id=row.id,
        tenant_id=row.tenant_id,
        request_id=request_id,
        metadata={"previous_assignee": str(previous) if previous else None},
    )
    return await _detail(row)


async def resolve_dispute(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    dispute_id: uuid.UUID,
    outcome: str,
    resolution: str,
    request_id: str | None = None,
    now: datetime | None = None,
) -> DisputeDetail:
    """Close it with words the raiser will read. **Changes nothing else**: a
    resolved hire dispute does not move the application, and a resolved
    payment dispute refunds nothing (blockers E12, E18). What follows from the
    decision is taken where that rule lives, by someone entitled to take it."""
    row = await _staff_dispute(session, ctx, dispute_id, lock=True)
    refusal = dispute_transition_refusal(row.state, outcome)
    if refusal is not None:
        raise DisputeStateError(code=refusal, params={"state": row.state})
    row = await repository.update_dispute(
        session,
        dispute_id=row.id,
        state=outcome,
        resolution=resolution.strip(),
        resolved_by=ctx.user_id,
        resolved_at=_now(now),
        assigned_to=row.assigned_to or ctx.user_id,
    )
    await audit_event(
        session,
        action=AuditAction.DISPUTE_RESOLVED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="dispute",
        target_id=row.id,
        tenant_id=row.tenant_id,
        request_id=request_id,
        metadata={"outcome": outcome, "kind": row.kind, "party": row.party},
    )
    await emit(
        session,
        event_type=DISPUTE_CLOSED,
        aggregate_type="dispute",
        aggregate_id=row.id,
        payload={
            "dispute_id": str(row.id),
            "raised_by": str(row.raised_by),
            "outcome": outcome,
        },
    )
    return await _detail(row)


# ---------------------------------------------------------------------------
# Audit search
# ---------------------------------------------------------------------------
async def search_audit(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    actor_id: uuid.UUID | None,
    action: str | None,
    target_type: str | None,
    target_id: str | None,
    tenant_id: uuid.UUID | None,
    occurred_from: datetime | None,
    occurred_to: datetime | None,
    cursor: str | None,
    limit: int | None,
    request_id: str | None = None,
) -> AuditEventsPage:
    """SRS 2.25.4: by actor, action, target and time, server-paginated. The
    search itself is written to the trail before it runs, with its filters."""
    if action is not None and action not in {a.value for a in AuditAction}:
        raise ValidationError(code="audit_action_unknown", params={"action": action})
    if occurred_from and occurred_to and occurred_from >= occurred_to:
        raise ValidationError(code="audit_time_range_invalid")
    size = clamp_limit(limit)
    filters = {
        "actor_id": str(actor_id) if actor_id else None,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "tenant_id": str(tenant_id) if tenant_id else None,
        "occurred_from": occurred_from.isoformat() if occurred_from else None,
        "occurred_to": occurred_to.isoformat() if occurred_to else None,
    }
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_AUDIT_LOG_SEARCHED,
        target_type="audit_events",
        target_id=None,
        request_id=request_id,
        metadata={k: v for k, v in filters.items() if v is not None},
    ) as reader:
        rows = await repository.audit_events(
            reader,
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            tenant_id=tenant_id,
            occurred_from=occurred_from,
            occurred_to=occurred_to,
            after=_keyset(cursor, id_type=int),
            limit=size,
        )
    return AuditEventsPage(
        items=[AuditEventRow.model_validate(dict(r)) for r in rows],
        next_cursor=_next(rows, size, at="occurred_at"),
    )


# ---------------------------------------------------------------------------
# Disputes -- the raiser's side
# ---------------------------------------------------------------------------
async def _bind_raiser(session: AsyncSession, ctx: TenantContext) -> str:
    party = party_for_role(ctx.role)
    if party is None:
        raise PermissionDeniedError()
    if party == "CANDIDATE":
        await jobs_service.bind_candidate(session, ctx)
    else:
        if ctx.tenant_id is None:
            raise PermissionDeniedError()
        await set_transaction_tenant(session, ctx.tenant_id)
    return party


async def raise_dispute(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    kind: str,
    application_id: uuid.UUID | None,
    description: str,
) -> MyDisputeResponse:
    """A candidate, an employer or a college tells us something went wrong.

    Rate-limited per person. A HIRE dispute must name an application the
    caller can see, checked under their own row-level security here and again
    by `guard_dispute_write`; any other id is `dispute_application_not_found`,
    whether it exists or not.
    """
    party = await _bind_raiser(session, ctx)
    refusal = dispute_refusal(party=party, kind=kind, has_application=application_id is not None)
    if refusal is not None:
        raise DisputeRefusedError(code=refusal, params={"kind": kind})
    await hit(
        bucket="dispute_raise",
        subject=str(ctx.user_id),
        limit=DISPUTES_PER_DAY,
        window_seconds=86_400,
    )
    if application_id is not None and not await repository.application_visible(
        session, application_id=application_id
    ):
        raise DisputeApplicationNotFoundError()

    row = await repository.insert_dispute(
        session,
        kind=kind,
        party=party,
        source="RAISED",
        raised_by=ctx.user_id,
        tenant_id=None if party == "CANDIDATE" else ctx.tenant_id,
        application_id=application_id,
        description=description.strip(),
        state="OPEN",
    )
    assert row is not None  # only a HIRE_DISPUTE source can conflict
    await _emit_opened(session, row)
    return MyDisputeResponse.model_validate(row)


async def my_disputes(session: AsyncSession, *, ctx: TenantContext) -> list[MyDisputeResponse]:
    """A candidate's own; an organisation's, whoever in it raised them."""
    await _bind_raiser(session, ctx)
    rows = await repository.visible_disputes(session, limit=100)
    return [MyDisputeResponse.model_validate(row) for row in rows]


async def open_hire_dispute(
    session: AsyncSession, *, application_id: uuid.UUID, candidate_id: uuid.UUID
) -> uuid.UUID | None:
    """Put a disputed hire in the queue, as the candidate's dispute (system).

    A candidate's dispute is only a timestamp on the application
    (`hire_disputed_at`) until this puts it in front of staff. This runs on
    `applications.hire_disputed` and files it **as the candidate**, binding
    their identity exactly as their own request did, so the row passes
    the same policy and guard a raised dispute does. At least once, so
    idempotent by application (`uq_disputes_hire_dispute`). None when it was
    already open.
    """
    await set_transaction_user(session, candidate_id)
    row = await repository.insert_dispute(
        session,
        kind="HIRE",
        party="CANDIDATE",
        source="HIRE_DISPUTE",
        raised_by=candidate_id,
        tenant_id=None,
        application_id=application_id,
        description=HIRE_DISPUTE_DESCRIPTION,
        state="OPEN",
    )
    if row is None:
        return None
    await _emit_opened(session, row)
    return row.id


async def _emit_opened(session: AsyncSession, row: Dispute) -> None:
    await emit(
        session,
        event_type=DISPUTE_OPENED,
        aggregate_type="dispute",
        aggregate_id=row.id,
        payload={"dispute_id": str(row.id), "kind": row.kind, "party": row.party},
    )


# ---------------------------------------------------------------------------
# Accounts made on someone's behalf (2026-09-18)
# ---------------------------------------------------------------------------
# The console presses the button and records that it did; `identity` makes
# the account and asks Cognito to email its temporary password, `employer`
# and `college` make the organisation exactly as self-registration does. An
# organisation made here is an ordinary one: its owner completes KYB and
# pays like anyone else.


def _payload(model: Any, **values: Any) -> Any:
    """Build another module's request schema, turning its validation into a
    422 rather than a 500."""
    try:
        return model(**values)
    except PydanticValidationError as exc:
        fields = sorted({str(e["loc"][0]) for e in exc.errors() if e.get("loc")})
        raise ValidationError(code="admin_account_invalid", params={"fields": fields}) from exc


async def _account_audit(
    session: AsyncSession,
    ctx: TenantContext,
    *,
    user_id: uuid.UUID,
    kind: str,
    invitation: str,
    prefilled: list[str],
    tenant_id: uuid.UUID | None = None,
    request_id: str | None,
) -> None:
    """`prefilled` names the answers staff gave, never their values: which
    answers on a form were ours rather than the person's is what a later
    dispute needs, and the values are on the form itself."""
    await audit_event(
        session,
        action=AuditAction.ACCOUNT_PROVISIONED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=user_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"kind": kind, "invitation": invitation, "prefilled": prefilled},
    )


def _prefill(answers: dict[str, Any] | None, **own: Any) -> dict[str, Any]:
    """Staff's answers, with the organisation's own fields over the same
    codes so the form and the organisation cannot start out disagreeing."""
    merged = {**(answers or {}), **{code: v for code, v in own.items() if v is not None}}
    return {code: value for code, value in merged.items() if value is not None}


def account_forms() -> AccountFormsResponse:
    """The two onboarding forms as staff may fill them, for the console's
    invitation screen. Undertakings and documents are left out."""
    kyb = kyb_service.form_definition(staff=True)
    college = college_service.form_definition(staff=True)
    return AccountFormsResponse(
        employer=AccountForm(
            code=kyb.code,
            version=kyb.version,
            sections=kyb.sections,
            options={
                source: [AccountFormOption(code=o.code, label=o.label) for o in items]
                for source, items in kyb.options.items()
            },
        ),
        college=AccountForm(
            code=college["code"],
            version=college["version"],
            sections=college["sections"],
            options={
                source: [AccountFormOption(**option) for option in items]
                for source, items in college_service.form_options().items()
            },
        ),
    )


async def provision_candidate(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    payload: ProvisionCandidateRequest,
    request_id: str | None = None,
) -> ProvisionedAccountResponse:
    """A candidate account, claimed at first sign-in. Staff may give the name
    and location the app asks at sign-up (2026-10-03); the candidate uploads
    a CV and subscribes as any candidate does -- and links to a college
    themselves, because that link is their consent."""
    name = (
        _payload(NameRequest, full_name=payload.full_name)
        if payload.full_name is not None
        else None
    )
    location = (
        _payload(LocationRequest, city=payload.city, state_code=payload.state_code)
        if payload.city is not None or payload.state_code is not None
        else None
    )
    user_id = await identity_service.create_candidate_account(session, email=payload.email)
    await candidate_service.prefill_profile(session, user_id=user_id, name=name, location=location)
    given = {
        "full_name": name.full_name if name else None,
        "city": location.city if location else None,
        "state_code": location.state_code if location else None,
    }
    prefilled = [code for code, value in given.items() if value]
    invitation = await identity_service.invitation_outcome_for(session, user_id=user_id)
    await _account_audit(
        session,
        ctx,
        user_id=user_id,
        kind="CANDIDATE",
        invitation=invitation,
        prefilled=prefilled,
        request_id=request_id,
    )
    return ProvisionedAccountResponse(
        user_id=user_id, kind="CANDIDATE", invitation=invitation, prefilled=prefilled
    )


async def provision_employer(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    payload: ProvisionEmployerRequest,
    request_id: str | None = None,
) -> ProvisionedAccountResponse:
    """The organisation, its owner, and a KYB draft of what staff know about
    it. The owner accepts the undertakings, uploads documents and submits --
    with approval off, submitting *is* approval, so it is never ours to do."""
    organisation = _payload(
        CreateOrganisationRequest,
        legal_name=payload.legal_name,
        employer_type=payload.employer_type,
        industry=payload.industry,
    )
    answers = _prefill(
        payload.kyb_answers,
        legal_name=organisation.legal_name,
        employer_type=organisation.employer_type,
        industry=organisation.industry,
    )
    owner_id = await identity_service.provision_business_user(session, email=payload.owner_email)
    row = await employer_service.create_organisation(
        session, user_id=owner_id, payload=organisation, actor_id=ctx.user_id, actor_role=ctx.role
    )
    await kyb_service.prefill_draft(session, tenant_id=row.tenant_id, answers=answers)
    invitation = await identity_service.invitation_outcome_for(session, user_id=owner_id)
    await _account_audit(
        session,
        ctx,
        user_id=owner_id,
        kind="EMPLOYER",
        invitation=invitation,
        prefilled=sorted(answers),
        tenant_id=row.tenant_id,
        request_id=request_id,
    )
    return ProvisionedAccountResponse(
        user_id=owner_id,
        kind="EMPLOYER",
        tenant_id=row.tenant_id,
        role=identity_service.EMPLOYER_OWNER_ROLE,
        invitation=invitation,
        prefilled=sorted(answers),
    )


async def provision_college(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    payload: ProvisionCollegeRequest,
    request_id: str | None = None,
) -> ProvisionedAccountResponse:
    """The college, its admin, and an onboarding draft of what staff know
    about it. The admin accepts the undertakings and submits."""
    college = _payload(
        CreateCollegeRequest, name=payload.name, institution_type=payload.institution_type
    )
    answers = _prefill(
        payload.onboarding_answers,
        legal_name=college.name,
        institution_type=college.institution_type,
    )
    admin_id = await identity_service.provision_business_user(session, email=payload.admin_email)
    row = await college_service.create_college(
        session, user_id=admin_id, payload=college, actor_id=ctx.user_id, actor_role=ctx.role
    )
    await college_service.prefill_onboarding(session, tenant_id=row.tenant_id, answers=answers)
    invitation = await identity_service.invitation_outcome_for(session, user_id=admin_id)
    await _account_audit(
        session,
        ctx,
        user_id=admin_id,
        kind="COLLEGE",
        invitation=invitation,
        prefilled=sorted(answers),
        tenant_id=row.tenant_id,
        request_id=request_id,
    )
    return ProvisionedAccountResponse(
        user_id=admin_id,
        kind="COLLEGE",
        tenant_id=row.tenant_id,
        role=identity_service.COLLEGE_ADMIN_ROLE,
        invitation=invitation,
        prefilled=sorted(answers),
    )


async def add_organisation_member(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    tenant_id: uuid.UUID,
    payload: AddOrganisationMemberRequest,
    request_id: str | None = None,
) -> ProvisionedAccountResponse:
    """Invite someone into an existing employer or college with a role of its
    kind -- the owner's "add a team member", done by staff."""
    tenant = await identity_service.get_tenant(session, tenant_id=tenant_id)
    team_roles = {
        "EMPLOYER": identity_service.EMPLOYER_TEAM_ROLES,
        "COLLEGE": identity_service.COLLEGE_TEAM_ROLES,
    }.get(tenant.type)
    if team_roles is None:
        raise OrganisationNotFoundError()
    member = await identity_service.add_team_member(
        session, tenant_id=tenant_id, email=payload.email, role=payload.role, team_roles=team_roles
    )
    await audit_event(
        session,
        action=AuditAction.TEAM_MEMBER_ADDED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=member.user_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"role": payload.role},
    )
    return ProvisionedAccountResponse(
        user_id=member.user_id,
        kind="MEMBER",
        tenant_id=tenant_id,
        role=payload.role,
        # `add_team_member` invites anyone who has never signed in; someone
        # who has already has a password.
        invitation=(
            "ALREADY_REGISTERED"
            if await identity_service.has_signed_in(session, user_id=member.user_id)
            else "SENT"
        ),
    )


async def resend_invitation(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> InvitationResentResponse:
    pool = await identity_service.resend_invitation(session, user_id=user_id)
    await audit_event(
        session,
        action=AuditAction.ACCOUNT_INVITATION_RESENT,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
        metadata={"pool": pool},
    )
    return InvitationResentResponse(user_id=user_id)


# ---------------------------------------------------------------------------
# Discount codes (2026-09-18)
# ---------------------------------------------------------------------------
def _discount(view: Any) -> DiscountCodeResponse:
    code = view.code
    return DiscountCodeResponse(
        id=code.id,
        code=code.code,
        audience=code.audience,
        percent_off=code.percent_off,
        amount_off_minor=code.amount_off_minor,
        valid_from=code.valid_from,
        valid_until=code.valid_until,
        usage_limit=code.usage_limit,
        usage_count=view.used,
        status=view.status,
        label=code.label,
        created_by=code.created_by,
        created_at=code.created_at,
        disabled_at=code.disabled_at,
        disabled_by=code.disabled_by,
    )


async def create_discount_code(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    payload: CreateDiscountCodeRequest,
    request_id: str | None = None,
) -> DiscountCodeResponse:
    view = await billing_service.create_discount_code(
        session,
        created_by=ctx.user_id,
        code=payload.code,
        audience=payload.audience,
        percent_off=payload.percent_off,
        amount_off_minor=payload.amount_off_minor,
        valid_from=payload.valid_from,
        valid_until=payload.valid_until,
        usage_limit=payload.usage_limit,
        label=payload.label,
    )
    await audit_event(
        session,
        action=AuditAction.DISCOUNT_CODE_CREATED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="discount_code",
        target_id=view.code.id,
        request_id=request_id,
        metadata={
            "audience": payload.audience,
            "percent_off": payload.percent_off,
            "amount_off_minor": payload.amount_off_minor,
            "usage_limit": payload.usage_limit,
        },
    )
    return _discount(view)


async def disable_discount_code(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    code_id: uuid.UUID,
    request_id: str | None = None,
) -> DiscountCodeResponse:
    view = await billing_service.disable_discount_code(
        session, code_id=code_id, disabled_by=ctx.user_id
    )
    await audit_event(
        session,
        action=AuditAction.DISCOUNT_CODE_DISABLED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="discount_code",
        target_id=code_id,
        request_id=request_id,
    )
    return _discount(view)


async def list_discount_codes(
    session: AsyncSession, *, audience: str | None, cursor: str | None, limit: int | None
) -> DiscountCodesPage:
    views, next_cursor = await billing_service.list_discount_codes(
        session, audience=audience, cursor=cursor, limit=limit
    )
    return DiscountCodesPage(
        items=[_discount(v) for v in views],
        next_cursor=next_cursor,
        policy_version=DISCOUNT_POLICY_VERSION,
    )


async def get_discount_code(session: AsyncSession, *, code_id: uuid.UUID) -> DiscountCodeResponse:
    return _discount(await billing_service.get_discount_code(session, code_id=code_id))


async def discount_redemptions(
    session: AsyncSession, *, code_id: uuid.UUID, cursor: str | None, limit: int | None
) -> DiscountRedemptionsPage:
    """The usage log: who used a code, on which payment, for how much, when."""
    rows, next_cursor = await billing_service.list_redemptions(
        session, code_id=code_id, cursor=cursor, limit=limit
    )
    names: dict[uuid.UUID, str] = {}
    for tenant_id in {r.subscriber_id for r in rows if r.subscriber_type == "TENANT"}:
        try:
            names[tenant_id] = (
                await identity_service.get_tenant(session, tenant_id=tenant_id)
            ).name
        except identity_service.TenantNotFoundError:  # pragma: no cover - FK-less, defensive
            continue
    return DiscountRedemptionsPage(
        items=[
            DiscountRedemptionRow(
                id=r.id,
                payment_id=r.payment_id,
                user_id=r.user_id,
                subscriber_type=r.subscriber_type,
                subscriber_id=r.subscriber_id,
                organisation=names.get(r.subscriber_id),
                list_amount_minor=r.list_amount_minor,
                discount_minor=r.discount_minor,
                amount_minor=r.amount_minor,
                redeemed_at=r.redeemed_at,
            )
            for r in rows
        ],
        next_cursor=next_cursor,
    )


# ---------------------------------------------------------------------------
# The dashboard
# ---------------------------------------------------------------------------
def _status_counts(rows: list[Any], tenant_type: str) -> OrganisationStatusCounts:
    counts = {r["status"]: int(r["n"]) for r in rows if r["type"] == tenant_type}
    return OrganisationStatusCounts(
        active=counts.get("ACTIVE", 0),
        suspended=counts.get("SUSPENDED", 0),
        closed=counts.get("CLOSED", 0),
    )


async def dashboard(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    request_id: str | None = None,
    now: datetime | None = None,
) -> AdminDashboard:
    """The console's landing page: every queue the caller can open, counted.

    **One audit row per load**, like every other cross-tenant read: the oldest
    items name organisations and candidate ids. It replaces the two or more a
    page built from the queue endpoints would write.

    **Each queue section is there only for a role that can open the queue**
    (`domain.dashboard_sections`), and the oldest items and the throughput
    chart are drawn from those queues alone. Platform totals are for all staff:
    they are counts, and name nobody.

    Read live. A dashboard a reviewer has just worked from must show the
    item gone.
    """
    now = _now(now)
    sections = dashboard_sections(ctx.role)
    review_required = (
        await kyb_service.require_approval(session, now=now) if "kyb" in sections else False
    )
    since = throughput_start(now)
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_BYPASS_SESSION_OPENED,
        target_type="admin_dashboard",
        target_id=None,
        request_id=request_id,
        metadata={"view": "dashboard", "sections": sorted(sections)},
    ) as reader:
        totals = await repository.platform_totals(reader)
        kyb = await repository.kyb_backlog(reader) if "kyb" in sections else None
        signals = await repository.integrity_backlog(reader) if "integrity" in sections else None
        disputes = await repository.dispute_backlog(reader) if "disputes" in sections else None
        tenants = await repository.organisation_counts(reader) if "tenants" in sections else None

        waiting: list[WaitingItem] = []
        if "kyb" in sections:
            waiting += [
                WaitingItem(
                    type="KYB",
                    id=r["id"],
                    waiting_since=r["waiting_since"],
                    detail=r["state"],
                    organisation=r["organisation"],
                    tenant_id=r["tenant_id"],
                )
                for r in await repository.oldest_kyb(reader, limit=OLDEST_ITEMS)
            ]
        if "integrity" in sections:
            waiting += [
                WaitingItem(
                    type="INTEGRITY",
                    id=r["id"],
                    waiting_since=r["waiting_since"],
                    detail=r["rule_id"],
                    candidate_id=r["candidate_id"],
                    severity=r["severity"],
                )
                for r in await repository.oldest_signals(reader, limit=OLDEST_ITEMS)
            ]
        if "disputes" in sections:
            waiting += [
                WaitingItem(
                    type="DISPUTE",
                    id=r["id"],
                    waiting_since=r["waiting_since"],
                    detail=r["kind"],
                    organisation=r["organisation"],
                    tenant_id=r["tenant_id"],
                    party=r["party"],
                )
                for r in await repository.oldest_disputes(reader, limit=OLDEST_ITEMS)
            ]
        moves = await repository.throughput(
            reader,
            since=since,
            zone=IST_ZONE_NAME,
            kyb="kyb" in sections,
            integrity="integrity" in sections,
            disputes="disputes" in sections,
        )

    intake = {r["day"]: int(r["intake"]) for r in moves}
    cleared = {r["day"]: int(r["cleared"]) for r in moves}
    return AdminDashboard(
        generated_at=now,
        kyb=None
        if kyb is None
        else KybBacklog(
            review_required=review_required,
            awaiting_review=kyb["awaiting_review"],
            awaiting_employer=kyb["awaiting_employer"],
            oldest_waiting_since=kyb["oldest_waiting_since"],
        ),
        integrity=None
        if signals is None
        else IntegrityBacklog(
            open=signals["open"],
            open_by_severity={
                "HIGH": signals["high"],
                "MEDIUM": signals["medium"],
                "LOW": signals["low"],
            },
            candidates_held_back=signals["candidates_held_back"],
            oldest_waiting_since=signals["oldest_waiting_since"],
        ),
        disputes=None
        if disputes is None
        else DisputeBacklog(
            open=disputes[0]["open"],
            in_review=disputes[0]["in_review"],
            unassigned=disputes[0]["unassigned"],
            by_kind={kind: disputes[1].get(kind, 0) for kind in DISPUTE_KINDS},
            oldest_waiting_since=disputes[0]["oldest_waiting_since"],
        ),
        organisations=None
        if tenants is None
        else OrganisationCounts(
            employers=_status_counts(tenants, "EMPLOYER"),
            colleges=_status_counts(tenants, "COLLEGE"),
        ),
        platform_totals=PlatformTotals(**dict(totals)),
        oldest_waiting=sorted(waiting, key=lambda w: (w.waiting_since, str(w.id)))[:OLDEST_ITEMS],
        throughput=[
            ThroughputDay(date=day, intake=came, cleared=went)
            for day, came, went in throughput_series(intake, cleared, now=now)
        ],
    )


# ---------------------------------------------------------------------------
# Search filter options (2026-09-24)
# ---------------------------------------------------------------------------
# The catalogue is `discovery`'s; the console writes the audit row beside
# each change. Not a cross-tenant read, so no `_reveal`: the rows name nobody.
def _filter_option(row: Any) -> SearchFilterOptionResponse:
    return SearchFilterOptionResponse.model_validate(row)


async def _audit_filter_option(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    action: AuditAction,
    row: Any,
    request_id: str | None,
    metadata: dict[str, Any],
) -> None:
    await audit_event(
        session,
        action=action,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="search_filter_option",
        target_id=row.id,
        request_id=request_id,
        metadata={"kind": row.kind, **metadata},
    )


async def create_search_filter_options(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    items: list[CreateSearchFilterOptionRequest],
    request_id: str | None = None,
) -> list[SearchFilterOptionResponse]:
    """All or none, one audit row per option created."""
    rows = await discovery_service.create_filter_options(
        session,
        options=[
            discovery_service.NewFilterOption(
                kind=item.kind,
                label=item.label,
                aliases=tuple(item.aliases),
                state_code=item.state_code,
                featured=item.featured,
                sort_order=item.sort_order,
            )
            for item in items
        ],
        created_by=ctx.user_id,
    )
    for row in rows:
        await _audit_filter_option(
            session,
            ctx=ctx,
            action=AuditAction.SEARCH_FILTER_OPTION_CREATED,
            row=row,
            request_id=request_id,
            metadata={"imported": len(rows) > 1},
        )
    return [_filter_option(row) for row in rows]


async def update_search_filter_option(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    option_id: uuid.UUID,
    payload: UpdateSearchFilterOptionRequest,
    request_id: str | None = None,
) -> SearchFilterOptionResponse:
    """Idempotent: a change that moves nothing writes no audit row."""
    row, moved = await discovery_service.update_filter_option(
        session,
        option_id=option_id,
        changes=discovery_service.FilterOptionChanges(
            label=payload.label,
            aliases=None if payload.aliases is None else tuple(payload.aliases),
            state_code=payload.state_code,
            featured=payload.featured,
            sort_order=payload.sort_order,
            active=payload.active,
        ),
        updated_by=ctx.user_id,
    )
    if moved:
        await _audit_filter_option(
            session,
            ctx=ctx,
            action=AuditAction.SEARCH_FILTER_OPTION_UPDATED,
            row=row,
            request_id=request_id,
            metadata={"fields": moved},
        )
    return _filter_option(row)


async def get_search_filter_option(
    session: AsyncSession, *, option_id: uuid.UUID
) -> SearchFilterOptionResponse:
    return _filter_option(await discovery_service.get_filter_option(session, option_id=option_id))


async def list_search_filter_options(
    session: AsyncSession,
    *,
    kind: FilterKind | None,
    query: str | None,
    include_inactive: bool,
    cursor: str | None,
    limit: int | None,
) -> SearchFilterOptionsPage:
    rows, next_cursor = await discovery_service.list_filter_options(
        session,
        kind=kind,
        query=query,
        include_inactive=include_inactive,
        cursor=cursor,
        limit=limit,
    )
    return SearchFilterOptionsPage(
        items=[_filter_option(row) for row in rows],
        next_cursor=next_cursor,
        catalogue_version=FILTER_CATALOGUE_VERSION,
    )


# ---------------------------------------------------------------------------
# The full candidate page (2026-09-29)
# ---------------------------------------------------------------------------
# Asked for by the client: everything the candidate gave us at onboarding,
# their CV, how their score moved, the interviews they sat (with the
# recordings), the course, and their applications with where each stands.
# Each is its own endpoint, so each reveal is its own audit row -- a member of
# staff checking an application stage has not thereby listened to anyone.


async def candidate_onboarding(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> CandidateOnboarding:
    """Unmasked: the one console view with a whole phone number and email,
    because it is where staff go to contact the person."""
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_CANDIDATE_DRILLDOWN,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
        metadata={"view": "onboarding"},
    ) as reader:
        row = await repository.candidate_onboarding(reader, user_id=user_id)
        if row is None:
            raise CandidateNotFoundError()
        facts = await repository.candidate_facts(reader, user_id=user_id)
        photo_url = await profile_images_service.photo_url(reader, user_id=user_id)
    saved_career = row["career"] or {}
    career = (
        CareerResponse.model_validate(
            {
                **saved_career,
                "updated_at": row["profile_updated_at"].isoformat()
                if row["profile_updated_at"]
                else None,
            }
        )
        if saved_career
        else None
    )
    return CandidateOnboarding(
        id=row["id"],
        status=row["status"],
        locale=row["locale"],
        created_at=row["created_at"],
        full_name=row["full_name"],
        photo_url=photo_url,
        email=row["email"],
        phone=career.details.phone or row["phone"] if career else row["phone"],
        city=row["city"],
        state_code=row["state_code"],
        career=career,
        questionnaire_submitted_at=row["questionnaire_submitted_at"],
        questionnaire=onboarding_answers(row["questionnaire_answers"] or {}),
        college_links=[CollegeLinkSummary.model_validate(dict(r)) for r in facts["colleges"]],
    )


def onboarding_answers(answers: dict[str, Any]) -> list[OnboardingAnswer]:
    """Every answer in words, the free-text one included: staff are not an
    employer the candidate did not apply to."""
    return [
        OnboardingAnswer(code=a.code, question=a.question, answer=a.answer)
        for a in answers_in_words(answers, include_free_text=True)
    ]


async def resume_version_view(row: Any, *, bucket: str, ttl: int) -> ResumeVersionView:
    parsed = row["parsed"] if isinstance(row["parsed"], dict) else {}
    body = parsed.get("raw_text")
    structured, structured_status = structured_view(parsed)
    return ResumeVersionView(
        id=row["id"],
        source=row["source"],
        created_at=row["created_at"],
        confirmed_at=row["confirmed_at"],
        text=body if isinstance(body, str) else None,
        fields=resume_service.shared_fields(parsed),
        structured_resume=structured,
        structured_status=structured_status,
        file_url=(
            await storage.presign_get(bucket=bucket, key=row["s3_key"], expires_in=ttl)
            if row["s3_key"]
            else None
        ),
        file_mime=row["mime"],
    )


async def candidate_resume(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    request_id: str | None = None,
    settings: Settings | None = None,
) -> CandidateResumeView:
    settings = settings or get_settings()
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_CANDIDATE_RESUME_OPENED,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
    ) as reader:
        if await repository.candidate_account(reader, user_id=user_id) is None:
            raise CandidateNotFoundError()
        found = await repository.candidate_resume(reader, user_id=user_id)
    latest, confirmed = found["latest"], found["confirmed"]
    bucket, ttl = settings.s3_bucket_resumes, settings.presigned_url_ttl_seconds
    return CandidateResumeView(
        latest=await resume_version_view(latest, bucket=bucket, ttl=ttl) if latest else None,
        confirmed=(
            await resume_version_view(confirmed, bucket=bucket, ttl=ttl)
            if confirmed and (latest is None or confirmed["id"] != latest["id"])
            else None
        ),
    )


def score_timeline(rows: list[Any]) -> list[ScorePoint]:
    """Each stored score as its display value and band, with the change from
    the one before and what caused it. The stored number never leaves here."""
    points: list[ScorePoint] = []
    previous: Any = None
    for row in rows:
        shown = display_value(int(row["raw_value"]))
        if previous is None:
            cause = "FIRST_SCORE"
        elif row["resume_version_id"] != previous["resume_version_id"]:
            cause = "RESUME_CHANGED"
        elif int(row["addon_value"]) != int(previous["addon_value"]):
            cause = "ADD_ON"
        else:
            cause = "RECOMPUTED"
        points.append(
            ScorePoint(
                computed_at=row["computed_at"],
                display_value=shown,
                band=band_for(shown),
                change=None if not points else shown - points[-1].display_value,
                cause=cause,
            )
        )
        previous = row
    return points


async def candidate_score_timeline(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> ScoreTimeline:
    """**Staff only.** The candidate is not shown their history (the client
    declined it; see `CandidateScoreResponse`); the console is, so a
    complaint that a score dropped can be answered with when and why."""
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_CANDIDATE_DRILLDOWN,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
        metadata={"view": "score_timeline"},
    ) as reader:
        if await repository.candidate_account(reader, user_id=user_id) is None:
            raise CandidateNotFoundError()
        rows = await repository.score_history(reader, user_id=user_id)
    return ScoreTimeline(points=score_timeline(rows))


async def candidate_interviews(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> list[InterviewSessionRow]:
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_CANDIDATE_DRILLDOWN,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
        metadata={"view": "interviews"},
    ) as reader:
        if await repository.candidate_account(reader, user_id=user_id) is None:
            raise CandidateNotFoundError()
        items = await interview_service.history_for_staff(reader, candidate_id=user_id)
    return [
        InterviewSessionRow(
            id=item.session.id,
            session_number=item.session.session_number,
            state=item.session.state,
            question_set_title=interview_service.question_set_title(item.session.question_set_code),
            created_at=item.session.created_at,
            completed_at=item.session.completed_at,
            questions_asked=item.questions_asked,
            answers_stored=item.answers_stored,
            report_status=item.report_status,
        )
        for item in items
    ]


async def candidate_interview_recordings(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    request_id: str | None = None,
) -> list[InterviewRecordingRow]:
    """A person's own voice. Its own capability and its own audit row, naming
    the session as well as the person."""
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_INTERVIEW_RECORDINGS_OPENED,
        target_type="interview_session",
        target_id=session_id,
        request_id=request_id,
        metadata={"candidate_id": str(user_id)},
    ) as reader:
        rows = await interview_service.recordings_for_staff(
            reader, candidate_id=user_id, session_id=session_id
        )
    return [InterviewRecordingRow.model_validate(r, from_attributes=True) for r in rows]


async def candidate_courses(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> list[CourseStatusRow]:
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_CANDIDATE_DRILLDOWN,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
        metadata={"view": "courses"},
    ) as reader:
        if await repository.candidate_account(reader, user_id=user_id) is None:
            raise CandidateNotFoundError()
        rows = await courses_service.status_for(reader, user_id=user_id)
    return [course_status_row(r) for r in rows]


def course_status_row(row: Any) -> CourseStatusRow:
    return CourseStatusRow(
        code=row.code,
        title=row.title,
        purchased=row.purchased,
        purchased_at=row.purchased_at,
        lessons_total=row.lessons_total,
        lessons_completed=row.lessons_completed,
        percent_complete=row.percent_complete,
        completed_at=row.completed_at,
    )


def application_analytics(rows: list[Any], reached: dict[str, int]) -> ApplicationAnalytics:
    summary = stage_summary(current=[str(r["stage"]) for r in rows], reached=reached)
    return ApplicationAnalytics(
        total=summary.total, open=summary.open, by_stage=summary.by_stage, reached=summary.reached
    )


async def candidate_applications(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    user_id: uuid.UUID,
    request_id: str | None = None,
) -> CandidateApplications:
    """Every application, where it stands, and the stage analytics. No
    employer note: those are the employer's (`application_events`)."""
    async with _reveal(
        session,
        ctx,
        action=AuditAction.ADMIN_CANDIDATE_DRILLDOWN,
        target_type="user",
        target_id=user_id,
        request_id=request_id,
        metadata={"view": "applications"},
    ) as reader:
        if await repository.candidate_account(reader, user_id=user_id) is None:
            raise CandidateNotFoundError()
        rows, reached = await repository.candidate_applications(reader, user_id=user_id)
    return CandidateApplications(
        items=[CandidateApplicationRow.model_validate(dict(r)) for r in rows],
        analytics=application_analytics(rows, reached),
    )


# ---------------------------------------------------------------------------
# Building the course (2026-09-29)
# ---------------------------------------------------------------------------
# `courses.service` holds every rule; the console decides who may, and writes
# the audit row. Not a cross-tenant read: nothing here names a person.


def _admin_course(view: Any) -> AdminCourseView:
    course = view.course
    return AdminCourseView(
        id=course.id,
        code=course.code,
        title=course.title,
        version=course.version,
        price_minor=course.price_minor,
        published=course.active,
        modules=[
            AdminModuleView(
                id=module.id,
                title=module.title,
                sort_order=module.sort_order,
                active=module.active,
                lessons=[_admin_lesson(lesson) for lesson in lessons],
            )
            for module, lessons in view.modules
        ],
    )


def _admin_lesson(lesson: Any) -> AdminLessonView:
    return AdminLessonView(
        id=lesson.id,
        title=lesson.title,
        description=lesson.description,
        sort_order=lesson.sort_order,
        duration_seconds=lesson.duration_seconds,
        media_kind=lesson.media_kind,
        youtube_video_id=lesson.youtube_video_id,
        media_ready=lesson.media_ready_at is not None,
        mime=lesson.mime,
        size_bytes=lesson.size_bytes,
        active=lesson.active,
        created_at=lesson.created_at,
        updated_at=lesson.updated_at,
    )


async def _audit_course(
    session: AsyncSession,
    ctx: TenantContext,
    *,
    target_type: str,
    target_id: uuid.UUID,
    request_id: str | None,
    metadata: dict[str, Any],
) -> None:
    await audit_event(
        session,
        action=AuditAction.COURSE_CONTENT_CHANGED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type=target_type,
        target_id=target_id,
        request_id=request_id,
        metadata=metadata,
    )


async def list_courses(session: AsyncSession) -> list[AdminCourseView]:
    return [_admin_course(v) for v in await courses_service.admin_courses(session)]


async def _course(session: AsyncSession, code: str) -> AdminCourseView:
    for view in await courses_service.admin_courses(session):
        if view.course.code == code:
            return _admin_course(view)
    raise courses_service.CourseNotFoundError()


async def create_course_module(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    code: str,
    payload: CreateCourseModuleRequest,
    request_id: str | None = None,
) -> AdminCourseView:
    row = await courses_service.create_module(
        session,
        code=code,
        title=payload.title.strip(),
        sort_order=payload.sort_order,
        created_by=ctx.user_id,
    )
    await _audit_course(
        session,
        ctx,
        target_type="course_module",
        target_id=row.id,
        request_id=request_id,
        metadata={"course_code": code, "change": "created"},
    )
    return await _course(session, code)


async def update_course_module(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    module_id: uuid.UUID,
    payload: UpdateCourseModuleRequest,
    request_id: str | None = None,
) -> AdminCourseView:
    row, moved = await courses_service.update_module(
        session,
        module_id=module_id,
        title=payload.title.strip() if payload.title else None,
        sort_order=payload.sort_order,
        active=payload.active,
    )
    if moved:
        await _audit_course(
            session,
            ctx,
            target_type="course_module",
            target_id=row.id,
            request_id=request_id,
            metadata={"course_code": row.course_code, "fields": moved},
        )
    return await _course(session, row.course_code)


async def create_course_lesson(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    module_id: uuid.UUID,
    payload: CreateCourseLessonRequest,
    request_id: str | None = None,
) -> AdminLessonView:
    row = await courses_service.create_lesson(
        session,
        module_id=module_id,
        title=payload.title.strip(),
        description=payload.description,
        duration_seconds=payload.duration_seconds,
        sort_order=payload.sort_order,
        youtube_url=payload.youtube_url,
        created_by=ctx.user_id,
    )
    await _audit_course(
        session,
        ctx,
        target_type="course_lesson",
        target_id=row.id,
        request_id=request_id,
        metadata={"module_id": str(module_id), "change": "created", "media": row.media_kind},
    )
    return _admin_lesson(row)


async def update_course_lesson(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    lesson_id: uuid.UUID,
    payload: UpdateCourseLessonRequest,
    request_id: str | None = None,
) -> AdminLessonView:
    changes: dict[str, object] = {
        k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None
    }
    row, moved = await courses_service.update_lesson(session, lesson_id=lesson_id, changes=changes)
    if moved:
        await _audit_course(
            session,
            ctx,
            target_type="course_lesson",
            target_id=row.id,
            request_id=request_id,
            metadata={"fields": moved},
        )
    return _admin_lesson(row)


async def issue_lesson_upload(
    session: AsyncSession, *, lesson_id: uuid.UUID
) -> LessonUploadResponse:
    ticket = await courses_service.issue_lesson_upload(session, lesson_id=lesson_id)
    return LessonUploadResponse(
        url=ticket.url,
        expires_in_seconds=ticket.expires_in_seconds,
        max_bytes=ticket.max_bytes,
        accepted_types=list(ticket.accepted_types),
    )


async def confirm_lesson_upload(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    lesson_id: uuid.UUID,
    request_id: str | None = None,
) -> AdminLessonView:
    row = await courses_service.confirm_lesson_upload(session, lesson_id=lesson_id)
    await _audit_course(
        session,
        ctx,
        target_type="course_lesson",
        target_id=row.id,
        request_id=request_id,
        metadata={"change": "video_uploaded", "size_bytes": row.size_bytes},
    )
    return _admin_lesson(row)


async def publish_course(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    code: str,
    published: bool,
    request_id: str | None = None,
) -> AdminCourseView:
    row = await courses_service.set_published(session, code=code, published=published)
    await _audit_course(
        session,
        ctx,
        target_type="course",
        target_id=row.id,
        request_id=request_id,
        metadata={"course_code": code, "published": published},
    )
    return await _course(session, code)
