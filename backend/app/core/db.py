"""Database engine, session factories, and the RLS session dependency.

Tenant isolation is defence in depth, three layers (docs/plan.md section 5.1):

  1. Postgres Row-Level Security on every tenant-scoped table.
  2. `SET LOCAL app.tenant_id` at the start of every transaction, resolved from
     the authenticated user's membership - never from client input.
  3. A repository-level filter as belt and braces.

`SET LOCAL` is the important detail: it dies with the transaction, so a pooled
connection cannot carry one request's tenancy into the next request.
"""

from __future__ import annotations

import ssl
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.settings import get_settings


def connect_args_for(url: str) -> dict[str, Any]:
    """Extra asyncpg connect args for a given database URL.

    Neon requires TLS, so any ``*.neon.tech`` host gets an SSL context. Disabling
    asyncpg's statement cache keeps the pooled (PgBouncer) endpoint safe too;
    it is a harmless no-op on the direct endpoint we normally use. Local
    Postgres matches neither branch and is left untouched.
    """
    try:
        host = make_url(url).host or ""
    except Exception:  # a malformed URL surfaces later, at connect time
        return {}
    if host.endswith(".neon.tech"):
        return {"ssl": ssl.create_default_context(), "statement_cache_size": 0}
    return {}


class Base(DeclarativeBase):
    """Declarative base for every ORM model in the service."""

    __allow_unmapped__ = False


_engine: AsyncEngine | None = None
_admin_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None
_admin_session_factory: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    """The application engine. Connects as a role WITHOUT BYPASSRLS."""
    global _engine
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            str(settings.database_url),
            pool_size=settings.database_pool_size,
            max_overflow=settings.database_max_overflow,
            pool_pre_ping=True,
            echo=settings.database_echo,
            connect_args=connect_args_for(str(settings.database_url)),
        )
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(get_engine(), expire_on_commit=False, autoflush=False)
    return _session_factory


def get_admin_engine() -> AsyncEngine:
    """A separate engine that assumes the bypass role.

    Deliberately a different engine and a different factory rather than a flag
    on the normal session. Two code paths mean you cannot accidentally get
    cross-tenant reach by passing the wrong boolean, and every session opened
    here is expected to emit an audit event.
    """
    global _admin_engine
    if _admin_engine is None:
        settings = get_settings()
        url = settings.database_admin_url or settings.database_url
        _admin_engine = create_async_engine(
            str(url), pool_pre_ping=True, connect_args=connect_args_for(str(url))
        )
    return _admin_engine


def get_admin_session_factory() -> async_sessionmaker[AsyncSession]:
    global _admin_session_factory
    if _admin_session_factory is None:
        _admin_session_factory = async_sessionmaker(
            get_admin_engine(), expire_on_commit=False, autoflush=False
        )
    return _admin_session_factory


async def set_transaction_tenant(session: AsyncSession, tenant_id: UUID) -> None:
    """Bind `app.tenant_id` for the current transaction only.

    `set_config(key, value, is_local => true)` is exactly `SET LOCAL`, and the
    indirection is not stylistic: **`SET LOCAL app.tenant_id = :tid` does not
    work.** Postgres parses SET as a utility statement, not a query, so it
    accepts no bind parameters -- asyncpg sends `SET LOCAL app.tenant_id = $1`
    and the server answers `syntax error at or near "$1"`. Every tenant-scoped
    request would have failed.

    Interpolating the value into the SQL string would "fix" it and open an
    injection hole in the one place isolation depends on. `set_config` is an
    ordinary function call, so the value stays a bind parameter.

    `is_local => true` is what makes this safe under connection pooling: the
    setting dies with the transaction, so a pooled connection cannot carry one
    request's tenancy into the next.
    """
    await session.execute(
        text("SELECT set_config('app.tenant_id', :tid, true)"),
        {"tid": str(tenant_id)},
    )


async def set_transaction_user(session: AsyncSession, user_id: UUID) -> None:
    """Bind `app.user_id` for the current transaction only. Candidates only.

    A candidate belongs to no tenant, so the tenant policies show them nothing.
    The candidate policies (`current_candidate_id()` in the baseline) read this
    instead, and honour it only when no tenant is bound and the id is an active
    candidate account -- so binding a business user's id here grants nothing.

    Same rules as `set_transaction_tenant`: the value comes from the verified
    token, never from a request, and `set_config(..., true)` keeps it from
    outliving the transaction on a pooled connection.
    """
    await session.execute(
        text("SELECT set_config('app.user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


@asynccontextmanager
async def tenant_session(tenant_id: UUID | None) -> AsyncIterator[AsyncSession]:
    """Open a session scoped to one tenant for the life of one transaction.

    `tenant_id` must come from the caller's resolved membership. If a value
    reaches here from a request body, a path parameter, a query string, or a
    header, that is the bug SRS 2.24.7 exists to prevent.
    """
    factory = get_session_factory()
    async with factory() as session, session.begin():
        if tenant_id is not None:
            await set_transaction_tenant(session, tenant_id)
        yield session


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency for routes with no tenant scope (auth, public)."""
    factory = get_session_factory()
    async with factory() as session, session.begin():
        yield session


async def check_database_liveness() -> dict[str, Any]:
    """Used by the health endpoint. Cheap, and never leaks connection details."""
    try:
        async with get_engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        return {"status": "up"}
    except Exception:
        return {"status": "down"}


async def dispose_engines() -> None:
    """Close pools on shutdown.

    The session factories are reset alongside the engines they wrap. A factory
    outliving its engine is a live object bound to a closed pool: the next
    `get_session_factory()` finds the memoised factory still set, returns it,
    and every session it opens fails on a disposed engine. Shutdown hides this
    -- the process is leaving anyway -- but any caller that disposes and keeps
    running, a test between cases most of all, gets a factory that can no
    longer produce a working session.
    """
    global _engine, _admin_engine, _session_factory, _admin_session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
    if _admin_engine is not None:
        await _admin_engine.dispose()
        _admin_engine = None
    _session_factory = None
    _admin_session_factory = None
