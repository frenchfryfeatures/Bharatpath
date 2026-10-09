"""At the database layer: what a candidate transaction can read and write.

The HTTP tests prove the service behaves. These prove what is left if it does
not -- a repository called directly on an app-role session, with nothing but
the candidate policies between it and the data.
"""

from __future__ import annotations

import os
import uuid
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from app.core.db import set_transaction_tenant, set_transaction_user
from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration

APP_URL = os.getenv("DATABASE_URL", "")


async def _user(pool: str) -> uuid.UUID:
    user_id = uuid.uuid4()
    contact = (
        {"phone": f"+9196{uuid.uuid4().int % 10**8:08d}", "email": None}
        if pool == "CANDIDATE"
        else {"phone": None, "email": f"{uuid.uuid4().hex[:12]}@example.test"}
    )
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, email, status, locale) "
                "VALUES (:u, :pool, :phone, :email, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "pool": pool, **contact},
        )
    return user_id


async def _job(tenant_id: uuid.UUID, status: str) -> uuid.UUID:
    job_id = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO jobs (id, tenant_id, title, description, salary_min_minor, "
                "salary_max_minor, status) VALUES (:j, :t, 'RLS job', 'd', 1, 2, :s)"
            ),
            {"j": str(job_id), "t": str(tenant_id), "s": status},
        )
    return job_id


async def _published_job(tenant_id: uuid.UUID) -> uuid.UUID:
    async with sessions(_seed_url())() as session:
        return uuid.UUID(
            str(
                await session.scalar(
                    text("SELECT id FROM jobs WHERE tenant_id = :t AND status = 'PUBLISHED'"),
                    {"t": str(tenant_id)},
                )
            )
        )


async def _seed_application(tenant_id: uuid.UUID, job_id: uuid.UUID, candidate: uuid.UUID) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage) "
                "VALUES (gen_random_uuid(), :t, :j, :c, 'SUBMITTED')"
            ),
            {"t": str(tenant_id), "j": str(job_id), "c": str(candidate)},
        )


def _insert_application(tenant_id: uuid.UUID, job_id: uuid.UUID, candidate: uuid.UUID) -> Any:
    return (
        text(
            "INSERT INTO applications (id, tenant_id, job_id, candidate_id, stage) "
            "VALUES (gen_random_uuid(), :t, :j, :c, 'SUBMITTED')"
        ),
        {"t": str(tenant_id), "j": str(job_id), "c": str(candidate)},
    )


# --- the board ------------------------------------------------------------------
async def test_a_candidate_reads_published_jobs_and_no_others(seeded_tenants) -> None:
    tenant_a, tenant_b = seeded_tenants
    draft = await _job(tenant_a, "DRAFT")
    candidate = await _user("CANDIDATE")

    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_user(session, candidate)
        rows = (
            await session.execute(
                text("SELECT id, status FROM jobs WHERE tenant_id IN (:a, :b)"),
                {"a": str(tenant_a), "b": str(tenant_b)},
            )
        ).all()
    assert len(rows) == 2
    assert {row.status for row in rows} == {"PUBLISHED"}
    assert draft not in {row.id for row in rows}


async def test_a_business_account_bound_as_a_user_sees_nothing(seeded_tenants) -> None:
    """`app.user_id` is honoured only for an active candidate account."""
    business = await _user("BUSINESS")
    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_user(session, business)
        assert await session.scalar(text("SELECT count(*) FROM jobs")) == 0
        assert await session.scalar(text("SELECT count(*) FROM employers")) == 0


async def test_a_bound_tenant_switches_the_candidate_policies_off(seeded_tenants) -> None:
    """A business transaction always binds its tenant, so the board policy can
    never widen what an employer sees."""
    tenant_a, _ = seeded_tenants
    candidate = await _user("CANDIDATE")
    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_user(session, candidate)
        await set_transaction_tenant(session, tenant_a)
        tenants = (await session.execute(text("SELECT DISTINCT tenant_id FROM jobs"))).scalars()
        assert [str(t) for t in tenants] == [str(tenant_a)]


async def test_a_candidate_cannot_change_a_job(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    candidate = await _user("CANDIDATE")
    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_user(session, candidate)
        result = await session.execute(
            text("UPDATE jobs SET title = 'Taken over' WHERE tenant_id = :t"),
            {"t": str(tenant_a)},
        )
        assert result.rowcount == 0


async def test_a_published_job_always_has_a_publication_time(seeded_tenants) -> None:
    """The fixture inserts PUBLISHED rows without `published_at`; the trigger
    stamps them, and the board's cursor depends on it."""
    tenant_a, tenant_b = seeded_tenants
    async with sessions(_seed_url())() as session:
        missing = await session.scalar(
            text(
                "SELECT count(*) FROM jobs WHERE tenant_id IN (:a, :b) "
                "AND status = 'PUBLISHED' AND published_at IS NULL"
            ),
            {"a": str(tenant_a), "b": str(tenant_b)},
        )
    assert missing == 0


async def test_employer_names_are_readable_only_for_employers_on_the_board(
    seeded_tenants,
) -> None:
    tenant_a, _ = seeded_tenants
    hidden = uuid.uuid4()
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO tenants (id, type, name, status) "
                "VALUES (:t, 'EMPLOYER', 'H', 'ACTIVE')"
            ),
            {"t": str(hidden)},
        )
        await session.execute(
            text(
                "INSERT INTO employers (tenant_id, legal_name, kyb_status) "
                "VALUES (:t, 'H', 'DRAFT')"
            ),
            {"t": str(hidden)},
        )
    await _job(hidden, "DRAFT")
    candidate = await _user("CANDIDATE")

    try:
        async with sessions(APP_URL)() as session, session.begin():
            await set_transaction_user(session, candidate)
            visible = (
                await session.execute(
                    text("SELECT tenant_id FROM employers WHERE tenant_id IN (:a, :h)"),
                    {"a": str(tenant_a), "h": str(hidden)},
                )
            ).scalars()
            assert [str(t) for t in visible] == [str(tenant_a)]
    finally:
        async with sessions(_seed_url())() as session, session.begin():
            for table in ("jobs", "employers"):
                await session.execute(
                    text(f"DELETE FROM {table} WHERE tenant_id = :t"),
                    {"t": str(hidden)},
                )
            await session.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": str(hidden)})


# --- applications -----------------------------------------------------------------
async def test_a_candidate_reads_only_their_own_applications(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    job = await _published_job(tenant_a)
    mine, theirs = await _user("CANDIDATE"), await _user("CANDIDATE")
    await _seed_application(tenant_a, job, mine)
    await _seed_application(tenant_a, job, theirs)

    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_user(session, mine)
        owners = (await session.execute(text("SELECT candidate_id FROM applications"))).scalars()
        assert [str(o) for o in owners] == [str(mine)]
        touched = await session.execute(
            text("UPDATE applications SET stage = 'WITHDRAWN' WHERE candidate_id = :c"),
            {"c": str(theirs)},
        )
        assert touched.rowcount == 0


async def test_a_candidate_cannot_apply_as_someone_else(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    job = await _published_job(tenant_a)
    me, someone = await _user("CANDIDATE"), await _user("CANDIDATE")
    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_user(session, me)
        with pytest.raises((DBAPIError, ProgrammingError)) as refused:
            await session.execute(*_insert_application(tenant_a, job, someone))
    assert "row-level security" in str(refused.value)


async def test_a_candidate_cannot_apply_to_a_job_that_is_not_live(seeded_tenants) -> None:
    tenant_a, _ = seeded_tenants
    draft = await _job(tenant_a, "DRAFT")
    me = await _user("CANDIDATE")
    async with sessions(APP_URL)() as session, session.begin():
        await set_transaction_user(session, me)
        with pytest.raises((DBAPIError, ProgrammingError)) as refused:
            await session.execute(*_insert_application(tenant_a, draft, me))
    assert "row-level security" in str(refused.value)


async def test_an_application_cannot_be_filed_under_another_tenant(seeded_tenants) -> None:
    """Even for the migrator, which bypasses every policy: a key, not a policy."""
    tenant_a, tenant_b = seeded_tenants
    job_of_a = await _published_job(tenant_a)
    me = await _user("CANDIDATE")
    async with sessions(_seed_url())() as session, session.begin():
        with pytest.raises((DBAPIError, ProgrammingError)) as refused:
            await session.execute(*_insert_application(tenant_b, job_of_a, me))
    assert "fk_applications_job_tenant" in str(refused.value)
