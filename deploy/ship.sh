#!/usr/bin/env bash
# Ship this working tree to the host, build the image there, restart the stack.
#
#   bash deploy/ship.sh HOST            # e.g. bharatpath-api.duckdns.org
#   BP_SSH_KEY=~/.ssh/bharatpath_ed25519 bash deploy/ship.sh HOST
#
# Sends only what the image and the stack need -- `backend/.env` and the rest
# of the working directory never leave this machine. **It ships the working
# tree, uncommitted changes included**; REVISION on the host records the
# commit and whether the tree was dirty.
#
# Migrations run on every `up` (the `migrate` service), before the API starts.
# Expect a few seconds of 502 while the API restarts.
set -euo pipefail

HOST=${1:?usage: deploy/ship.sh HOST}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SSH=(ssh -o StrictHostKeyChecking=accept-new ${BP_SSH_KEY:+-i "$BP_SSH_KEY"} "ec2-user@$HOST")
if [ -n "${BP_SSH_KNOWN_HOSTS:-}" ]; then
  SSH=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
       -o "UserKnownHostsFile=$BP_SSH_KNOWN_HOSTS" \
       ${BP_SSH_KEY:+-i "$BP_SSH_KEY"} "ec2-user@$HOST")
fi

cd "$ROOT"
REVISION="$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- backend deploy || echo '-dirty')"
echo "shipping $REVISION to $HOST"

# One tarball, laid out the way the host expects it:
#   /opt/bharatpath/{docker-compose.prod.yml,Caddyfile,init_rds.sh,init/,backend/}
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/init" "$STAGE/backend"
cp deploy/docker-compose.prod.yml deploy/Caddyfile deploy/init_rds.sh "$STAGE/"
cp backend/scripts/init_db_roles.sql backend/scripts/init_db_extensions.sql "$STAGE/init/"
cp -r backend/Dockerfile backend/pyproject.toml backend/alembic.ini \
      backend/app backend/alembic backend/scripts backend/data "$STAGE/backend/"
find "$STAGE" -name __pycache__ -type d -prune -exec rm -rf {} +
echo "$REVISION" > "$STAGE/REVISION"

# The remote half, as one command string: the tarball arrives on its stdin.
# CRLF is stripped from shell and SQL files because core.autocrlf=true on a
# Windows checkout writes them that way, and bash on the host reads a trailing CR as
# part of the last word on each line.
REMOTE='set -euo pipefail
cd /opt/bharatpath
rm -rf .incoming && mkdir .incoming && tar -xzf - -C .incoming
find .incoming -type f \( -name "*.sh" -o -name "*.sql" -o -name Caddyfile -o -name "*.yml" \) -exec sed -i "s/\r\$//" {} +
rm -rf backend.previous
[ -d backend ] && mv backend backend.previous
mv .incoming/backend backend
mkdir -p init
mv -f .incoming/init/* init/
mv -f .incoming/docker-compose.prod.yml .incoming/Caddyfile .incoming/init_rds.sh .incoming/REVISION .
rm -rf .incoming
docker build -q -t bharatpath-backend:latest backend
if [ ! -f .env ]; then echo "deployment failed: host .env is missing"; exit 1; fi
if grep -q "<SET_BY_INIT_RDS>" .env; then echo "deployment failed: initialise RDS first"; exit 1; fi
docker compose -f docker-compose.prod.yml up -d --remove-orphans
MIGRATION_ID=$(docker compose -f docker-compose.prod.yml ps -a -q migrate)
test -n "$MIGRATION_ID"
if [ "$(docker wait "$MIGRATION_ID")" != "0" ]; then
  docker compose -f docker-compose.prod.yml logs --tail=100 migrate
  echo "deployment failed: migrations or seeds failed"
  exit 1
fi
docker compose -f docker-compose.prod.yml exec -T api \
  curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-connrefused \
    http://localhost:8000/api/v1/health
docker compose -f docker-compose.prod.yml ps'

tar -C "$STAGE" -czf - . | "${SSH[@]}" "$REMOTE"
echo "shipped $REVISION"
