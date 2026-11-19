"""Shared, moderated job taxonomy."""

from typing import Any

name = "taxonomy"
prefix = "/taxonomy"


def get_router() -> Any:
    from .router import router

    return router


def get_extra_routers() -> Any:
    from .router import admin_router

    return (("/admin/taxonomy", admin_router),)
