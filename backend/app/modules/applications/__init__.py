"""applications module. Apply, stages, withdraw, expiry, hire confirm."""

from __future__ import annotations

from fastapi import APIRouter

name = "applications"
prefix = "/candidate/applications"


def get_router() -> APIRouter | None:
    """Return this module's router, or None while it is still a stub."""
    from . import router as _router

    return getattr(_router, "router", None)


def get_extra_routers() -> tuple[tuple[str, APIRouter], ...]:
    """Candidates apply; employers work the pipeline and read it counted."""
    from . import router as _router

    return (
        ("/employer/applications", _router.employer_router),
        ("/employer/dashboard", _router.dashboard_router),
    )
