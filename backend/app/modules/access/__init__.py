"""access module. Staff roles, permissions and their assignments (Access Management)."""

from __future__ import annotations

from fastapi import APIRouter

name = "access"
prefix = "/admin/access"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
