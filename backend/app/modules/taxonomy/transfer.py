from typing import Any
from uuid import UUID
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import TenantContext

from . import repository as repo
from . import service
from .schemas import OptionWrite
from .tabular import read_sheets, write_table

HEADERS = ["id", "name", "parent_id", "type", "sort_order", "is_visible", "version"]


async def export_rows(session: AsyncSession, level: Any, format: Any) -> Any:
    rows = (await session.scalars(repo.option_query(level, visible=False))).all()
    values = [HEADERS]
    for row in rows:
        values.append(
            [
                str(row.id),
                row.name,
                str(repo.parent_id(row) or ""),
                getattr(row, "type", ""),
                str(row.sort_order),
                str(row.is_visible).lower(),
                str(row.version),
            ]
        )
    media = (
        "text/csv"
        if format == "csv"
        else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    return write_table(values, format), media


async def import_rows(
    session: AsyncSession, level: Any, content: Any, filename: Any, ctx: TenantContext
) -> Any:
    try:
        sheets = read_sheets(content, filename)
        rows = next(iter(sheets.values()))
        if not rows or rows[0] != HEADERS:
            raise ValueError("Use the columns from a taxonomy export, in the same order.")
        if len(rows) > 2001:
            raise ValueError("Import at most 2,000 options at a time.")
        parsed = []
        for number, values in enumerate(rows[1:], 2):
            if not any(values):
                continue
            data = dict(zip(HEADERS, values, strict=True))
            if data["is_visible"].lower() not in ("true", "false"):
                raise ValueError(f"Row {number}: visibility must be true or false.")
            parsed.append(
                (
                    UUID(data["id"]) if data["id"] else None,
                    OptionWrite(
                        name=data["name"],
                        parent_id=data["parent_id"] or None,
                        type=data["type"] or "Non-tech",
                        sort_order=int(data["sort_order"] or 0),
                        is_visible=data["is_visible"].lower() == "true",
                        version=int(data["version"] or 1),
                    ),
                )
            )
    except (ValueError, KeyError, IndexError, BadZipFile, ParseError) as exc:
        raise service.invalid(
            "The import could not be read. Check the exported template and try again.",
            reason=str(exc),
        ) from exc
    for option_id, payload in parsed:
        await service.write_option(session, level, payload, ctx, option_id)
    await service.changed(session, ctx, "import", level, {"rows": len(parsed)})
    return {"imported": len(parsed)}
