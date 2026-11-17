from typing import Any
from uuid import UUID
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import TenantContext
from app.modules.taxonomy.tabular import read_sheets, write_table

from . import repository as repo
from . import service
from .schemas import OptionWrite

HEADERS = [
    "id",
    "name",
    "parent_id",
    "level_rank",
    "sort_order",
    "is_visible",
    "version",
    "course_ids",
    "is_not_applicable",
]


async def export_rows(session: AsyncSession, level: Any, format: Any) -> Any:
    rows = (await session.scalars(repo.option_query(level, visible=False))).all()
    values = [HEADERS]
    for row in rows:
        values.append(
            [
                str(row.id),
                row.name,
                str(repo.parent_id(row) or ""),
                str(getattr(row, "level_rank", "")),
                str(row.sort_order),
                str(row.is_visible).lower(),
                str(row.version),
                "|".join((await service.links_for(session, row.id))["course_ids"])
                if level == "specialization"
                else "",
                str(getattr(row, "is_not_applicable", False)).lower(),
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
        attachments = []
        for number, values in enumerate(rows[1:], 2):
            if not any(values):
                continue
            data = dict(zip(HEADERS, values, strict=True))
            if data["is_visible"].lower() not in ("true", "false"):
                raise ValueError(f"Row {number}: visibility must be true or false.")
            attachments.append([UUID(value) for value in data["course_ids"].split("|") if value])
            parsed.append(
                (
                    UUID(data["id"]) if data["id"] else None,
                    OptionWrite(
                        name=data["name"],
                        parent_id=UUID(data["parent_id"]) if data["parent_id"] else None,
                        level_rank=int(data["level_rank"] or 1),
                        is_not_applicable=data["is_not_applicable"].lower() == "true",
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
    for (option_id, payload), courses in zip(parsed, attachments, strict=True):
        result = await service.write_option(session, level, payload, ctx, option_id)
        if courses and level != "specialization":
            raise service.invalid("Only specializations can have course links.")
        if courses:
            from .schemas import Links

            await service.change_links(
                session,
                Links(
                    course_ids=courses,
                    specialization_ids=[UUID(result["id"])],
                    action="attach",
                    revision=await service.revision(session),
                ),
                ctx,
            )
    await service.changed(session, ctx, "import", level, {"rows": len(parsed)})
    return {"imported": len(parsed)}
