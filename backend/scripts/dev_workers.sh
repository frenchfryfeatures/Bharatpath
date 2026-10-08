#!/usr/bin/env bash
# Run the local Celery worker and enqueue the transactional outbox relay every
# two seconds, so an event (resume.version_confirmed -> score_resume, a stub
# payment callback, ...) is acted on while you are still looking at the screen.
#
# Deployed environments run the relay on Celery Beat every 30 seconds, beside
# the hourly and daily sweeps (app/tasks/schedule.py). This loop runs only the
# relay: to exercise expiry, renewals, erasure or nudges locally, also run
#   celery -A app.worker beat --loglevel=info
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
[ -f .env ] && . ./.env
set +a

if [ -n "${PYTHON:-}" ]; then
  PYTHON_BIN="$PYTHON"
elif [ -x .venv/bin/python ]; then
  PYTHON_BIN=.venv/bin/python
else
  PYTHON_BIN=python
fi

# Celery's prefork pool uses macOS's spawn behaviour and can receive tasks
# before each child has initialized its task tracer (`fast_trace_task` then
# fails with an empty local cache). Solo is deterministic for local work and
# enough for one developer exercising the flow end to end.
"$PYTHON_BIN" -m celery -A app.worker.celery_app worker \
  --loglevel=info \
  --pool=solo \
  "$@" &
WORKER_PID=$!

cleanup() {
  kill "$WORKER_PID" 2>/dev/null || true
  wait "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Immediate sends only, as beat does. The worker drains both the relay and the
# tasks it publishes.
"$PYTHON_BIN" - <<'PY'
import time

from app.worker import celery_app

while True:
    celery_app.send_task("outbox.relay")
    time.sleep(2)
PY
