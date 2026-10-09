"""Creating a sign-in on somebody's behalf: the one write we make to Cognito.

Used by admin-created accounts and team invitations
(`docs/signup-and-accounts.md`). Staff create a candidate, an employer or a
college in the console; an owner adds a colleague. Either way the person has
no Cognito user yet, so we ask Cognito to make one: `AdminCreateUser` with the
address as the username, **which emails a temporary password**. The person
signs in with it, Cognito forces a new password (MFA is optional and off
until they turn it on), and on their first API call
`app.core.auth.users._adopt_unlinked` links that identity to the row we
created here by email -- so the organisation and role are waiting for them.

**What this is not.** It is not authorisation, and it holds no credential:
Cognito generates and sends the password, and we never see it. This module can
ask for an account to exist, ask for the invitation to be sent again, and ask
for an account to be destroyed.

**`delete_user` is the erasure's last act on the identity.** Without it an
erasure would empty our `users` row and leave the Cognito user standing, so a
person who was erased and later signed in with the same address would present
a subject whose hash we still hold, and be refused forever rather than
starting fresh. It is called *before* the database cascade
deliberately: the cascade replaces `cognito_sub` with its SHA-256, so after
it runs there is no identifier left to delete by.

Two implementations, chosen once at boot like `provider.py`:

* `CognitoAccountDirectory` -- the real one. Needs `cognito-idp:AdminCreateUser`
  and `cognito-idp:AdminDeleteUser` on both pools (`infra/terraform/iam.tf`).
* `LocalAccountDirectory` -- local development and tests, whenever
  `AUTH_ALLOW_LOCAL_TOKENS` is on (which `Settings` refuses in staging and
  production). Records what it was asked for, so a test can read it.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Literal, Protocol

from app.core.auth.tokens import Pool
from app.core.logging import get_logger
from app.settings import Settings, get_settings

logger = get_logger(__name__)

#: What `invite` did. ALREADY_REGISTERED is not an error: the person has a
#: sign-in already (they registered themselves first), so no email went out
#: and they should simply sign in.
InviteOutcome = Literal["SENT", "ALREADY_REGISTERED"]


class DirectoryError(Exception):
    """Cognito refused or could not be reached. `code` is safe to log and to
    return; the address never is."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class AccountDirectory(Protocol):
    name: str

    async def invite(self, *, pool: Pool, email: str) -> InviteOutcome:
        """Create a sign-in for `email` in `pool` and email its temporary password."""
        ...

    async def resend_invitation(self, *, pool: Pool, email: str) -> None:
        """Send the temporary password again, with a fresh expiry. Only for an
        account that has never signed in; raises `DirectoryError` otherwise."""
        ...

    async def delete_user(self, *, pool: Pool, subject: str) -> None:
        """Destroy the sign-in itself, as part of an erasure.

        **Idempotent.** A subject Cognito does not have is success, not an
        error: the erasure sweep retries a failed run, and the second attempt
        must not fail on work the first one finished.

        `subject` is the `sub` claim, which is what `users.cognito_sub`
        holds. Both pools use `username_attributes`, so Cognito's own
        username *is* that value and it addresses the user directly -- no
        lookup by email, which would need the address we are erasing.
        """
        ...


# ---------------------------------------------------------------------------
# Local
# ---------------------------------------------------------------------------
@dataclass
class LocalAccountDirectory:
    """In memory. `sent` is every invitation a test can inspect."""

    name: str = "local"
    registered: set[tuple[str, str]] = field(default_factory=set)
    sent: list[dict[str, str]] = field(default_factory=list)
    #: Subjects an erasure asked to destroy, for a test to assert on.
    deleted: list[dict[str, str]] = field(default_factory=list)

    async def invite(self, *, pool: Pool, email: str) -> InviteOutcome:
        key = (pool, email)
        if key in self.registered:
            return "ALREADY_REGISTERED"
        self.registered.add(key)
        self.sent.append({"pool": pool, "email": email, "kind": "INVITE"})
        return "SENT"

    async def resend_invitation(self, *, pool: Pool, email: str) -> None:
        if (pool, email) not in self.registered:
            raise DirectoryError("directory_user_not_found")
        self.sent.append({"pool": pool, "email": email, "kind": "RESEND"})

    async def delete_user(self, *, pool: Pool, subject: str) -> None:
        self.deleted.append({"pool": pool, "subject": subject})


# ---------------------------------------------------------------------------
# Cognito
# ---------------------------------------------------------------------------
class CognitoAccountDirectory:
    name = "cognito"

    def __init__(self, settings: Settings) -> None:
        self._region = settings.aws_region
        self._pool_ids: dict[Pool, str | None] = {
            "CANDIDATE": settings.cognito_candidate_pool_id,
            "BUSINESS": settings.cognito_business_pool_id,
        }
        self._client: object | None = None

    def _cognito(self) -> object:
        if self._client is None:
            import boto3

            self._client = boto3.client("cognito-idp", region_name=self._region)
        return self._client

    def _pool_id(self, pool: Pool) -> str:
        pool_id = self._pool_ids[pool]
        if not pool_id:
            raise DirectoryError("directory_pool_unconfigured")
        return pool_id

    async def invite(self, *, pool: Pool, email: str) -> InviteOutcome:
        pool_id = self._pool_id(pool)

        def _create() -> InviteOutcome:
            client = self._cognito()
            try:
                client.admin_create_user(  # type: ignore[attr-defined]
                    UserPoolId=pool_id,
                    Username=email,
                    UserAttributes=[
                        {"Name": "email", "Value": email},
                        # Staff typed the address and the temporary password
                        # is sent to it, so reaching the inbox proves it.
                        {"Name": "email_verified", "Value": "true"},
                    ],
                    DesiredDeliveryMediums=["EMAIL"],
                )
            except Exception as exc:
                code = _error_code(exc)
                if code == "UsernameExistsException":
                    return "ALREADY_REGISTERED"
                raise DirectoryError(f"cognito_{code}") from exc
            return "SENT"

        return await asyncio.to_thread(_create)

    async def resend_invitation(self, *, pool: Pool, email: str) -> None:
        pool_id = self._pool_id(pool)

        def _resend() -> None:
            client = self._cognito()
            try:
                client.admin_create_user(  # type: ignore[attr-defined]
                    UserPoolId=pool_id,
                    Username=email,
                    MessageAction="RESEND",
                    DesiredDeliveryMediums=["EMAIL"],
                )
            except Exception as exc:
                raise DirectoryError(f"cognito_{_error_code(exc)}") from exc

        await asyncio.to_thread(_resend)

    async def delete_user(self, *, pool: Pool, subject: str) -> None:
        pool_id = self._pool_id(pool)

        def _delete() -> None:
            client = self._cognito()
            try:
                client.admin_delete_user(  # type: ignore[attr-defined]
                    UserPoolId=pool_id, Username=subject
                )
            except Exception as exc:
                code = _error_code(exc)
                if code == "UserNotFoundException":
                    # Already gone. The sweep retries, and a retry must not
                    # fail on work the previous attempt completed.
                    logger.info("cognito_user_already_absent", pool=pool)
                    return
                raise DirectoryError(f"cognito_{code}") from exc

        await asyncio.to_thread(_delete)


def _error_code(exc: Exception) -> str:
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        return str(response.get("Error", {}).get("Code", "unknown"))
    return "unreachable"


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------
_directory: AccountDirectory | None = None


def get_account_directory() -> AccountDirectory:
    global _directory
    if _directory is None:
        settings = get_settings()
        # The same switch as the token verifier: local tokens mean there is no
        # Cognito pool to write to, and `Settings` refuses the flag outside
        # local and CI.
        _directory = (
            LocalAccountDirectory()
            if settings.auth_allow_local_tokens
            else CognitoAccountDirectory(settings)
        )
    return _directory


_CONFORMS_LOCAL: type[AccountDirectory] = LocalAccountDirectory
_CONFORMS_COGNITO: type[AccountDirectory] = CognitoAccountDirectory
