"""jobs module. Composer, validation, publish gate, lifecycle."""

from __future__ import annotations

from fastapi import APIRouter

name = "jobs"
prefix = "/employer/jobs"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)


def get_extra_routers() -> tuple[tuple[str, APIRouter], ...]:
    """Routers for other surfaces. Employers compose jobs; candidates search them."""
    from . import router as _router

    return (("/candidate/jobs", _router.candidate_router),)
