"""identity - HTTP layer

Users, sessions, Cognito linkage, memberships.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**What is NOT here, and why.** There is no login endpoint and no token
endpoint. Cognito owns the session and issues the tokens: both pools by email
and password (the business pool adds software-token MFA), with Cognito
emailing every verification and reset code. Phone OTP is deferred by the
client (2026-09-18); its route below exists only behind
`AUTH_PHONE_OTP_ENABLED`. Putting a
login endpoint here would mean this service handling credentials, which is the
liability the Cognito decision exists to avoid (docs/plan.md 5.7).

What this service does is verify the resulting token and answer, from our own
tables, what the holder may do.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, Request, UploadFile, status

from app.core.deps import CurrentUser, DbSession
from app.modules.candidate import service as candidate_service
from app.modules.identity import service
from app.modules.identity.schemas import (
    DevTokenRequest,
    DevTokenResponse,
    MeResponse,
    OtpStartRequest,
    OtpStartResponse,
)
from app.settings import get_settings

router = APIRouter()


@router.post("/resume-preview", summary="Read a resume into a transient signup draft")
async def resume_preview(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
    from app.core import ratelimit
    from app.modules.resume import onboarding_service
    from app.modules.resume.service import UploadRejectedError

    await ratelimit.enforce("resume.preview", subject=_client_ip(request) or "unknown")
    content = await file.read(get_settings().resume_max_upload_bytes + 1)
    await file.close()
    if len(content) > get_settings().resume_max_upload_bytes:
        raise UploadRejectedError(code="upload_too_large")
    return await onboarding_service.preview(content)


async def otp_start(payload: OtpStartRequest, request: Request) -> OtpStartResponse:
    """Rate-limit an OTP request. Sends nothing itself.

    202, not 200: the challenge is not delivered by the time this returns.
    The client proceeds to Cognito `InitiateAuth`, and Twilio delivers the
    code from inside the Lambda trigger.

    The response is identical whether or not the number belongs to a known
    user. See `OtpStartResponse` for why that matters.
    """
    retry_after = await service.start_otp_challenge(
        phone=payload.phone,
        client_ip=_client_ip(request),
    )
    return OtpStartResponse(retry_after_seconds=retry_after)


# Phone OTP is deferred (2026-09-18). Registered at import time and only when
# the flag is on, like `/dev/token` below: while it is off the route does not
# exist and is absent from openapi.json, so no client can come to depend on it.
if get_settings().auth_phone_otp_enabled:  # pragma: no cover - off until phone OTP returns
    router.add_api_route(
        "/otp/start",
        otp_start,
        methods=["POST"],
        response_model=OtpStartResponse,
        status_code=status.HTTP_202_ACCEPTED,
        summary="Outer throttle in front of the Cognito custom auth flow",
    )


@router.get("/me", response_model=MeResponse, summary="The caller's resolved identity")
async def me(user: CurrentUser, session: DbSession) -> MeResponse:
    """Who the server thinks you are.

    Cheap and load-bearing: it is the smallest endpoint that proves the whole
    authentication chain works -- token verified, user row resolved, membership
    read from our tables. When something is wrong with auth, this is the first
    thing to call.

    `email` is the caller's own, from `users`. `full_name` exists only for a
    candidate (their profile name); a business account has no stored name, so
    it is null rather than guessed from the address.
    """
    full_name = None
    if user.role == "CANDIDATE":
        full_name = (await candidate_service.get_profile(session, ctx=user)).full_name
    return MeResponse(
        user_id=user.user_id,
        role=user.role,
        pool=user.pool,
        tenant_id=user.tenant_id,
        email=await service.email_of(session, user_id=user.user_id),
        full_name=full_name,
    )


def _client_ip(request: Request) -> str | None:
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


# ---------------------------------------------------------------------------
# Development only
# ---------------------------------------------------------------------------
# Registered at import time and only when the flag is on, so in any other
# environment this route does not exist -- not "returns 403", does not exist,
# and does not appear in openapi.json. `Settings` additionally refuses to boot
# with the flag set in staging or prod, so there is no configuration that
# reaches this code in a deployed environment.
if get_settings().auth_allow_local_tokens:  # pragma: no cover - exercised via its own test

    @router.post(
        "/dev/token",
        response_model=DevTokenResponse,
        summary="Mint a local test token (local development only)",
        description=(
            "Present only when AUTH_ALLOW_LOCAL_TOKENS is set, which Settings "
            "refuses in staging and production. Issues a genuine RS256 token "
            "signed by a key this process generated at boot, so the ordinary "
            "verification path runs unchanged."
        ),
    )
    async def dev_token(payload: DevTokenRequest) -> DevTokenResponse:
        from app.core.auth.local import LocalIdentityProvider
        from app.core.auth.provider import get_identity_provider

        provider = get_identity_provider()
        assert isinstance(provider, LocalIdentityProvider)  # guaranteed by the flag

        settings = get_settings()
        token, subject = provider.issue(
            subject=payload.subject,
            pool=payload.pool,
            phone=payload.phone,
            email=payload.email,
        )
        return DevTokenResponse(
            access_token=token,
            subject=subject,
            expires_in=settings.local_token_ttl_seconds,
        )
