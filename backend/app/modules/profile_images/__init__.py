"""profile_images module. Everyone's own photo, and employer and college logos. Never the score."""

from __future__ import annotations

from fastapi import APIRouter

name = "profile_images"
prefix = "/profile"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)


def get_extra_routers() -> tuple[tuple[str, APIRouter], ...]:
    """The organisation logo, on the employer's and the college's own surfaces."""
    from . import router as _router

    return (
        ("/employer/organisation/logo", _router.employer_router),
        ("/college/organisation/logo", _router.college_router),
    )
