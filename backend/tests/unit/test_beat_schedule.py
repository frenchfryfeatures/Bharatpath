"""The periodic schedule names real tasks.

**The failure this guards against is a schedule that looks right and drives
nothing.** A misspelt task
name in `BEAT_SCHEDULE` is not an error at import, not an error at boot, and
not an error when beat publishes it -- it is a message the worker discards
as unregistered, silently, forever. These tests are the only place that
fails loudly.
"""

from __future__ import annotations

import importlib
import inspect
from typing import Any

import pytest
from celery.schedules import crontab, schedule

from app.tasks.routing import TASK_MODULES
from app.tasks.schedule import BEAT_SCHEDULE, SCHEDULED_TASKS


def _registered() -> dict[str, Any]:
    for module in TASK_MODULES:
        importlib.import_module(module)
    from app.worker import celery_app

    return dict(celery_app.tasks)


@pytest.mark.parametrize("task_name", SCHEDULED_TASKS)
def test_every_scheduled_task_is_registered(task_name: str) -> None:
    """A name beat publishes that no worker registers is discarded in
    silence. This is the exact shape of the bug E4 records."""
    registered = _registered()
    assert task_name in registered, (
        f"{task_name} is scheduled and never registered. "
        f"Add its module to routing.TASK_MODULES, or fix the name."
    )


@pytest.mark.parametrize("task_name", SCHEDULED_TASKS)
def test_every_scheduled_task_takes_no_arguments(task_name: str) -> None:
    """A sweep decides its own scope from the clock and the database, so beat
    passes it nothing. A task that grew a required argument would fail on
    every tick, in a worker log nobody reads."""
    task = _registered()[task_name]
    signature = inspect.signature(task.run)
    required = [
        name
        for name, param in signature.parameters.items()
        if param.default is inspect.Parameter.empty
        and param.kind not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
    ]
    assert required == [], f"{task_name} requires {required}; beat sends no arguments"


def test_the_worker_app_carries_the_schedule() -> None:
    """Beat reads the schedule off the app it is pointed at. If `worker.py`
    stopped attaching it, `celery -A app.worker beat` would start, log
    nothing unusual, and run no sweeps at all."""
    from app.worker import celery_app

    attached = celery_app.conf.beat_schedule
    assert set(attached) == set(BEAT_SCHEDULE), (
        "app.worker does not carry every entry in BEAT_SCHEDULE"
    )


@pytest.mark.parametrize("name,entry", sorted(BEAT_SCHEDULE.items()))
def test_every_entry_is_a_real_celery_schedule(name: str, entry: dict[str, Any]) -> None:
    """A plain number or a string here is accepted by Celery in some versions
    and misread in others. Keep them typed."""
    assert isinstance(entry["schedule"], (crontab, schedule)), (
        f"{name} has a {type(entry['schedule']).__name__} schedule"
    )


@pytest.mark.parametrize("name,entry", sorted(BEAT_SCHEDULE.items()))
def test_every_entry_expires(name: str, entry: dict[str, Any]) -> None:
    """A tick that waited behind a backlog should be dropped, not run late.

    Without `expires`, a worker that was down for an hour comes back to sixty
    queued relay ticks and runs all of them. They are idempotent, so nothing
    breaks -- but they are also pointless, and they arrive exactly when the
    system is least able to absorb them.
    """
    options = entry.get("options")
    assert isinstance(options, dict) and "expires" in options, (
        f"{name} has no expires; a backlog of ticks will all run"
    )
