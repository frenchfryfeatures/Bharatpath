from typing import Literal

from fastapi import APIRouter, Depends, Query

from app.core.deps import (
    CANDIDATE,
    EMPLOYER_OWNER,
    EMPLOYER_RECRUITER,
    EMPLOYER_VIEWER,
    CurrentUser,
    DbSession,
    require_role,
)
from app.modules.admin.domain import CONSOLE_ROLES

from . import service
from .schemas import ConfigRequest, ImpressionRequest, RecruiterAction

router = APIRouter(dependencies=[Depends(require_role(CANDIDATE))])
admin_router = APIRouter(dependencies=[Depends(require_role(*CONSOLE_ROLES["insights_config"]))])
employer_router = APIRouter(
    dependencies=[Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER, EMPLOYER_VIEWER))]
)


@router.get("")
async def overview(user: CurrentUser, session: DbSession, days: Literal["7", "30"] = "30"):
    return await service.overview(session, user, int(days))


@router.get("/applications")
async def applications(
    user: CurrentUser, session: DbSession, offset: int = Query(0, ge=0, le=100000)
):
    return await service.application_page(session, user, offset)


@employer_router.post("/impressions")
async def impressions(payload: ImpressionRequest, user: CurrentUser, session: DbSession):
    return await service.impressions(session, user, payload.receipts)


@employer_router.post("/actions")
async def action(payload: RecruiterAction, user: CurrentUser, session: DbSession):
    return await service.recruiter_action(session, user, payload)


@admin_router.get("/config")
async def insights_config(user: CurrentUser, session: DbSession):
    return await service.configuration(session)


@admin_router.put("/config")
async def set_insights_config(payload: ConfigRequest, user: CurrentUser, session: DbSession):
    return await service.configure(session, user, payload)


@admin_router.get("/volumes")
async def insights_volumes(user: CurrentUser, session: DbSession):
    return await service.event_volumes(session, user)
