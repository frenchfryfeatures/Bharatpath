"""engagement module. Daily app-open streaks and engagement points. Never the score."""

from __future__ import annotations

from fastapi import APIRouter

name = "engagement"
prefix = "/candidate/streak"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
