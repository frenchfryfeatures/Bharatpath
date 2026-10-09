"""Root router. Surface-scoped prefixes for readability - NOT for authorisation.

`/api/v1/candidate/*`, `/employer/*`, `/college/*`, `/admin/*` are namespacing
so four client teams can read the schema. A candidate hitting an `/employer/*`
route is rejected by the role dependency, never by the routing.

Modules are mounted from the registry (`app.modules.ALL_MODULES`), so a new
module appears in `openapi.json` without editing this file.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api import health
from app.modules import ALL_MODULES

api_router = APIRouter()
api_router.include_router(health.router)

for _module in ALL_MODULES:
    if (_router := _module.get_router()) is not None:
        api_router.include_router(_router, prefix=_module.prefix, tags=[_module.name])
    # A module that serves a second surface -- `jobs` is composed by employers
    # and searched by candidates -- mounts that router under the other
    # surface's prefix, still inside its own module and its own layering rules.
    for _prefix, _extra in getattr(_module, "get_extra_routers", tuple)():
        api_router.include_router(_extra, prefix=_prefix, tags=[_module.name])
