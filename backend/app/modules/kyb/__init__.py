"""kyb module. Submissions, documents, review state machine."""

from __future__ import annotations

from fastapi import APIRouter

name = "kyb"
prefix = "/employer/kyb"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
