"""discovery module. Masked search, access-window checks, reveal audit."""

from __future__ import annotations

from fastapi import APIRouter

name = "discovery"
prefix = "/employer/discovery"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)


def get_extra_routers() -> tuple[tuple[str, APIRouter], ...]:
    """`/reference/cities` (2026-11-23): the curated city catalogue for any
    city field -- sign-up and profile included, before an account exists.
    Reference data only: nothing about any candidate."""
    from . import router as _router

    return (("/reference", _router.reference_router),)
