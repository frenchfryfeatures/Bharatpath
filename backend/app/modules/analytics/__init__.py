"""analytics module. Cohort aggregates, placement tracking."""

from __future__ import annotations

from fastapi import APIRouter

name = "analytics"
prefix = "/college/analytics"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
