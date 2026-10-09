"""scoring module. Engine interface, versions, history, breakdown."""

from __future__ import annotations

from fastapi import APIRouter

name = "scoring"
prefix = "/candidate/score"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
