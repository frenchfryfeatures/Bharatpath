"""assistant - business rules and transaction boundaries

The candidate's job-search chat (2026-10-13). See `domain.py` for the rules
this file carries out.

Services own the transaction. They never touch `Request`, and anything
that reveals private data writes its audit row on the same session
before the transaction closes.

**Every action is another module's own door**: the board's search and job
screen (`jobs.service`), the home screen's recommendations (`jobs.service`,
`candidate.career_service`) and the Application Board
(`applications.service`). Each binds the candidate and applies its own
rules, so the chat can show nothing the app's screens would not.

**Paywalled like the board** (R13), by the router. Rate-limited per person
(`assistant.message`, failing closed), because every message is a paid
model call.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationError
from app.core.logging import get_logger
from app.core.ratelimit import enforce
from app.core.tenant import TenantContext
from app.modules.applications import service as applications_service
from app.modules.assistant.domain import (
    LISTING_ACTIONS,
    MAX_OFFSET,
    MAX_PLAN_ATTEMPTS,
    OPEN_TO_YOU,
    RESULTS_PER_TURN,
    ConversationState,
    JobInView,
    Listing,
    ListingSource,
    Plan,
    PlanContext,
    PlanRefusedError,
    SearchRequest,
    StateInvalidError,
    Turn,
    decode_state,
    encode_state,
    excerpt,
    parse_plan,
    salary_words,
    trim_history,
)
from app.modules.assistant.planner import AssistantUnavailableError, get_planner
from app.modules.assistant.schemas import (
    ApplyProposal,
    AssistantMessageRequest,
    AssistantReply,
)
from app.modules.candidate import career_service
from app.modules.identity import service as identity_service
from app.modules.jobs import service as jobs_service
from app.modules.jobs.domain import RECOMMENDATIONS_MAX, MatchTerms
from app.modules.jobs.schemas import BoardJobDetail, RecommendedJob

logger = get_logger(__name__)


class AssistantStateInvalidError(ValidationError):
    code = "assistant_state_invalid"
    title = "The conversation state is not one this server wrote; start over"


def _in_view(jobs: list[BoardJobDetail]) -> tuple[JobInView, ...]:
    return tuple(
        JobInView(
            number=n,
            title=job.title,
            employer_name=job.employer_name,
            location=job.location,
            work_mode=job.work_mode,
            skills=tuple(job.skills),
            experience_min_years=(
                round(job.experience_min_months / 12, 1)
                if job.experience_min_months is not None
                else None
            ),
            salary=salary_words(
                minimum_minor=job.salary_min_minor,
                maximum_minor=job.salary_max_minor,
                period=job.details.compensation.period,
                disclosed=job.salary_disclosed,
            ),
            description=excerpt(job.description),
            open_to_you=OPEN_TO_YOU[job.eligibility],
        )
        for n, job in enumerate(jobs, start=1)
    )


async def _plan(context: PlanContext) -> Plan:
    """Ask the planner, and once more with the reason if its plan does not
    fit. Never a guessed plan in place of a refused one."""
    planner = get_planner()
    refused: list[str] = []
    for _ in range(MAX_PLAN_ATTEMPTS):
        raw = await planner.plan(context=replace(context, refused=tuple(refused)))
        try:
            return parse_plan(raw, jobs_in_view=len(context.jobs_in_view))
        except PlanRefusedError as exc:
            logger.warning("assistant_plan_refused", reason=exc.reason)
            refused.append(exc.reason)
    raise AssistantUnavailableError()


async def _listing(
    session: AsyncSession,
    ctx: TenantContext,
    *,
    source: ListingSource,
    search: SearchRequest | None,
    offset: int,
) -> tuple[list[RecommendedJob], bool]:
    """One page of a list, from `offset`, and whether there is more."""
    if source == "SEARCH":
        search = search or SearchRequest()
        months = search.experience_years * 12 if search.experience_years is not None else None
        terms = MatchTerms.build(
            # Role words are often skills too ("accountant", "driver"); a job
            # matching either is a match.
            skills=[*search.skills, *search.keywords],
            titles=search.keywords,
            locations=search.locations,
            experience_months=months,
        )
        return await jobs_service.search_ranked(
            session,
            ctx=ctx,
            terms=terms,
            locations=search.locations,
            work_mode=search.work_mode,
            min_salary_minor=(
                search.min_salary_rupees * 100 if search.min_salary_rupees is not None else None
            ),
            max_experience_months=months,
            eligible_only=search.eligible_only,
            offset=offset,
            limit=RESULTS_PER_TURN,
        )
    # The home screen's sections are short lists, not paginated; a page of
    # one is a slice of the list as long as it needs to be.
    wanted = min(offset + RESULTS_PER_TURN + 1, RECOMMENDATIONS_MAX)
    if source == "MATCH_MY_PROFILE":
        section = await career_service.jobs_matching_profile(session, ctx=ctx, limit=wanted)
    else:
        section = await jobs_service.similar_to_applied(session, ctx=ctx, limit=wanted)
    page = section.items[offset : offset + RESULTS_PER_TURN]
    return page, len(section.items) > offset + RESULTS_PER_TURN


async def respond(
    session: AsyncSession, *, ctx: TenantContext, payload: AssistantMessageRequest
) -> AssistantReply:
    """Read one message, do what it asks, and say so."""
    user_id = await jobs_service.bind_candidate(session, ctx)
    try:
        state = decode_state(payload.state)
    except StateInvalidError as exc:
        raise AssistantStateInvalidError() from exc
    await enforce("assistant.message", subject=str(user_id))

    # Jobs no longer on the board drop out of view, so "the second one" is
    # always counted among jobs the candidate can still open.
    view = await jobs_service.board_jobs(session, ctx=ctx, job_ids=list(state.in_view))
    listing = state.listing
    can_show_more = listing is not None and listing.can_continue
    context = PlanContext(
        language=await identity_service.locale_of(session, user_id=user_id),
        history=trim_history([Turn(t.role, t.text) for t in payload.history]),
        message=payload.message.strip(),
        jobs_in_view=_in_view(view),
        can_show_more=can_show_more,
    )
    plan = await _plan(context)
    logger.info("assistant_action", action=plan.action)

    reply = AssistantReply(
        reply=plan.reply,
        action=plan.action,
        suggestions=list(plan.suggestions),
        state=encode_state(state),
    )

    if plan.action in LISTING_ACTIONS or plan.action == "MORE_RESULTS":
        if plan.action == "MORE_RESULTS":
            if listing is None or not can_show_more:
                return reply.model_copy(update={"reply": plan.reply_if_empty})
            source, search, offset = listing.source, listing.search, listing.offset
        else:
            source, search, offset = cast(ListingSource, plan.action), plan.search, 0
        jobs, more = await _listing(session, ctx, source=source, search=search, offset=offset)
        if not jobs:
            # Nothing new to show: the jobs in view stay, so "apply to the
            # first one" still means what it meant.
            return reply.model_copy(update={"reply": plan.reply_if_empty})
        next_state = ConversationState(
            in_view=tuple(job.id for job in jobs),
            listing=Listing(
                source=source,
                offset=min(offset + len(jobs), MAX_OFFSET),
                search=search,
                more=more,
            ),
        )
        return reply.model_copy(
            update={"jobs": jobs, "has_more": more, "state": encode_state(next_state)}
        )

    if plan.action in ("SHOW_JOB", "APPLY"):
        # `parse_plan` held the number to the jobs in view.
        job = view[(plan.job_number or 1) - 1]
        update: dict[str, Any] = {"job": job}
        if plan.action == "APPLY" and job.eligibility == "ELIGIBLE":
            update["apply"] = ApplyProposal(
                job_id=job.id,
                job_title=job.title,
                employer_name=job.employer_name,
                in_app=job.details.application.method == "BHARATPATH",
            )
        return reply.model_copy(update=update)

    if plan.action == "MY_APPLICATIONS":
        page = await applications_service.list_mine(
            session, ctx=ctx, cursor=None, limit=RESULTS_PER_TURN, status=plan.applications
        )
        if not page.items:
            return reply.model_copy(update={"reply": plan.reply_if_empty})
        return reply.model_copy(update={"applications": page.items})

    return reply
