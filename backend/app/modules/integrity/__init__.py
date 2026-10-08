"""integrity module. Signals, severity policy, search suppression."""

from __future__ import annotations

from fastapi import APIRouter

name = "integrity"
prefix = "/integrity"


def get_router() -> APIRouter | None:
    """None: integrity has no HTTP surface of its own.

    Signals are raised by a task and resolved by staff through the admin
    console (`admin.router`), which calls `integrity.service`. A candidate
    never sees a signal, so there is nothing here to route.
    """
    return None
