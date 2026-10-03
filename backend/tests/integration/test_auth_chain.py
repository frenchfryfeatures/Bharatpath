"""The authentication chain, end to end, against a real database.

Day 5's gate asks four things of the spine. This file proves the ones that are
about identity; `test_rls_and_grants.py` proves the ones that are about rows.

Every test here goes through the real `current_user` dependency, the real
token verifier, and the real membership lookup. Nothing is patched. A test
that monkeypatched authentication would prove only that the patch works.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration

ME = "/api/v1/auth/me"


# ---------------------------------------------------------------------------
# There is no unauthenticated path. Client, 2026-08-27.
# ---------------------------------------------------------------------------
async def test_no_token_is_rejected(client) -> None:
    response = await client.get(ME)
    assert response.status_code == 401


@pytest.mark.parametrize(
    "header",
    [
        "",
        "Bearer",
        "Bearer ",
        "Basic dXNlcjpwYXNz",
        "Bearer not.a.jwt",
        "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdHRhY2tlciJ9.",
    ],
    ids=["empty", "scheme-only", "scheme-space", "wrong-scheme", "garbage", "alg-none"],
)
async def test_malformed_credentials_are_rejected(client, header: str) -> None:
    """Including the classic `alg: none` forgery.

    That last case is why `LocalIdentityProvider` and `CognitoIdentityProvider`
    both pin `algorithms=["RS256"]`. A verifier that trusts the token's own
    `alg` header can be told not to verify at all.
    """
    response = await client.get(ME, headers={"Authorization": header})
    assert response.status_code == 401


async def test_expired_token_is_rejected(client, mint_token) -> None:
    headers, _ = mint_token(ttl_seconds=-60)
    assert (await client.get(ME, headers=headers)).status_code == 401


async def test_token_signed_by_a_different_key_is_rejected(client, mint_token) -> None:
    """A well-formed token from an issuer we do not trust.

    Constructed by standing up a second provider with its own keypair, which
    is the closest local analogue of someone presenting a token minted by a
    Cognito pool that is not ours.
    """
    from app.core.auth.local import LocalIdentityProvider
    from app.settings import get_settings

    foreign = LocalIdentityProvider(get_settings())
    token, _ = foreign.issue(pool="CANDIDATE")

    response = await client.get(ME, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["code"] == "invalid_token"


# ---------------------------------------------------------------------------
# First sign-in, and the identity that follows from it
# ---------------------------------------------------------------------------
async def test_first_sign_in_creates_exactly_one_user(client, mint_token) -> None:
    """And signing in again resolves the same row, not a second one.

    A candidate who ends up with two user rows has their score history split
    across both, and neither is right.
    """
    phone = f"+9198{uuid.uuid4().int % 10**8:08d}"
    headers, subject = mint_token(pool="CANDIDATE", phone=phone)

    first = await client.get(ME, headers=headers)
    assert first.status_code == 200, first.text
    user_id = first.json()["user_id"]

    # A different token, same subject: a second device, or a refreshed session.
    again, _ = mint_token(pool="CANDIDATE", subject=subject, phone=phone)
    second = await client.get(ME, headers=again)
    assert second.status_code == 200
    assert second.json()["user_id"] == user_id

    factory = sessions(_seed_url())
    try:
        async with factory() as session, session.begin():
            count = (
                await session.execute(
                    text("SELECT count(*) FROM users WHERE cognito_sub = :s"), {"s": subject}
                )
            ).scalar_one()
            assert count == 1
    finally:
        await _delete_user(subject)


async def test_the_provider_subject_never_appears_in_a_response(client, mint_token) -> None:
    """`cognito_sub` is an identifier in someone else's system.

    Our `users.id` is what clients see. Leaking the provider subject hands out
    a value that is meaningful to whoever else can talk to that pool.
    """
    headers, subject = mint_token(pool="CANDIDATE", phone=f"+9197{uuid.uuid4().int % 10**8:08d}")
    try:
        body = (await client.get(ME, headers=headers)).text
        assert subject not in body
    finally:
        await _delete_user(subject)


async def test_me_returns_the_callers_email_and_candidate_name(client, mint_token) -> None:
    """`/auth/me` carries the caller's own email, and a candidate's profile name."""
    email = f"{uuid.uuid4().hex[:10]}@example.test"
    headers, subject = mint_token(pool="CANDIDATE", email=email)
    try:
        before = (await client.get(ME, headers=headers)).json()
        assert before["email"] == email
        assert before["full_name"] is None  # nothing set yet: null, not an error

        named = await client.put(
            "/api/v1/candidate/profile/name", json={"full_name": "Asha Rao"}, headers=headers
        )
        assert named.status_code == 200, named.text

        after = (await client.get(ME, headers=headers)).json()
        assert after["full_name"] == "Asha Rao"
    finally:
        await _delete_user(subject)


async def test_a_business_account_has_an_email_and_no_name(
    client, mint_token, business_member
) -> None:
    headers, _ = mint_token(pool="BUSINESS", subject=business_member["subject"])
    body = (await client.get(ME, headers=headers)).json()
    assert body["email"] is not None
    assert body["full_name"] is None


async def test_a_candidate_has_no_tenant(client, mint_token) -> None:
    headers, subject = mint_token(pool="CANDIDATE", phone=f"+9196{uuid.uuid4().int % 10**8:08d}")
    try:
        body = (await client.get(ME, headers=headers)).json()
        assert body["role"] == "CANDIDATE"
        assert body["tenant_id"] is None
    finally:
        await _delete_user(subject)


# ---------------------------------------------------------------------------
# Authorisation comes from OUR tables, not from the token
# ---------------------------------------------------------------------------
async def test_membership_resolves_role_and_tenant(client, mint_token, business_member) -> None:
    headers, _ = mint_token(pool="BUSINESS", subject=business_member["subject"])

    body = (await client.get(ME, headers=headers)).json()
    assert body["role"] == "EMPLOYER_OWNER"
    assert body["tenant_id"] == str(business_member["tenant_id"])
    assert body["user_id"] == str(business_member["user_id"])


async def test_business_identity_without_a_membership_is_authorised_for_nothing(
    client, mint_token
) -> None:
    """Verified, and permitted nothing. The two are different answers.

    This is the shape of an invited-but-not-yet-added colleague, and of one
    whose access was just revoked.
    """
    headers, subject = mint_token(pool="BUSINESS", email=f"{uuid.uuid4().hex[:10]}@example.test")
    try:
        response = await client.get(ME, headers=headers)
        assert response.status_code == 403
        assert response.json()["code"] == "no_active_membership"
    finally:
        await _delete_user(subject)


async def test_a_candidate_pool_token_cannot_hold_a_business_role(
    client, mint_token, business_member
) -> None:
    """The pools are different assurance levels, not different labels.

    The business pool requires software-token MFA (SRS 1.3.4); the candidate
    pool does not. Honouring a business membership against a candidate-pool
    token would let an attacker skip MFA entirely by signing in on the other
    side of the product.
    """
    headers, _ = mint_token(pool="CANDIDATE", subject=business_member["subject"])

    response = await client.get(ME, headers=headers)
    assert response.status_code == 403
    assert response.json()["code"] == "pool_role_mismatch"


async def test_revoking_a_membership_takes_effect(client, mint_token, business_member) -> None:
    """The whole argument for not trusting token claims, demonstrated.

    The token is unchanged and still perfectly valid throughout. Access ends
    because the row changed, which is the property SRS 2.24.7 is really
    asking for.
    """
    headers, _ = mint_token(pool="BUSINESS", subject=business_member["subject"])
    assert (await client.get(ME, headers=headers)).status_code == 200

    from app.core.auth import membership as membership_lookup

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text("UPDATE memberships SET status = 'REVOKED' WHERE user_id = :u"),
            {"u": str(business_member["user_id"])},
        )
    await membership_lookup.invalidate(business_member["user_id"])

    after = await client.get(ME, headers=headers)
    assert after.status_code == 403
    assert after.json()["code"] == "no_active_membership"


async def test_suspending_a_tenant_ends_access_immediately(
    client, mint_token, business_member
) -> None:
    """Admin "stop operations" (client, 2026-08-24).

    An operational control that takes an hour to bite is not an operational
    control, so the membership query joins suspensions rather than leaving it
    to a nightly job.
    """
    headers, _ = mint_token(pool="BUSINESS", subject=business_member["subject"])
    assert (await client.get(ME, headers=headers)).status_code == 200

    from app.core.auth import membership as membership_lookup

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO tenant_suspensions "
                "(id, tenant_id, reason, suspended_by, suspended_at) "
                "VALUES (gen_random_uuid(), :t, 'test', :u, now())"
            ),
            {"t": str(business_member["tenant_id"]), "u": str(business_member["user_id"])},
        )
    await membership_lookup.invalidate(business_member["user_id"])

    assert (await client.get(ME, headers=headers)).status_code == 403

    async with factory() as session, session.begin():
        await session.execute(
            text("DELETE FROM tenant_suspensions WHERE tenant_id = :t"),
            {"t": str(business_member["tenant_id"])},
        )


async def test_a_suspended_user_cannot_authenticate(client, mint_token) -> None:
    """A valid token belonging to a disabled account.

    Account state is ours, not the identity provider's, so this must be
    enforced here even when the signature is impeccable.
    """
    headers, subject = mint_token(pool="CANDIDATE", phone=f"+9195{uuid.uuid4().int % 10**8:08d}")
    try:
        assert (await client.get(ME, headers=headers)).status_code == 200

        factory = sessions(_seed_url())
        async with factory() as session, session.begin():
            await session.execute(
                text("UPDATE users SET status = 'SUSPENDED' WHERE cognito_sub = :s"),
                {"s": subject},
            )

        response = await client.get(ME, headers=headers)
        assert response.status_code == 401
        assert response.json()["code"] == "account_inactive"
    finally:
        await _delete_user(subject)


# ---------------------------------------------------------------------------
# The membership cache is a cache, not the authority
# ---------------------------------------------------------------------------
async def test_membership_cache_bounds_revocation_lag(business_member) -> None:
    """The TTL is the backstop for a missed invalidation, and it is short.

    Asserted against the configured value rather than a literal so that
    changing the setting cannot quietly widen the window a revocation takes to
    apply without someone changing this line too.
    """
    from app.core.auth.membership import cache_key
    from app.core.cache import get_redis
    from app.settings import get_settings

    factory = sessions(_seed_url())
    from app.core.auth import membership as membership_lookup

    async with factory() as session, session.begin():
        await membership_lookup.resolve(session, business_member["user_id"])

    ttl = await get_redis().ttl(cache_key(business_member["user_id"]))
    assert 0 < ttl <= get_settings().membership_cache_ttl_seconds
    assert get_settings().membership_cache_ttl_seconds <= 60, (
        "a longer cache widens the window in which a revoked membership still works"
    )


async def test_a_candidate_lookup_does_not_hit_the_database_twice(client, mint_token) -> None:
    """ "No membership" is itself a cached answer.

    Candidates are the largest class of user and have no membership row. If
    absence were not cached, every candidate request would pay a database
    round trip to learn nothing.
    """
    from app.core.auth.membership import cache_key
    from app.core.cache import get_redis

    headers, subject = mint_token(pool="CANDIDATE", phone=f"+9194{uuid.uuid4().int % 10**8:08d}")
    try:
        user_id = (await client.get(ME, headers=headers)).json()["user_id"]
        cached = await get_redis().get(cache_key(uuid.UUID(user_id)))
        assert cached == "{}", "absence of a membership must be cached, not re-read"
    finally:
        await _delete_user(subject)


# ---------------------------------------------------------------------------
# The OTP outer throttle -- deferred with phone OTP (2026-09-18)
# ---------------------------------------------------------------------------
async def test_phone_otp_is_not_offered_while_it_is_deferred(client, app) -> None:
    """The client deferred phone OTP until the organisation's registration and
    DLT exist. The route is not registered, so no client can come to depend
    on it, and it is absent from the published API."""
    response = await client.post("/api/v1/auth/otp/start", json={"phone": "+919800000000"})
    assert response.status_code in (404, 405)
    assert "/api/v1/auth/otp/start" not in app.openapi()["paths"]


async def test_the_otp_throttle_still_limits_per_phone_for_when_it_returns() -> None:
    """Kept and tested at the service, so switching phone OTP back on is the
    Lambda triggers and a flag, not a rebuild. It sends nothing itself and
    never sees a code."""
    from app.core.errors import RateLimitedError
    from app.modules.identity import service as identity_service
    from app.settings import get_settings

    phone = f"+9193{uuid.uuid4().int % 10**8:08d}"
    limit = get_settings().otp_start_per_phone_per_hour
    for _ in range(limit):
        assert await identity_service.start_otp_challenge(phone=phone, client_ip=None) > 0
    with pytest.raises(RateLimitedError):
        await identity_service.start_otp_challenge(phone=phone, client_ip=None)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
async def _delete_user(subject: str) -> None:
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(text("DELETE FROM users WHERE cognito_sub = :s"), {"s": subject})
