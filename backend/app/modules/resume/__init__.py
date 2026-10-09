"""resume module. Upload, parse jobs, versions, review and confirm."""

from __future__ import annotations

from fastapi import APIRouter

name = "resume"
prefix = "/candidate/resume"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
