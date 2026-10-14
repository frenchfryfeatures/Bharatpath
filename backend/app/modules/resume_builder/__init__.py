"""resume_builder module. Resumes from onboarding answers in four templates. Never the score."""

from __future__ import annotations

from fastapi import APIRouter

name = "resume_builder"
prefix = "/candidate/resume-builder"


def get_router() -> APIRouter | None:
    """Return this module's router."""
    from . import router as _router

    return getattr(_router, "router", None)
