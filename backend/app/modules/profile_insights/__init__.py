"""Candidate-owned activity insights, configured by platform administrators."""

name = "profile_insights"
prefix = "/candidate/insights"


def get_router():
    from .router import router

    return router


def get_extra_routers():
    from .router import admin_router, employer_router

    return (("/admin/insights", admin_router), ("/employer/insights", employer_router))
