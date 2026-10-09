"""billing module. Payments, entitlements, signed callbacks."""

from __future__ import annotations

from fastapi import APIRouter

name = "billing"
prefix = "/billing"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
