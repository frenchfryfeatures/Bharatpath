"""employer module. Employer tenant, team members, roles."""

from __future__ import annotations

from fastapi import APIRouter

name = "employer"
prefix = "/employer"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
