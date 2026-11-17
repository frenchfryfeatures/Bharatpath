"""Shared, moderated education catalogue."""

from fastapi import APIRouter

name = "education_taxonomy"
prefix = "/education-taxonomy"


def get_router() -> APIRouter:
    from .router import router

    return router


def get_extra_routers() -> tuple[tuple[str, APIRouter], ...]:
    from .router import admin_router

    return (("/admin/education-taxonomy", admin_router),)
