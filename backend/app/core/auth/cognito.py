"""The production identity provider: RS256 verification against Cognito JWKS.

This is real code on the real path. It is not exercised locally only because
Cognito cannot be emulated -- LocalStack's free tier does not provide it, and
the candidate pool additionally needs three custom-auth Lambda triggers that
are infrastructure rather than application code (docs/plan.md section 5.7).
The moment the pools exist, this class is what runs, unchanged.

**Cognito is not consulted for authorisation.** It answers "who is this", and
nothing else. Role and tenant come from `memberships`.
"""

from __future__ import annotations

import time
from typing import Any, Final

import httpx
import jwt
from jwt import PyJWKClient

from app.core.auth.tokens import (
    IdentityProvider,
    InvalidTokenError,
    Pool,
    ProviderProfile,
    VerifiedToken,
)
from app.core.logging import get_logger
from app.settings import Settings

logger = get_logger(__name__)

#: Cognito signs with RS256 and nothing else. Pinning the algorithm is not
#: pedantry: a verifier that accepts whatever `alg` the token declares can be
#: talked into accepting `none`, or into verifying an RSA public key as an
#: HMAC secret. Both are classic JWT forgeries, and both are closed by this
#: one constant.
ALGORITHMS: Final[list[str]] = ["RS256"]

#: How long a JWKS refresh triggered by an unknown `kid` is suppressed for.
#: Without it, anyone can force a network call per request by sending a token
#: carrying a made-up key id.
UNKNOWN_KID_REFRESH_COOLDOWN: Final = 300.0

POOLS: Final[tuple[Pool, ...]] = ("CANDIDATE", "BUSINESS")


class CognitoIdentityProvider:
    """Verifies tokens from either pool, and only from configured pools."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._jwk_clients: dict[Pool, PyJWKClient] = {}
        self._last_refresh: dict[Pool, float] = {}
        self._http: httpx.AsyncClient | None = None

        for pool in POOLS:
            issuer = settings.cognito_issuer(pool)
            if issuer is None:
                # A deployment may legitimately serve one pool -- an
                # admin-only environment has no candidates. Absent config
                # means "this pool is not served here", and a token from it
                # is rejected rather than half-verified.
                continue
            self._jwk_clients[pool] = PyJWKClient(
                f"{issuer}/.well-known/jwks.json",
                cache_keys=True,
                lifespan=settings.jwks_cache_ttl_seconds,
            )

        if not self._jwk_clients:
            raise RuntimeError(
                "CognitoIdentityProvider constructed with no pool configured. "
                "Set COGNITO_CANDIDATE_POOL_ID and/or COGNITO_BUSINESS_POOL_ID."
            )

    # -- verification ------------------------------------------------------
    async def verify(self, raw_token: str) -> VerifiedToken:
        pool = self._pool_from_issuer(raw_token)
        claims = self._decode(raw_token, pool)
        self._check_token_use(claims)
        self._check_client_id(claims, pool)

        subject = claims.get("sub")
        if not subject:
            raise InvalidTokenError()

        return VerifiedToken(
            subject=str(subject),
            pool=pool,
            # Present on ID tokens, absent on access tokens. Either way this
            # is a hint, not an authority -- `fetch_profile` is what populates
            # a new user row.
            phone=claims.get("phone_number"),
            email=claims.get("email"),
            auth_time=_epoch(claims.get("auth_time")),
        )

    def _pool_from_issuer(self, raw_token: str) -> Pool:
        """Route the token to a pool by its unverified `iss`, then verify.

        Reading a claim before checking the signature is safe *only* because
        nothing is trusted from it: it selects which set of public keys to
        verify against, and verification against the wrong keys fails. A token
        naming an issuer we do not serve is rejected outright.
        """
        try:
            unverified = jwt.decode(raw_token, options={"verify_signature": False})
        except jwt.PyJWTError as exc:
            raise InvalidTokenError() from exc

        issuer = unverified.get("iss")
        for pool in self._jwk_clients:
            if issuer == self._settings.cognito_issuer(pool):
                return pool

        logger.warning("token_rejected", reason="unknown_issuer")
        raise InvalidTokenError()

    def _decode(self, raw_token: str, pool: Pool) -> dict[str, Any]:
        client = self._jwk_clients[pool]
        try:
            key = client.get_signing_key_from_jwt(raw_token)
        except Exception:
            # An unknown `kid` is the normal shape of a key rotation, so one
            # forced refresh is correct. Rate-limited, because it is also the
            # normal shape of someone sending garbage in a loop.
            if not self._may_refresh(pool):
                logger.warning("token_rejected", reason="unknown_kid_cooldown")
                raise InvalidTokenError() from None
            try:
                client.get_jwk_set(refresh=True)
                key = client.get_signing_key_from_jwt(raw_token)
            except Exception as exc:
                logger.warning("token_rejected", reason="no_signing_key")
                raise InvalidTokenError() from exc

        try:
            return dict(
                jwt.decode(
                    raw_token,
                    key.key,
                    algorithms=ALGORITHMS,
                    issuer=self._settings.cognito_issuer(pool),
                    # Access tokens carry `client_id`, not `aud`, so the
                    # audience is checked explicitly below rather than here.
                    # Disabling the library check and then forgetting to do it
                    # by hand is the mistake this comment exists to prevent.
                    options={"verify_aud": False, "require": ["exp", "iss", "sub"]},
                    leeway=30,  # tolerate modest clock skew, nothing more
                )
            )
        except jwt.PyJWTError as exc:
            logger.warning("token_rejected", reason=type(exc).__name__)
            raise InvalidTokenError() from exc

    def _may_refresh(self, pool: Pool) -> bool:
        now = time.monotonic()
        if now - self._last_refresh.get(pool, 0.0) < UNKNOWN_KID_REFRESH_COOLDOWN:
            return False
        self._last_refresh[pool] = now
        return True

    def _check_token_use(self, claims: dict[str, Any]) -> None:
        if claims.get("token_use") != self._settings.cognito_token_use:
            logger.warning("token_rejected", reason="wrong_token_use")
            raise InvalidTokenError()

    def _check_client_id(self, claims: dict[str, Any], pool: Pool) -> None:
        """The audience check, spelled out because the claim name varies.

        Access tokens put the app client in `client_id`; ID tokens put it in
        `aud`. Checking only one of them leaves whichever token type you did
        not think about unchecked.
        """
        expected = self._settings.cognito_client_id(pool)
        if expected is None:
            # Pool configured but client id not. Refusing is the safe answer:
            # without it, a token minted for any app client in the same pool
            # -- including one belonging to a different application -- passes.
            logger.error("client_id_not_configured", pool=pool)
            raise InvalidTokenError()

        presented = claims.get("client_id") or claims.get("aud")
        if isinstance(presented, list):
            presented = presented[0] if presented else None
        if presented != expected:
            logger.warning("token_rejected", reason="wrong_client_id")
            raise InvalidTokenError()

    # -- profile -----------------------------------------------------------
    async def fetch_profile(self, raw_token: str, token: VerifiedToken) -> ProviderProfile:
        """Read contact attributes with Cognito's `GetUser`.

        Called once, on first sign-in. `GetUser` takes the access token itself
        as the credential, so this needs no AWS request signing and no IAM
        permission -- it is the caller proving who they are, not us acting on
        their behalf.
        """
        if token.phone or token.email:
            return ProviderProfile(token.subject, phone=token.phone, email=token.email)

        endpoint = f"https://cognito-idp.{self._settings.aws_region}.amazonaws.com/"
        try:
            response = await self._client().post(
                endpoint,
                headers={
                    "Content-Type": "application/x-amz-json-1.1",
                    "X-Amz-Target": "AWSCognitoIdentityProviderService.GetUser",
                },
                json={"AccessToken": raw_token},
            )
            response.raise_for_status()
            attributes = {
                a["Name"]: a.get("Value") for a in response.json().get("UserAttributes", [])
            }
        except Exception:
            # A profile we could not read is not an authentication failure --
            # the token verified. The user row is created with what we have,
            # and the attributes fill in on a later sign-in.
            logger.warning("profile_fetch_failed", subject=token.subject)
            return ProviderProfile(token.subject)

        return ProviderProfile(
            subject=token.subject,
            phone=attributes.get("phone_number"),
            email=attributes.get("email"),
        )

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=5.0)
        return self._http

    async def aclose(self) -> None:
        if self._http is not None:
            await self._http.aclose()
            self._http = None


#: Structural conformance, checked by mypy rather than by a base class. If a
#: method signature drifts from the protocol, this line stops the build.
_CONFORMS: type[IdentityProvider] = CognitoIdentityProvider


def _epoch(value: object) -> int | None:
    """A numeric claim, or None when absent or not a number."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return int(value)
