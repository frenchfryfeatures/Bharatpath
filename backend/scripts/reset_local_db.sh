#!/usr/bin/env bash
# Drop and rebuild the local database from scratch.
#
# WHY THIS EXISTS. The baseline migration is deliberately not reversible --
# "downgrading" it means dropping every table in the product -- so the only way
# to pick up a schema change during development is to rebuild. Doing that by
# hand is four commands in the right order, one of which (roles) must run
# before the migration and after the schema drop.
#
# Safe by construction: it refuses to run against anything but the local
# container, because the one command in this file that matters is DROP SCHEMA.
set -euo pipefail

# Git Bash on Windows rewrites any argument that looks like an absolute POSIX
# path into a Windows one, so `/docker-entrypoint-initdb.d/...` -- a path
# INSIDE the container -- arrives as `D:/Git/docker-entrypoint-initdb.d/...`
# and psql cannot find it. This disables that rewriting; it is a no-op on
# Linux and macOS.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

cd "$(dirname "$0")/.."

CONTAINER="${PG_CONTAINER:-bharatpath-postgres-1}"
DB="${PG_DB:-bharatpath}"
SUPERUSER="${PG_SUPERUSER:-bharatpath}"

# A destructive command needs a target it cannot be wrong about. If this is not
# the compose container on this machine, stop.
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "error: container '$CONTAINER' not found. Start it with: docker compose up -d postgres" >&2
  exit 1
fi

psql_run() { docker exec -i "$CONTAINER" psql -U "$SUPERUSER" -d "$DB" -v ON_ERROR_STOP=1 "$@"; }

echo "==> dropping schema public"
psql_run -q -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "==> extensions"
psql_run -q -f /docker-entrypoint-initdb.d/05-extensions.sql

echo "==> roles, ownership and default privileges"
# Idempotent -- the roles survive a schema drop, so this reapplies ownership
# and the ALTER DEFAULT PRIVILEGES that the new schema lost.
psql_run -q -f /docker-entrypoint-initdb.d/10-roles.sql

echo "==> alembic upgrade head (as the migrator role, which owns the tables)"
DATABASE_URL="postgresql+asyncpg://bharatpath_migrator:bharatpath_migrator@localhost:5432/${DB}" \
DATABASE_URL_MIGRATOR="postgresql+asyncpg://bharatpath_migrator:bharatpath_migrator@localhost:5432/${DB}" \
REDIS_URL="redis://localhost:6379/0" \
ENVIRONMENT=local \
  "${PYTHON:-python}" -m alembic upgrade head

echo "==> price list and course (placeholder content)"
DATABASE_URL="postgresql+asyncpg://bharatpath_migrator:bharatpath_migrator@localhost:5432/${DB}" \
REDIS_URL="redis://localhost:6379/0" \
ENVIRONMENT=local \
AUTH_ALLOW_LOCAL_TOKENS=true \
  "${PYTHON:-python}" scripts/seed_catalogue.py

# The eight tunables (view caps, expiry, analytics floors, nudges, renewal,
# integrity thresholds, streak rules, the KYB switch). Every reader falls
# back to a code default when the row is absent, so this is not required for
# the suite to pass -- it is here so local looks like a deployment, where the
# numbers are rows somebody can read and change without a deploy.
echo "==> configuration defaults"
DATABASE_URL="postgresql+asyncpg://bharatpath_migrator:bharatpath_migrator@localhost:5432/${DB}" \
REDIS_URL="redis://localhost:6379/0" \
ENVIRONMENT=local \
AUTH_ALLOW_LOCAL_TOKENS=true \
  "${PYTHON:-python}" scripts/seed_config.py

echo "==> search filter options (placeholder content)"
DATABASE_URL="postgresql+asyncpg://bharatpath_migrator:bharatpath_migrator@localhost:5432/${DB}" \
REDIS_URL="redis://localhost:6379/0" \
ENVIRONMENT=local \
AUTH_ALLOW_LOCAL_TOKENS=true \
  "${PYTHON:-python}" scripts/seed_filter_options.py

POLICIES=$(psql_run -tAc "SELECT count(*) FROM pg_policies WHERE schemaname='public'")
TABLES=$(psql_run -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
echo "==> done: ${TABLES} tables, ${POLICIES} row-level security policies"
