"""college - business rules and transaction boundaries

Institution tenant, roster, invites, consent, referral codes.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**Two kinds of caller, bound two ways.** College staff act for their tenant,
bound from the membership (`_bind`). A student acts for themselves, bound as a
candidate (`_bind_student`) -- **never by binding the tenant a code or an
invitation names**, which would be a tenant id taken from a request body and
would open that college's rows to the transaction (SRS 2.24.7). The student
reaches the college tables through the narrow functions in the baseline.

**What a college gets, in order:**

  1. **An organisation** (`create_college`) -- the tenant, its admin, and a
     seat row at zero. Onboarding answers are saved and submitted against the
     versioned form; nobody reviews them, because a college is a deal someone
     has already spoken to.
  2. **A subscription** -- `/college/subscription`, one payment per period
     for up to N students.
  3. **Seats** (`allocate_seats`) -- set by our staff through the admin
     console, never above what the live plan pays for.
  4. **Students**, by referral code (`link_by_code`) or by roster invitation
     (`answer_invitation`). Either way the student's own act is the consent,
     it is **ROSTER scope only**, and a free seat is taken for them at once.
"""

from __future__ import annotations

import dataclasses
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit, storage
from app.core.audit import AuditAction, audit_event
from app.core.db import set_transaction_tenant, set_transaction_user
from app.core.deps import CANDIDATE, COLLEGE_ADMIN, PLATFORM_ADMIN
from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.core.errors import ValidationError as AppValidationError
from app.core.forms import staff_fillable_sections, validate_answers, validate_staff_answers
from app.core.logging import get_logger
from app.core.outbox import emit
from app.core.pagination import clamp_limit, decode_cursor, encode_cursor
from app.core.reference import INDIAN_STATES
from app.core.tenant import TenantContext
from app.modules.college import repository
from app.modules.college.domain import (
    CODE_RANDOM_BYTES,
    CONSENT_VERSION,
    GRANTED_VIA_DIRECT,
    GRANTED_VIA_INVITE,
    GRANTED_VIA_REFERRAL_CODE,
    INDIVIDUAL,
    INDIVIDUAL_CONSENT_VERSION,
    INVITATION_VALID_FOR,
    INVITE_ACCEPTED,
    INVITE_DECLINED,
    INVITE_EXPIRED,
    INVITE_PENDING,
    INVITE_SENT,
    ISSUE_ALREADY_ON_ROSTER,
    LINK_ATTEMPTS_PER_IP_PER_HOUR,
    LINK_ATTEMPTS_PER_USER_PER_HOUR,
    ROSTER,
    RosterFileInvalid,
    StudentLinkState,
    StudentStageFilter,
    allocation_refusal,
    code_from_bytes,
    code_state,
    invitation_state,
    mark_already_on_roster,
    normalise_code,
    parse_roster_csv,
    roster_fingerprint,
    scopes_revoked_with,
    seats_available,
)
from app.modules.college.events import (
    CONSENT_REVOKED,
    INDIVIDUAL_VISIBILITY_GRANTED,
    INVITATION_SENT,
    ORGANISATION_CREATED,
    ROSTER_IMPORT_COMMITTED,
    SEATS_ALLOCATED,
    STUDENT_LINKED,
)
from app.modules.college.forms import COLLEGE_FORM, FORM_VERSION, INSTITUTION_TYPES, MONTHS
from app.modules.college.models import College, ReferralCode, RosterEntry, RosterImport
from app.modules.college.schemas import CreateCollegeRequest, UpdateCollegeRequest
from app.modules.identity import service as identity_service

# Which roster columns an invitation can actually be delivered to (E35).
# A service reading another module's pure domain, the same shape as
# `admin.router` reading `notifications.service`.
from app.modules.notifications.domain import roster_invitation_contact_fields
from app.modules.profile_images import service as profile_images_service
from app.modules.resume import service as resume_service
from app.modules.resume.structuring import StructuredResume, StructuredStatus, structured_view
from app.modules.scoring.domain import band_for, display_value
from app.modules.subscriptions import service as subscriptions_service
from app.settings import Settings, get_settings

logger = get_logger(__name__)

#: Allowed codes for every `options_source` the college form names. A source
#: the form names and this omits raises in `validate_answers`, loudly.
COLLEGE_OPTIONS: Final[dict[str, frozenset[str]]] = {
    "college.INSTITUTION_TYPES": frozenset(code for code, _ in INSTITUTION_TYPES),
    "college.MONTHS": frozenset(code for code, _ in MONTHS),
    "reference.INDIAN_STATES": frozenset(r.code for r in INDIAN_STATES),
}

#: Who may set a college's seat allowance: our staff, or a system job.
SEAT_ALLOCATORS: Final = frozenset({PLATFORM_ADMIN, "SYSTEM"})


# ---------------------------------------------------------------------------
# Errors. Codes, never sentences.
# ---------------------------------------------------------------------------
class CollegeNotFoundError(NotFoundError):
    code = "college_not_found"
    title = "College not found"


class CollegeOnboardingInvalidError(AppValidationError):
    """`params.issues` lists every problem by field and code."""

    code = "college_onboarding_invalid"
    title = "Some answers need attention"


class CollegeOnboardingSubmittedError(ConflictError):
    code = "college_onboarding_submitted"
    title = "Onboarding has already been submitted"


class CollegeSeatAllocationError(ConflictError):
    """`code` says why: `college_seats_below_used`, `college_seats_exceed_plan`,
    `college_seats_no_plan`, `college_seats_negative`."""

    code = "college_seats_refused"
    title = "That seat allowance is not allowed"


class ReferralCodeNotFoundError(NotFoundError):
    code = "referral_code_not_found"
    title = "Referral code not found"


class ReferralCodeInvalidError(AppValidationError):
    """**One answer for every reason a code does not link**: never issued,
    mistyped, expired, revoked, used up, or its college suspended. Telling them
    apart would tell a guesser which of their guesses were real codes."""

    code = "referral_code_invalid"
    title = "That code did not work"


class ConsentVersionOutdatedError(ConflictError):
    """The app showed terms that are no longer current. Show `params` and ask
    again: consent to words the student never saw is not consent."""

    code = "consent_version_outdated"
    title = "The terms have changed"


class InvitationNotFoundError(NotFoundError):
    """Not yours, never sent, expired, or already answered the other way."""

    code = "college_invitation_not_found"
    title = "Invitation not found"


class RosterFileRejectedError(AppValidationError):
    """`code` is the file-level problem, e.g. `roster_too_many_rows`."""

    code = "roster_file_rejected"
    title = "This file cannot be imported"


class RosterImportNotFoundError(NotFoundError):
    code = "roster_import_not_found"
    title = "Roster import not found"


class RosterImportClosedError(ConflictError):
    """`params.state` is where the import is. A discarded import is not
    committed, and a committed one is not discarded."""

    code = "roster_import_closed"
    title = "This import can no longer change"


def _now(now: datetime | None) -> datetime:
    return now or datetime.now(UTC)


def _created_cursor(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    if cursor is None:
        return None
    decoded = decode_cursor(cursor)
    try:
        return (
            datetime.fromisoformat(str(decoded["created_at"])),
            uuid.UUID(str(decoded["id"])),
        )
    except (KeyError, ValueError) as exc:
        raise AppValidationError(code="invalid_cursor") from exc


def _next_created_cursor(
    *,
    created_at: datetime,
    record_id: uuid.UUID,
) -> str:
    return encode_cursor({"created_at": created_at.isoformat(), "id": str(record_id)})


def _tenant_of(ctx: TenantContext) -> uuid.UUID:
    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    return ctx.tenant_id


async def _bind(session: AsyncSession, ctx: TenantContext) -> uuid.UUID:
    tenant_id = _tenant_of(ctx)
    await set_transaction_tenant(session, tenant_id)
    return tenant_id


async def _bind_student(session: AsyncSession, ctx: TenantContext) -> uuid.UUID:
    if ctx.tenant_id is not None or ctx.role != CANDIDATE:
        raise PermissionDeniedError()
    await set_transaction_user(session, ctx.user_id)
    return ctx.user_id


# ---------------------------------------------------------------------------
# 1. The organisation and its team
# ---------------------------------------------------------------------------
async def create_college(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    payload: CreateCollegeRequest,
    actor_id: uuid.UUID | None = None,
    actor_role: str | None = None,
) -> College:
    """A business account creates its college and becomes its admin -- or
    staff create it for them (`actor_*`, 2026-09-18).

    Tenant first, then bind, then the college row -- the RLS `WITH CHECK`
    refuses a row for a tenant that is not bound, so the order is not style.
    """
    tenant_id = await identity_service.create_tenant_with_owner(
        session,
        owner_user_id=user_id,
        tenant_type="COLLEGE",
        name=payload.name,
        owner_role=identity_service.COLLEGE_ADMIN_ROLE,
    )
    await set_transaction_tenant(session, tenant_id)
    row = await repository.create_college(
        session, tenant_id=tenant_id, name=payload.name, institution_type=payload.institution_type
    )
    await audit_event(
        session,
        action=AuditAction.ORGANISATION_CREATED,
        actor_id=actor_id or user_id,
        actor_role=actor_role or COLLEGE_ADMIN,
        target_type="tenant",
        target_id=tenant_id,
        tenant_id=tenant_id,
    )
    await emit(
        session,
        event_type=ORGANISATION_CREATED,
        aggregate_type="tenant",
        aggregate_id=tenant_id,
        payload={"admin_user_id": str(user_id)},
    )
    logger.info("college_created", tenant_id=str(tenant_id))
    return row


async def get_college(session: AsyncSession, *, ctx: TenantContext) -> College:
    tenant_id = await _bind(session, ctx)
    row = await repository.get_college(session, tenant_id=tenant_id)
    if row is None:
        raise CollegeNotFoundError()
    return row


async def update_college(
    session: AsyncSession, *, ctx: TenantContext, payload: UpdateCollegeRequest
) -> College:
    tenant_id = await _bind(session, ctx)
    changes = payload.model_dump(exclude_unset=True)
    row = await repository.update_college(session, tenant_id=tenant_id, changes=changes)
    if row is None:
        raise CollegeNotFoundError()
    if changes.get("name"):
        # `tenants.name` is what admin screens and the suspension log show.
        await identity_service.rename_tenant(session, tenant_id=tenant_id, name=changes["name"])
    return row


async def list_team(session: AsyncSession, *, ctx: TenantContext) -> Any:
    return await identity_service.list_team(session, tenant_id=_tenant_of(ctx))


async def add_team_member(
    session: AsyncSession, *, ctx: TenantContext, email: str, role: str
) -> Any:
    tenant_id = await _bind(session, ctx)
    member = await identity_service.add_team_member(
        session,
        tenant_id=tenant_id,
        email=email,
        role=role,
        team_roles=identity_service.COLLEGE_TEAM_ROLES,
    )
    await audit_event(
        session,
        action=AuditAction.TEAM_MEMBER_ADDED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=member.user_id,
        tenant_id=tenant_id,
        metadata={"role": role},
    )
    return member


async def change_member_role(
    session: AsyncSession, *, ctx: TenantContext, user_id: uuid.UUID, role: str
) -> Any:
    tenant_id = await _bind(session, ctx)
    member = await identity_service.change_member_role(
        session,
        tenant_id=tenant_id,
        user_id=user_id,
        role=role,
        team_roles=identity_service.COLLEGE_TEAM_ROLES,
        owner_role=identity_service.COLLEGE_ADMIN_ROLE,
    )
    await audit_event(
        session,
        action=AuditAction.TEAM_MEMBER_ROLE_CHANGED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=user_id,
        tenant_id=tenant_id,
        metadata={"role": role},
    )
    return member


async def remove_team_member(
    session: AsyncSession, *, ctx: TenantContext, user_id: uuid.UUID
) -> None:
    tenant_id = await _bind(session, ctx)
    await identity_service.remove_team_member(
        session,
        tenant_id=tenant_id,
        user_id=user_id,
        owner_role=identity_service.COLLEGE_ADMIN_ROLE,
    )
    await audit_event(
        session,
        action=AuditAction.TEAM_MEMBER_REMOVED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=user_id,
        tenant_id=tenant_id,
    )


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------
def form_definition(*, staff: bool = False) -> dict[str, Any]:
    """The whole form, or with `staff` the part our staff may fill in for a
    college (`app.core.forms.staff_fillable_sections`)."""
    sections = staff_fillable_sections(COLLEGE_FORM) if staff else COLLEGE_FORM.sections
    return {
        "code": COLLEGE_FORM.code,
        "version": COLLEGE_FORM.version,
        "sections": [dataclasses.asdict(section) for section in sections],
    }


def form_options() -> dict[str, list[dict[str, str]]]:
    return {
        "college.INSTITUTION_TYPES": [{"code": c, "label": lbl} for c, lbl in INSTITUTION_TYPES],
        "college.MONTHS": [{"code": c, "label": lbl} for c, lbl in MONTHS],
        "reference.INDIAN_STATES": [{"code": r.code, "label": r.name} for r in INDIAN_STATES],
    }


def _issues(issues: tuple[Any, ...]) -> CollegeOnboardingInvalidError:
    return CollegeOnboardingInvalidError(
        params={"issues": [{"field": i.field, "code": i.code} for i in issues]}
    )


async def save_onboarding(
    session: AsyncSession, *, ctx: TenantContext, answers: dict[str, Any]
) -> College:
    """A partial save, merged; `null` clears a field. Format now, completeness
    at submission. Submitted answers are a record and do not change."""
    tenant_id = await _bind(session, ctx)
    issues = validate_answers(COLLEGE_FORM, answers, options=COLLEGE_OPTIONS, complete=False)
    if issues:
        raise _issues(issues)
    row = await repository.get_college(session, tenant_id=tenant_id, lock=True)
    if row is None:
        raise CollegeNotFoundError()
    if row.onboarding_submitted_at is not None:
        raise CollegeOnboardingSubmittedError()
    merged = {**(row.onboarding_answers or {}), **answers}
    row.onboarding_answers = {code: value for code, value in merged.items() if value is not None}
    row.form_version = FORM_VERSION
    await session.flush()
    return row


async def prefill_onboarding(
    session: AsyncSession, *, tenant_id: uuid.UUID, answers: dict[str, Any]
) -> None:
    """Staff fill a college's onboarding in for it, in the transaction that
    created the college (2026-10-03). Saved, never submitted: the college's
    admin finds it filled at first sign-in, accepts the undertakings and
    submits, which staff cannot do (`validate_staff_answers`).

    `tenant_id` is the college this transaction just created, never one from
    a request, which is why binding it here is safe.
    """
    issues = validate_staff_answers(COLLEGE_FORM, answers, options=COLLEGE_OPTIONS)
    if issues:
        raise _issues(issues)
    answers = {code: value for code, value in answers.items() if value is not None}
    if not answers:
        return
    await set_transaction_tenant(session, tenant_id)
    row = await repository.get_college(session, tenant_id=tenant_id, lock=True)
    if row is None:  # pragma: no cover - created in this transaction
        raise CollegeNotFoundError()
    row.onboarding_answers = {**(row.onboarding_answers or {}), **answers}
    row.form_version = FORM_VERSION
    await session.flush()


async def submit_onboarding(
    session: AsyncSession, *, ctx: TenantContext, now: datetime | None = None
) -> College:
    """Idempotent. 422 lists everything still missing."""
    tenant_id = await _bind(session, ctx)
    row = await repository.get_college(session, tenant_id=tenant_id, lock=True)
    if row is None:
        raise CollegeNotFoundError()
    if row.onboarding_submitted_at is not None:
        return row
    issues = validate_answers(
        COLLEGE_FORM, row.onboarding_answers or {}, options=COLLEGE_OPTIONS, complete=True
    )
    if issues:
        raise _issues(issues)
    row.onboarding_submitted_at = _now(now)
    row.form_version = FORM_VERSION
    await session.flush()
    return row


# ---------------------------------------------------------------------------
# 3. Seats
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class SeatSummary:
    allocated: int
    used: int
    available: int
    subscription_active: bool


async def seat_summary(session: AsyncSession, *, ctx: TenantContext) -> SeatSummary:
    tenant_id = await _bind(session, ctx)
    seats = await repository.get_seats(session, tenant_id=tenant_id)
    if seats is None:
        raise CollegeNotFoundError()
    current = await subscriptions_service.status_for(
        session,
        subscriber=subscriptions_service.Subscriber("TENANT", tenant_id, "COLLEGE"),
    )
    return SeatSummary(
        allocated=seats.seats_allocated,
        used=seats.seats_used,
        available=seats_available(allocated=seats.seats_allocated, used=seats.seats_used),
        subscription_active=current.has_access,
    )


@dataclass(frozen=True, slots=True)
class Allocation:
    allocated: int
    used: int
    filled: int


async def allocate_seats(
    session: AsyncSession,
    *,
    actor_id: uuid.UUID | None,
    actor_role: str,
    tenant_id: uuid.UUID,
    seats: int,
    request_id: str | None = None,
) -> Allocation:
    """Set a college's seat allowance, then seat linked students waiting for one.

    **Our staff's action, not the college's** (client: seats are assigned "from
    the admin"). The tenant is passed in because the actor belongs to none, as
    for a KYB decision; it is bound before any read.

    Refused below the seats in use (taking a seat from a student is a release,
    a decision about a person), above what the college's live plan pays for,
    and without a live plan at all. Audited.

    Growing the allowance seats students already linked, longest-linked first,
    in the same transaction -- a student who linked while the college was full
    should not have to link again.
    """
    if actor_role not in SEAT_ALLOCATORS:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, tenant_id)
    row = await repository.get_seats(session, tenant_id=tenant_id, lock=True)
    if row is None:
        raise CollegeNotFoundError()
    current = await subscriptions_service.status_for(
        session,
        subscriber=subscriptions_service.Subscriber("TENANT", tenant_id, "COLLEGE"),
    )
    allowance = current.plan.seat_allowance if current.has_access and current.plan else None
    refusal = allocation_refusal(requested=seats, used=row.seats_used, plan_allowance=allowance)
    if refusal is not None:
        raise CollegeSeatAllocationError(
            code=refusal, params={"seats_used": row.seats_used, "plan_allowance": allowance}
        )

    previous = row.seats_allocated
    row = await repository.set_allocation(session, row, seats=seats, allocated_by=actor_id)
    filled = await repository.fill_seats(session, tenant_id=tenant_id) if seats > previous else 0
    row = await repository.get_seats(session, tenant_id=tenant_id, lock=True) or row

    await audit_event(
        session,
        action=AuditAction.COLLEGE_SEATS_ALLOCATED,
        actor_id=actor_id,
        actor_role=actor_role,
        target_type="tenant",
        target_id=tenant_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"from": previous, "to": seats, "filled": filled},
    )
    await emit(
        session,
        event_type=SEATS_ALLOCATED,
        aggregate_type="tenant",
        aggregate_id=tenant_id,
        payload={"seats_allocated": seats, "seats_used": row.seats_used, "filled": filled},
    )
    return Allocation(allocated=row.seats_allocated, used=row.seats_used, filled=filled)


# ---------------------------------------------------------------------------
# 4a. Referral codes -- the college's side
# ---------------------------------------------------------------------------
async def issue_code(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    expires_in_days: int,
    max_uses: int | None,
    now: datetime | None = None,
    request_id: str | None = None,
) -> ReferralCode:
    """A new code, from the operating system's CSPRNG. Always expiring."""
    tenant_id = await _bind(session, ctx)
    now = _now(now)
    for _ in range(3):
        row = await repository.insert_code(
            session,
            tenant_id=tenant_id,
            code=code_from_bytes(secrets.token_bytes(CODE_RANDOM_BYTES)),
            created_by=ctx.user_id,
            max_uses=max_uses,
            expires_at=now + timedelta(days=expires_in_days),
        )
        if row is not None:
            break
    else:  # pragma: no cover - three 60-bit collisions in a row
        raise RuntimeError("referral code generation collided three times")
    # The code itself stays out of the audit metadata: it is a credential.
    await audit_event(
        session,
        action=AuditAction.REFERRAL_CODE_ISSUED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="referral_code",
        target_id=row.id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"expires_in_days": expires_in_days, "max_uses": max_uses},
    )
    return row


@dataclass(frozen=True, slots=True)
class ReferralCodesPage:
    items: list[ReferralCode]
    next_cursor: str | None


async def list_codes(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    cursor: str | None,
    limit: int | None,
    active_only: bool = False,
    now: datetime | None = None,
) -> ReferralCodesPage:
    tenant_id = await _bind(session, ctx)
    size = clamp_limit(limit)
    now = _now(now)
    rows = await repository.list_codes(
        session,
        tenant_id=tenant_id,
        after=_created_cursor(cursor),
        limit=size + 1,
        active_only=active_only,
        now=now,
    )
    page = rows[:size]
    return ReferralCodesPage(
        items=page,
        next_cursor=(
            _next_created_cursor(created_at=page[-1].created_at, record_id=page[-1].id)
            if len(rows) > size
            else None
        ),
    )


async def revoke_code(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    code_id: uuid.UUID,
    now: datetime | None = None,
    request_id: str | None = None,
) -> ReferralCode:
    """Idempotent. Students already linked stay linked: revoking a code stops
    new links, and a student's consent is theirs to withdraw, not the code's."""
    tenant_id = await _bind(session, ctx)
    row = await repository.get_code(session, tenant_id=tenant_id, code_id=code_id, lock=True)
    if row is None:
        raise ReferralCodeNotFoundError()
    if row.revoked_at is not None:
        return row
    row = await repository.revoke_code(session, row, revoked_by=ctx.user_id, now=_now(now))
    await audit_event(
        session,
        action=AuditAction.REFERRAL_CODE_REVOKED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="referral_code",
        target_id=row.id,
        tenant_id=tenant_id,
        request_id=request_id,
    )
    return row


def state_of(code: ReferralCode, *, now: datetime | None = None) -> str:
    return code_state(
        revoked_at=code.revoked_at,
        expires_at=code.expires_at,
        uses=code.uses,
        max_uses=code.max_uses,
        now=_now(now),
    )


# ---------------------------------------------------------------------------
# 4b. Linking -- the student's side
# ---------------------------------------------------------------------------
def _require_current_terms(consent_version: str) -> None:
    if consent_version != CONSENT_VERSION:
        raise ConsentVersionOutdatedError(params={"consent_version": CONSENT_VERSION})


@dataclass(frozen=True, slots=True)
class Link:
    college_id: uuid.UUID
    college_name: str | None
    scope: str
    granted_via: str
    granted_at: datetime
    revoked_at: datetime | None
    seat_held: bool
    created: bool
    college_logo_url: str | None = None


async def _link(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    tenant_id: uuid.UUID,
    granted_via: str,
    referral_code_id: uuid.UUID | None,
    roster_entry_id: uuid.UUID | None,
    request_id: str | None,
) -> Link:
    """Write the ROSTER consent, audit it, take a free seat. The student's
    transaction is already bound; the consent row's policy re-checks that the
    code or invitation it names admits this student to this college."""
    consent = await repository.insert_roster_consent(
        session,
        tenant_id=tenant_id,
        candidate_id=ctx.user_id,
        granted_via=granted_via,
        consent_version=CONSENT_VERSION,
        referral_code_id=referral_code_id,
        roster_entry_id=roster_entry_id,
    )
    await audit_event(
        session,
        action=AuditAction.CONSENT_GRANTED,
        actor_id=ctx.user_id,
        actor_role=CANDIDATE,
        target_type="student_consent",
        target_id=consent.id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={
            "scope": consent.scope,
            "granted_via": granted_via,
            "consent_version": CONSENT_VERSION,
        },
    )
    seat = await repository.claim_seat(session, tenant_id=tenant_id)
    await emit(
        session,
        event_type=STUDENT_LINKED,
        aggregate_type="student_consent",
        aggregate_id=consent.id,
        payload={
            "tenant_id": str(tenant_id),
            "granted_via": granted_via,
            "seat_held": seat is not None,
        },
    )
    logger.info("college_student_linked", granted_via=granted_via, seat_held=seat is not None)
    names = await repository.college_names(session, tenant_ids=[tenant_id])
    return Link(
        college_id=tenant_id,
        college_name=names.get(tenant_id),
        college_logo_url=await profile_images_service.logo_url(session, tenant_id=tenant_id),
        scope=consent.scope,
        granted_via=granted_via,
        granted_at=consent.granted_at,
        revoked_at=None,
        seat_held=seat is not None,
        created=True,
    )


async def _existing_link(
    session: AsyncSession, *, ctx: TenantContext, tenant_id: uuid.UUID
) -> Link | None:
    consent = await repository.live_roster_consent(
        session, tenant_id=tenant_id, candidate_id=ctx.user_id
    )
    if consent is None:
        return None
    # A student linked while the college was full is seated on a retry if a
    # seat has freed since.
    seat = await repository.claim_seat(session, tenant_id=tenant_id)
    names = await repository.college_names(session, tenant_ids=[tenant_id])
    return Link(
        college_id=tenant_id,
        college_name=names.get(tenant_id),
        college_logo_url=await profile_images_service.logo_url(session, tenant_id=tenant_id),
        scope=consent.scope,
        granted_via=consent.granted_via,
        granted_at=consent.granted_at,
        revoked_at=None,
        seat_held=seat is not None,
        created=False,
    )


async def link_by_code(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    code: str,
    consent_version: str,
    client_ip: str | None,
    request_id: str | None = None,
) -> Link:
    """A student enters their college's code. **Entering it is the consent**
    (R16, client-approved), for ROSTER scope and nothing more.

    Rate-limited per student and per address before the code is looked at,
    and every refusal is the same `referral_code_invalid`. Idempotent: a
    student already linked to that college is returned their link and the
    code is not used again.
    """
    await ratelimit.hit(
        bucket="college_link:user",
        subject=str(ctx.user_id),
        limit=LINK_ATTEMPTS_PER_USER_PER_HOUR,
        window_seconds=3600,
    )
    if client_ip:
        await ratelimit.hit(
            bucket="college_link:ip",
            subject=client_ip,
            limit=LINK_ATTEMPTS_PER_IP_PER_HOUR,
            window_seconds=3600,
        )
    _require_current_terms(consent_version)
    await _bind_student(session, ctx)

    normalised = normalise_code(code)
    live = await repository.resolve_code(session, code=normalised) if normalised else None
    if live is None:
        logger.info("referral_code_refused")
        raise ReferralCodeInvalidError()

    existing = await _existing_link(session, ctx=ctx, tenant_id=live.tenant_id)
    if existing is not None:
        return existing
    if not await repository.consume_code(session, code_id=live.code_id):
        # Used up between the lookup and now.
        raise ReferralCodeInvalidError()
    return await _link(
        session,
        ctx=ctx,
        tenant_id=live.tenant_id,
        granted_via=GRANTED_VIA_REFERRAL_CODE,
        referral_code_id=live.code_id,
        roster_entry_id=None,
        request_id=request_id,
    )


async def list_links(session: AsyncSession, *, ctx: TenantContext) -> list[Link]:
    """Every college the student has linked to, revoked links included: what
    they agreed to, and when, is theirs to see."""
    user_id = await _bind_student(session, ctx)
    consents = await repository.candidate_consents(session, candidate_id=user_id)
    seat = await repository.candidate_live_seat(session, candidate_id=user_id)
    tenant_ids = sorted({c.tenant_id for c in consents})
    names = await repository.college_names(session, tenant_ids=tenant_ids)
    logos = await profile_images_service.logo_urls(session, tenant_ids=tenant_ids)
    return [
        Link(
            college_id=c.tenant_id,
            college_name=names.get(c.tenant_id),
            college_logo_url=logos.get(c.tenant_id),
            scope=c.scope,
            granted_via=c.granted_via,
            granted_at=c.granted_at,
            revoked_at=c.revoked_at,
            seat_held=seat is not None and seat.consent_id == c.id,
            created=False,
        )
        for c in consents
    ]


@dataclass(frozen=True, slots=True)
class InvitationView:
    entry_id: uuid.UUID
    college_name: str
    sent_at: datetime
    expires_at: datetime
    college_logo_url: str | None = None


async def list_invitations(session: AsyncSession, *, ctx: TenantContext) -> list[InvitationView]:
    """Unanswered, unexpired invitations sent to the student's own verified
    phone or email. Matched in the database on the account's contact, never
    on anything the student sends."""
    await _bind_student(session, ctx)
    invitations = await repository.invitations_for_candidate(session)
    logos = await profile_images_service.logo_urls(
        session, tenant_ids=[i.tenant_id for i in invitations]
    )
    return [
        InvitationView(
            i.entry_id,
            i.college_name,
            i.sent_at,
            i.sent_at + INVITATION_VALID_FOR,
            logos.get(i.tenant_id),
        )
        for i in invitations
    ]


async def answer_invitation(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    entry_id: uuid.UUID,
    accept: bool,
    consent_version: str | None,
    request_id: str | None = None,
) -> Link | None:
    """Accept (the consent act for INVITE) or decline. Idempotent either way.
    Not this student's, expired, or answered the other way: 404."""
    if accept:
        _require_current_terms(consent_version or "")
    await _bind_student(session, ctx)
    tenant_id = await repository.answer_invitation(session, entry_id=entry_id, accept=accept)
    if tenant_id is None:
        raise InvitationNotFoundError()
    if not accept:
        return None
    existing = await _existing_link(session, ctx=ctx, tenant_id=tenant_id)
    if existing is not None:
        return existing
    return await _link(
        session,
        ctx=ctx,
        tenant_id=tenant_id,
        granted_via=GRANTED_VIA_INVITE,
        referral_code_id=None,
        roster_entry_id=entry_id,
        request_id=request_id,
    )


# ---------------------------------------------------------------------------
# 4c. Roster import and invitations -- the college's side
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class ImportView:
    record: RosterImport
    invitations: dict[str, int]
    created: bool = False
    #: Valid rows no invitation can reach, given what is deliverable today.
    #: Phone-only rows while SMS is deferred.
    unreachable_rows: int = 0


async def _view(
    session: AsyncSession, record: RosterImport, *, now: datetime, created: bool = False
) -> ImportView:
    counts = dict.fromkeys((INVITE_PENDING, INVITE_SENT, INVITE_ACCEPTED, INVITE_DECLINED), 0)
    counts[INVITE_EXPIRED] = 0
    for stored, sent_at in await repository.invitation_rows(
        session, tenant_id=record.tenant_id, import_id=record.id
    ):
        state = invitation_state(stored=stored, sent_at=sent_at, now=now)
        if state is not None:
            counts[state] += 1
    # Asked on every read of an import, not only at upload: which columns can
    # carry an invitation is a deployment fact that changes, so a count taken
    # once and stored would go stale the day SMS returns.
    unreachable = await repository.unreachable_valid_rows(
        session,
        import_id=record.id,
        contact_fields=roster_invitation_contact_fields(),
    )
    return ImportView(record, counts, created, unreachable_rows=unreachable)


async def upload_roster(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    file_name: str,
    csv_text: str,
    now: datetime | None = None,
) -> ImportView:
    """Parse and check a roster file, and stage it as a preview.

    **Nothing is invited here.** Every row is kept with its state and issues
    so the college can see what will happen before it commits (SRS 2.25.3).
    The same file again returns its existing PREVIEW or COMMITTED import
    (`created` false). A discarded file may be uploaded again because discard
    permanently removed its staged rows.
    """
    tenant_id = await _bind(session, ctx)
    now = _now(now)
    try:
        parsed = parse_roster_csv(csv_text)
    except RosterFileInvalid as exc:
        raise RosterFileRejectedError(code=exc.code, params={"detail": str(exc)}) from exc

    await repository.lock_roster(session, tenant_id=tenant_id)
    fingerprint = roster_fingerprint(csv_text)
    existing = await repository.import_by_source(
        session, tenant_id=tenant_id, source_sha256=fingerprint
    )
    if existing is not None:
        return await _view(session, existing, now=now)

    phones, emails = await repository.committed_contacts(session, tenant_id=tenant_id)
    rows = mark_already_on_roster(parsed.rows, phones=phones, emails=emails)
    record = await repository.insert_import(
        session,
        tenant_id=tenant_id,
        file_name=file_name,
        source_sha256=fingerprint,
        rows=rows,
        ignored_columns=parsed.ignored_columns,
        created_by=ctx.user_id,
    )
    logger.info("roster_previewed", rows=record.total_rows, valid=record.valid_rows)
    return await _view(session, record, now=now, created=True)


async def get_import(
    session: AsyncSession, *, ctx: TenantContext, import_id: uuid.UUID, now: datetime | None = None
) -> ImportView:
    tenant_id = await _bind(session, ctx)
    record = await repository.get_import(session, tenant_id=tenant_id, import_id=import_id)
    if record is None:
        raise RosterImportNotFoundError()
    return await _view(session, record, now=_now(now))


@dataclass(frozen=True, slots=True)
class ImportViewsPage:
    items: list[ImportView]
    next_cursor: str | None
    invitation_totals: dict[str, int]


async def list_imports(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    cursor: str | None,
    limit: int | None,
    now: datetime | None = None,
) -> ImportViewsPage:
    tenant_id = await _bind(session, ctx)
    now = _now(now)
    size = clamp_limit(limit)
    records = await repository.list_imports(
        session,
        tenant_id=tenant_id,
        after=_created_cursor(cursor),
        limit=size + 1,
    )
    page = records[:size]
    totals = dict.fromkeys(
        (INVITE_PENDING, INVITE_SENT, INVITE_ACCEPTED, INVITE_DECLINED, INVITE_EXPIRED),
        0,
    )
    totals.update(
        await repository.invitation_counts_for_tenant(
            session,
            tenant_id=tenant_id,
            expired_before=now - INVITATION_VALID_FOR,
        )
    )
    return ImportViewsPage(
        items=[await _view(session, record, now=now) for record in page],
        next_cursor=(
            _next_created_cursor(created_at=page[-1].created_at, record_id=page[-1].id)
            if len(records) > size
            else None
        ),
        invitation_totals=totals,
    )


@dataclass(frozen=True, slots=True)
class RowsPage:
    rows: list[tuple[RosterEntry, str | None]]
    next_cursor: str | None


async def list_rows(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    import_id: uuid.UUID,
    row_state: str | None,
    cursor: str | None,
    limit: int | None,
    now: datetime | None = None,
) -> RowsPage:
    """The preview, a page at a time, in file order. Each row carries the
    invitation state a reader sees, EXPIRED included."""
    tenant_id = await _bind(session, ctx)
    if await repository.get_import(session, tenant_id=tenant_id, import_id=import_id) is None:
        raise RosterImportNotFoundError()
    size = clamp_limit(limit)
    after = int(decode_cursor(cursor).get("row", 0)) if cursor else 0
    rows = await repository.list_rows(
        session,
        tenant_id=tenant_id,
        import_id=import_id,
        row_state=row_state,
        after_row=after,
        limit=size + 1,
    )
    now = _now(now)
    page = rows[:size]
    return RowsPage(
        rows=[
            (row, invitation_state(stored=row.invite_state, sent_at=row.sent_at, now=now))
            for row in page
        ],
        next_cursor=encode_cursor({"row": page[-1].row_number}) if len(rows) > size else None,
    )


async def commit_import(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    import_id: uuid.UUID,
    now: datetime | None = None,
    request_id: str | None = None,
) -> ImportView:
    """Put the valid rows on the roster as pending invitations. Idempotent.

    Duplicates are checked again under the roster lock, because another
    import may have been committed since this one was previewed. **Rows that
    will never be invited are deleted**: a malformed or duplicate contact the
    college cannot use is not ours to keep. The counts stay on the import.
    """
    tenant_id = await _bind(session, ctx)
    now = _now(now)
    await repository.lock_roster(session, tenant_id=tenant_id)
    record = await repository.get_import(
        session, tenant_id=tenant_id, import_id=import_id, lock=True
    )
    if record is None:
        raise RosterImportNotFoundError()
    if record.state == "COMMITTED":
        return await _view(session, record, now=now)
    if record.state != "PREVIEW":
        raise RosterImportClosedError(params={"state": record.state})

    phones, emails = await repository.committed_contacts(session, tenant_id=tenant_id)
    collided = [
        row.id
        for row in await repository.valid_uncommitted_rows(
            session, tenant_id=tenant_id, import_id=import_id
        )
        if (row.phone and row.phone in phones) or (row.email and row.email in emails)
    ]
    await repository.mark_rows_already_on_roster(
        session, row_ids=collided, issue=ISSUE_ALREADY_ON_ROSTER
    )
    await repository.recount(session, record)
    committed = await repository.commit_rows(session, tenant_id=tenant_id, import_id=import_id)
    await repository.delete_uncommitted_rows(session, tenant_id=tenant_id, import_id=import_id)

    record.state = "COMMITTED"
    record.committed_at = now
    record.committed_by = ctx.user_id
    await session.flush()
    await audit_event(
        session,
        action=AuditAction.ROSTER_IMPORT_COMMITTED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="roster_import",
        target_id=record.id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"committed": committed, "duplicates_at_commit": len(collided)},
    )
    await emit(
        session,
        event_type=ROSTER_IMPORT_COMMITTED,
        aggregate_type="roster_import",
        aggregate_id=record.id,
        payload={"tenant_id": str(tenant_id), "committed": committed},
    )
    return await _view(session, record, now=now)


async def discard_import(
    session: AsyncSession, *, ctx: TenantContext, import_id: uuid.UUID, now: datetime | None = None
) -> ImportView:
    """Throw a preview away, and every row staged with it. Idempotent."""
    tenant_id = await _bind(session, ctx)
    record = await repository.get_import(
        session, tenant_id=tenant_id, import_id=import_id, lock=True
    )
    if record is None:
        raise RosterImportNotFoundError()
    if record.state == "COMMITTED":
        raise RosterImportClosedError(params={"state": record.state})
    if record.state == "PREVIEW":
        await repository.delete_uncommitted_rows(session, tenant_id=tenant_id, import_id=import_id)
        record.state = "DISCARDED"
        await session.flush()
    return await _view(session, record, now=_now(now))


async def send_invitations(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    import_id: uuid.UUID,
    now: datetime | None = None,
    request_id: str | None = None,
) -> tuple[int, ImportView]:
    """Send every pending invitation in a committed import. Idempotent: a
    second call sends nothing.

    **Sending is an outbox event per invitation**, consumed by notifications.
    SMS stays DLT-gated (blockers D1) and email waits on SES
    production access, so today an invitation is marked SENT and recorded,
    and the student finds it in the app from their own verified contact.
    """
    tenant_id = await _bind(session, ctx)
    now = _now(now)
    record = await repository.get_import(
        session, tenant_id=tenant_id, import_id=import_id, lock=True
    )
    if record is None:
        raise RosterImportNotFoundError()
    if record.state != "COMMITTED":
        raise RosterImportClosedError(params={"state": record.state})
    sent = await repository.send_pending(session, tenant_id=tenant_id, import_id=import_id, now=now)
    for entry_id in sent:
        # Ids only. The notification consumer reads the contact from the row,
        # so no phone number or address ever sits in the outbox.
        await emit(
            session,
            event_type=INVITATION_SENT,
            aggregate_type="roster_entry",
            aggregate_id=entry_id,
            payload={"tenant_id": str(tenant_id), "import_id": str(import_id)},
        )
    if sent:
        await audit_event(
            session,
            action=AuditAction.ROSTER_INVITATIONS_SENT,
            actor_id=ctx.user_id,
            actor_role=ctx.role,
            target_type="roster_import",
            target_id=record.id,
            tenant_id=tenant_id,
            request_id=request_id,
            metadata={"sent": len(sent)},
        )
    return len(sent), await _view(session, record, now=now)


@dataclass(frozen=True, slots=True)
class InvitationRecipient:
    phone: str | None
    email: str | None
    college_name: str


async def invitation_recipient(
    session: AsyncSession, *, tenant_id: uuid.UUID, entry_id: uuid.UUID
) -> InvitationRecipient | None:
    """Where to deliver one sent invitation. **System only.**

    The tenant comes from the `college.invitation_sent` event our own service
    wrote, not from a request -- the same footing as the expiry sweep binding
    each tenant from `tenants`. None when the row is no longer a sent
    invitation (answered, or the import discarded), so a late delivery sends
    nothing.
    """
    await set_transaction_tenant(session, tenant_id)
    entry = await repository.sent_invitation(session, tenant_id=tenant_id, entry_id=entry_id)
    college = await repository.get_college(session, tenant_id=tenant_id)
    if entry is None or college is None:
        return None
    return InvitationRecipient(phone=entry.phone, email=entry.email, college_name=college.name)


# ---------------------------------------------------------------------------
# 5. Consent after linking -- the student's side
# ---------------------------------------------------------------------------
class CollegeLinkNotFoundError(NotFoundError):
    """The student has no live link to that college, or never had one."""

    code = "college_link_not_found"
    title = "You are not linked to that college"


async def _live_by_scope(
    session: AsyncSession, *, tenant_id: uuid.UUID, candidate_id: uuid.UUID
) -> dict[str, Any]:
    consents = await repository.live_consents(
        session, tenant_id=tenant_id, candidate_id=candidate_id
    )
    return {c.scope: c for c in consents}


async def grant_individual_visibility(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    college_id: uuid.UUID,
    consent_version: str,
    request_id: str | None = None,
) -> Link:
    """Let a linked college see the student as a person (PRD 3.8).

    **A separate act, never a side effect of linking**, against its own
    versioned words. Needs a live ROSTER link to that college (404 without);
    `guard_student_consent_insert` holds the same rule for every writer.
    Idempotent: granted already, the existing grant is returned.

    **A grant under older words is replaced, not returned** (2026-09-29): the
    student is agreeing to the current words, which may show the college
    more, so the old row is revoked and a new one written in this
    transaction. Until they do, the college keeps the older, narrower view.
    """
    if consent_version != INDIVIDUAL_CONSENT_VERSION:
        raise ConsentVersionOutdatedError(params={"consent_version": INDIVIDUAL_CONSENT_VERSION})
    user_id = await _bind_student(session, ctx)
    live = await _live_by_scope(session, tenant_id=college_id, candidate_id=user_id)
    if ROSTER not in live:
        raise CollegeLinkNotFoundError()
    existing = live.get(INDIVIDUAL)
    upgraded_from: str | None = None
    if existing is not None and existing.consent_version != INDIVIDUAL_CONSENT_VERSION:
        upgraded_from = existing.consent_version
        await repository.revoke_consent(
            session, tenant_id=college_id, candidate_id=user_id, scope=INDIVIDUAL
        )
        existing = None
    consent = existing or await repository.insert_individual_consent(
        session,
        tenant_id=college_id,
        candidate_id=user_id,
        consent_version=INDIVIDUAL_CONSENT_VERSION,
    )
    if existing is None:
        await audit_event(
            session,
            action=AuditAction.CONSENT_GRANTED,
            actor_id=user_id,
            actor_role=CANDIDATE,
            target_type="student_consent",
            target_id=consent.id,
            tenant_id=college_id,
            request_id=request_id,
            metadata={
                "scope": INDIVIDUAL,
                "granted_via": GRANTED_VIA_DIRECT,
                "consent_version": INDIVIDUAL_CONSENT_VERSION,
                "upgraded_from": upgraded_from,
            },
        )
        await emit(
            session,
            event_type=INDIVIDUAL_VISIBILITY_GRANTED,
            aggregate_type="student_consent",
            aggregate_id=consent.id,
            payload={"tenant_id": str(college_id)},
        )
    names = await repository.college_names(session, tenant_ids=[college_id])
    return Link(
        college_id=college_id,
        college_name=names.get(college_id),
        scope=INDIVIDUAL,
        granted_via=GRANTED_VIA_DIRECT,
        granted_at=consent.granted_at,
        revoked_at=None,
        seat_held=False,
        created=existing is None,
    )


@dataclass(frozen=True, slots=True)
class Revocation:
    college_id: uuid.UUID
    #: What this call ended: `ROSTER` then `INDIVIDUAL`, or just `INDIVIDUAL`.
    #: Empty on a retry.
    revoked: tuple[str, ...]
    revoked_at: datetime | None


async def revoke_consent(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    college_id: uuid.UUID,
    scope: str,
    request_id: str | None = None,
) -> Revocation:
    """The student withdraws consent. **Effective on the next statement.**

    Revoking ROSTER disconnects: the college stops counting the student, the
    seat it paid for is released (`release_seat_on_consent_revoke`) and any
    INDIVIDUAL grant ends with it (`revoke_individual_with_roster`), all in
    this one UPDATE. Revoking INDIVIDUAL leaves the link and the seat.

    Never deleted: the rows keep saying what was visible, to whom, until when.
    Not paywalled -- withdrawing consent never waits on a payment.
    Idempotent: nothing live to revoke is a 200 with nothing revoked, and a
    college the student never linked to is a 404.
    """
    user_id = await _bind_student(session, ctx)
    live = await _live_by_scope(session, tenant_id=college_id, candidate_id=user_id)
    ended = tuple(s for s in scopes_revoked_with(scope) if s in live)
    revoked_at = await repository.revoke_consent(
        session, tenant_id=college_id, candidate_id=user_id, scope=scope
    )
    if revoked_at is None:
        if not await repository.has_any_consent(
            session, tenant_id=college_id, candidate_id=user_id
        ):
            raise CollegeLinkNotFoundError()
        return Revocation(college_id=college_id, revoked=(), revoked_at=None)

    for ended_scope in ended:
        await audit_event(
            session,
            action=AuditAction.CONSENT_REVOKED,
            actor_id=user_id,
            actor_role=CANDIDATE,
            target_type="student_consent",
            target_id=live[ended_scope].id,
            tenant_id=college_id,
            request_id=request_id,
            metadata={"scope": ended_scope, "requested_scope": scope},
        )
    await emit(
        session,
        event_type=CONSENT_REVOKED,
        aggregate_type="student_consent",
        aggregate_id=live[scope].id,
        payload={"tenant_id": str(college_id), "scopes": list(ended)},
    )
    logger.info("college_consent_revoked", scopes=list(ended))
    return Revocation(college_id=college_id, revoked=ended, revoked_at=revoked_at)


# ---------------------------------------------------------------------------
# 6. Students who let their college see them -- the college's side
# ---------------------------------------------------------------------------
class CollegeStudentNotFoundError(NotFoundError):
    """No live INDIVIDUAL consent to this college: never given, revoked, or
    not this college's student. One answer for all three, so the route cannot
    be used to learn whether someone linked."""

    code = "college_student_not_found"
    title = "Student not found"


async def _name(
    session: AsyncSession,
    *,
    candidate_id: uuid.UUID,
    full_name: str | None,
    resume_version_id: uuid.UUID | None,
) -> str | None:
    """The name given at sign-up, else the one typed on the structured CV
    form, else none. Never guessed from a CV, as for an employer."""
    if full_name or resume_version_id is None:
        return full_name
    return await resume_service.declared_name(
        session, user_id=candidate_id, resume_version_id=resume_version_id
    )


@dataclass(frozen=True, slots=True)
class VisibleStudent:
    record_id: uuid.UUID
    candidate_id: uuid.UUID | None
    roster_entry_id: uuid.UUID | None
    full_name: str | None
    stage_since: datetime
    visible_since: datetime | None
    link_state: StudentLinkState


@dataclass(frozen=True, slots=True)
class VisibleStudentsPage:
    items: list[VisibleStudent]
    next_cursor: str | None


async def list_visible_students(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    cursor: str | None,
    limit: int | None,
    query: str | None = None,
    stage: StudentStageFilter = "ALL",
    request_id: str | None = None,
    now: datetime | None = None,
) -> VisibleStudentsPage:
    """The college's roster by link stage, oldest stage change first.

    LINKED names come only through live INDIVIDUAL consent. Earlier stages use
    names the college supplied in its own roster; candidate ids stay hidden.
    Every page is audited in the same transaction as the read.
    """
    tenant_id = await _bind(session, ctx)
    size = clamp_limit(limit)
    after: tuple[datetime, uuid.UUID] | None = None
    if cursor:
        decoded = decode_cursor(cursor)
        try:
            after = (datetime.fromisoformat(str(decoded["since"])), uuid.UUID(str(decoded["id"])))
        except (KeyError, ValueError) as exc:
            raise AppValidationError(code="invalid_cursor") from exc
    search = query.strip() if query and query.strip() else None
    selected_stages: tuple[StudentLinkState, ...] = (
        ("LINKED", "INVITED", "CONSENT_PENDING") if stage == "ALL" else (stage,)
    )
    items: list[VisibleStudent] = []

    if "LINKED" in selected_stages:
        rows = await repository.visible_students(
            session,
            limit=size + 1,
            after=after,
            query=search,
        )
        for row in rows:
            items.append(
                VisibleStudent(
                    record_id=row.candidate_id,
                    candidate_id=row.candidate_id,
                    roster_entry_id=None,
                    full_name=await _name(
                        session,
                        candidate_id=row.candidate_id,
                        full_name=row.full_name,
                        resume_version_id=row.score_resume_version_id,
                    ),
                    stage_since=row.visible_since,
                    visible_since=row.visible_since,
                    link_state="LINKED",
                )
            )

    now = _now(now)
    for roster_stage in ("INVITED", "CONSENT_PENDING"):
        if roster_stage not in selected_stages:
            continue
        roster_rows = await repository.roster_stage_students(
            session,
            tenant_id=tenant_id,
            stage=roster_stage,
            limit=size + 1,
            after=after,
            query=search,
            invited_after=now - INVITATION_VALID_FOR,
        )
        items.extend(
            VisibleStudent(
                record_id=row.roster_entry_id,
                candidate_id=None,
                roster_entry_id=row.roster_entry_id,
                full_name=row.full_name,
                stage_since=row.stage_since,
                visible_since=None,
                link_state=roster_stage,
            )
            for row in roster_rows
        )

    items.sort(key=lambda item: (item.stage_since, item.record_id))
    page = items[:size]
    if page:
        await audit_event(
            session,
            action=AuditAction.COLLEGE_STUDENTS_LISTED,
            actor_id=ctx.user_id,
            actor_role=ctx.role,
            target_type="tenant",
            target_id=tenant_id,
            tenant_id=tenant_id,
            request_id=request_id,
            metadata={
                "candidate_ids": [
                    str(item.candidate_id) for item in page if item.candidate_id is not None
                ],
                "roster_entry_ids": [
                    str(item.roster_entry_id) for item in page if item.roster_entry_id is not None
                ],
            },
        )
    next_cursor = None
    if len(items) > size:
        last = page[-1]
        next_cursor = encode_cursor(
            {"since": last.stage_since.isoformat(), "id": str(last.record_id)}
        )
    return VisibleStudentsPage(items=page, next_cursor=next_cursor)


@dataclass(frozen=True, slots=True)
class StudentHire:
    job_title: str
    employer_name: str
    hired_at: datetime
    employer_logo_url: str | None = None


@dataclass(frozen=True, slots=True)
class StudentView:
    candidate_id: uuid.UUID
    full_name: str | None
    visible_since: datetime
    #: The number a person is shown (`scoring.domain.display_value`), and its
    #: band. None until the student has a score.
    score: int | None
    band: str | None
    scored_at: datetime | None
    applications: int
    interviews: int
    hires: list[StudentHire]


async def open_student(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    candidate_id: uuid.UUID,
    request_id: str | None = None,
) -> StudentView:
    """One student, **only while their INDIVIDUAL consent is live** (SRS
    1.16.2), checked by the query itself on every read and never cached: a
    consent revoked a moment ago is a 404 now.

    **Audited on every open, re-opens included**, in the same transaction as
    the read, ids only -- and written before anything is returned, so a read
    whose audit failed never reaches the caller.
    """
    tenant_id = await _bind(session, ctx)
    row = await repository.student_profile(session, candidate_id=candidate_id)
    if row is None:
        raise CollegeStudentNotFoundError()
    hires = await repository.student_hires(session, candidate_id=candidate_id)
    hire_logos = await profile_images_service.logo_urls(
        session, tenant_ids=[h.employer_tenant_id for h in hires]
    )
    await audit_event(
        session,
        action=AuditAction.COLLEGE_STUDENT_VIEWED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=candidate_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"consent_id": str(row.consent_id)},
    )
    score = display_value(row.stored_score) if row.stored_score is not None else None
    return StudentView(
        candidate_id=row.candidate_id,
        full_name=await _name(
            session,
            candidate_id=row.candidate_id,
            full_name=row.full_name,
            resume_version_id=row.score_resume_version_id,
        ),
        visible_since=row.visible_since,
        score=score,
        band=band_for(score) if score is not None else None,
        scored_at=row.scored_at,
        applications=row.applications,
        interviews=row.interviews,
        hires=[
            StudentHire(
                h.job_title, h.employer_name, h.hired_at, hire_logos.get(h.employer_tenant_id)
            )
            for h in hires
        ],
    )


# ---------------------------------------------------------------------------
# A student's details, CV, courses and applications (2026-09-29)
# ---------------------------------------------------------------------------
# Asked for by the client. **Served only under INDIVIDUAL consent to the
# current words** (`INDIVIDUAL_DETAILS_VERSIONS`), which name every one of
# these, and read only through the consent-joined functions in migration 0005.
# A student who agreed to version 1 keeps version 1's view: 409 here, with the
# consent version the college should ask them to accept.


class StudentDetailsNotSharedError(ConflictError):
    """The student lets the college see them under earlier words, which did
    not include these details. Only the student can agree to the new ones."""

    code = "college_student_details_not_shared"
    title = "This student has not agreed to share these details"


async def _details_gate(
    session: AsyncSession, ctx: TenantContext, candidate_id: uuid.UUID
) -> tuple[uuid.UUID, repository.StudentDetailsRow]:
    tenant_id = await _bind(session, ctx)
    details = await repository.student_details(session, candidate_id=candidate_id)
    if details is None:
        if await repository.student_profile(session, candidate_id=candidate_id) is None:
            raise CollegeStudentNotFoundError()
        raise StudentDetailsNotSharedError(params={"consent_version": INDIVIDUAL_CONSENT_VERSION})
    return tenant_id, details


@dataclass(frozen=True, slots=True)
class StudentCourse:
    code: str
    title: str
    purchased_at: datetime
    lessons_total: int
    lessons_completed: int
    completed_at: datetime | None

    @property
    def percent_complete(self) -> int:
        if self.lessons_total <= 0:
            return 0
        return (100 * min(self.lessons_completed, self.lessons_total)) // self.lessons_total


@dataclass(frozen=True, slots=True)
class StudentApplication:
    job_title: str
    employer_name: str
    job_location: str | None
    stage: str
    applied_at: datetime
    updated_at: datetime
    employer_logo_url: str | None = None


@dataclass(frozen=True, slots=True)
class StudentDetails:
    candidate_id: uuid.UUID
    consent_version: str
    email: str | None
    phone: str | None
    city: str | None
    state_code: str | None
    locale: str
    questionnaire: dict[str, Any]
    questionnaire_submitted_at: datetime | None
    resume_confirmed_at: datetime | None
    has_resume_file: bool
    interviews_completed: int
    courses: list[StudentCourse]
    applications: list[StudentApplication]
    reached: dict[str, int]


async def open_student_details(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    candidate_id: uuid.UUID,
    request_id: str | None = None,
) -> StudentDetails:
    """Everything the current consent words name beyond the core view.
    Audited like every open, in the transaction, before anything is returned."""
    tenant_id, row = await _details_gate(session, ctx, candidate_id)
    courses = await repository.student_courses(session, candidate_id=candidate_id)
    applications, reached = await repository.student_applications(
        session, candidate_id=candidate_id
    )
    application_logos = await profile_images_service.logo_urls(
        session, tenant_ids=[a.employer_tenant_id for a in applications]
    )
    await audit_event(
        session,
        action=AuditAction.COLLEGE_STUDENT_VIEWED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=candidate_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"consent_id": str(row.consent_id), "view": "details"},
    )
    return StudentDetails(
        candidate_id=candidate_id,
        consent_version=row.consent_version,
        email=row.email,
        phone=row.phone,
        city=row.city,
        state_code=row.state_code,
        locale=row.locale,
        questionnaire=row.questionnaire,
        questionnaire_submitted_at=row.questionnaire_submitted_at,
        resume_confirmed_at=row.resume_confirmed_at,
        has_resume_file=row.resume_s3_key is not None,
        interviews_completed=row.interviews_completed,
        courses=[
            StudentCourse(
                c.course_code,
                c.title,
                c.purchased_at,
                c.lessons_total,
                c.lessons_completed,
                c.completed_at,
            )
            for c in courses
        ],
        applications=[
            StudentApplication(
                a.job_title,
                a.employer_name,
                a.job_location,
                a.stage,
                a.applied_at,
                a.updated_at,
                application_logos.get(a.employer_tenant_id),
            )
            for a in applications
        ],
        reached=reached,
    )


@dataclass(frozen=True, slots=True)
class StudentResume:
    confirmed_at: datetime | None
    source: str
    text: str | None
    fields: dict[str, Any]
    structured_resume: StructuredResume | None
    structured_status: StructuredStatus
    file_url: str | None
    file_mime: str | None


async def open_student_resume(
    session: AsyncSession,
    *,
    ctx: TenantContext,
    candidate_id: uuid.UUID,
    request_id: str | None = None,
    settings: Settings | None = None,
) -> StudentResume:
    """The CV the student's score was built from: the newest confirmed
    version, as text, and the uploaded file by a presigned GET that expires.
    Its own audit row: a CV is a larger reveal than the profile."""
    settings = settings or get_settings()
    tenant_id, row = await _details_gate(session, ctx, candidate_id)
    if row.resume_source is None:
        raise CollegeStudentResumeNotFoundError()
    await audit_event(
        session,
        action=AuditAction.COLLEGE_STUDENT_RESUME_OPENED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="user",
        target_id=candidate_id,
        tenant_id=tenant_id,
        request_id=request_id,
        metadata={"consent_id": str(row.consent_id)},
    )
    parsed = row.resume_parsed or {}
    body = parsed.get("raw_text")
    structured, structured_status = structured_view(parsed)
    return StudentResume(
        confirmed_at=row.resume_confirmed_at,
        source=row.resume_source,
        text=body if isinstance(body, str) else None,
        fields=resume_service.shared_fields(parsed),
        structured_resume=structured,
        structured_status=structured_status,
        file_url=(
            await storage.presign_get(
                bucket=settings.s3_bucket_resumes,
                key=row.resume_s3_key,
                expires_in=settings.presigned_url_ttl_seconds,
            )
            if row.resume_s3_key
            else None
        ),
        file_mime=row.resume_mime,
    )


class CollegeStudentResumeNotFoundError(NotFoundError):
    code = "college_student_resume_not_found"
    title = "This student has no confirmed CV yet"
