"""identity - business rules and transaction boundaries

Users, sessions, Cognito linkage, memberships.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import membership as membership_lookup
from app.core.auth.directory import DirectoryError, InviteOutcome, get_account_directory
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.logging import get_logger
from app.core.ratelimit import enforce
from app.modules.identity import repository
from app.modules.identity.domain import PLATFORM_ROLES, suspendable

logger = get_logger(__name__)

OTP_WINDOW_SECONDS = 3600


async def start_otp_challenge(*, phone: str, client_ip: str | None) -> int:
    """Throttle an OTP request, then let the client proceed to Cognito.

    **Deferred by the client (2026-09-18): there is no phone OTP today.** The
    route in front of this is registered only when `AUTH_PHONE_OTP_ENABLED`
    is set, and nothing sets it; sign-in is email and password on both pools.
    Kept, and tested directly, so that switching phone OTP on later is the
    Lambda triggers and a flag rather than a rebuild.

    **Two counters, not one, and both are needed.** Per-phone stops someone
    hammering one victim's number into a flood of login texts. Per-IP stops
    someone walking the number space -- which the per-phone limit alone would
    happily allow, five messages at a time, across every number in India.

    This service does not call Twilio and does not send anything. The client
    goes to Cognito next; Cognito's custom-auth Lambdas call Twilio Verify.
    We are the outer throttle in front of that, and nothing else
    (docs/plan.md 5.8).

    Returns the window length, so the client can render a resend timer that
    matches the server's actual behaviour rather than guessing.
    """
    await enforce("otp.phone", subject=phone)
    if client_ip:
        await enforce("otp.ip", subject=client_ip)

    # Logged without the number. A phone number in an application log is
    # personal data sitting in a system with far broader access than the
    # database, and DPDP does not care that it was convenient.
    logger.info("otp_challenge_allowed")
    return OTP_WINDOW_SECONDS


async def grant_membership(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    role: str,
) -> None:
    """Add or restore a membership, then drop the cached lookup.

    The cache invalidation is not an optimisation. Without it a newly added
    recruiter waits up to 60 seconds before their access works, and support
    gets a ticket about it every single time.
    """
    await repository.upsert_membership(session, user_id=user_id, tenant_id=tenant_id, role=role)
    await membership_lookup.invalidate(user_id)


async def revoke_membership(
    session: AsyncSession, *, user_id: uuid.UUID, tenant_id: uuid.UUID
) -> None:
    """Revoke access, then drop the cached lookup.

    Here the invalidation matters far more than it does on grant: the whole
    argument for reading membership from our database rather than from a token
    claim is that revocation takes effect promptly. Sixty seconds is the
    backstop if this fails; it is not meant to be the normal path.
    """
    await repository.revoke_membership(session, user_id=user_id, tenant_id=tenant_id)
    await membership_lookup.invalidate(user_id)


# ---------------------------------------------------------------------------
# Tenants and teams (Day 9)
# ---------------------------------------------------------------------------
EMPLOYER_OWNER_ROLE = "EMPLOYER_OWNER"
EMPLOYER_TEAM_ROLES: frozenset[str] = frozenset(
    {"EMPLOYER_OWNER", "EMPLOYER_RECRUITER", "EMPLOYER_VIEWER"}
)
#: A college's team (Day 17). The admin plays the owner's part: it runs the
#: team, the subscription and the referral codes; staff import rosters.
COLLEGE_ADMIN_ROLE = "COLLEGE_ADMIN"
COLLEGE_TEAM_ROLES: frozenset[str] = frozenset({"COLLEGE_ADMIN", "COLLEGE_STAFF"})


class AlreadyInOrganisationError(ConflictError):
    """The account already belongs to an organisation, including a suspended one."""

    code = "identity_already_in_organisation"
    title = "Account already belongs to an organisation"


class AlreadyAMemberError(ConflictError):
    code = "identity_already_a_member"
    title = "Already a member of this organisation"


class CannotAddMemberError(ConflictError):
    """**One refusal for every reason that is about someone else's account.**

    The address might belong to a candidate, or to a member of another
    employer. Saying which would let any employer test whether a person is
    registered on the platform -- an enumeration oracle for exactly the
    people whose contact details the product exists to protect. The caller
    learns only that this address cannot be added.

    Residual, stated rather than hidden: "cannot be added" still differs from
    success, so an owner can learn that an address exists *somewhere*. Closing
    that needs an accept-by-link invitation, which does not exist yet.
    """

    code = "identity_cannot_add_member"
    title = "This address cannot be added"


class MemberNotFoundError(NotFoundError):
    code = "identity_member_not_found"
    title = "Team member not found"


class LastOwnerError(ConflictError):
    """An organisation must always have an owner. Without one, nobody can add
    staff, change roles, or close the account, and only a platform admin with
    a database session can recover it."""

    code = "identity_last_owner"
    title = "An organisation needs at least one owner"


class AccountExistsError(ConflictError):
    """Staff asked for an account that exists already. Staff may know that --
    this is our console, not a public form -- so it says so plainly."""

    code = "identity_account_exists"
    title = "An account with this email already exists"


class AccountAlreadyActiveError(ConflictError):
    """The invitation cannot be sent again: the person has signed in, so the
    temporary password is gone and they use their own."""

    code = "identity_account_already_active"
    title = "This account has already signed in"


class AccountDirectoryUnavailableError(AppError):
    """Cognito refused or could not be reached. Nothing was created: the rows
    written in this transaction roll back with the error."""

    status_code = status.HTTP_502_BAD_GATEWAY
    code = "account_directory_unavailable"
    title = "The sign-in service could not create the account"


@dataclass(frozen=True, slots=True)
class TeamMember:
    user_id: uuid.UUID
    email: str | None
    role: str
    added_at: datetime


def normalise_email(email: str) -> str:
    return email.strip().lower()


async def create_tenant_with_owner(
    session: AsyncSession,
    *,
    owner_user_id: uuid.UUID,
    tenant_type: str,
    name: str,
    owner_role: str,
) -> uuid.UUID:
    """Create a tenant and make the caller its owner, atomically.

    **One organisation per account.** `membership.resolve` answers "which
    tenant is this caller acting for?" with a single row, so a second
    membership would make that answer depend on row order.
    """
    await repository.lock_user(session, user_id=owner_user_id)
    if await repository.active_membership(session, user_id=owner_user_id) is not None:
        raise AlreadyInOrganisationError()

    tenant_id = await repository.create_tenant(session, tenant_type=tenant_type, name=name)
    await grant_membership(session, user_id=owner_user_id, tenant_id=tenant_id, role=owner_role)
    logger.info("tenant_created", tenant_id=str(tenant_id), tenant_type=tenant_type)
    return tenant_id


async def employer_tenant_ids(session: AsyncSession) -> list[uuid.UUID]:
    """Every employer organisation, whatever its status. **For system sweeps only.**

    The one place a tenant id comes from a table rather than a membership:
    the application-expiry sweep has no caller, and binds each of these in
    turn. `tenants` is not under RLS, and this returns identifiers only.
    Suspended employers are included -- a suspended employer is the most
    silent of all, and its candidates should be released too.
    """
    return await repository.tenant_ids_of_type(session, tenant_type="EMPLOYER")


async def rename_tenant(session: AsyncSession, *, tenant_id: uuid.UUID, name: str) -> None:
    await repository.rename_tenant(session, tenant_id=tenant_id, name=name)


async def list_team(session: AsyncSession, *, tenant_id: uuid.UUID) -> list[TeamMember]:
    rows = await repository.list_active_members(session, tenant_id=tenant_id)
    return [
        TeamMember(
            user_id=user.id, email=user.email, role=membership.role, added_at=membership.created_at
        )
        for membership, user in rows
    ]


async def add_team_member(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    email: str,
    role: str,
    team_roles: frozenset[str] = EMPLOYER_TEAM_ROLES,
) -> TeamMember:
    """Invite by email. The person gets access the first time they sign in.

    Business accounts are provisioned, not self-registered (the business
    Cognito pool is admin-create-only), so an address with no account yet gets
    one here and waits to be claimed.
    """
    if role not in team_roles:
        raise CannotAddMemberError()

    address = normalise_email(email)
    user = await repository.user_by_email(session, email=address)
    if user is None:
        user = await repository.create_business_user(session, email=address)
    if user.pool != "BUSINESS":
        # A candidate. The email column is unique across both pools, so one
        # address cannot be a candidate and a recruiter at once.
        raise CannotAddMemberError()

    await repository.lock_user(session, user_id=user.id)
    current = await repository.active_membership(session, user_id=user.id)
    if current is not None:
        if current.tenant_id == tenant_id:
            raise AlreadyAMemberError()
        raise CannotAddMemberError()

    await grant_membership(session, user_id=user.id, tenant_id=tenant_id, role=role)
    membership = await repository.get_membership(session, user_id=user.id, tenant_id=tenant_id)
    if membership is None:  # pragma: no cover - just written on this transaction
        raise MemberNotFoundError()
    if user.cognito_sub is None:
        # Never signed in: ask Cognito for their sign-in, which emails the
        # temporary password. Last, so a refusal above sends nobody an email.
        await send_invitation(pool="BUSINESS", email=address)
    return TeamMember(user_id=user.id, email=user.email, role=role, added_at=membership.created_at)


# ---------------------------------------------------------------------------
# Accounts made on someone's behalf (2026-09-18)
# ---------------------------------------------------------------------------
# Staff create a candidate, or an organisation with its first owner, from the
# console. Each is a `users` row with no `cognito_sub` -- the same "waiting to
# be claimed" row a team invitation has always made -- plus a Cognito user
# whose temporary password Cognito emails. The first sign-in adopts the row
# by email (`app.core.auth.users._adopt_unlinked`, same pool only).
#
# Self-registration is unchanged beside this: a person who signs up in the
# app gets their row on first sign-in, as before.

InvitationPool = Literal["CANDIDATE", "BUSINESS"]


async def send_invitation(*, pool: InvitationPool, email: str) -> InviteOutcome:
    """Ask Cognito for a sign-in for `email`. Raises
    `AccountDirectoryUnavailableError`, which rolls the caller's rows back."""
    try:
        outcome = await get_account_directory().invite(pool=pool, email=email)
    except DirectoryError as exc:
        logger.error("account_invitation_failed", pool=pool, code=exc.code)
        raise AccountDirectoryUnavailableError(params={"reason": exc.code}) from exc
    logger.info("account_invitation", pool=pool, outcome=outcome)
    return outcome


async def create_candidate_account(session: AsyncSession, *, email: str) -> uuid.UUID:
    """A candidate account for `email`, waiting to be claimed. Refused if the
    address has any account already -- staff should tell that person to sign
    in, not make them a second one.

    **Sends nothing**, like `provision_business_user`: the caller writes
    whatever else it has, then invites last (`invitation_outcome_for`), so a
    refusal in between emails nobody."""
    address = normalise_email(email)
    if await repository.user_by_email(session, email=address) is not None:
        raise AccountExistsError()
    user = await repository.create_candidate_user(session, email=address)
    if user.pool != "CANDIDATE" or user.cognito_sub is not None:
        # Lost a race with another request for the same address.
        raise AccountExistsError()
    return user.id


async def provision_business_user(session: AsyncSession, *, email: str) -> uuid.UUID:
    """A business account for `email` that belongs to no organisation yet,
    ready to be made one's owner. An existing business account with no
    organisation is reused; anything else is refused. **Sends nothing** --
    the caller invites once the organisation exists, so a refusal there
    emails nobody."""
    address = normalise_email(email)
    user = await repository.user_by_email(session, email=address)
    if user is None:
        user = await repository.create_business_user(session, email=address)
    if user.pool != "BUSINESS":
        raise AccountExistsError()
    await repository.lock_user(session, user_id=user.id)
    if await repository.active_membership(session, user_id=user.id) is not None:
        raise AlreadyInOrganisationError()
    return user.id


async def invitation_outcome_for(session: AsyncSession, *, user_id: uuid.UUID) -> InviteOutcome:
    """Invite a provisioned business owner. One who has signed in before is
    ALREADY_REGISTERED without a call: they have a password."""
    user = await repository.get_user(session, user_id)
    if user is None or user.email is None:  # pragma: no cover - just provisioned
        raise MemberNotFoundError()
    if user.cognito_sub is not None:
        return "ALREADY_REGISTERED"
    pool: InvitationPool = "BUSINESS" if user.pool == "BUSINESS" else "CANDIDATE"
    return await send_invitation(pool=pool, email=user.email)


async def has_signed_in(session: AsyncSession, *, user_id: uuid.UUID) -> bool:
    """Whether this account has ever been claimed by a sign-in."""
    user = await repository.get_user(session, user_id)
    return user is not None and user.cognito_sub is not None


async def resend_invitation(session: AsyncSession, *, user_id: uuid.UUID) -> str:
    """Send a provisioned account's temporary password again, for one that
    has never signed in. Returns the pool."""
    user = await repository.get_user(session, user_id)
    if user is None or user.email is None or user.status != "ACTIVE":
        raise MemberNotFoundError()
    if user.cognito_sub is not None:
        raise AccountAlreadyActiveError()
    pool: InvitationPool = "BUSINESS" if user.pool == "BUSINESS" else "CANDIDATE"
    try:
        await get_account_directory().resend_invitation(pool=pool, email=user.email)
    except DirectoryError as exc:
        logger.error("account_invitation_resend_failed", pool=pool, code=exc.code)
        raise AccountDirectoryUnavailableError(params={"reason": exc.code}) from exc
    return pool


async def _ensure_another_owner(
    session: AsyncSession, *, tenant_id: uuid.UUID, leaving_user_id: uuid.UUID, owner_role: str
) -> None:
    owners = await repository.lock_active_holders_of_role(
        session, tenant_id=tenant_id, role=owner_role
    )
    if not any(owner != leaving_user_id for owner in owners):
        raise LastOwnerError()


async def _active_member(
    session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[object, object]:
    membership = await repository.get_membership(session, user_id=user_id, tenant_id=tenant_id)
    if membership is None or membership.status != "ACTIVE":
        raise MemberNotFoundError()
    user = await repository.get_user(session, user_id)
    if user is None:  # pragma: no cover - the membership's foreign key guarantees it
        raise MemberNotFoundError()
    return membership, user


async def change_member_role(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    role: str,
    team_roles: frozenset[str] = EMPLOYER_TEAM_ROLES,
    owner_role: str = EMPLOYER_OWNER_ROLE,
) -> TeamMember:
    if role not in team_roles:
        raise MemberNotFoundError()
    membership = await repository.get_membership(session, user_id=user_id, tenant_id=tenant_id)
    if membership is None or membership.status != "ACTIVE":
        raise MemberNotFoundError()
    if membership.role == owner_role and role != owner_role:
        await _ensure_another_owner(
            session, tenant_id=tenant_id, leaving_user_id=user_id, owner_role=owner_role
        )

    await grant_membership(session, user_id=user_id, tenant_id=tenant_id, role=role)
    user = await repository.get_user(session, user_id)
    return TeamMember(
        user_id=user_id,
        email=user.email if user is not None else None,
        role=role,
        added_at=membership.created_at,
    )


async def remove_team_member(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    owner_role: str = EMPLOYER_OWNER_ROLE,
) -> None:
    """Revoke, never delete -- the row is the evidence of who could see what,
    and when. The cached membership is dropped so access ends on the next
    request, not a minute later."""
    membership = await repository.get_membership(session, user_id=user_id, tenant_id=tenant_id)
    if membership is None or membership.status != "ACTIVE":
        raise MemberNotFoundError()
    if membership.role == owner_role:
        await _ensure_another_owner(
            session, tenant_id=tenant_id, leaving_user_id=user_id, owner_role=owner_role
        )
    await revoke_membership(session, user_id=user_id, tenant_id=tenant_id)


# ---------------------------------------------------------------------------
# Day 19 -- platform staff, tenants for the console, suspension
# ---------------------------------------------------------------------------
class TenantNotFoundError(NotFoundError):
    code = "identity_tenant_not_found"
    title = "Organisation not found"


class TenantNotSuspendableError(ConflictError):
    """Our own staff tenant. See `domain.suspendable`."""

    code = "identity_tenant_not_suspendable"
    title = "This organisation cannot be suspended"


class TenantAlreadySuspendedError(ConflictError):
    code = "identity_tenant_already_suspended"
    title = "This organisation is already suspended"


class TenantNotSuspendedError(ConflictError):
    code = "identity_tenant_not_suspended"
    title = "This organisation is not suspended"


@dataclass(frozen=True, slots=True)
class TenantView:
    id: uuid.UUID
    type: str
    name: str
    status: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class SuspensionView:
    id: uuid.UUID
    tenant_id: uuid.UUID
    reason: str
    suspended_by: uuid.UUID
    suspended_at: datetime
    lifted_by: uuid.UUID | None
    lifted_at: datetime | None


@dataclass(frozen=True, slots=True)
class Contact:
    """How to reach one account. No response schema carries one."""

    user_id: uuid.UUID
    pool: str
    status: str
    phone: str | None
    email: str | None
    locale: str


def _tenant(row: Any) -> TenantView:
    return TenantView(
        id=row.id, type=row.type, name=row.name, status=row.status, created_at=row.created_at
    )


def _suspension(row: Any) -> SuspensionView:
    return SuspensionView(
        id=row.id,
        tenant_id=row.tenant_id,
        reason=row.reason,
        suspended_by=row.suspended_by,
        suspended_at=row.suspended_at,
        lifted_by=row.lifted_by,
        lifted_at=row.lifted_at,
    )


async def get_tenant(session: AsyncSession, *, tenant_id: uuid.UUID) -> TenantView:
    row = await repository.get_tenant(session, tenant_id=tenant_id)
    if row is None:
        raise TenantNotFoundError()
    return _tenant(row)


async def list_tenants(
    session: AsyncSession,
    *,
    tenant_type: str | None,
    status: str | None,
    name_contains: str | None,
    after: tuple[str, uuid.UUID] | None,
    limit: int,
) -> list[TenantView]:
    rows = await repository.list_tenants(
        session,
        tenant_type=tenant_type,
        status=status,
        name_contains=name_contains,
        after=after,
        limit=limit,
    )
    return [_tenant(row) for row in rows]


async def member_ids(
    session: AsyncSession, *, tenant_id: uuid.UUID, roles: frozenset[str] | None = None
) -> list[uuid.UUID]:
    """Active members of a tenant, optionally only those holding `roles`.
    Identifiers only: a notification resolves the contact separately."""
    return await repository.active_member_ids(session, tenant_id=tenant_id, roles=roles)


async def member_role_counts(session: AsyncSession, *, tenant_id: uuid.UUID) -> dict[str, int]:
    return await repository.member_role_counts(session, tenant_id=tenant_id)


async def provision_platform_staff(
    session: AsyncSession, *, email: str, role: str
) -> tuple[uuid.UUID, uuid.UUID]:
    """Make an address a member of our staff. **Has no route, deliberately.**

    Run by `scripts/create_platform_staff.py` as the migrator. A route that
    grants staff roles would be the one endpoint worth attacking, and nobody
    adds a colleague so often that a script is a burden. The Cognito user is
    created in the business pool separately (admin-create-only); on first
    sign-in it adopts this row by email, as an invited recruiter does.

    Returns `(tenant_id, user_id)`.
    """
    if role not in PLATFORM_ROLES:
        raise ValueError(f"{role} is not a platform role: {sorted(PLATFORM_ROLES)}")
    tenant_id = await repository.create_platform_tenant(session)
    address = normalise_email(email)
    user = await repository.user_by_email(session, email=address)
    if user is None:
        user = await repository.create_business_user(session, email=address)
    if user.pool != "BUSINESS":
        raise CannotAddMemberError()
    await repository.lock_user(session, user_id=user.id)
    current = await repository.active_membership(session, user_id=user.id)
    if current is not None and current.tenant_id != tenant_id:
        raise AlreadyInOrganisationError()
    await grant_membership(session, user_id=user.id, tenant_id=tenant_id, role=role)
    return tenant_id, user.id


async def suspend_tenant(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    reason: str,
    suspended_by: uuid.UUID,
    now: datetime,
) -> SuspensionView:
    """Stop an organisation operating. Deletes nothing.

    The row is the switch: `membership.resolve` refuses every member of a
    tenant with an open suspension, and `guard_tenant_suspension_write` marks
    the tenant SUSPENDED in the same statement. The members' cached
    memberships are distrusted before this returns, so the next request of
    any of them is refused (`membership.mark_tenant_changed`).
    """
    tenant = await repository.get_tenant(session, tenant_id=tenant_id)
    if tenant is None:
        raise TenantNotFoundError()
    if not suspendable(tenant.type):
        raise TenantNotSuspendableError()
    row = await repository.insert_suspension(
        session, tenant_id=tenant_id, reason=reason, suspended_by=suspended_by, now=now
    )
    if row is None:
        raise TenantAlreadySuspendedError()
    await membership_lookup.mark_tenant_changed(
        tenant_id, await repository.active_member_ids(session, tenant_id=tenant_id)
    )
    logger.info("tenant_suspended", tenant_id=str(tenant_id), tenant_type=tenant.type)
    return _suspension(row)


async def reinstate_tenant(
    session: AsyncSession, *, tenant_id: uuid.UUID, lifted_by: uuid.UUID, now: datetime
) -> SuspensionView:
    if await repository.get_tenant(session, tenant_id=tenant_id) is None:
        raise TenantNotFoundError()
    row = await repository.lift_suspension(
        session, tenant_id=tenant_id, lifted_by=lifted_by, now=now
    )
    if row is None:
        raise TenantNotSuspendedError()
    await membership_lookup.mark_tenant_changed(
        tenant_id, await repository.active_member_ids(session, tenant_id=tenant_id)
    )
    logger.info("tenant_reinstated", tenant_id=str(tenant_id))
    return _suspension(row)


async def suspensions_for(session: AsyncSession, *, tenant_id: uuid.UUID) -> list[SuspensionView]:
    rows = await repository.suspensions_for(session, tenant_id=tenant_id)
    return [_suspension(row) for row in rows]


async def contacts(session: AsyncSession, *, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, Contact]:
    """Phone, email and language for delivering a message. **For notifications
    only**; no response schema carries a `Contact`."""
    return {
        user.id: Contact(
            user_id=user.id,
            pool=user.pool,
            status=user.status,
            phone=user.phone,
            email=user.email,
            locale=user.locale,
        )
        for user in await repository.users_by_ids(session, user_ids=user_ids)
    }


async def email_of(session: AsyncSession, *, user_id: uuid.UUID) -> str | None:
    """The caller's own address, for `/auth/me`. Never for anyone else's."""
    user = await repository.get_user(session, user_id)
    return user.email if user is not None else None


async def set_locale(session: AsyncSession, *, user_id: uuid.UUID, locale: str) -> None:
    """The caller's language, already validated against the shipped locales."""
    await repository.set_locale(session, user_id=user_id, locale=locale)


async def candidates_signed_up_before(
    session: AsyncSession, *, before: datetime, after_id: uuid.UUID | None, limit: int
) -> list[uuid.UUID]:
    """Candidate accounts older than `before`, for the incomplete-profile sweep."""
    return await repository.candidates_signed_up_before(
        session, before=before, after_id=after_id, limit=limit
    )
