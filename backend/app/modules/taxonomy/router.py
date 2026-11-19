"""Public catalogue reads and Platform Admin maintenance."""

from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import text

from app.core.deps import PLATFORM_ADMIN, DbSession, require_role
from app.core.tenant import TenantContext

from . import service
from .schemas import Level, OptionWrite, Priorities, Reorder, Resolve

router = APIRouter(tags=["Job taxonomy"])
admin_router = APIRouter(tags=["Admin job taxonomy"])


async def admin_context(
    session: DbSession, ctx: Annotated[TenantContext, Depends(require_role(PLATFORM_ADMIN))]
) -> Any:
    await session.execute(
        text("SELECT set_config('app.taxonomy_actor', :actor, true)"), {"actor": str(ctx.user_id)}
    )
    return ctx


Admin = Annotated[TenantContext, Depends(admin_context)]


@router.get("/industries")
async def industries(
    session: DbSession,
    q: str = Query("", max_length=160),
    offset: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=1000),
) -> Any:
    return await service.list_options(session, "industry", q=q, limit=limit, offset=offset)


@router.get("/departments")
async def departments(
    session: DbSession,
    industry_id: UUID,
    q: str = Query("", max_length=160),
    offset: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=1000),
) -> Any:
    return await service.list_options(
        session, "department", industry=industry_id, q=q, limit=limit, offset=offset
    )


@router.get("/categories")
async def categories(
    session: DbSession,
    department_id: UUID,
    q: str = Query("", max_length=160),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
) -> Any:
    return await service.list_options(
        session, "category", parent=department_id, q=q, offset=offset, limit=limit
    )


@router.get("/roles")
async def roles(
    session: DbSession,
    category_id: UUID,
    q: str = Query("", max_length=160),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
) -> Any:
    return await service.list_options(
        session, "role", parent=category_id, q=q, offset=offset, limit=limit
    )


@admin_router.get("/others")
async def others(
    session: DbSession,
    ctx: Admin,
    status: Literal["pending", "approved", "rejected", "merged"] = "pending",
    level: Level | None = None,
    q: str = Query("", max_length=160),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
) -> Any:
    await service.changed(session, ctx, "read_submissions", "others")
    return await service.others(
        session, status=status, level=level, q=q, offset=offset, limit=limit
    )


@admin_router.post("/others/{submission_id}/resolve")
async def resolve(session: DbSession, ctx: Admin, submission_id: UUID, payload: Resolve) -> Any:
    return await service.resolve_other(session, submission_id, payload, ctx)


@admin_router.get("/priorities/{industry_id}")
async def priorities(session: DbSession, ctx: Admin, industry_id: UUID) -> Any:
    return await service.priorities(session, industry_id)


@admin_router.put("/priorities/{industry_id}")
async def save_priorities(
    session: DbSession, ctx: Admin, industry_id: UUID, payload: Priorities
) -> Any:
    return await service.save_priorities(session, industry_id, payload, ctx)


@admin_router.get("/{level}/export")
async def export_options(
    session: DbSession, ctx: Admin, level: Level, format: Literal["csv", "xlsx"] = "csv"
) -> Any:
    from .transfer import export_rows

    content, media = await export_rows(session, level, format)
    await service.changed(session, ctx, "export", level)
    return Response(
        content,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{level}.{format}"'},
    )


@admin_router.post("/{level}/import")
async def import_options(
    session: DbSession, ctx: Admin, level: Level, file: UploadFile = File()
) -> Any:
    from .transfer import import_rows

    content = await file.read(2_000_001)
    return await import_rows(session, level, content, file.filename or "", ctx)


@admin_router.get("/{level}")
async def options(
    session: DbSession,
    ctx: Admin,
    level: Level,
    parent_id: UUID | None = None,
    q: str = Query("", max_length=160),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
) -> Any:
    return await service.list_options(
        session, level, parent=parent_id, q=q, offset=offset, limit=limit, admin=True
    )


@admin_router.post("/{level}/reorder")
async def reorder(session: DbSession, ctx: Admin, level: Level, payload: Reorder) -> Any:
    return await service.reorder(session, level, payload, ctx)


@admin_router.post("/{level}", status_code=201)
async def create(session: DbSession, ctx: Admin, level: Level, payload: OptionWrite) -> Any:
    return await service.write_option(session, level, payload, ctx)


@admin_router.put("/{level}/{option_id}")
async def update(
    session: DbSession, ctx: Admin, level: Level, option_id: UUID, payload: OptionWrite
) -> Any:
    return await service.write_option(session, level, payload, ctx, option_id)


@admin_router.delete("/{level}/{option_id}")
async def delete(
    session: DbSession,
    ctx: Admin,
    level: Level,
    option_id: UUID,
    version: int = Query(ge=1),
    hard: bool = False,
) -> Any:
    return await service.delete_option(session, level, option_id, version, ctx, hard=hard)
