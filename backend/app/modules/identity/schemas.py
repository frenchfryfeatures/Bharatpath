"""identity - Pydantic request/response DTOs

Users, sessions, Cognito linkage, memberships.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**`cognito_sub` appears in no schema in this file, and must not.** It is the
external identity link; our `users.id` is the identifier clients see. Leaking
the provider subject hands out a value that is meaningful in someone else's
system.
"""

from __future__ import annotations

import uuid

from pydantic import Field, field_validator

from app.core.auth.tokens import Pool
from app.core.schemas import ApiSchema


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


# ---------------------------------------------------------------------------
# OTP start - our outer throttle in front of the Cognito custom auth flow
# ---------------------------------------------------------------------------
class OtpStartRequest(_Base):
    """A phone number to send a login code to.

    The code itself never touches this service. Cognito's custom-auth Lambdas
    call Twilio Verify, which generates, sends, expires and checks it
    (docs/plan.md 5.8). No OTP value reaches our database or our logs, which
    removes a whole class of leak rather than mitigating it.
    """

    phone: str = Field(
        min_length=8,
        max_length=20,
        description="E.164, e.g. +919876543210.",
    )

    @field_validator("phone")
    @classmethod
    def _e164(cls, v: str) -> str:
        v = v.strip().replace(" ", "")
        if not v.startswith("+") or not v[1:].isdigit():
            # Normalising instead of rejecting would guess a country code, and
            # guessing wrong sends a stranger's phone a login code.
            raise ValueError("phone must be E.164, starting with + and digits only")
        return v


class OtpStartResponse(_Base):
    """Deliberately says nothing about whether the number is registered.

    Answering "no such user" here turns the login form into a tool for
    checking whether a given person has an account, which is a privacy leak
    with no upside -- the candidate who mistyped their number learns nothing
    useful from it either.
    """

    status: str = "CHALLENGE_SENT"
    retry_after_seconds: int


# ---------------------------------------------------------------------------
# Whoami
# ---------------------------------------------------------------------------
class MeResponse(_Base):
    """The caller's own identity, as resolved server-side.

    Every field here is the *server's* answer, not an echo of the token. The
    four clients use this to decide which surface to render, so a client that
    somehow held a stale or forged claim still gets the truth from here.
    """

    user_id: uuid.UUID
    role: str
    pool: str
    tenant_id: uuid.UUID | None = None
    email: str | None = Field(
        default=None,
        description="The caller's own address, from our `users` row. Null only if none is held.",
    )
    full_name: str | None = Field(
        default=None,
        description="The name a candidate gave on their profile. Null for a candidate who has "
        "not set one, and always null for a business account, which has no stored name.",
    )


# ---------------------------------------------------------------------------
# Development-only token minting
# ---------------------------------------------------------------------------
class DevTokenRequest(_Base):
    """Registered only when `auth_allow_local_tokens` is on. See router."""

    pool: Pool = "CANDIDATE"
    subject: str | None = Field(
        default=None,
        description="Reuse a subject to sign in as an existing local user.",
    )
    phone: str | None = None
    email: str | None = None


class DevTokenResponse(_Base):
    access_token: str
    token_type: str = "Bearer"  # noqa: S105 - a scheme name, not a credential
    subject: str
    expires_in: int
