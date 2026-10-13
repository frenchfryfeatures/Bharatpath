"""assistant module. The candidate's job-search chat. Never reads the score."""

from __future__ import annotations

from fastapi import APIRouter

name = "assistant"
prefix = "/candidate/assistant"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
