"""Alembic environment.

One migration per pull request, never edited after merge. A migration that has
run in any shared environment is history, not a draft.
"""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# Importing the registry pulls in every module's models so autogenerate can
# see the whole schema. Without this, autogenerate silently drops tables.
import app.core.models  # noqa: F401
from app.core.metadata import load_all_models
from app.settings import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _migration_url() -> str:
    """Migrations run as the OWNER role, never as the application role.

    RLS does not apply to a table's owner. If migrations ran as the same role
    the application connects as, that role would own every table and every
    policy would become decorative - visible in the catalog, enforcing
    nothing. Nothing would error; isolation would just stop existing.

    So this refuses to guess. If no migrator URL is configured we fail with an
    explanation rather than falling back to `database_url`, because the
    fallback is exactly the mistake worth preventing.
    """
    settings = get_settings()
    if settings.database_url_migrator is not None:
        return str(settings.database_url_migrator)

    raise RuntimeError(
        "DATABASE_URL_MIGRATOR is not set.\n\n"
        "Migrations must run as the role that OWNS the tables "
        "(bharatpath_migrator), not as the application role. Row-Level "
        "Security does not apply to a table's owner, so running migrations "
        "as the app role would silently disable tenant isolation while every "
        "policy still looked correct.\n\n"
        "Local: copy .env.example to .env - it sets this for you.\n"
        "Deployed: the migration task's env must supply it from Secrets "
        "Manager."
    )


config.set_main_option("sqlalchemy.url", _migration_url())

# Populate the metadata BEFORE autogenerate or any migration reads it.
# Importing `app.modules` alone leaves it empty - see app/core/metadata.py.
target_metadata = load_all_models()


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    from app.core.db import connect_args_for

    section = config.get_section(config.config_ini_section, {})
    engine = async_engine_from_config(
        section,
        prefix="sqlalchemy.",
        connect_args=connect_args_for(config.get_main_option("sqlalchemy.url") or ""),
    )
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
