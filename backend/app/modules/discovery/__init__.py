"""discovery module. Masked search, access-window checks, reveal audit."""

from __future__ import annotations

from fastapi import APIRouter

name = "discovery"
prefix = "/employer/discovery"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
