"""When each periodic task runs. One table, like `routing.py`.

Nine tasks sweep rather than subscribe, because what triggers them is the
passage of time and not an event: a subscription lapses because a date
passed, not because anybody did anything. Without them a deletion request is
accepted, shown with its due date, and never carried out -- a promise not
kept rather than a feature missing.

**Celery Beat, not EventBridge Scheduler.** "SQS has no native ETA/countdown"
does not rule Beat out. It is true of `apply_async(countdown=...)` and `eta=...`, which ask
the *broker* to hold a message and which SQS cannot do beyond its 15-minute
delay ceiling. Beat does not ask the broker for anything: it is a clock in a
separate process that publishes a task the moment it is due, exactly as the
relay does. The broker only ever sees an ordinary immediate message.

Choosing Beat over EventBridge also avoids adding a public
`POST /internal/tasks/{name}` endpoint and a machine-auth scheme to secure
it. The trade is that Beat is a **singleton**: run exactly one beat process.
Two schedulers mean every sweep runs twice. The sweeps themselves are
idempotent -- each claims its rows with `FOR UPDATE SKIP LOCKED` or a
conditional UPDATE -- so a double run wastes work rather than corrupting
anything, but it is still a misconfiguration, not a redundancy.

See `docs/aws-deployment.md` for how the beat container is run, and for what
changes when this moves to ECS (nothing here; only the container's placement).
"""

from __future__ import annotations

from typing import Final

from celery.schedules import crontab, schedule

#: Every task named here takes no arguments. That is not an accident: a sweep
#: decides its own scope from the clock and the database, so there is nothing
#: for a scheduler to pass it and nothing a misconfigured schedule can get
#: wrong beyond the interval. `tests/unit/test_beat_schedule.py` asserts it
#: against the registered task signatures.
BEAT_SCHEDULE: Final[dict[str, dict[str, object]]] = {
    # -- the one that is not really periodic -------------------------------
    # The relay is the heart of the system: nothing is granted, sent,
    # re-scored or dispatched until it runs, because every one of those is
    # an outbox row waiting for a broker. Thirty seconds is the delay a
    # candidate feels between paying and being subscribed.
    #
    # Cheap to run often: one indexed query returning nothing when the
    # outbox is empty. The cost of running it rarely is a user watching a
    # spinner.
    "outbox-relay": {
        "task": "outbox.relay",
        "schedule": schedule(run_every=30.0),
        # Late is worse than never here -- a relay queued behind a backlog
        # adds load to a system already behind. Drop the tick instead; the
        # next one is thirty seconds away and picks up the same rows.
        "options": {"expires": 25.0},
    },
    "push-pending": {
        "task": "notifications.push_pending",
        "schedule": schedule(run_every=30.0),
        "options": {"expires": 25.0},
    },
    # -- hourly sweeps -----------------------------------------------------
    # Every one of these measures a period in days. Hourly is far more often
    # than any of them needs and is still cheap, and it means the worst case
    # a user sees is "within the hour" rather than "tomorrow".
    #
    # Staggered across the hour rather than all on :00. They contend for the
    # same connection pool, and three of them take a per-tenant or
    # advisory lock.
    "expire-applications": {
        "task": "applications.expire",
        "schedule": crontab(minute="5"),
        "options": {"expires": 3000.0},
    },
    "subscription-renewals": {
        "task": "subscriptions.renewals",
        "schedule": crontab(minute="15"),
        "options": {"expires": 3000.0},
    },
    # The erasure sweep: carries out deletions whose 24h cooling-off period
    # has passed.
    "privacy-erase-due": {
        "task": "privacy.erase_due",
        "schedule": crontab(minute="25"),
        "options": {"expires": 3000.0},
    },
    # An export archive is a whole person's record in one object. It expires
    # after 48h; hourly means at most 49.
    "privacy-expire-exports": {
        "task": "privacy.expire_exports",
        "schedule": crontab(minute="35"),
        "options": {"expires": 3000.0},
    },
    # Runs hourly and sends almost never: the task itself enforces the IST
    # sending window, the 72h spacing and the cap of three
    # (`notifications.domain`, config `notifications.nudges`). Scheduling it
    # hourly is what lets it honour "09:00 IST" rather than "whenever the
    # daily job happens to be".
    "profile-nudges": {
        "task": "notifications.nudge_incomplete_profiles",
        "schedule": crontab(minute="45"),
        "options": {"expires": 3000.0},
    },
    # Messages a crashed worker decided and never sent. The
    # rows it recovers are ones no redelivery will ever pick up -- a nudge's
    # sequence number is already claimed, so the nudge sweep will not
    # generate it a second time. Hourly is ample: `ORPHAN_AFTER_MINUTES` is
    # fifteen, so nothing here is younger than that anyway.
    "orphaned-notifications": {
        "task": "notifications.send_orphaned",
        "schedule": crontab(minute="55"),
        "options": {"expires": 3000.0},
    },
    # -- daily -------------------------------------------------------------
    # `candidate_view_events` is partitioned by month and the baseline created
    # fifteen months of partitions. This keeps a rolling window ahead, so the
    # failure it prevents -- an insert landing in DEFAULT because nobody
    # created next month -- is impossible rather than unlikely.
    #
    # 18:30 UTC is midnight IST: a new partition exists before the Indian day
    # that would need it starts.
    "view-event-partitions": {
        "task": "discovery.ensure_view_partitions",
        "schedule": crontab(hour="18", minute="30"),
        "options": {"expires": 43200.0},
    },
    # The streak calendar keeps a year of opened days (client, 2026-09-29).
    # 18:40 UTC is 00:10 IST, just after the window has moved by a day.
    "streak-activity-retention": {
        "task": "engagement.purge_expired_activity",
        "schedule": crontab(hour="18", minute="40"),
        "options": {"expires": 43200.0},
    },
}

#: Task names this schedule drives, for the test that checks each one is
#: registered and takes no arguments.
SCHEDULED_TASKS: Final[tuple[str, ...]] = tuple(
    str(entry["task"]) for entry in BEAT_SCHEDULE.values()
)
