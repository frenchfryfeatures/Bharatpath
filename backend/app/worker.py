"""Celery application factory.

**Periodic work runs on Celery Beat** (`app/tasks/schedule.py`). Beat never
asks the broker to delay anything: it is a clock in its own process that
publishes a task at the moment it is due, an ordinary immediate send. That is
why it works on any broker, including SQS, which cannot hold a delayed message
beyond 15 minutes -- so `apply_async(countdown=...)` and `eta=...` must not be
used by task code.

Nothing settles a payment, dispatches a notification or carries out an
accepted deletion until the relay runs, so a deployment without beat is
silently broken rather than slow.

**Run exactly one beat process.** See `schedule.py`.
"""

from __future__ import annotations

from celery import Celery

from app.core.metadata import load_all_models
from app.settings import get_settings
from app.tasks.routing import TASK_MODULES
from app.tasks.schedule import BEAT_SCHEDULE


def create_celery() -> Celery:
    settings = get_settings()
    celery = Celery(
        "bharatpath",
        broker=settings.celery_broker_url,
        backend=settings.celery_result_backend,
        # Every task module, by name. `include=["app.tasks"]` imported the
        # package and none of its modules, so a worker started that way
        # registered no task at all, and the relay's messages were dropped.
        # The list lives beside the routing table.
        include=list(TASK_MODULES),
    )
    celery.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        timezone="UTC",
        enable_utc=True,
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
        broker_transport_options={"region": settings.aws_region},
        # The periodic table. Attached to every Celery app in this process,
        # not only to beat: `celery -A app.worker beat` and
        # `celery -A app.worker worker` load the same module, and beat reads
        # the schedule from the app it is pointed at.
        beat_schedule=dict(BEAT_SCHEDULE),
        # Beat keeps its "last run" state in this file. On the single EC2 host
        # it lives on the mounted volume so a container restart does not
        # re-run every sweep it had already done; under ECS it belongs on an
        # EFS mount or beat runs with `--schedule` pointed at one.
        beat_schedule_filename=settings.celery_beat_schedule_path,
    )
    return celery


celery_app = create_celery()

# Populate `Base.metadata` for this process.
#
# **Not optional, and not what the API does.** The API happens to end up with
# complete metadata because `create_app()` mounts every module's router, and
# each router reaches its own models through service -> repository. A worker
# mounts no routers: it imports `app.tasks` and nothing else, so a task that
# touches a table with a foreign key into another module's table fails with
# `NoReferencedTableError` -- SQLAlchemy cannot resolve a target it has never
# imported.
#
# Concretely: `resume_files.user_id` references `users`, which `identity` owns.
# Parsing a CV in a worker that had only loaded `resume.models` raised exactly
# that, and only under Celery -- the same code path is fine in the API.
load_all_models()
