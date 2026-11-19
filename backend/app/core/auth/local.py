"""A local stand-in for Cognito, for development and tests only.

**Why this exists.** Cognito cannot be run locally: LocalStack's free tier does
not provide it, and the candidate pool additionally needs three custom-auth
Lambda triggers that are infrastructure. Without something here, every day of
work that sits behind authentication -- resume upload, scoring, discovery,
every gate -- would have to be written blind and tested for the first time in
a deployed environment.

**What it is not.** It is not a stub. A stubbed `current_user` that returns a
fixed identity silently disables every check downstream of it, and a
permission matrix that passes against such a stub proves nothing. This issues
and verifies genuine RS256 JWTs, with the same claim validation, the same
failure modes, and the same code path as `CognitoIdentityProvider`. Only the
issuer differs.

**How it is kept out of production**, three ways, deliberately overlapping:

  1. `Settings._local_auth_is_never_production` refuses to construct settings
     with `auth_allow_local_tokens` set in staging or prod. The process does
     not boot.
  2. The signing key is generated in memory at start-up and never persisted.
     Every restart invalidates every token, and no key exists to leak.
  3. `POST /auth/dev/token`, the only way to obtain one, is registered on the
     router only while the flag is on, so it is absent from `openapi.json` in
     any other environment.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Final

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

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

ALGORITHM: Final = "RS256"

#: Deliberately not a Cognito-shaped issuer. A token minted here must be
#: obviously distinguishable in a log from one Cognito minted, so that a
#: local token appearing anywhere it should not is unmistakable rather than
#: something you have to squint at.
ISSUER: Final = "https://local.bharatpath.invalid/dev"


class LocalIdentityProvider:
    """Issues and verifies RS256 tokens against an in-process keypair."""

    def __init__(self, settings: Settings) -> None:
        if settings.environment in ("staging", "prod"):  # pragma: no cover - defence in depth
            raise RuntimeError(
                "LocalIdentityProvider must never be constructed in a deployed environment."
            )
        self._settings = settings

        # 2048 bits, generated per process. Key generation costs a few hundred
        # milliseconds once at boot, which is invisible, and the alternative --
        # a checked-in key -- is a signing key in version control.
        self._key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self._private_pem = self._key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        self._public_pem = self._key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        logger.warning(
            "local_identity_provider_active",
            detail="tokens are signed by an in-process key; never enable outside local dev",
        )

    # -- issuing (development only) ---------------------------------------
    def issue(
        self,
        *,
        subject: str | None = None,
        pool: Pool = "CANDIDATE",
        phone: str | None = None,
        email: str | None = None,
        ttl_seconds: int | None = None,
        auth_time: int | None = None,
    ) -> tuple[str, str]:
        """Mint a token. Returns `(raw_token, subject)`.

        The claim set mirrors a Cognito access token exactly, so code that
        reads a claim here reads the same claim in production.
        """
        subject = subject or str(uuid.uuid4())
        now = int(time.time())
        ttl = ttl_seconds or self._settings.local_token_ttl_seconds

        claims: dict[str, Any] = {
            "sub": subject,
            "iss": ISSUER,
            "client_id": f"local-{pool.lower()}",
            "token_use": self._settings.cognito_token_use,
            "pool": pool,
            "iat": now,
            "exp": now + ttl,
            # As Cognito does: the moment of sign-in, kept across refreshes.
            "auth_time": now if auth_time is None else auth_time,
        }
        # Carried in the token so first sign-in needs no profile round trip.
        # Cognito access tokens do not include these; the identity service
        # treats them as optional in both implementations, which is why that
        # difference does not leak into the code above it.
        if phone:
            claims["phone_number"] = phone
        if email:
            claims["email"] = email

        return jwt.encode(claims, self._private_pem, algorithm=ALGORITHM), subject

    # -- verification ------------------------------------------------------
    async def verify(self, raw_token: str) -> VerifiedToken:
        try:
            claims = jwt.decode(
                raw_token,
                self._public_pem,
                algorithms=[ALGORITHM],
                issuer=ISSUER,
                options={"verify_aud": False, "require": ["exp", "iss", "sub"]},
                leeway=30,
            )
        except jwt.PyJWTError as exc:
            logger.warning("token_rejected", reason=type(exc).__name__)
            raise InvalidTokenError() from exc

        if claims.get("token_use") != self._settings.cognito_token_use:
            raise InvalidTokenError()

        pool = claims.get("pool")
        if pool not in ("CANDIDATE", "BUSINESS"):
            raise InvalidTokenError()

        return VerifiedToken(
            subject=str(claims["sub"]),
            pool=pool,
            phone=claims.get("phone_number"),
            email=claims.get("email"),
            auth_time=claims.get("auth_time") if isinstance(claims.get("auth_time"), int) else None,
        )

    async def fetch_profile(self, raw_token: str, token: VerifiedToken) -> ProviderProfile:
        return ProviderProfile(token.subject, phone=token.phone, email=token.email)

    async def aclose(self) -> None:
        return None


_CONFORMS: type[IdentityProvider] = LocalIdentityProvider
