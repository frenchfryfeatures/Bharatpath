"""Tenant isolation, row-level security and grants, proven against a real Postgres.

Never SQLite. RLS, `SET LOCAL`, partial indexes and JSONB all behave
differently there, and those are precisely what these tests exercise - a
green run against SQLite would prove nothing at all.

These are skipped when no database is reachable, so a laptop without Docker
can still run the rest of the suite. **CI has Postgres and must not skip
them** - `test_database_is_actually_available` fails loudly if the CI marker
is set and the database is missing, so a silent skip cannot masquerade as a
pass.
"""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import set_transaction_tenant

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]

APP_URL = os.getenv("DATABASE_URL_APP") or os.getenv("DATABASE_URL", "")
# Writes go through the migrator: it is the only role with BOTH write access
# and BYPASSRLS. Tenant-scoped tables carry FORCE ROW LEVEL SECURITY so the
# policy applies to the owner too, and a fixture seeding two different tenants
# has no single app.tenant_id it could set. The admin role bypasses RLS but is
# SELECT-only by design; the app role has neither power.
SEED_URL = os.getenv("DATABASE_URL_MIGRATOR") or os.getenv("DATABASE_ADMIN_URL") or APP_URL
ADMIN_URL = os.getenv("DATABASE_ADMIN_URL", "")
IN_CI = os.getenv("CI") == "true"


def _sessions(url: str) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(create_async_engine(url), expire_on_commit=False)


async def _db_reachable(url: str) -> bool:
    if not url:
        return False
    try:
        engine = create_async_engine(url)
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        await engine.dispose()
        return True
    except Exception:
        return False


@pytest.fixture(scope="module", autouse=True)
async def _require_db() -> None:
    if not await _db_reachable(APP_URL):
        if IN_CI:
            pytest.fail(
                "CI must run these against a real Postgres. A skip here would "
                "let the tenant-isolation and append-only guarantees go "
                "unverified while the build still went green."
            )
        pytest.skip("no database reachable - start docker compose up -d postgres")


# ---------------------------------------------------------------------------
# INVARIANT 7 / SRS 2.24.7 - tenant isolation
# ---------------------------------------------------------------------------


async def test_unset_tenant_returns_no_rows_not_all_rows(seeded_tenants) -> None:
    """Forgetting to set the tenant must fail CLOSED.

    This is the single most important property of the RLS design. The policy
    compares against `current_setting('app.tenant_id', true)`, which is NULL
    when unset; a NULL comparison matches nothing. The failure mode of a
    forgotten `SET LOCAL` is therefore an empty result, not the whole table.
    """
    # seeded_tenants has just written two jobs. Without rows present this
    # assertion would pass against an empty table and prove nothing.
    async with _sessions(APP_URL)() as session, session.begin():
        rows = (await session.execute(text("SELECT count(*) FROM jobs"))).scalar_one()
        assert rows == 0, (
            "RLS is not filtering with app.tenant_id unset. Either the policy "
            "is missing, or the application role owns the tables / holds "
            "BYPASSRLS - in which case RLS is doing nothing at all."
        )


async def test_tenant_a_cannot_see_tenant_b(seeded_tenants) -> None:
    """The core cross-tenant assertion, at the database layer."""
    tenant_a, tenant_b = seeded_tenants

    async with _sessions(APP_URL)() as session, session.begin():
        await set_transaction_tenant(session, tenant_a)
        visible = (await session.execute(text("SELECT tenant_id FROM jobs"))).scalars().all()

    assert all(str(t) == str(tenant_a) for t in visible)
    assert str(tenant_b) not in [str(t) for t in visible]


async def test_set_local_does_not_leak_across_transactions(seeded_tenants) -> None:
    """The transaction-local setting dies with its transaction.

    This is why the session dependency sets `app.tenant_id` locally rather
    than for the session: a pooled connection must not carry one request's
    tenancy into the next request that happens to reuse it.
    """
    tenant_a, _ = seeded_tenants
    factory = _sessions(APP_URL)

    async with factory() as session, session.begin():
        await set_transaction_tenant(session, tenant_a)

    async with factory() as session, session.begin():
        setting = (
            await session.execute(text("SELECT current_setting('app.tenant_id', true)"))
        ).scalar_one()
        assert setting in (None, ""), "tenant setting survived its transaction"


# ---------------------------------------------------------------------------
# INVARIANT 7' / PRD rule 9 - the audit trail is append-only
# ---------------------------------------------------------------------------


async def test_audit_events_cannot_be_updated_or_deleted() -> None:
    """Revoked at the role level, so even a bug cannot rewrite history."""
    factory = _sessions(APP_URL)

    for statement in (
        "UPDATE audit_events SET action = 'tampered'",
        "DELETE FROM audit_events",
    ):
        async with factory() as session, session.begin():
            with pytest.raises((ProgrammingError, DBAPIError)) as exc:
                await session.execute(text(statement))
            assert "permission denied" in str(exc.value).lower(), (
                f"{statement!r} was not refused by the database"
            )


# ---------------------------------------------------------------------------
# INVARIANT 3 - the score is never human-editable
# ---------------------------------------------------------------------------


async def test_scores_are_insert_only() -> None:
    """No route accepts a score, and the database will not accept one either.

    "Score history" is every row of this table. Nothing is ever mutated, so an
    old score can always be replayed and compared.
    """
    factory = _sessions(APP_URL)

    for statement in (
        "UPDATE scores SET raw_value = 990",
        "DELETE FROM scores",
    ):
        async with factory() as session, session.begin():
            with pytest.raises((ProgrammingError, DBAPIError)) as exc:
                await session.execute(text(statement))
            assert "permission denied" in str(exc.value).lower()


@pytest.mark.parametrize(
    ("raw", "base", "addon", "why"),
    [
        (1200, 900, 90, "above the 990 ceiling"),
        (650, 650, 0, "below the 700 base"),
        (995, 900, 95, "add-on total above the +90 cap"),
        (800, 700, 50, "raw_value does not equal base + addon"),
    ],
)
async def test_score_constraints_are_enforced_by_the_database(
    seeded_candidate, raw: int, base: int, addon: int, why: str
) -> None:
    """INVARIANT 2 and 4-prime, checked below the application.

    Uses REAL parent rows deliberately. An earlier version passed random
    UUIDs for user_id and resume_version_id, so every insert died on a
    foreign-key violation before the CHECK constraints were ever evaluated -
    a green test that proved the foreign keys worked and said nothing at all
    about the score bounds.
    """
    user_id, version_id = seeded_candidate

    async with _sessions(SEED_URL)() as session, session.begin():
        with pytest.raises((DBAPIError, ProgrammingError)) as exc:
            await session.execute(
                text(
                    "INSERT INTO scores (id, user_id, resume_version_id, "
                    "algorithm_version, raw_value, base_value, addon_value, "
                    "contribution_version) VALUES (gen_random_uuid(), "
                    ":u, :v, 'v0', :raw, :base, :addon, 'v1')"
                ),
                {
                    "u": str(user_id),
                    "v": str(version_id),
                    "raw": raw,
                    "base": base,
                    "addon": addon,
                },
            )
        # It must be a CHECK violation, not a foreign key one.
        assert "ck_scores" in str(exc.value), f"expected a CHECK failure for: {why}"


async def test_a_valid_score_is_accepted(seeded_candidate) -> None:
    """The constraints must not be so tight that a legitimate score fails.

    790 = 700 base + 30 (one course) + 60 (three interviews), with a resume
    judged at 0. The exact worked example the client gave on 2026-08-27.
    """
    user_id, version_id = seeded_candidate

    async with _sessions(SEED_URL)() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO scores (id, user_id, resume_version_id, "
                "algorithm_version, raw_value, base_value, addon_value, "
                "contribution_version) VALUES (gen_random_uuid(), "
                ":u, :v, 'v0-placeholder', 790, 700, 90, 'v1')"
            ),
            {"u": str(user_id), "v": str(version_id)},
        )


# ---------------------------------------------------------------------------
# INVARIANT 8 - no publish before KYB, below the service layer
# ---------------------------------------------------------------------------


async def test_publish_gate_fires_on_a_direct_insert(seeded_tenants) -> None:
    """The test bypasses the API *and* the service and must still fail.

    A gate that lives only in application code is a gate a future refactor can
    route around. This one is a Postgres trigger.
    """
    tenant_a, _ = seeded_tenants

    async with _sessions(SEED_URL)() as session, session.begin():
        await session.execute(
            text("UPDATE employers SET kyb_status = 'DRAFT' WHERE tenant_id = :t"),
            {"t": str(tenant_a)},
        )
        with pytest.raises((DBAPIError, ProgrammingError)) as exc:
            await session.execute(
                text(
                    "INSERT INTO jobs (id, tenant_id, title, description, "
                    "salary_min_minor, salary_max_minor, status) "
                    "VALUES (gen_random_uuid(), :t, 'x', 'y', 100, 200, 'PUBLISHED')"
                ),
                {"t": str(tenant_a)},
            )
        assert "KYB_REQUIRED" in str(exc.value)


# ---------------------------------------------------------------------------
# Duplicate application prevention - a constraint, not a race
# ---------------------------------------------------------------------------


async def test_duplicate_active_application_is_refused(seeded_tenants) -> None:
    """Not to be confused with the duplicate-CV rule the client dropped.

    This is a partial unique index, it is a different mechanism entirely, and
    it stays.
    """
    tenant_a, _ = seeded_tenants
    job_id, candidate_id = uuid.uuid4(), uuid.uuid4()

    async with _sessions(SEED_URL)() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, status, locale) "
                "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(candidate_id), "p": f"+9198{uuid.uuid4().int % 10**8:08d}"},
        )
        await session.execute(
            text("UPDATE employers SET kyb_status = 'APPROVED' WHERE tenant_id = :t"),
            {"t": str(tenant_a)},
        )
        await session.execute(
            text(
                "INSERT INTO jobs (id, tenant_id, title, description, "
                "salary_min_minor, salary_max_minor, status) "
                "VALUES (:j, :t, 'x', 'y', 100, 200, 'PUBLISHED')"
            ),
            {"j": str(job_id), "t": str(tenant_a)},
        )

        insert_application = text(
            "INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage) "
            "VALUES (gen_random_uuid(), :t, :j, :c, 'SUBMITTED')"
        )
        params = {"t": str(tenant_a), "j": str(job_id), "c": str(candidate_id)}
        await session.execute(insert_application, params)

        with pytest.raises((DBAPIError, ProgrammingError)):
            await session.execute(insert_application, params)


# ---------------------------------------------------------------------------
# Role capabilities - the properties migrations and admin drill-downs depend on
# ---------------------------------------------------------------------------


async def test_migrator_can_write_to_a_tenant_scoped_table() -> None:
    """Data migrations depend on this, and it is easy to break.

    Tenant-scoped tables carry FORCE ROW LEVEL SECURITY, so the policy applies
    to the table OWNER too. The migrator owns every table, so without
    BYPASSRLS it could not write a single row to a tenant-scoped one - and
    `app.tenant_id` is unset during a migration, with no single value a
    backfill across several tenants could use anyway.

    This broke first as "permission denied" in the fixtures. The fixtures were
    the messenger; the real casualty would have been the first migration that
    backfilled a tenant-scoped column.
    """
    import uuid as _uuid

    tenant_id = _uuid.uuid4()
    async with _sessions(SEED_URL)() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO tenants (id, type, name, status) "
                "VALUES (:i, 'EMPLOYER', 'Migrator write check', 'ACTIVE')"
            ),
            {"i": str(tenant_id)},
        )
        # employers is tenant-scoped and FORCE RLS - this is the real assertion.
        await session.execute(
            text(
                "INSERT INTO employers (tenant_id, legal_name, kyb_status) "
                "VALUES (:i, 'Check', 'DRAFT')"
            ),
            {"i": str(tenant_id)},
        )
        await session.execute(text("DELETE FROM tenants WHERE id = :i"), {"i": str(tenant_id)})


@pytest.mark.skipif(not ADMIN_URL, reason="DATABASE_ADMIN_URL not configured")
async def test_admin_role_reads_across_tenants_but_cannot_write(
    seeded_tenants,
) -> None:
    """The admin bypass role has exactly one of the two dangerous powers.

    It must see across tenants, because admin drill-downs are cross-tenant by
    definition (SRS 1.17.4-1.17.6). It must NOT be able to write, because a
    credential that can cross every tenant boundary *and* mutate data is the
    most dangerous one in the system. Admin actions that genuinely write go
    through the app role with an explicit tenant context, so they stay inside
    RLS and inside the audit path.
    """
    tenant_a, tenant_b = seeded_tenants

    async with _sessions(ADMIN_URL)() as session, session.begin():
        visible = (await session.execute(text("SELECT tenant_id FROM jobs"))).scalars().all()
        seen = {str(t) for t in visible}
        assert {str(tenant_a), str(tenant_b)} <= seen, (
            "admin role cannot see across tenants - drill-downs would be blind"
        )

    async with _sessions(ADMIN_URL)() as session, session.begin():
        with pytest.raises((ProgrammingError, DBAPIError)) as exc:
            await session.execute(
                text("UPDATE jobs SET title = 'tampered'"),
            )
        assert "permission denied" in str(exc.value).lower()


async def test_app_role_is_not_a_table_owner() -> None:
    """The property the whole three-role split exists to guarantee.

    RLS does not apply to a table's owner. If the application role ever ended
    up owning a table, every policy on it would become decorative - visible in
    the catalog, enforcing nothing, with no error anywhere.
    """
    async with _sessions(SEED_URL)() as session, session.begin():
        owned = (
            (
                await session.execute(
                    text(
                        "SELECT tablename FROM pg_tables "
                        "WHERE schemaname = 'public' AND tableowner = :role"
                    ),
                    {"role": "bharatpath_app"},
                )
            )
            .scalars()
            .all()
        )
    assert not owned, (
        f"bharatpath_app owns {list(owned)} - RLS does not apply to owners, so "
        "tenant isolation is disabled on those tables"
    )
