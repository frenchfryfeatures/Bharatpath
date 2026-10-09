"""candidate module. Candidate profile, settings, language preference."""

from __future__ import annotations

from fastapi import APIRouter

name = "candidate"
prefix = "/candidate"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)


def get_extra_routers() -> tuple[tuple[str, APIRouter], ...]:
    """Candidates keep their profile; employers open one, beside masked search."""
    from . import router as _router

    return (("/employer/discovery", _router.employer_router),)
