"""employer - HTTP layer

Employer tenant, team members, roles.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Two routes accept a business account that belongs to no organisation yet**
-- creating one, and reading the vocabularies its form needs. Every other
route requires an employer role resolved from `memberships`. Of the three
roles, only the owner can change the organisation or its team; recruiters and
viewers can read them.
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import (
    EMPLOYER_OWNER,
    EMPLOYER_RECRUITER,
    EMPLOYER_VIEWER,
    CurrentBusinessIdentity,
    CurrentUser,
    DbSession,
    current_business_identity,
    require_role,
)
from app.modules.employer import service
from app.modules.employer.reference import active_employer_types, active_industries
from app.modules.employer.schemas import (
    AddTeamMemberRequest,
    ChangeRoleRequest,
    CreateOrganisationRequest,
    OrganisationResponse,
    ReferenceResponse,
    TeamMemberResponse,
    TermResponse,
    UpdateOrganisationRequest,
)
from app.modules.profile_images import service as profile_images_service

router = APIRouter()

AnyEmployerRole = Depends(require_role(EMPLOYER_OWNER, EMPLOYER_RECRUITER, EMPLOYER_VIEWER))
OwnerOnly = Depends(require_role(EMPLOYER_OWNER))


async def _organisation(session: AsyncSession, row: Any) -> OrganisationResponse:
    logo = await profile_images_service.logo_url(session, tenant_id=row.tenant_id)
    return OrganisationResponse.model_validate(row).model_copy(update={"logo_url": logo})


def _member(member: object) -> TeamMemberResponse:
    return TeamMemberResponse.model_validate(member)


@router.get(
    "/reference",
    response_model=ReferenceResponse,
    dependencies=[Depends(current_business_identity)],
    summary="Employer types and industries the organisation form offers",
)
async def reference() -> ReferenceResponse:
    """Active terms only. A business account needs these before it has an
    organisation, so this takes a business identity, not an employer role."""
    return ReferenceResponse(
        employer_types=[TermResponse(code=t.code, label=t.label) for t in active_employer_types()],
        industries=[TermResponse(code=t.code, label=t.label) for t in active_industries()],
    )


@router.post(
    "/organisation",
    response_model=OrganisationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create the caller's organisation and make them its owner",
)
async def create_organisation(
    payload: CreateOrganisationRequest, identity: CurrentBusinessIdentity, session: DbSession
) -> OrganisationResponse:
    """409 if the account already belongs to an organisation -- including a
    suspended one, so suspension cannot be escaped by starting afresh."""
    row = await service.create_organisation(session, user_id=identity.user_id, payload=payload)
    return await _organisation(session, row)


@router.get(
    "/organisation",
    response_model=OrganisationResponse,
    dependencies=[AnyEmployerRole],
    summary="The caller's organisation",
)
async def get_organisation(user: CurrentUser, session: DbSession) -> OrganisationResponse:
    return await _organisation(session, await service.get_organisation(session, ctx=user))


@router.patch(
    "/organisation",
    response_model=OrganisationResponse,
    dependencies=[OwnerOnly],
    summary="Change the organisation's name, type or industry",
)
async def update_organisation(
    payload: UpdateOrganisationRequest, user: CurrentUser, session: DbSession
) -> OrganisationResponse:
    """KYB status is not editable here and never will be: it moves only
    through the KYB state machine, or invariant 8 is one PATCH from bypassed."""
    row = await service.update_organisation(session, ctx=user, payload=payload)
    return await _organisation(session, row)


@router.get(
    "/team",
    response_model=list[TeamMemberResponse],
    dependencies=[AnyEmployerRole],
    summary="Active members of the caller's organisation",
)
async def list_team(user: CurrentUser, session: DbSession) -> list[TeamMemberResponse]:
    return [_member(m) for m in await service.list_team(session, ctx=user)]


@router.post(
    "/team",
    response_model=TeamMemberResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[OwnerOnly],
    summary="Add someone to the organisation by email",
)
async def add_team_member(
    payload: AddTeamMemberRequest, user: CurrentUser, session: DbSession
) -> TeamMemberResponse:
    """The person gets access the first time they sign in with that address.

    One refusal code covers every reason that concerns someone else's
    account, so this route cannot be used to test whether a person is
    registered on the platform.
    """
    return _member(await service.add_team_member(session, ctx=user, payload=payload))


@router.patch(
    "/team/{user_id}",
    response_model=TeamMemberResponse,
    dependencies=[OwnerOnly],
    summary="Change a member's role",
)
async def change_member_role(
    user_id: uuid.UUID, payload: ChangeRoleRequest, user: CurrentUser, session: DbSession
) -> TeamMemberResponse:
    """404 for someone outside the caller's organisation, never 403. 409 if
    it would leave the organisation with no owner."""
    return _member(
        await service.change_member_role(session, ctx=user, user_id=user_id, payload=payload)
    )


@router.delete(
    "/team/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[OwnerOnly],
    summary="Remove a member from the organisation",
)
async def remove_team_member(user_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    """Revoked, not deleted, and effective on the member's next request."""
    await service.remove_team_member(session, ctx=user, user_id=user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
