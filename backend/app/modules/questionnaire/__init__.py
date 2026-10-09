"""questionnaire module. Optional attribute questionnaire. Imports nothing from scoring."""

from __future__ import annotations

from fastapi import APIRouter

name = "questionnaire"
prefix = "/candidate/questionnaire"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
