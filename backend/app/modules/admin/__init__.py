"""admin module. Queues, drill-downs, disputes, suspensions."""

from __future__ import annotations

from fastapi import APIRouter

name = "admin"
prefix = "/admin"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)


def get_extra_routers() -> tuple[tuple[str, APIRouter], ...]:
    """`/disputes`: where the three external groups raise what the console
    works. Mounted here so the dispute's two sides share one module."""
    from . import router as _router

    return (("/disputes", _router.raiser_router),)
