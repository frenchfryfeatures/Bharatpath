"""interview module. Audio sessions, chunk upload, evaluation, +20/session."""

from __future__ import annotations

from fastapi import APIRouter

name = "interview"
prefix = "/candidate/interview"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
