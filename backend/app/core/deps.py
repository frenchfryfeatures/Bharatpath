"""FastAPI dependencies: authentication, role, tenant, and the paid gates.

The gate hierarchy matters and the pieces must not be merged. As of v6 an
employer passes through up to three independent checks, and they fail
differently and return different error codes:

  1. `current_user`               - a verified JWT from the correct pool
  2. `require_role(...)`          - role read from OUR memberships table
     `require_permission(...)`    - for our staff: a permission their role
                                    assignments grant (2026-11-19)
  3. `require_active_subscription`- pay-first, all three audiences (R13)
  4. `require_active_access_window` - the employer's paid period (R14)

Conflating 3 and 4, or 4 and KYB, produces an error message that tells the user
the wrong thing to do about it.

**The KYB gate (invariant 8 / R15) is deliberately NOT a dependency here.**
It cannot be: deciding it means reading `employers.kyb_status`, and
`app.core` may not import `app.modules` -- the `core-depends-on-nothing`
contract in `.importlinter`. The check lives where the row can be read:

  * `jobs.service.publish_job`        - invariant 8, re-checked on resume
  * `discovery.service._verified_employer` - search and the reveal (SRS 1.14.1)

plus the `guard_job_publish` trigger, which refuses a PUBLISHED row for an
unapproved employer for every writer including the migrator. Add the next
one beside those, not here.
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated
from urllib.parse import unquote
from uuid import UUID

from fastapi import Depends, Header, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.audit import AuditAction, audit_event
from app.core.auth import membership as membership_lookup
from app.core.auth import staff_access
from app.core.auth.directory import DirectoryError, get_account_directory
from app.core.auth.provider import get_identity_provider
from app.core.auth.tokens import VerifiedToken
from app.core.auth.users import AuthenticatedUser, resolve_or_create_user
from app.core.db import get_db
from app.core.entitlements import has_active_college_seat, has_active_subscription
from app.core.errors import (
    AccessWindowExpiredError,
    AppError,
    PermissionDeniedError,
    SubscriptionRequiredError,
    UnauthenticatedError,
)
from app.core.staff_permissions import (
    BY_KEY,
    PLATFORM_STAFF,
    REASON_HEADER,
    REASON_MAX_LENGTH,
    REASON_MIN_LENGTH,
)
from app.core.tenant import Membership, TenantContext
from app.settings import get_settings

# --- roles, SRS 1.2 -------------------------------------------------------
CANDIDATE = "CANDIDATE"
EMPLOYER_OWNER = "EMPLOYER_OWNER"
EMPLOYER_RECRUITER = "EMPLOYER_RECRUITER"
EMPLOYER_VIEWER = "EMPLOYER_VIEWER"
COLLEGE_ADMIN = "COLLEGE_ADMIN"
COLLEGE_STAFF = "COLLEGE_STAFF"
# Every member of our staff holds PLATFORM_STAFF (2026-11-19, imported above
# from `staff_permissions`). What they may do is their role assignments,
# checked by `require_permission`, never the membership role.

ALL_ROLES: frozenset[str] = frozenset(
    {
        CANDIDATE,
        EMPLOYER_OWNER,
        EMPLOYER_RECRUITER,
        EMPLOYER_VIEWER,
        COLLEGE_ADMIN,
        COLLEGE_STAFF,
        PLATFORM_STAFF,
    }
)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def _authenticate(
    session: AsyncSession, authorization: str | None
) -> tuple[AuthenticatedUser, VerifiedToken]:
    """Steps 1 and 2 of `current_user`: verify the token, resolve the user.

    Shared with `current_business_identity` so the two can never disagree
    about what a valid credential is. A second copy of this is exactly where
    the `account_inactive` check would quietly go missing.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise UnauthenticatedError()

    raw_token = authorization[7:].strip()
    if not raw_token:
        raise UnauthenticatedError()

    provider = get_identity_provider()
    token = await provider.verify(raw_token)  # raises InvalidTokenError

    user = await resolve_or_create_user(
        session, provider=provider, raw_token=raw_token, token=token
    )
    if user.status != "ACTIVE":
        # Suspended and deleted users hold tokens that are still
        # cryptographically valid. The account state is ours to enforce.
        raise UnauthenticatedError(code="account_inactive")
    return user, token


async def current_user(
    session: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> TenantContext:
    """Verify the bearer token, then resolve role and tenant from OUR database.

    Three steps, and the order matters:

      1. Verify the token. Signature, issuer, audience, `token_use`, expiry.
         Whoever issued it -- Cognito in a deployed environment, the local
         provider on a laptop -- answers only "who is this".
      2. Resolve the user row from `cognito_sub`. A verified token for a
         subject we have never seen is a first sign-in, and creates the row.
      3. Read the membership from `memberships`, Redis-cached for 60 seconds.
         **Not from a token claim**, because a claim goes stale and a
         revocation that does not take effect is the tenant-isolation failure
         SRS 2.24.7 forbids.

    The pool is checked against the role in step 3. A candidate-pool token can
    never carry a business role, whatever any row says, because the two pools
    are different authentication models with different assurance -- the
    business pool has a stricter password policy, shorter sessions and the
    user's own software-token MFA (optional since 2026-10-07), none of which
    the candidate pool applies.
    """
    user, token = await _authenticate(session, authorization)

    membership = await membership_lookup.resolve(session, user.id)

    if token.pool == "CANDIDATE":
        # Candidates belong to no tenant. A membership row against a
        # candidate-pool identity means someone has been granted staff access
        # to an account that never passed the business pool's sign-in (and
        # the MFA its owner may have turned on), so it is refused rather
        # than honoured.
        if membership is not None:
            raise PermissionDeniedError(code="pool_role_mismatch")
        ctx = TenantContext(user_id=user.id, tenant_id=None, role=CANDIDATE, pool=token.pool)
        await _global_limits(ctx)
        return ctx

    if membership is None:
        # A verified business identity with no active membership: invited but
        # not yet added, just revoked, or a member of a suspended organisation
        # -- who is told so, because "you belong nowhere" would send
        # them to their owner rather than to us.
        if await membership_lookup.in_suspended_tenant(session, user.id):
            raise PermissionDeniedError(code="tenant_suspended")
        raise PermissionDeniedError(code="no_active_membership")
    if membership.role == CANDIDATE:
        raise PermissionDeniedError(code="pool_role_mismatch")

    # Our staff: what they may do is their role assignments, read from the
    # database on the same terms as the membership (`auth/staff_access.py`).
    staff = (
        await staff_access.resolve(session, user.id) if membership.role == PLATFORM_STAFF else None
    )
    ctx = TenantContext(
        user_id=user.id,
        tenant_id=membership.tenant_id,
        role=membership.role,
        pool=token.pool,
        staff=staff,
        auth_time=token.auth_time,
    )
    await _global_limits(ctx)
    return ctx


async def _global_limits(ctx: TenantContext) -> None:
    """The per-user and per-tenant tier of the global limit.

    Here, once, because every authenticated route resolves `current_user`
    exactly once per request -- FastAPI caches a dependency within a request --
    so this counts requests rather than dependency lookups. After the
    membership is resolved and not before, so a tenant's budget is charged
    only by that tenant's real members.
    """
    if not get_settings().rate_limit_global_enabled:
        return
    await ratelimit.enforce("global.user", subject=str(ctx.user_id))
    if ctx.tenant_id is not None:
        await ratelimit.enforce("global.tenant", subject=str(ctx.tenant_id))


CurrentUser = Annotated[TenantContext, Depends(current_user)]


def rate_limit(name: str) -> Callable[[TenantContext], Awaitable[None]]:
    """A route dependency applying one named policy from `ratelimit.policies`
    to the caller -- by user or by tenant, as the policy says. Fails closed."""
    policy = ratelimit.policies()[name]
    if policy.scope not in (ratelimit.Scope.USER, ratelimit.Scope.TENANT):
        raise ValueError(f"{name} is not a per-user or per-tenant policy")

    async def _limit(user: CurrentUser) -> None:
        subject = user.tenant_id if policy.scope is ratelimit.Scope.TENANT else user.user_id
        await ratelimit.enforce(name, subject=str(subject or user.user_id))

    return _limit


@dataclass(frozen=True, slots=True)
class BusinessIdentity:
    """A verified business-pool account, **with or without a membership**.

    `current_user` refuses a business account that belongs to no tenant --
    rightly, for every route that reads tenant data. But that makes the first
    step of employer onboarding unreachable: an account cannot create its
    organisation if it must already belong to one.

    So this exists, and it is deliberately **not** a `TenantContext`. It has
    no role and no tenant id to confuse with one, and a route that takes it
    cannot accidentally read tenant data as though authorised to.
    """

    user_id: UUID
    membership: Membership | None


async def current_business_identity(
    session: DbSession,
    authorization: Annotated[str | None, Header()] = None,
) -> BusinessIdentity:
    """For the handful of routes a business account needs before it has a tenant.

    Today that is creating an organisation and reading the vocabularies its
    form needs. **Adding a route here is adding a way into the product that
    skips the membership check**, so each one should be as narrow as those
    two are.

    **Self-registration is open (2026-09-18).** The client decided employers
    and colleges sign themselves up, as R15 said, so the business Cognito pool
    is not admin-create-only and this dependency admits strangers: anyone can
    register, verify their email, and reach these
    routes. That is acceptable only because they stay this narrow -- what a
    new organisation can *do* is still gated on KYB and payment (R15).
    """
    user, token = await _authenticate(session, authorization)
    if token.pool != "BUSINESS":
        raise PermissionDeniedError(code="business_account_required")

    membership = await membership_lookup.resolve(session, user.id)
    if membership is not None and membership.role == CANDIDATE:
        raise PermissionDeniedError(code="pool_role_mismatch")
    return BusinessIdentity(user_id=user.id, membership=membership)


CurrentBusinessIdentity = Annotated[BusinessIdentity, Depends(current_business_identity)]


def require_role(*roles: str) -> Callable[[TenantContext], Awaitable[TenantContext]]:
    """Authorisation is by role, never by URL prefix.

    A candidate hitting an `/employer/*` route is rejected here, not by
    routing. The path prefixes exist for readability only.
    """
    unknown = set(roles) - ALL_ROLES
    if unknown:
        raise ValueError(f"unknown role(s) in require_role: {sorted(unknown)}")

    async def _dep(user: CurrentUser) -> TenantContext:
        if user.role not in roles:
            raise PermissionDeniedError()
        return user

    return _dep


class StaffCheckUnavailableError(AppError):
    """Cognito could not say whether an authenticator is enrolled. Refused,
    not waved through: the step-up fails closed."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "staff_mfa_check_unavailable"
    title = "The sign-in check is unavailable"


_RISK_ORDER = {"LOW": 0, "HIGH": 1, "CRITICAL": 2}


def require_permission(
    permission: str, *, also: tuple[str, ...] = (), tenant_param: str | None = None
) -> Callable[..., Awaitable[TenantContext]]:
    """A console route's guard: the caller is staff and holds `permission`
    (and every one of `also`). See `app/core/staff_permissions.py`.

    `tenant_param` names the path parameter holding the organisation the
    route acts on. Only then can an organisation-scoped grant count, and only
    for that organisation; without it a scoped grant grants nothing.

    **HIGH and CRITICAL permissions pass the step-up** before the handler runs:

    1. a reason in `X-Access-Reason` (percent-encoded; 5 to 500 characters),
       or 403 `access_reason_required`;
    2. CRITICAL only: a sign-in within `staff_recent_auth_seconds`, or 401
       `reauthentication_required` -- the client signs in again;
    3. an authenticator app enrolled on the Cognito user, or 403
       `mfa_required` (`staff_mfa_required`, off only on a laptop);

    and then writes a `staff_sensitive_access` audit row -- the permissions,
    the reason, the route, the caller's IP address and user agent -- in the
    request's own transaction, so the action cannot commit without it.
    """
    needed = (permission, *also)
    unknown = [key for key in needed if key not in BY_KEY]
    if unknown:
        raise ValueError(f"unknown permission(s) in require_permission: {unknown}")
    risk = max((BY_KEY[key].risk for key in needed), key=_RISK_ORDER.__getitem__)

    async def _dep(request: Request, user: CurrentUser, session: DbSession) -> TenantContext:
        if user.staff is None:
            raise PermissionDeniedError()
        tenant_id = _path_tenant(request, tenant_param)
        if not all(user.can(key, tenant_id=tenant_id) for key in needed):
            raise PermissionDeniedError()
        if risk != "LOW":
            reason = await _step_up(request, session, user, critical=risk == "CRITICAL")
            await audit_event(
                session,
                action=AuditAction.STAFF_SENSITIVE_ACCESS,
                actor_id=user.user_id,
                actor_role=user.role,
                target_type="console_route",
                target_id=None,
                request_id=get_request_id(request),
                metadata={
                    "permissions": list(needed),
                    "risk": risk,
                    "reason": reason,
                    "method": request.method,
                    "route": _route_template(request),
                    "path": request.url.path,
                    "path_params": {k: str(v) for k, v in request.path_params.items()},
                    "ip": client_ip(request),
                    "user_agent": (request.headers.get("User-Agent") or "")[:200],
                },
            )
        return user

    # Read by the console's invariant test, which holds every route to the
    # permission table it is written against.
    _dep.permissions = needed  # type: ignore[attr-defined]
    _dep.tenant_param = tenant_param  # type: ignore[attr-defined]
    return _dep


def _path_tenant(request: Request, tenant_param: str | None) -> UUID | None:
    if tenant_param is None:
        return None
    try:
        return UUID(str(request.path_params[tenant_param]))
    except (KeyError, ValueError):
        # Not an id: no organisation-scoped grant can match it, and an
        # unscoped one lets the route answer its own 404 or 422.
        return None


def _route_template(request: Request) -> str:
    route = request.scope.get("route")
    return str(getattr(route, "path", request.url.path))


def access_reason(request: Request) -> str | None:
    """The reason header, decoded and trimmed, or None if absent or unusable.

    Percent-encoded, because a header is Latin-1 and a reason may be typed in
    any of nine languages; plain ASCII passes through `unquote` unchanged."""
    raw = request.headers.get(REASON_HEADER)
    if raw is None:
        return None
    reason = unquote(raw).strip()
    if not REASON_MIN_LENGTH <= len(reason) <= REASON_MAX_LENGTH:
        return None
    return reason


async def _step_up(
    request: Request, session: AsyncSession, user: TenantContext, *, critical: bool
) -> str:
    reason = access_reason(request)
    if reason is None:
        raise PermissionDeniedError(code="access_reason_required")
    settings = get_settings()
    if critical:
        signed_in = user.auth_time
        if signed_in is None or time.time() - signed_in > settings.staff_recent_auth_seconds:
            raise UnauthenticatedError(code="reauthentication_required")
    if settings.staff_mfa_required and not await _mfa_enrolled(session, user.user_id):
        raise PermissionDeniedError(code="mfa_required")
    return reason


async def _mfa_enrolled(session: AsyncSession, user_id: UUID) -> bool:
    cached = await staff_access.cached_mfa(user_id)
    if cached is not None:
        return cached
    subject = await staff_access.cognito_subject(session, user_id)
    if subject is None:
        return False
    try:
        enabled = await get_account_directory().mfa_enabled(pool="BUSINESS", subject=subject)
    except DirectoryError as exc:
        raise StaffCheckUnavailableError() from exc
    await staff_access.remember_mfa(user_id, enabled)
    return enabled


def require_tenant() -> Callable[[TenantContext], Awaitable[TenantContext]]:
    async def _dep(user: CurrentUser) -> TenantContext:
        if user.tenant_id is None:
            raise PermissionDeniedError()
        return user

    return _dep


async def require_active_subscription(user: CurrentUser, session: DbSession) -> TenantContext:
    """Pay-first, for all three audiences (R13).

    Sign-up creates an account; everything else needs payment. A lapsed
    subscriber keeps their account and their score history and loses access -
    they never lose data.

    **A candidate is entitled by a personal subscription OR by an active
    college seat** (client, 2026-09-12, closing C12). A seated student pays us
    nothing and must still get in, so this is a check with two limbs and a
    seated student failing it would be a college's entire cohort locked out of
    something the college has already paid for.

    The seat limb is the one with a lifecycle: a personal subscription lapses
    on a date this user controls, a seat is withdrawn by someone else - the
    college not renewing, or an admin reassigning it. Both must be read live.
    **Do not cache the answer**; `require_active_access_window` below carries
    the same warning for the same reason.

    A candidate subscribes as a USER; an employer or college as its TENANT.
    **Put a role guard before this one** in a route's dependencies, so a caller
    with the wrong role is told 403 rather than invited to pay for a surface
    they cannot use.

    **The seat limb** is `has_active_college_seat`: a seat held on a
    live ROSTER consent, at an ACTIVE college, whose own subscription is in
    period. A college that lapses, or a student who disconnects, loses the
    seat's access on the next request.
    """
    if user.tenant_id is None:
        paying = await has_active_subscription(
            session, subscriber_type="USER", subscriber_id=user.user_id
        ) or await has_active_college_seat(session, user_id=user.user_id)
    else:
        paying = await has_active_subscription(
            session, subscriber_type="TENANT", subscriber_id=user.tenant_id
        )
    if not paying:
        raise SubscriptionRequiredError()
    return user


async def require_active_access_window(user: CurrentUser, session: DbSession) -> TenantContext:
    """Invariant 7: the employer's paid period, checked on every reveal (R14).

    One check, one place. The subscription IS the entitlement - there is no
    per-candidate unlock row any more, nothing to decrement, and **no cached
    entitlement, deliberately**. A window lapsing mid-session must mask the
    very next read, so this reads current state every time.

    It reads the same row as `require_active_subscription` and refuses with a
    different code on purpose: `subscription_required` tells an employer to
    buy something before using the portal, `access_window_expired` tells one
    who was revealing candidates a minute ago that their period has ended.

    Only a tenant has an access window. A candidate or a business account with
    no organisation is refused before any subscription is read.
    """
    if user.tenant_id is None:
        raise PermissionDeniedError()
    if not await has_active_subscription(
        session, subscriber_type="TENANT", subscriber_id=user.tenant_id
    ):
        raise AccessWindowExpiredError()
    return user


def client_ip(request: Request) -> str | None:
    """The caller's address, from the load balancer's forwarding header.

    Behind ALB the socket address is the balancer's, so throttling on it would
    put every user in India in one bucket. `X-Forwarded-For` is a client-
    supplied header and trivially spoofed, so the LAST entry is taken rather
    than the first: everything before it was written by the client, and only
    the final hop was appended by infrastructure we control.
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else None


def get_request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


__all__ = [
    "ALL_ROLES",
    "CANDIDATE",
    "COLLEGE_ADMIN",
    "COLLEGE_STAFF",
    "EMPLOYER_OWNER",
    "EMPLOYER_RECRUITER",
    "EMPLOYER_VIEWER",
    "PLATFORM_STAFF",
    "CurrentUser",
    "DbSession",
    "current_user",
    "require_active_access_window",
    "require_active_subscription",
    "require_permission",
    "require_role",
    "require_tenant",
]
