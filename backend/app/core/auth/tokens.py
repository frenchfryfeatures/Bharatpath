"""What a verified token is, and what any verifier must promise.

The shape of this module is the point. Authentication has exactly one
production implementation (Cognito) and exactly one local substitute, and they
sit behind the same protocol so that **the code under test is the code that
ships**. The alternative -- a stub `current_user` that returns a fixed
identity in development -- silently disables every gate downstream of it, which
is how a permission matrix ends up green against a service that checks nothing.

`VerifiedToken` deliberately carries no role and no tenant. Those are read from
our `memberships` table on every request (see `app.core.auth.membership`), not
from a claim, because a claim goes stale and a revocation that does not take
effect is the tenant-isolation failure SRS 2.24.7 forbids.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

from app.core.errors import UnauthenticatedError

#: The two Cognito pools, and the two authentication models the PRD requires.
#: A pool is a property of the *token*; a role is a property of the membership.
Pool = Literal["CANDIDATE", "BUSINESS"]


class InvalidTokenError(UnauthenticatedError):
    """A token that failed verification, for any reason.

    Deliberately one error for every cause. "Expired" and "wrong signature"
    and "wrong pool" all return the same code, because telling an attacker
    which part of their forgery was wrong is free information. The specific
    reason is logged server-side.
    """

    code = "invalid_token"
    title = "Invalid or expired token"


@dataclass(frozen=True, slots=True)
class VerifiedToken:
    """A token whose signature, issuer, audience and expiry have all passed."""

    subject: str
    """The provider's stable identifier -- `cognito_sub`. Never returned in an
    API response; our own `users.id` is the identifier clients see."""

    pool: Pool

    phone: str | None = None
    email: str | None = None
    """Present only when the provider put them in the token. Access tokens do
    not carry contact attributes, so on first sign-in these are None and the
    identity service asks the provider for them instead of guessing."""

    auth_time: int | None = None
    """When the person last proved who they are (epoch seconds). Cognito sets
    it at sign-in and keeps it through every refresh, so a token minted from a
    refresh an hour later still says the hour-old sign-in. The CRITICAL staff
    step-up reads it (`staff_recent_auth_seconds`)."""


@dataclass(frozen=True, slots=True)
class ProviderProfile:
    """Contact attributes fetched from the identity provider.

    Read once, on first sign-in, to populate the `users` row. Afterwards our
    row is the authority -- re-reading the provider on every request would add
    a network call to the hot path to answer a question that does not change.
    """

    subject: str
    phone: str | None = None
    email: str | None = None


@runtime_checkable
class IdentityProvider(Protocol):
    """The seam between this service and whoever issues tokens.

    Two methods, because verifying a token and looking up who it belongs to
    are different operations with different costs: the first happens on every
    request and must be local, the second happens once per user and may go
    over the network.
    """

    async def verify(self, raw_token: str) -> VerifiedToken:
        """Verify a bearer token, or raise `InvalidTokenError`.

        Must validate, at minimum: signature against the issuer's published
        keys, `iss`, `token_use`, the client id, and expiry. Must reject a
        token that is valid for a pool this deployment does not serve.
        """
        ...

    async def fetch_profile(self, raw_token: str, token: VerifiedToken) -> ProviderProfile:
        """Contact attributes for a subject signing in for the first time."""
        ...

    async def aclose(self) -> None:
        """Release any connections held. Called on application shutdown."""
        ...
