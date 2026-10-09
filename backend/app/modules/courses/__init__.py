"""courses module. Catalogue, purchase, completion, +30 contribution."""

from __future__ import annotations

from fastapi import APIRouter

name = "courses"
prefix = "/candidate/courses"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
