"""The relay hands events to the broker.

`_publish` enqueues every subscribed task by name, and a task name or argument
that does not match what a worker registers fails only inside that worker --
where nobody is looking. These tests hold the routing table, the argument
builders and the registered tasks to each other.
"""

from __future__ import annotations

import importlib
import inspect
import uuid
from typing import Any

import pytest

from app.modules.notifications.domain import NOTIFYING_EVENTS
from app.tasks.routing import (
    EVENT_SUBSCRIPTIONS,
    NOTIFY_TASK,
    OPEN_HIRE_DISPUTE_TASK,
    TASK_ARGUMENTS,
    TASK_MODULES,
    task_arguments,
    tasks_for,
)

ROUTED = sorted({task for tasks in EVENT_SUBSCRIPTIONS.values() for task in tasks})


def _registered() -> dict[str, Any]:
    for module in TASK_MODULES:
        importlib.import_module(module)
    from app.worker import celery_app

    return dict(celery_app.tasks)


def _event(event_type: str) -> dict[str, Any]:
    return {
        "id": uuid.uuid4(),
        "event_type": event_type,
        "aggregate_type": "x",
        "aggregate_id": str(uuid.uuid4()),
        "payload": {
            "user_id": str(uuid.uuid4()),
            "candidate_id": str(uuid.uuid4()),
            "session_id": str(uuid.uuid4()),
        },
        "attempts": 0,
    }


@pytest.mark.parametrize("task_name", ROUTED)
def test_every_routed_task_is_registered_and_takes_the_arguments_it_is_sent(
    task_name: str,
) -> None:
    registered = _registered()
    assert task_name in registered, f"{task_name} is routed to and never registered"
    parameters = set(inspect.signature(registered[task_name].run).parameters)
    assert set(task_arguments(task_name, _event("any.event"))) == parameters


def test_every_routed_task_has_an_argument_builder_and_none_is_stale() -> None:
    assert set(ROUTED) == set(TASK_ARGUMENTS)


def test_the_worker_includes_every_task_module() -> None:
    from app.worker import celery_app

    assert set(celery_app.conf.include) == set(TASK_MODULES)


@pytest.mark.parametrize("event", sorted(NOTIFYING_EVENTS))
def test_every_notifying_event_reaches_the_notification_task(event: str) -> None:
    assert NOTIFY_TASK in tasks_for(event)


def test_a_disputed_hire_is_filed_and_the_confirm_gate_is_untouched() -> None:
    assert tasks_for("applications.hire_disputed") == (OPEN_HIRE_DISPUTE_TASK,)
    assert tasks_for("resume.version_created") == ()


def test_publishing_enqueues_each_subscriber_with_its_own_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.tasks import outbox_relay

    sent: list[tuple[str, dict[str, str]]] = []
    monkeypatch.setattr(
        outbox_relay.celery_app, "send_task", lambda name, kwargs: sent.append((name, kwargs))
    )
    event = _event("interview.session_completed")
    outbox_relay._publish(event)
    assert [name for name, _ in sent] == list(tasks_for("interview.session_completed"))
    assert all(kwargs == task_arguments(name, event) for name, kwargs in sent)


def test_a_broker_failure_raises_so_the_row_stays_unpublished(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.tasks import outbox_relay

    def refuse(name: str, kwargs: dict[str, str]) -> None:
        raise ConnectionError("broker down")

    monkeypatch.setattr(outbox_relay.celery_app, "send_task", refuse)
    with pytest.raises(ConnectionError):
        outbox_relay._publish(_event("billing.callback_received"))


def test_an_event_nobody_subscribes_to_publishes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.tasks import outbox_relay

    monkeypatch.setattr(
        outbox_relay.celery_app,
        "send_task",
        lambda name, kwargs: pytest.fail("nothing subscribes to this"),
    )
    outbox_relay._publish(_event("questionnaire.submitted"))
