"""Shared fixtures.

Integration tests use a real Postgres via docker-compose (locally) or the CI
service container. Never SQLite: RLS, JSONB, partial indexes and `SET LOCAL`
all behave differently there, and those are exactly what the tests exercise.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://bharatpath:bharatpath@localhost:5432/bharatpath"
)
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("ENVIRONMENT", "local")

# The test suite authenticates for real. Cognito cannot be reached from a test
# runner, so the local provider issues and verifies genuine RS256 tokens
# through the same code path -- see app/core/auth/local.py for why this is a
# substitute rather than a stub, and for the three mechanisms that keep it out
# of a deployed environment.
os.environ.setdefault("AUTH_ALLOW_LOCAL_TOKENS", "true")

# No gateway exists. The stub signs callbacks with a real HMAC, so the suite
# exercises verification rather than skipping it; Settings refuses it outside
# local and dev.
os.environ.setdefault("PAYMENTS_PROVIDER", "stub")
# One test "IP" makes more requests a minute than any person could. The
# global tier is switched on by `tests/integration/test_rate_limits.py`.
os.environ.setdefault("RATE_LIMIT_GLOBAL_ENABLED", "false")
# No test may call a model or a speech service, whatever a developer's .env
# switches on for the running API. Assigned, not defaulted, for that reason;
# tests that need a provider pass one explicitly or fake its transport.
os.environ["SCORING_EXTRACTION_ENABLED"] = "false"
os.environ["INTERVIEW_EVALUATION_PROVIDER"] = "none"
os.environ["INTERVIEW_TRANSCRIPTION_PROVIDER"] = "none"
# The question writer has no "none": tests use the stub, never the model.
os.environ["INTERVIEW_QUESTION_PROVIDER"] = "stub"
os.environ["OPENAI_API_KEY"] = ""
os.environ["SARVAM_API_KEY"] = ""

# Complete `Base.metadata` for every test, not just the ones that happen to
# build the app. A test that imports one module's models alone cannot resolve
# a foreign key into another module's table, and the failure
# (`NoReferencedTableError`) points at SQLAlchemy rather than at the missing
# import. See app/core/metadata.py.
from app.core.metadata import load_all_models

load_all_models()


@pytest.fixture(scope="session")
def app():
    from app.main import create_app

    return create_app()


@pytest.fixture
async def client(app) -> AsyncIterator[object]:
    from httpx import ASGITransport, AsyncClient

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def _seed_url() -> str:
    """The connection used to create test data.

    **The migrator role.** Seeding needs two powers at once:

      * write access -- the admin role has BYPASSRLS but is SELECT-only by
        design, because a role that can cross every tenant boundary AND write
        is the most dangerous credential in the system;
      * BYPASSRLS -- tenant-scoped tables carry FORCE ROW LEVEL SECURITY, so
        the policy applies even to the table owner, and a fixture seeding two
        different tenants has no single `app.tenant_id` it could set.

    Only the migrator has both. This is the same capability a data migration
    needs when it backfills a tenant-scoped column, so if this breaks, real
    migrations are broken too.

    Seeding with bypass and then READING through the app role is also
    production's shape: privileged writes, tenant-scoped reads.
    """
    return (
        os.getenv("DATABASE_URL_MIGRATOR")
        or os.getenv("DATABASE_ADMIN_URL")
        or os.getenv("DATABASE_URL", "")
    )


def sessions(url: str) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(create_async_engine(url), expire_on_commit=False)


async def subscribe_tenant(tenant_id: uuid.UUID | str, *, lapsed: bool = False) -> uuid.UUID:
    """An employer subscription for `tenant_id`, seeded as the migrator.

    Employer actions need an active one (R15), and so does opening a profile:
    for an employer the subscription IS the access window (R14). `lapsed`
    seeds a period that ended ten days ago. Returns the subscription id, so a
    test can end the window mid-session.
    """
    from datetime import UTC, datetime, timedelta

    now = datetime.now(UTC)
    start, end = (
        (now - timedelta(days=40), now - timedelta(days=10))
        if lapsed
        else (now - timedelta(days=1), now + timedelta(days=29))
    )
    plan_id, subscription_id = uuid.uuid4(), uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO plans (id, audience, code, period, price_minor, entitlements, "
                "active, version) VALUES (:p, 'EMPLOYER', :c, 'MONTHLY', 999900, "
                "'{}'::jsonb, true, 1)"
            ),
            {"p": str(plan_id), "c": f"TEST_EMP_{plan_id.hex[:16]}"},
        )
        await session.execute(
            text(
                "INSERT INTO subscriptions (id, subscriber_type, subscriber_id, plan_id, state, "
                "current_period_start, current_period_end, renews_automatically) "
                "VALUES (:id, 'TENANT', :t, :p, 'ACTIVE', :s, :e, false)"
            ),
            {
                "id": str(subscription_id),
                "t": str(tenant_id),
                "p": str(plan_id),
                "s": start,
                "e": end,
            },
        )
    return subscription_id


@pytest.fixture
async def seeded_tenants() -> AsyncIterator[tuple[uuid.UUID, uuid.UUID]]:
    """Two employer tenants, each with an approved employer and a live job.

    Function-scoped on purpose. A module-scoped async fixture needs its event
    loop scope to match under pytest-asyncio, which is a footgun for no gain
    here - seeding four rows costs microseconds and per-test isolation means
    one failing test cannot leave state that breaks the next.
    """
    engine = create_async_engine(_seed_url())
    factory = async_sessionmaker(engine, expire_on_commit=False)

    tenant_a, tenant_b = uuid.uuid4(), uuid.uuid4()

    async with factory() as session, session.begin():
        for tenant_id, name in ((tenant_a, "Tenant A"), (tenant_b, "Tenant B")):
            await session.execute(
                text(
                    "INSERT INTO tenants (id, type, name, status) "
                    "VALUES (:i, 'EMPLOYER', :n, 'ACTIVE')"
                ),
                {"i": str(tenant_id), "n": name},
            )
            await session.execute(
                text(
                    "INSERT INTO employers (tenant_id, legal_name, kyb_status) "
                    "VALUES (:i, :n, 'APPROVED')"
                ),
                {"i": str(tenant_id), "n": name},
            )
            await session.execute(
                text(
                    "INSERT INTO jobs (id, tenant_id, title, description, "
                    "salary_min_minor, salary_max_minor, status) "
                    "VALUES (gen_random_uuid(), :i, 'Role', 'Desc', "
                    "1000000, 2000000, 'PUBLISHED')"
                ),
                {"i": str(tenant_id)},
            )

    yield tenant_a, tenant_b

    # Children first. `TenantScoped.tenant_id` is ON DELETE RESTRICT on
    # purpose -- a tenant row that could be deleted out from under its jobs
    # and applications would take the audit trail's meaning with it -- so
    # teardown has to unwind in dependency order rather than rely on a
    # cascade that deliberately does not exist.
    ids = [str(tenant_a), str(tenant_b)]
    async with factory() as session, session.begin():
        for table in ("jobs", "employers"):
            await session.execute(
                text(f"DELETE FROM {table} WHERE tenant_id = ANY(:ids)"), {"ids": ids}
            )
        await session.execute(text("DELETE FROM tenants WHERE id = ANY(:ids)"), {"ids": ids})
    await engine.dispose()


@pytest.fixture
async def seeded_candidate() -> AsyncIterator[tuple[uuid.UUID, uuid.UUID]]:
    """One candidate with a confirmed resume version, for score tests."""
    engine = create_async_engine(_seed_url())
    factory = async_sessionmaker(engine, expire_on_commit=False)

    user_id, version_id = uuid.uuid4(), uuid.uuid4()

    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, status, locale) "
                "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "p": f"+9199{uuid.uuid4().int % 10**8:08d}"},
        )
        await session.execute(
            text(
                "INSERT INTO resume_versions (id, user_id, source, parsed, "
                "confirmed_at) VALUES (:v, :u, 'UPLOAD', '{}'::jsonb, now())"
            ),
            {"v": str(version_id), "u": str(user_id)},
        )

    yield user_id, version_id

    async with factory() as session, session.begin():
        await session.execute(text("DELETE FROM users WHERE id = :u"), {"u": str(user_id)})
    await engine.dispose()


# ---------------------------------------------------------------------------
# Authentication fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def local_provider():
    """The process-wide local identity provider.

    Session-scoped because the signing key is generated per provider instance:
    a fresh one per test would mint tokens the application's own provider
    cannot verify, and the failure would look like a verification bug.
    """
    from app.core.auth.local import LocalIdentityProvider
    from app.core.auth.provider import get_identity_provider

    provider = get_identity_provider()
    assert isinstance(provider, LocalIdentityProvider), (
        "tests must run against the local identity provider; set AUTH_ALLOW_LOCAL_TOKENS=true"
    )
    return provider


@pytest.fixture
def mint_token(local_provider):
    """Mint a bearer header for an arbitrary identity.

    Returns `(headers, subject)`. Tests that need the resulting user row look
    it up by subject rather than being handed an id, because creating the row
    is itself part of what is under test.
    """

    def _mint(pool="CANDIDATE", subject=None, phone=None, email=None, ttl_seconds=None):
        token, sub = local_provider.issue(
            subject=subject, pool=pool, phone=phone, email=email, ttl_seconds=ttl_seconds
        )
        return {"Authorization": f"Bearer {token}"}, sub

    return _mint


@pytest.fixture
async def business_member() -> AsyncIterator[dict]:
    """A business user with an ACTIVE membership in a fresh employer tenant.

    Yields the ids plus the Cognito subject, so a test can mint a token for
    this identity and get back a fully resolved employer context.
    """
    engine = create_async_engine(_seed_url())
    factory = async_sessionmaker(engine, expire_on_commit=False)

    tenant_id, user_id = uuid.uuid4(), uuid.uuid4()
    subject = f"local-test-{uuid.uuid4()}"

    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO tenants (id, type, name, status) "
                "VALUES (:t, 'EMPLOYER', 'Auth Fixture Co', 'ACTIVE')"
            ),
            {"t": str(tenant_id)},
        )
        await session.execute(
            text(
                "INSERT INTO employers (tenant_id, legal_name, kyb_status) "
                "VALUES (:t, 'Auth Fixture Co', 'APPROVED')"
            ),
            {"t": str(tenant_id)},
        )
        await session.execute(
            text(
                "INSERT INTO users (id, cognito_sub, pool, email, status, locale) "
                "VALUES (:u, :s, 'BUSINESS', :e, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "s": subject, "e": f"{uuid.uuid4().hex[:12]}@example.test"},
        )
        await session.execute(
            text(
                "INSERT INTO memberships (id, user_id, tenant_id, role, status) "
                "VALUES (gen_random_uuid(), :u, :t, 'EMPLOYER_OWNER', 'ACTIVE')"
            ),
            {"u": str(user_id), "t": str(tenant_id)},
        )

    # A cached membership from an earlier test using a recycled id would make
    # this fixture's state invisible. Cheap to clear, confusing to debug.
    await _clear_membership_cache(user_id)

    yield {"tenant_id": tenant_id, "user_id": user_id, "subject": subject}

    async with factory() as session, session.begin():
        await session.execute(
            text("DELETE FROM memberships WHERE user_id = :u"), {"u": str(user_id)}
        )
        await session.execute(text("DELETE FROM users WHERE id = :u"), {"u": str(user_id)})
        await session.execute(
            text("DELETE FROM employers WHERE tenant_id = :t"), {"t": str(tenant_id)}
        )
        await session.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": str(tenant_id)})
    await _clear_membership_cache(user_id)
    await engine.dispose()


async def _clear_membership_cache(user_id: uuid.UUID) -> None:
    from app.core.auth import membership as membership_lookup

    await membership_lookup.invalidate(user_id)


@pytest.fixture(autouse=True)
async def _dispose_process_clients() -> AsyncIterator[None]:
    """Close the process-wide Redis client after every test.

    `app.core.cache.get_redis()` memoises one client for the process, which is
    right in production -- there is one event loop for the life of the service,
    and the pool should be shared. Under pytest-asyncio each test gets its own
    event loop, so a client created in one test holds connections bound to a
    loop that is closed by the time the next test runs. The symptom is
    bewildering: tests pass individually and fail in a suite, and the error
    surfaces as `RuntimeError: Event loop is closed` inside whatever happened
    to touch Redis first -- which the rate limiter then reports as
    `ratelimit_backend_unavailable`, blaming the wrong component entirely.

    The database engines have the same shape and the same problem -- asyncpg
    connections pooled on one loop, closed on the next, surfacing as
    `RuntimeError: Event loop is closed` from deep inside connection teardown.

    Disposing here is exactly what `lifespan` does on shutdown, so this is the
    production teardown path running per test rather than a test-only hack.

    Rate-limit counters are cleared on the way in for a different reason.
    Every test drives the app through the same ASGI transport, so they all
    share one client address and therefore one `ratelimit:otp:ip` counter,
    which survives in Redis for the length of its window. Nothing resets it
    between tests, so a long enough run eventually trips the per-IP limit and
    the failure lands on whichever test happens to be running -- typically one
    asserting something else entirely, and always passing when run alone.
    Clearing at setup rather than teardown means a test that fails midway
    still cannot poison the next one.
    """
    from app.core.cache import get_redis

    redis = get_redis()
    keys = [key async for key in redis.scan_iter("ratelimit:*")]
    if keys:
        await redis.delete(*keys)

    yield

    from app.core.cache import dispose_redis
    from app.core.db import dispose_engines

    await dispose_redis()
    await dispose_engines()
