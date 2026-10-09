"""Write every tunable in `config_values` as an explicit, readable row.

    cd backend && .venv/Scripts/python.exe scripts/seed_config.py
    .venv/Scripts/python.exe scripts/seed_config.py --check    # no writes

**The problem this solves.** Eight documents steer things a customer feels --
how many candidates an employer may open in an hour, how long an application
survives an employer's silence, when a college's cohort is too small to
report, how often somebody is nudged. Every reader falls back to a default
in code when no row exists, and no row existed anywhere: not in the baseline
migration, not in `reset_local_db.sh`, not in any deploy step. So production
ran on numbers that were invisible unless you read the source, and every one
of them is *ours* rather than the client's.

Falling back was the right design and stays: a missing row must not take the
platform down. What was missing is the row itself.

**The values here are not retyped.** Each document is built from the module's
own default object -- `DiscoveryLimits()`, `DEFAULT_NUDGE_RULES`, and so on --
and then parsed back through that module's own strict reader before anything
is written. A default that changes in code changes here too, and a document
this script could write but the application would refuse is a test failure
rather than a 500 in production. `tests/unit/test_config_seed.py`.

**Version 1 only, and never an update.** `config_values` is append-only by
convention: the reader takes the highest `version` whose `effective_from` has
passed, so changing a number is inserting version 2, never editing version 1.
This script therefore writes a key only when that key has no row at all, and
re-running it is a no-op. It will not overwrite a number somebody chose.

**These are still our numbers.** Seeding them changes nothing about who
decided them -- it makes them visible, diffable and changeable without a
deploy. `docs/blockers.md` has the ones the client still owes.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from collections.abc import Callable
from dataclasses import fields
from typing import TYPE_CHECKING, Any, Final, NamedTuple

if TYPE_CHECKING:
    from _typeshed import DataclassInstance


class Tunable(NamedTuple):
    key: str
    #: Builds the JSON document from the module's own defaults.
    document: Callable[[], dict[str, Any]]
    #: Parses it back through the module's strict reader. Raises if the
    #: document this script would write is one the application would refuse.
    verify: Callable[[dict[str, Any]], object]
    note: str


def _tunables() -> tuple[Tunable, ...]:
    """Imported inside the function: these are `app.modules`, and importing
    them at module scope would run before `ENVIRONMENT` is set below."""
    from app.modules.analytics import domain as analytics
    from app.modules.applications import domain as applications
    from app.modules.discovery import domain as discovery
    from app.modules.engagement import domain as engagement
    from app.modules.integrity import domain as integrity
    from app.modules.notifications import domain as notifications
    from app.modules.subscriptions import domain as subscriptions

    def _asdict(obj: DataclassInstance, *, drop: frozenset[str] = frozenset()) -> dict[str, Any]:
        return {f.name: getattr(obj, f.name) for f in fields(obj) if f.name not in drop}

    # `version` is the config ROW's version, not part of the document. A
    # reader that found it inside the JSON would refuse the row as an
    # unknown key, which is exactly the check `verify` performs.
    VERSION: Final = frozenset({"version"})

    return (
        Tunable(
            key="discovery.limits",
            document=lambda: _asdict(discovery.DiscoveryLimits()),
            verify=discovery.limits_from_config,
            note="Per-organisation reach into the candidate pool. Ours; "
            "the client accepted them as defaults 2026-09-15.",
        ),
        Tunable(
            key="analytics.privacy",
            document=lambda: _asdict(analytics.PrivacyFloors()),
            verify=analytics.floors_from_config,
            note="Cohort and cell floors for college analytics. Cohort floor "
            "and median step ours; exact cells (min_cell_size 1) the client's, "
            "2026-09-30. A row may raise them.",
        ),
        Tunable(
            key="applications.expiry",
            document=lambda: {"inactive_days": applications.DEFAULT_EXPIRY_RULES.inactive_days},
            verify=lambda d: applications.expiry_rules_from_config(d, version="seed"),
            note="Days of employer silence before an application is released "
            "(30 accepted by the client 2026-09-15).",
        ),
        Tunable(
            key="notifications.nudges",
            document=lambda: _asdict(notifications.DEFAULT_NUDGE_RULES),
            verify=notifications.nudge_rules_from_config,
            note="Incomplete-profile nudges: spacing, cap and IST sending hours (R9). Ours.",
        ),
        Tunable(
            key="subscriptions.renewal",
            document=lambda: _asdict(subscriptions.RenewalPolicy(version="x"), drop=VERSION),
            verify=lambda d: subscriptions.policy_from_config(d, version="seed"),
            note="Grace, notice periods and the UPI mandate ceiling (R17). "
            "mandate_max_amount_minor is our reading of the RBI limit (blockers E16).",
        ),
        Tunable(
            key="integrity.thresholds",
            document=lambda: _asdict(integrity.IntegrityThresholds(version="x"), drop=VERSION),
            verify=lambda d: integrity.thresholds_from_config(d, version="seed"),
            note="Tolerances for the eight dishonest-CV rules. Delegated "
            "to us by the client 2026-09-11. Severity policy is NOT config.",
        ),
        Tunable(
            key="engagement.streak_rules",
            document=lambda: {
                "break_penalty": engagement.DEFAULT_RULES.break_penalty,
                "milestones": [
                    {"days": days, "points": points}
                    for days, points in engagement.DEFAULT_RULES.milestones
                ],
            },
            verify=lambda d: engagement.rules_from_config(d, version="seed"),
            note="Daily streak points (2026-09-13). A SEPARATE balance: these "
            "points never reach the 700-990 score. Eight decisions S1-S8 open.",
        ),
        Tunable(
            key="kyb.require_approval",
            # The one document with no dataclass behind it: the whole of R15
            # is a single boolean. Off is the client's decision (2026-08-27) --
            # an employer is approved on arrival. Seeding it explicitly is the
            # point: "off because nobody set it" and "off because the client
            # chose it" are indistinguishable while the row is absent.
            document=lambda: {"enabled": False},
            verify=lambda d: d,
            note="R15. False = employers approved on arrival (client, "
            "2026-08-27). Set true to route every submission to the console.",
        ),
    )


async def main(argv: list[str]) -> int:
    from sqlalchemy import select

    from app.core.db import get_session_factory
    from app.core.models import ConfigValue

    check_only = "--check" in argv
    tunables = _tunables()

    # Build and verify every document before opening a transaction. A
    # document the application would refuse must never reach the table: a
    # strict reader answers a bad row with a 500, and a 500 on
    # `analytics.privacy` is a college dashboard that is down rather than
    # floored.
    documents: dict[str, dict[str, Any]] = {}
    for tunable in tunables:
        document = tunable.document()
        try:
            tunable.verify(document)
        except Exception as exc:
            print(
                f"REFUSING: the document for {tunable.key} is one the application "
                f"would reject: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
            return 2
        documents[tunable.key] = document

    async with get_session_factory()() as session, session.begin():
        existing = set(
            (
                await session.execute(
                    select(ConfigValue.key).where(ConfigValue.key.in_([t.key for t in tunables]))
                )
            )
            .scalars()
            .all()
        )

        written = 0
        for tunable in tunables:
            document = documents[tunable.key]
            if tunable.key in existing:
                # Somebody has chosen a value. Never touch it -- a seed script
                # that overwrites a deliberate number on every deploy is worse
                # than no seed script.
                print(f"  kept     {tunable.key}  (a row already exists)")
                continue
            if check_only:
                print(f"  MISSING  {tunable.key}  {json.dumps(document)}")
                written += 1
                continue
            session.add(
                ConfigValue(
                    key=tunable.key,
                    value=document,
                    version=1,
                    note=f"seeded from code defaults by scripts/seed_config.py. {tunable.note}",
                )
            )
            print(f"  wrote    {tunable.key}  {json.dumps(document)}")
            written += 1

        if check_only:
            await session.rollback()
            if written:
                print(f"\n{written} key(s) have no row; the code default is live for each.")
                return 1
            print("\nevery tunable has a row.")
            return 0

    print(f"\n{written} key(s) written, {len(tunables) - written} already present.")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("ENVIRONMENT", "local")
    sys.exit(asyncio.run(main(sys.argv[1:])))
