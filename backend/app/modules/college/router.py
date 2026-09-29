"""college - HTTP layer

Institution tenant, roster, invites, consent, referral codes.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

**Two surfaces.** `router` is the college's (`/college`): the organisation,
its team, onboarding, seats, referral codes and roster imports.
`candidate_router` is the student's (`/candidate/colleges`): the consent
terms, linking by code, invitations, and their own links.

**Who may do what at a college.** The admin runs the organisation, the team
and the referral codes; staff import rosters and send invitations. **Pay-first
(R13)** gates what reaches students -- issuing codes, importing, committing
and sending -- and leaves open what an unpaid college needs to onboard or to
stop something: the organisation, team, onboarding, seats, listing and
**revoking** codes, and discarding a preview. Revoking a credential must never
wait on a payment.

**A student's routes are not paywalled, deliberately.** Linking to a college
is how a seated student gets access at all; putting it behind a subscription
would ask them to pay for the thing their college has paid for. Granting and
revoking consent are the student's, and never wait on anyone's payment.

**Day 18.** `/college/students` combines names from the college's own roster
with individually visible candidates. A candidate id and profile open are
available only behind live INDIVIDUAL consent, read on every request. List
pages and profile opens are audited and paywalled like the analytics beside
them.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import BeforeValidator

from app.core.deps import (
    CANDIDATE,
    COLLEGE_ADMIN,
    COLLEGE_STAFF,
    CurrentBusinessIdentity,
    CurrentUser,
    DbSession,
    client_ip,
    get_request_id,
    require_active_subscription,
    require_role,
)
from app.modules.applications.domain import stage_summary
from app.modules.college import service
from app.modules.college.domain import (
    StudentStageFilter,
    format_code,
)
from app.modules.college.domain import consent_terms as terms_for
from app.modules.college.models import ReferralCode
from app.modules.college.schemas import (
    AddTeamMemberRequest,
    AnswerInvitationRequest,
    CandidateInvitationResponse,
    ChangeRoleRequest,
    CollegeLinkResponse,
    CollegeResponse,
    CollegeStudentDetailsResponse,
    CollegeStudentResponse,
    CollegeStudentResumeResponse,
    ConsentTermsResponse,
    CreateCollegeRequest,
    FormOption,
    GrantIndividualVisibilityRequest,
    InvitationCounts,
    InvitationsSentResponse,
    IssueCodeRequest,
    LinkByCodeRequest,
    OnboardingResponse,
    ReferralCodeResponse,
    ReferralCodesPage,
    RevokeConsentRequest,
    RevokeConsentResponse,
    RosterImportResponse,
    RosterImportsPage,
    RosterRowResponse,
    RosterRowsPage,
    RosterUploadRequest,
    SaveOnboardingRequest,
    SeatsResponse,
    StudentAnswer,
    StudentApplicationAnalytics,
    StudentApplicationResponse,
    StudentCourseResponse,
    StudentHireResponse,
    TeamMemberResponse,
    UpdateCollegeRequest,
    VisibleStudentResponse,
    VisibleStudentsPage,
)
from app.modules.questionnaire.domain import answers_in_words

router = APIRouter()
candidate_router = APIRouter()


def _normalise_student_stage(value: object) -> object:
    return value.upper() if isinstance(value, str) else value


StudentStageQuery = Annotated[
    StudentStageFilter,
    BeforeValidator(_normalise_student_stage),
]

AnyCollegeRole = Depends(require_role(COLLEGE_ADMIN, COLLEGE_STAFF))
AdminOnly = Depends(require_role(COLLEGE_ADMIN))
Paid = Depends(require_active_subscription)
Student = Depends(require_role(CANDIDATE))


def _college(row: object) -> CollegeResponse:
    return CollegeResponse.model_validate(row)


def _member(member: object) -> TeamMemberResponse:
    return TeamMemberResponse.model_validate(member)


def _code(row: ReferralCode) -> ReferralCodeResponse:
    return ReferralCodeResponse(
        id=row.id,
        code=format_code(row.code),
        state=service.state_of(row),
        uses=row.uses,
        max_uses=row.max_uses,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        created_at=row.created_at,
    )


def _counts(counts: dict[str, int]) -> InvitationCounts:
    return InvitationCounts(**{state.lower(): n for state, n in counts.items()})


def _import(view: service.ImportView) -> RosterImportResponse:
    r = view.record
    return RosterImportResponse(
        id=r.id,
        file_name=r.file_name,
        state=r.state,
        total_rows=r.total_rows,
        valid_rows=r.valid_rows,
        invalid_rows=r.invalid_rows,
        duplicate_rows=r.duplicate_rows,
        unreachable_rows=view.unreachable_rows,
        ignored_columns=list(r.ignored_columns),
        created_at=r.created_at,
        committed_at=r.committed_at,
        invitations=_counts(view.invitations),
    )


def _link(link: service.Link) -> CollegeLinkResponse:
    return CollegeLinkResponse(
        college_id=link.college_id,
        college_name=link.college_name,
        scope=link.scope,
        granted_via=link.granted_via,
        granted_at=link.granted_at,
        revoked_at=link.revoked_at,
        seat_held=link.seat_held,
    )


# ===========================================================================
# The college's surface
# ===========================================================================
@router.post(
    "/organisation",
    response_model=CollegeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create the caller's college and make them its admin",
)
async def create_college(
    payload: CreateCollegeRequest, identity: CurrentBusinessIdentity, session: DbSession
) -> CollegeResponse:
    """409 if the account already belongs to an organisation, of either kind."""
    return _college(
        await service.create_college(session, user_id=identity.user_id, payload=payload)
    )


@router.get(
    "/organisation",
    response_model=CollegeResponse,
    dependencies=[AnyCollegeRole],
    summary="The caller's college",
)
async def get_college(user: CurrentUser, session: DbSession) -> CollegeResponse:
    return _college(await service.get_college(session, ctx=user))


@router.patch(
    "/organisation",
    response_model=CollegeResponse,
    dependencies=[AdminOnly],
    summary="Rename the college or change its type",
)
async def update_college(
    payload: UpdateCollegeRequest, user: CurrentUser, session: DbSession
) -> CollegeResponse:
    return _college(await service.update_college(session, ctx=user, payload=payload))


@router.get(
    "/team",
    response_model=list[TeamMemberResponse],
    dependencies=[AnyCollegeRole],
    summary="Active members of the college's team",
)
async def list_team(user: CurrentUser, session: DbSession) -> list[TeamMemberResponse]:
    return [_member(m) for m in await service.list_team(session, ctx=user)]


@router.post(
    "/team",
    response_model=TeamMemberResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[AdminOnly],
    summary="Add someone to the college's team by email",
)
async def add_team_member(
    payload: AddTeamMemberRequest, user: CurrentUser, session: DbSession
) -> TeamMemberResponse:
    """One refusal code for every reason about someone else's account, as for
    employers, so this cannot test whether a person is registered."""
    return _member(
        await service.add_team_member(session, ctx=user, email=payload.email, role=payload.role)
    )


@router.patch(
    "/team/{user_id}",
    response_model=TeamMemberResponse,
    dependencies=[AdminOnly],
    summary="Change a team member's role",
)
async def change_member_role(
    user_id: uuid.UUID, payload: ChangeRoleRequest, user: CurrentUser, session: DbSession
) -> TeamMemberResponse:
    """404 outside the caller's college. 409 if it would leave no admin."""
    return _member(
        await service.change_member_role(session, ctx=user, user_id=user_id, role=payload.role)
    )


@router.delete(
    "/team/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[AdminOnly],
    summary="Remove a member from the college's team",
)
async def remove_team_member(user_id: uuid.UUID, user: CurrentUser, session: DbSession) -> Response:
    await service.remove_team_member(session, ctx=user, user_id=user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- onboarding ------------------------------------------------------------------
async def _onboarding(user: CurrentUser, session: DbSession) -> OnboardingResponse:
    college = await service.get_college(session, ctx=user)
    return OnboardingResponse(
        form=service.form_definition(),
        options={
            source: [FormOption(**option) for option in options]
            for source, options in service.form_options().items()
        },
        answers=dict(college.onboarding_answers or {}),
        form_version=college.form_version,
        submitted_at=college.onboarding_submitted_at,
    )


@router.get(
    "/onboarding",
    response_model=OnboardingResponse,
    dependencies=[AnyCollegeRole],
    summary="The onboarding form, its options and the saved answers",
)
async def get_onboarding(user: CurrentUser, session: DbSession) -> OnboardingResponse:
    return await _onboarding(user, session)


@router.put(
    "/onboarding/answers",
    response_model=OnboardingResponse,
    dependencies=[AdminOnly],
    summary="Save onboarding answers, complete or not",
)
async def save_onboarding(
    payload: SaveOnboardingRequest, user: CurrentUser, session: DbSession
) -> OnboardingResponse:
    """422 lists every malformed answer. 409 once submitted."""
    await service.save_onboarding(session, ctx=user, answers=payload.answers)
    return await _onboarding(user, session)


@router.post(
    "/onboarding/submit",
    response_model=OnboardingResponse,
    dependencies=[AdminOnly],
    summary="Submit onboarding",
)
async def submit_onboarding(user: CurrentUser, session: DbSession) -> OnboardingResponse:
    """422 lists every required answer still missing. Idempotent."""
    await service.submit_onboarding(session, ctx=user)
    return await _onboarding(user, session)


# --- seats -----------------------------------------------------------------------
@router.get(
    "/seats",
    response_model=SeatsResponse,
    dependencies=[AnyCollegeRole],
    summary="How many seats the college has, and how many are in use",
)
async def get_seats(user: CurrentUser, session: DbSession) -> SeatsResponse:
    """Counts only. The allowance is set by BharatPath staff, not here."""
    summary = await service.seat_summary(session, ctx=user)
    return SeatsResponse(
        seats_allocated=summary.allocated,
        seats_used=summary.used,
        seats_available=summary.available,
        subscription_active=summary.subscription_active,
    )


# --- referral codes --------------------------------------------------------------
@router.post(
    "/referral-codes",
    response_model=ReferralCodeResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[AdminOnly, Paid],
    summary="Issue a referral code for students to link with",
)
async def issue_code(
    payload: IssueCodeRequest, request: Request, user: CurrentUser, session: DbSession
) -> ReferralCodeResponse:
    """A code always expires (default 90 days). Anyone holding it can link
    themselves to this college, so treat it like a password you hand out."""
    row = await service.issue_code(
        session,
        ctx=user,
        expires_in_days=payload.expires_in_days,
        max_uses=payload.max_uses,
        request_id=get_request_id(request),
    )
    return _code(row)


@router.get(
    "/referral-codes",
    response_model=ReferralCodesPage,
    dependencies=[AnyCollegeRole],
    summary="The college's referral codes, newest first",
)
async def list_codes(
    user: CurrentUser,
    session: DbSession,
    cursor: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    active_only: bool = False,
) -> ReferralCodesPage:
    page = await service.list_codes(
        session,
        ctx=user,
        cursor=cursor,
        limit=limit,
        active_only=active_only,
    )
    return ReferralCodesPage(
        items=[_code(row) for row in page.items],
        next_cursor=page.next_cursor,
    )


@router.post(
    "/referral-codes/{code_id}/revoke",
    response_model=ReferralCodeResponse,
    dependencies=[AdminOnly],
    summary="Revoke a referral code",
)
async def revoke_code(
    code_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> ReferralCodeResponse:
    """Stops new links at once. Students already linked stay linked. Idempotent."""
    row = await service.revoke_code(
        session, ctx=user, code_id=code_id, request_id=get_request_id(request)
    )
    return _code(row)


# --- roster imports --------------------------------------------------------------
@router.post(
    "/roster-imports",
    response_model=RosterImportResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[AnyCollegeRole, Paid],
    summary="Upload a roster CSV and preview it",
)
async def upload_roster(
    payload: RosterUploadRequest, response: Response, user: CurrentUser, session: DbSession
) -> RosterImportResponse:
    """Nothing is invited until the import is committed. Every row comes back
    with its state and issues. The same retained file answers 200 with the
    import it already made; a discarded file creates a fresh preview. 422
    `roster_*` when the file itself is unusable."""
    view = await service.upload_roster(
        session, ctx=user, file_name=payload.file_name, csv_text=payload.csv
    )
    if not view.created:
        response.status_code = status.HTTP_200_OK
    return _import(view)


@router.get(
    "/roster-imports",
    response_model=RosterImportsPage,
    dependencies=[AnyCollegeRole],
    summary="The college's roster imports, newest first",
)
async def list_imports(
    user: CurrentUser,
    session: DbSession,
    cursor: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
) -> RosterImportsPage:
    page = await service.list_imports(session, ctx=user, cursor=cursor, limit=limit)
    return RosterImportsPage(
        items=[_import(view) for view in page.items],
        next_cursor=page.next_cursor,
        invitation_totals=_counts(page.invitation_totals),
    )


@router.get(
    "/roster-imports/{import_id}",
    response_model=RosterImportResponse,
    dependencies=[AnyCollegeRole],
    summary="One roster import, with invitation tracking",
)
async def get_import(
    import_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> RosterImportResponse:
    return _import(await service.get_import(session, ctx=user, import_id=import_id))


@router.get(
    "/roster-imports/{import_id}/rows",
    response_model=RosterRowsPage,
    dependencies=[AnyCollegeRole],
    summary="The rows of a roster import, with their issues",
)
async def list_rows(
    import_id: uuid.UUID,
    user: CurrentUser,
    session: DbSession,
    row_state: Literal["VALID", "INVALID", "DUPLICATE"] | None = None,
    cursor: str | None = None,
    limit: int | None = Query(default=None, ge=1, le=100),
) -> RosterRowsPage:
    page = await service.list_rows(
        session, ctx=user, import_id=import_id, row_state=row_state, cursor=cursor, limit=limit
    )
    return RosterRowsPage(
        items=[
            RosterRowResponse(
                row_number=row.row_number,
                full_name=row.full_name,
                phone=row.phone,
                email=row.email,
                student_ref=row.student_ref,
                row_state=row.row_state,
                issues=list(row.issues),
                invite_state=state,
            )
            for row, state in page.rows
        ],
        next_cursor=page.next_cursor,
    )


@router.post(
    "/roster-imports/{import_id}/commit",
    response_model=RosterImportResponse,
    dependencies=[AnyCollegeRole, Paid],
    summary="Put the valid rows on the roster as invitations to send",
)
async def commit_import(
    import_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> RosterImportResponse:
    """Duplicates are re-checked against the roster as it is now. Rows that
    will not be invited are deleted. Idempotent; 409 once discarded."""
    view = await service.commit_import(
        session, ctx=user, import_id=import_id, request_id=get_request_id(request)
    )
    return _import(view)


@router.post(
    "/roster-imports/{import_id}/discard",
    response_model=RosterImportResponse,
    dependencies=[AnyCollegeRole],
    summary="Discard a preview and delete its rows",
)
async def discard_import(
    import_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> RosterImportResponse:
    """Idempotent; 409 once committed."""
    return _import(await service.discard_import(session, ctx=user, import_id=import_id))


@router.post(
    "/roster-imports/{import_id}/invitations/send",
    response_model=InvitationsSentResponse,
    dependencies=[AnyCollegeRole, Paid],
    summary="Send the pending invitations of a committed import",
)
async def send_invitations(
    import_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> InvitationsSentResponse:
    """Marks each pending invitation SENT and queues it for delivery. A
    student sees it in the app from their own verified phone or email.
    Idempotent. **SMS and email delivery are not live yet** (DLT, SES)."""
    sent, view = await service.send_invitations(
        session, ctx=user, import_id=import_id, request_id=get_request_id(request)
    )
    return InvitationsSentResponse(sent=sent, invitations=_counts(view.invitations))


# ===========================================================================
# The student's surface -- `/candidate/colleges`
# ===========================================================================
@candidate_router.get(
    "/consent-terms",
    response_model=ConsentTermsResponse,
    dependencies=[Student],
    summary="What linking to a college means, to show before linking",
)
async def consent_terms(
    scope: Literal["ROSTER", "INDIVIDUAL"] = "ROSTER",
) -> ConsentTermsResponse:
    """`ROSTER` (the default) is what linking means; `INDIVIDUAL` is what
    letting the college see you by name means. Send `consent_version` back
    with the act it describes."""
    version, key, text = terms_for(scope)
    return ConsentTermsResponse(consent_version=version, scope=scope, key=key, text=text)


@candidate_router.get(
    "",
    response_model=list[CollegeLinkResponse],
    dependencies=[Student],
    summary="The colleges the student has linked to",
)
async def list_links(user: CurrentUser, session: DbSession) -> list[CollegeLinkResponse]:
    return [_link(link) for link in await service.list_links(session, ctx=user)]


@candidate_router.post(
    "/link",
    response_model=CollegeLinkResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Student],
    summary="Link to a college with its referral code",
)
async def link_by_code(
    payload: LinkByCodeRequest,
    request: Request,
    response: Response,
    user: CurrentUser,
    session: DbSession,
) -> CollegeLinkResponse:
    """Entering the code is the student's consent to be **counted** by that
    college, and nothing more. 200 if already linked. 422
    `referral_code_invalid` for every kind of bad code; 409
    `consent_version_outdated`; 429 after too many attempts."""
    link = await service.link_by_code(
        session,
        ctx=user,
        code=payload.code,
        consent_version=payload.consent_version,
        client_ip=client_ip(request),
        request_id=get_request_id(request),
    )
    if not link.created:
        response.status_code = status.HTTP_200_OK
    return _link(link)


@candidate_router.get(
    "/invitations",
    response_model=list[CandidateInvitationResponse],
    dependencies=[Student],
    summary="Invitations from colleges to this student's phone or email",
)
async def list_invitations(
    user: CurrentUser, session: DbSession
) -> list[CandidateInvitationResponse]:
    return [
        CandidateInvitationResponse(
            id=i.entry_id, college_name=i.college_name, sent_at=i.sent_at, expires_at=i.expires_at
        )
        for i in await service.list_invitations(session, ctx=user)
    ]


@candidate_router.post(
    "/invitations/{invitation_id}/accept",
    response_model=CollegeLinkResponse,
    dependencies=[Student],
    summary="Accept a college's invitation",
)
async def accept_invitation(
    invitation_id: uuid.UUID,
    payload: AnswerInvitationRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> CollegeLinkResponse:
    """Accepting is the consent to be counted, as entering a code is. 404 if
    not yours, expired, or declined."""
    link = await service.answer_invitation(
        session,
        ctx=user,
        entry_id=invitation_id,
        accept=True,
        consent_version=payload.consent_version,
        request_id=get_request_id(request),
    )
    assert link is not None  # accepting always links
    return _link(link)


@candidate_router.post(
    "/invitations/{invitation_id}/decline",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Student],
    summary="Decline a college's invitation",
)
async def decline_invitation(
    invitation_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> Response:
    await service.answer_invitation(
        session, ctx=user, entry_id=invitation_id, accept=False, consent_version=None
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@candidate_router.post(
    "/{college_id}/individual-visibility",
    response_model=CollegeLinkResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Student],
    summary="Let a linked college see the student by name",
)
async def grant_individual_visibility(
    college_id: uuid.UUID,
    payload: GrantIndividualVisibilityRequest,
    request: Request,
    response: Response,
    user: CurrentUser,
    session: DbSession,
) -> CollegeLinkResponse:
    """A separate choice from linking. Show `GET /consent-terms?scope=INDIVIDUAL`
    first. 200 if already granted; 404 `college_link_not_found` without a live
    link; 409 `consent_version_outdated`."""
    link = await service.grant_individual_visibility(
        session,
        ctx=user,
        college_id=college_id,
        consent_version=payload.consent_version,
        request_id=get_request_id(request),
    )
    if not link.created:
        response.status_code = status.HTTP_200_OK
    return _link(link)


@candidate_router.post(
    "/{college_id}/revoke",
    response_model=RevokeConsentResponse,
    dependencies=[Student],
    summary="Withdraw consent from a college, at once",
)
async def revoke_consent(
    college_id: uuid.UUID,
    payload: RevokeConsentRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> RevokeConsentResponse:
    """Takes effect on the next request anyone makes. Idempotent; 404
    `college_link_not_found` for a college the student never linked to."""
    revocation = await service.revoke_consent(
        session,
        ctx=user,
        college_id=college_id,
        scope=payload.scope,
        request_id=get_request_id(request),
    )
    return RevokeConsentResponse(
        college_id=revocation.college_id,
        revoked=list(revocation.revoked),
        revoked_at=revocation.revoked_at,
    )


# ===========================================================================
# The college's view of students who allow it (Day 18)
# ===========================================================================
@router.get(
    "/students",
    response_model=VisibleStudentsPage,
    dependencies=[AnyCollegeRole, Paid],
    summary="The college roster by link stage",
)
async def list_students(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    q: Annotated[
        str | None,
        Query(max_length=100, description="Part of the student's name"),
    ] = None,
    stage: StudentStageQuery = "ALL",
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    limit: int | None = Query(default=None, ge=1, le=100),
) -> VisibleStudentsPage:
    """`q` matches part of the displayed student name, case-insensitively.

    LINKED rows use the student's live individual-visibility grant. INVITED
    and CONSENT_PENDING rows use only names from the college's own roster and
    never expose a candidate id. Every page read is audited.
    """
    page = await service.list_visible_students(
        session,
        ctx=user,
        cursor=cursor,
        limit=limit,
        query=q,
        stage=stage,
        request_id=get_request_id(request),
    )
    return VisibleStudentsPage(
        items=[
            VisibleStudentResponse(
                candidate_id=s.candidate_id,
                roster_entry_id=s.roster_entry_id,
                full_name=s.full_name,
                stage_since=s.stage_since,
                visible_since=s.visible_since,
                link_state=s.link_state,
            )
            for s in page.items
        ],
        next_cursor=page.next_cursor,
    )


@router.get(
    "/students/{candidate_id}/details",
    response_model=CollegeStudentDetailsResponse,
    dependencies=[AnyCollegeRole, Paid],
    summary="A student's sign-up details, interviews, courses and applications",
)
async def get_student_details(
    candidate_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> CollegeStudentDetailsResponse:
    """Only for a student whose visibility consent is to the current words
    (2026-09-29), which name all of this. 409
    `college_student_details_not_shared` for a student who agreed to earlier
    words -- only they can agree to these -- and 404 unless their consent is
    live. Every open is audited."""
    view = await service.open_student_details(
        session, ctx=user, candidate_id=candidate_id, request_id=get_request_id(request)
    )
    summary = stage_summary(current=[a.stage for a in view.applications], reached=view.reached)
    return CollegeStudentDetailsResponse(
        candidate_id=view.candidate_id,
        consent_version=view.consent_version,
        email=view.email,
        phone=view.phone,
        city=view.city,
        state_code=view.state_code,
        locale=view.locale,
        questionnaire=[
            StudentAnswer(code=a.code, question=a.question, answer=a.answer)
            for a in answers_in_words(view.questionnaire, include_free_text=False)
        ],
        questionnaire_submitted_at=view.questionnaire_submitted_at,
        resume_confirmed_at=view.resume_confirmed_at,
        has_resume_file=view.has_resume_file,
        interviews_completed=view.interviews_completed,
        courses=[
            StudentCourseResponse(
                code=c.code,
                title=c.title,
                purchased_at=c.purchased_at,
                lessons_total=c.lessons_total,
                lessons_completed=c.lessons_completed,
                percent_complete=c.percent_complete,
                completed_at=c.completed_at,
            )
            for c in view.courses
        ],
        applications=[
            StudentApplicationResponse(
                job_title=a.job_title,
                employer_name=a.employer_name,
                job_location=a.job_location,
                stage=a.stage,
                applied_at=a.applied_at,
                updated_at=a.updated_at,
            )
            for a in view.applications
        ],
        analytics=StudentApplicationAnalytics(
            total=summary.total,
            open=summary.open,
            by_stage=summary.by_stage,
            reached=summary.reached,
        ),
    )


@router.get(
    "/students/{candidate_id}/resume",
    response_model=CollegeStudentResumeResponse,
    dependencies=[AnyCollegeRole, Paid],
    summary="The student's CV (audited)",
)
async def get_student_resume(
    candidate_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> CollegeStudentResumeResponse:
    """The confirmed CV the score was built from. Same consent rule as
    `/details`; 404 `college_student_resume_not_found` before the student has
    one. `file_url` is a presigned GET that expires."""
    resume = await service.open_student_resume(
        session, ctx=user, candidate_id=candidate_id, request_id=get_request_id(request)
    )
    return CollegeStudentResumeResponse(
        confirmed_at=resume.confirmed_at,
        source=resume.source,
        text=resume.text,
        fields=resume.fields,
        file_url=resume.file_url,
        file_mime=resume.file_mime,
    )


@router.get(
    "/students/{candidate_id}",
    response_model=CollegeStudentResponse,
    dependencies=[AnyCollegeRole, Paid],
    summary="One student who lets the college see them",
)
async def get_student(
    candidate_id: uuid.UUID, request: Request, user: CurrentUser, session: DbSession
) -> CollegeStudentResponse:
    """404 `college_student_not_found` unless the student's consent is live
    right now. Every open is audited, re-opens included."""
    view = await service.open_student(
        session, ctx=user, candidate_id=candidate_id, request_id=get_request_id(request)
    )
    return CollegeStudentResponse(
        candidate_id=view.candidate_id,
        full_name=view.full_name,
        visible_since=view.visible_since,
        score=view.score,
        band=view.band,
        scored_at=view.scored_at,
        applications=view.applications,
        interviews=view.interviews,
        hires=[
            StudentHireResponse(
                job_title=h.job_title, employer_name=h.employer_name, hired_at=h.hired_at
            )
            for h in view.hires
        ],
    )
