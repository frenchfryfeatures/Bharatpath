"""Write the starter search-filter catalogue: the skills and cities employers pick from.

Idempotent and additive. An option is written only when none of its
spellings is already in the table, so a re-run never undoes what staff
changed through `/admin/search-filters` -- the console owns the live list,
this only keeps a fresh database from showing an empty panel.

**The lists are ours, not the client's** (`FILTER_CATALOGUE_VERSION` starts
`placeholder-`). Unlike prices they name nobody and charge nobody, so they
are seeded in every environment; staff replace them in the console.

    cd backend && .venv/Scripts/python.exe scripts/seed_filter_options.py
"""

from __future__ import annotations

import asyncio
import os
import sys


async def main() -> int:
    from app.core.db import get_session_factory
    from app.modules.discovery import service
    from app.modules.discovery.catalogue import FILTER_CATALOGUE_VERSION

    async with get_session_factory()() as session, session.begin():
        written, skipped = await service.seed_filter_catalogue(session)
    print(
        f"search filters {FILTER_CATALOGUE_VERSION}: {written} options written, "
        f"{skipped} already present"
    )
    return 0


if __name__ == "__main__":
    os.environ.setdefault("ENVIRONMENT", "local")
    sys.exit(asyncio.run(main()))
