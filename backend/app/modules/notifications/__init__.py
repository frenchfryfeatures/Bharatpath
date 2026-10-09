"""notifications module. Event to channel fan-out, templates."""

from __future__ import annotations

from fastapi import APIRouter

name = "notifications"
prefix = "/notifications"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
