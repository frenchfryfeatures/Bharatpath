"""Resolve the `users` row behind a verified token, creating it on first sign-in.

**Why this lives in core rather than in the identity module.** Authentication
runs before any module does, and core must not import from `app.modules` --
that would invert the dependency direction the whole layout rests on and make
`identity` un-extractable later. So the two tables authentication itself needs,
`users` and `memberships`, are read here with explicit SQL, and `identity`
owns everything else about them: profiles, invitations, role changes,
suspensions.

That boundary is enforced, not remembered: `.importlinter` forbids `app.core`
from importing `app.modules`.
"""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.tokens import IdentityProvider, VerifiedToken
from app.core.errors import PermissionDeniedError
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class AuthenticatedUser:
    """The minimum authentication needs. Not the profile -- that is identity's."""

    id: uuid.UUID
    pool: str
    status: str


async def resolve_or_create_user(
    session: AsyncSession,
    *,
    provider: IdentityProvider,
    raw_token: str,
    token: VerifiedToken,
) -> AuthenticatedUser:
    """Map a provider subject onto our own user id.

    `cognito_sub` is the external link and `users.id` is the internal primary
    key. They are kept separate so that the identifier in our API is ours:
    `cognito_sub` never appears in a response, and a future change of identity
    provider re-links rows rather than rewriting every foreign key in the
    schema.
    """
    existing = await _by_subject(session, token.subject)
    if existing is not None:
        return existing

    # First sign-in. Access tokens carry no contact attributes, so ask the
    # provider rather than inventing them.
    profile = await provider.fetch_profile(raw_token, token)

    # A phone or email may already exist against a row created by another
    # route into the product -- a college roster import, an employer inviting
    # a colleague. Adopting that row is the difference between one account and
    # two accounts for the same person, and two accounts means a candidate
    # whose score history silently splits in half.
    adopted = await _adopt_unlinked(
        session, token.subject, token.pool, profile.phone, profile.email
    )
    if adopted is not None:
        logger.info("user_linked_to_existing_row", user_id=str(adopted.id))
        return adopted

    row = (
        await session.execute(
            text(
                """
                INSERT INTO users (id, cognito_sub, pool, phone, email, status, locale)
                VALUES (gen_random_uuid(), :sub, :pool, :phone, :email, 'ACTIVE', 'en')
                ON CONFLICT DO NOTHING
                RETURNING id, pool, status
                """
            ),
            {
                "sub": token.subject,
                "pool": token.pool,
                "phone": profile.phone,
                "email": profile.email,
            },
        )
    ).first()

    if row is None:
        # Lost a race with a concurrent first request from the same user --
        # two devices signing in at once. The other transaction created the
        # row; read it rather than failing a legitimate sign-in.
        existing = await _by_subject(session, token.subject)
        if existing is None:
            # Not a race: the phone or email already belongs to another
            # account -- in practice the other pool's (one address cannot be
            # both a candidate and employer staff). Said
            # plainly rather than as a 500. The address is not logged.
            logger.warning("user_contact_in_use", pool=token.pool)
            raise PermissionDeniedError(code="account_contact_in_use")
        return existing

    logger.info("user_created", user_id=str(row.id), pool=token.pool)
    return AuthenticatedUser(id=row.id, pool=row.pool, status=row.status)


def erased_subject(subject: str) -> str:
    """What an erasure leaves in `cognito_sub`: the subject's SHA-256.

    Must match `erase_candidate` in the baseline migration byte for byte.
    """
    return hashlib.sha256(subject.encode("utf-8")).hexdigest()


async def _by_subject(session: AsyncSession, subject: str) -> AuthenticatedUser | None:
    """The row for this subject -- **including an erased one**.

    An erasure replaces the subject with its hash rather than clearing it.
    Matching the hash here returns the DELETED row, which `_authenticate`
    refuses; without it, a token issued before the erasure would find no row
    and sign-in would create a new account from the erased person's still
    valid credential.
    """
    row = (
        await session.execute(
            text(
                "SELECT id, pool, status FROM users "
                "WHERE cognito_sub = :sub OR (cognito_sub = :erased AND status = 'DELETED')"
            ),
            {"sub": subject, "erased": erased_subject(subject)},
        )
    ).first()
    return None if row is None else AuthenticatedUser(id=row.id, pool=row.pool, status=row.status)


async def _adopt_unlinked(
    session: AsyncSession, subject: str, pool: str, phone: str | None, email: str | None
) -> AuthenticatedUser | None:
    """Link a pre-existing row that has no provider subject yet.

    Deliberately narrow: it matches only rows where `cognito_sub IS NULL`. A
    row that already carries a different subject belongs to a different
    identity, and merging two identities because they share a contact detail
    is an account-takeover primitive, not a convenience.

    **And only a row made for this pool.** Staff create candidate rows as well
    as business ones (2026-09-18); a business sign-in adopting a candidate row
    by email would carry a candidate's history into an account with a
    different authentication model, and the pool check in `current_user`
    would then refuse the person forever.
    """
    if not phone and not email:
        return None

    row = (
        await session.execute(
            text(
                """
                UPDATE users
                   SET cognito_sub = :sub
                 WHERE cognito_sub IS NULL
                   AND pool = :pool
                   AND (
                         phone = CAST(:phone AS text)
                      OR email = CAST(:email AS text)
                   )
             RETURNING id, pool, status
                """
                # The casts are required, not decorative. A bare placeholder
                # in `:phone IS NOT NULL` gives Postgres nothing to infer a
                # type from and it refuses the statement outright
                # ("could not determine data type of parameter $2").
                #
                # The NULL guards are gone because they were redundant:
                # `phone = NULL` is NULL, never true, so a null parameter
                # already matches nothing. That is exactly the behaviour
                # wanted here -- a user with no phone must not adopt every
                # row whose phone is also unset.
            ),
            {"sub": subject, "pool": pool, "phone": phone, "email": email},
        )
    ).first()
    return None if row is None else AuthenticatedUser(id=row.id, pool=row.pool, status=row.status)
