"""privacy module. Export and deletion requests, DSR tracking."""

from __future__ import annotations

from fastapi import APIRouter

name = "privacy"
prefix = "/privacy"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
