"""Load the supplied taxonomy and migrate existing labels. Defaults to local databases only."""

import argparse
import asyncio
from pathlib import Path

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import connect_args_for
from app.core.metadata import load_all_models
from app.modules.taxonomy.seed import backfill, load_source, seed
from app.settings import get_settings

DEFAULT_SOURCE = Path(__file__).resolve().parents[1] / "data/job_taxonomy.json"


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=DEFAULT_SOURCE,
    )
    parser.add_argument("--allow-remote", action="store_true")
    # Deploys run this on every `up` (2026-11-23): write any missing catalogue
    # rows and touch no candidate profile. Linking old free-text answers to
    # the catalogue (`backfill`) changes people's profiles, so it stays a
    # deliberate, separate run without this flag.
    parser.add_argument("--seed-only", action="store_true")
    args = parser.parse_args()
    settings = get_settings()
    if not settings.database_url_migrator:
        raise SystemExit(
            "Set DATABASE_URL_MIGRATOR; the owner is needed to migrate historical labels."
        )
    url = str(settings.database_url_migrator)
    if (
        make_url(url).host not in ("127.0.0.1", "localhost", "postgres", "::1")
        and not args.allow_remote
    ):
        raise SystemExit(
            "Remote database refused. Use --allow-remote only for an approved deployment."
        )
    load_all_models()
    data = await asyncio.to_thread(load_source, args.source)
    engine = create_async_engine(url, connect_args=connect_args_for(url))
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session, session.begin():
            result = await seed(session, data)
            if not args.seed_only:
                result["profiles_migrated"] = await backfill(session)
        print(result)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
