"""Which task runs when a domain event is published.

One table, so "what happens when a resume is confirmed?" has a single answer
that can be read, diffed and tested — rather than being distributed across
however many modules happened to subscribe.

**This is where the confirm gate is enforced as a subscription** (SRS 1.4.4).
Scoring is triggered by `resume.version_confirmed` and nothing else. The
obvious alternative, `resume.version_created`, fires on every parse and every
correction *including unconfirmed ones*, so subscribing to it would score
content the candidate has never reviewed — while every other test in the
suite still passed, because the gate function would remain intact and simply
never be called.

`tests/invariants/test_confirm_gate.py` asserts against this table directly:
the confirmed event must route to the scoring task, and the created event must
route nowhere near it.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Final

from app.modules.notifications.domain import NOTIFYING_EVENTS

#: Celery task names. Strings rather than imports, deliberately: the relay
#: enqueues by name and must not drag every module's dependencies into the
#: worker that publishes events.
SCORE_RESUME_TASK: Final = "scoring.score_resume"
RESCORE_FOR_ADDONS_TASK: Final = "scoring.rescore_for_addons"
DETECT_INTEGRITY_TASK: Final = "integrity.detect"
PROCESS_PAYMENT_CALLBACK_TASK: Final = "billing.process_callback"
EVALUATE_INTERVIEW_TASK: Final = "interview.evaluate_session"
#: Notifications consume every event in `NOTIFYING_EVENTS`, and a
#: disputed hire is filed in the console's queue.
NOTIFY_TASK: Final = "notifications.dispatch"
OPEN_HIRE_DISPUTE_TASK: Final = "admin.open_hire_dispute"
#: An export is built when it is asked for. Erasure is a sweep, not a
#: subscription: it must wait out its grace period (`privacy/events.py`).
BUILD_EXPORT_TASK: Final = "privacy.build_export"
#: An uploaded CV is parsed out of band. The endpoint returns 202 and emits
#: `resume.file_uploaded`; this task reads the object, extracts the text and
#: creates the unconfirmed version the candidate then reviews. Without this
#: subscription the upload completes, the outbox row is marked published, and
#: nothing ever parses -- the client polls a `parse_status` that stays QUEUED.
PARSE_RESUME_TASK: Final = "resume.parse"

#: `event_type -> the tasks it triggers`.
#:
#: An event with no entry is published and consumed by nobody, which is
#: ordinary — most events exist for analytics and notifications that arrive on
#: later days. Absence here is not a bug; a *wrong* entry is.
_SUBSCRIPTIONS: Final[dict[str, tuple[str, ...]]] = {
    # The confirm gate. See the module docstring for why this is the confirmed
    # event and not the created one.
    "resume.version_confirmed": (SCORE_RESUME_TASK,),
    # An uploaded CV is parsed out of band. The endpoint returns 202 and emits
    # this event; the parse task reads the object and creates the unconfirmed
    # version. `resume.version_created` is NOT the trigger -- that fires on
    # every parse and every correction, and the parse task would re-parse an
    # already-parsed file.
    "resume.file_uploaded": (PARSE_RESUME_TASK,),
    # Add-ons move the score (R1, 2026-08-24), so a completion re-scores.
    # Not `SCORE_RESUME_TASK`: that task is idempotent by resume version and
    # would find the version already scored and stop. The re-score runs
    # Layers 2 and 3 over the stored extraction, so a completion costs no
    # model call and cannot drift the resume-derived part of the number.
    #
    # A course completion and a completed interview session.
    # Both are read back by `scoring.service.addons_for`, which applies the
    # caps; the questionnaire is worth nothing and routes nowhere near here.
    #
    # A completed session is also evaluated. That is feedback for the
    # candidate and nothing else: the +20 was recorded at completion, and the
    # evaluation task imports nothing that scores.
    "courses.completion_recorded": (RESCORE_FOR_ADDONS_TASK,),
    "interview.session_completed": (RESCORE_FOR_ADDONS_TASK, EVALUATE_INTERVIEW_TASK),
    # A verified gateway callback, stored by the callback route. Settling it
    # grants what was bought; the route itself never does.
    "billing.callback_received": (PROCESS_PAYMENT_CALLBACK_TASK,),
    # Integrity runs once a confirmed version has been scored, because that is
    # the first moment both halves it reads exist: the CV text, and the Layer 1
    # extraction stored on the score row. The task receives the event's
    # `aggregate_id`, which is the score id.
    #
    # Subscribed to the *score* event and not to `resume.version_confirmed`:
    # a confirmation whose extraction fails produces no score and so no
    # extraction to read, and an integrity check against nothing would record
    # a clean result for a CV nobody has read.
    "scoring.score_computed": (DETECT_INTEGRITY_TASK,),
    # A disputed hire is filed as the candidate's dispute, for our staff to
    # work.
    "applications.hire_disputed": (OPEN_HIRE_DISPUTE_TASK,),
    "privacy.export_requested": (BUILD_EXPORT_TASK,),
}


def _with_notifications(
    subscriptions: dict[str, tuple[str, ...]],
) -> dict[str, tuple[str, ...]]:
    """Add the notification task to every event notifications consumes. Built
    from `NOTIFYING_EVENTS` so the fan-out table and the routing cannot name
    different events. **Nothing here reaches a score**: the dispatch task
    imports no scoring module, and a message has no variable for one."""
    merged = dict(subscriptions)
    for event in sorted(NOTIFYING_EVENTS):
        merged[event] = (*merged.get(event, ()), NOTIFY_TASK)
    return merged


EVENT_SUBSCRIPTIONS: Final[dict[str, tuple[str, ...]]] = _with_notifications(_SUBSCRIPTIONS)

#: How the relay turns a published event into each task's arguments. Every
#: routed task needs an entry, and its keyword names must be the task's own
#: parameters -- `tests/unit/test_outbox_relay.py` checks both against the
#: registered tasks, because a name mismatch fails only inside a worker.
Event = dict[str, Any]
TASK_ARGUMENTS: Final[dict[str, Callable[[Event], dict[str, str]]]] = {
    SCORE_RESUME_TASK: lambda e: {
        "user_id": str(e["payload"]["user_id"]),
        "resume_version_id": str(e["aggregate_id"]),
    },
    RESCORE_FOR_ADDONS_TASK: lambda e: {"user_id": str(e["payload"]["user_id"])},
    DETECT_INTEGRITY_TASK: lambda e: {"score_id": str(e["aggregate_id"])},
    PARSE_RESUME_TASK: lambda e: {"resume_file_id": str(e["aggregate_id"])},
    PROCESS_PAYMENT_CALLBACK_TASK: lambda e: {"callback_id": str(e["aggregate_id"])},
    EVALUATE_INTERVIEW_TASK: lambda e: {"session_id": str(e["payload"]["session_id"])},
    NOTIFY_TASK: lambda e: {"event_id": str(e["id"])},
    BUILD_EXPORT_TASK: lambda e: {
        "request_id": str(e["aggregate_id"]),
        "user_id": str(e["payload"]["user_id"]),
    },
    OPEN_HIRE_DISPUTE_TASK: lambda e: {
        "application_id": str(e["aggregate_id"]),
        "candidate_id": str(e["payload"]["candidate_id"]),
    },
}

#: Every module that registers a task. The worker imports exactly these.
TASK_MODULES: Final = (
    "app.tasks.detect_integrity",
    "app.tasks.evaluate_interview",
    "app.tasks.expire_applications",
    "app.tasks.notify",
    "app.tasks.open_hire_dispute",
    "app.tasks.outbox_relay",
    "app.tasks.parse_resume",
    "app.tasks.privacy_requests",
    "app.tasks.process_payment_callback",
    "app.tasks.profile_nudges",
    "app.tasks.rescore_addons",
    "app.tasks.score_resume",
    "app.tasks.streak_activity_retention",
    "app.tasks.subscription_renewals",
    "app.tasks.view_event_partitions",
)


def tasks_for(event_type: str) -> tuple[str, ...]:
    """The tasks an event triggers. Empty when nothing subscribes."""
    return EVENT_SUBSCRIPTIONS.get(event_type, ())


def task_arguments(task_name: str, event: Event) -> dict[str, str]:
    """The keyword arguments `task_name` is enqueued with for `event`."""
    return TASK_ARGUMENTS[task_name](event)
