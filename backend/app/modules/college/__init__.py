"""college module. Institution tenant, roster, invites, consent, referral codes."""

from __future__ import annotations

from fastapi import APIRouter

name = "college"
prefix = "/college"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)


def get_extra_routers() -> tuple[tuple[str, APIRouter], ...]:
    """A student links to a college from their own surface."""
    from . import router as _router

    return (("/candidate/colleges", _router.candidate_router),)
