"""Insights never change profile data, resume contents, scores or application stages."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.core.audit import AuditAction, audit_event
from app.core.db import get_admin_session_factory, set_transaction_tenant, set_transaction_user
from app.core.errors import ConflictError, PermissionDeniedError

from . import repository as repo
from .domain import ACTIONS, IST, METRICS, comparison, default_config, strength
from .models import InsightRollup


async def configuration(session):
    value, version = await repo.config(session)
    return {**(value or default_config()), "version": version}


async def configure(session, ctx, payload):
    if ctx.role != "PLATFORM_ADMIN":
        raise PermissionDeniedError()
    value = payload.model_dump(exclude={"version"})
    version = await repo.append_config(session, value, payload.version)
    if version is None:
        raise ConflictError(
            code="insights_config_changed", title="Configuration changed. Reload before saving."
        )
    await audit_event(
        session,
        action=AuditAction.INSIGHTS_CONFIG_CHANGED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="config",
        target_id=None,
        tenant_id=ctx.tenant_id,
        metadata={"version": version},
    )
    return {**value, "version": version}


async def record(
    session, *, ctx, candidate_id, metric, event_id=None, application_id=None, terms=None, at=None
):
    if metric not in METRICS or not ctx.tenant_id:
        return False
    now = at or datetime.now(UTC)
    key = (
        f"view:{ctx.user_id}:{candidate_id}:{now.astimezone(IST).date()}"
        if metric == "PROFILE_VIEW"
        else f"{metric}:{event_id or uuid.uuid4()}"
    )
    return await repo.event(
        session,
        candidate_id=candidate_id,
        actor_id=ctx.user_id,
        tenant_id=ctx.tenant_id,
        metric=metric,
        dedup_key=key,
        terms=terms,
        application_id=application_id,
        occurred_at=now,
    )


async def search_receipts(session, ctx, candidates, terms):
    # Retain matched skills and locations only, never arbitrary query text.
    def clean(values):
        return list(
            dict.fromkeys(
                str(term).strip().casefold()[:100] for term in values if str(term).strip()
            )
        )[:20]

    cleaned = (
        {candidate: clean(values) for candidate, values in terms.items()}
        if isinstance(terms, dict)
        else clean(terms)
    )
    return await repo.issue_receipts(session, ctx, candidates, cleaned)


async def impressions(session, ctx, ids):
    from app.core.ratelimit import hit

    await hit(bucket="insights:impressions", subject=str(ctx.user_id), limit=120, window_seconds=60)
    from app.modules.discovery.service import insight_visible

    if ctx.tenant_id is None:
        raise PermissionDeniedError()
    await set_transaction_tenant(session, ctx.tenant_id)
    accepted = 0
    for row in await repo.receipts_for(session, ctx, list(set(ids))):
        if not await insight_visible(session, ctx=ctx, candidate_id=row.candidate_id):
            continue
        row.shown_at = datetime.now(UTC)
        accepted += int(
            await record(
                session,
                ctx=ctx,
                candidate_id=row.candidate_id,
                metric="SEARCH_APPEARANCE",
                event_id=row.id,
                terms=row.terms,
            )
        )
    return {"accepted": accepted}


async def recruiter_action(session, ctx, payload):
    from app.core.ratelimit import hit

    await hit(bucket="insights:actions", subject=str(ctx.user_id), limit=60, window_seconds=60)
    from app.modules.applications.service import insight_action_candidate
    from app.modules.discovery.service import require_shortlistable

    if payload.application_id:
        candidate = await insight_action_candidate(
            session, ctx=ctx, application_id=payload.application_id
        )
        if candidate != payload.candidate_id:
            raise PermissionDeniedError()
    else:
        if ctx.role not in {"EMPLOYER_OWNER", "EMPLOYER_RECRUITER"}:
            raise PermissionDeniedError()
        await require_shortlistable(session, ctx=ctx, candidate_id=payload.candidate_id)
    return {
        "recorded": await record(
            session,
            ctx=ctx,
            candidate_id=payload.candidate_id,
            metric=payload.action,
            event_id=payload.event_id,
            application_id=payload.application_id,
        )
    }


async def overview(session, ctx, days):
    if ctx.role != "CANDIDATE":
        raise PermissionDeniedError()
    await set_transaction_user(session, ctx.user_id)
    config = await configuration(session)
    enabled = ctx.user_id.int % 100 < config["rollout_percent"] and any(config["metrics"].values())
    if not enabled:
        return {"enabled": False, "metrics": config["metrics"], "days": days}
    # The admin connection joins only the requesting candidate's aggregates to
    # company labels. No recruiter identifiers or contacts enter the response.
    await audit_event(
        session,
        action=AuditAction.PROFILE_INSIGHTS_READ,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="candidate",
        target_id=ctx.user_id,
        tenant_id=None,
    )
    async with get_admin_session_factory()() as reader, reader.begin():
        today = datetime.now(UTC).astimezone(IST).date()
        start = today - timedelta(days=days - 1)
        rows = await repo.daily(reader, ctx.user_id, today - timedelta(days=2 * days - 1), today)
        current = {}
        previous = {}
        companies = {}
        keywords = {}
        for metric, day, company, keyword, count in rows:
            target = current if day >= start else previous
            target[metric] = target.get(metric, 0) + count
            if day >= start and metric in ACTIONS:
                companies[company] = companies.get(company, 0) + count
            if day >= start and metric == "SEARCH_KEYWORD":
                keywords[keyword] = keywords.get(keyword, 0) + count
        labels = await repo.companies(reader, set(companies))
        facts = await repo.facts(reader, ctx.user_id)
        applications = (
            await repo.timelines(reader, ctx.user_id)
            if config["metrics"]["applications"]
            else {"items": [], "next_offset": None}
        )
        aggregated = await reader.scalar(
            select(InsightRollup.updated_at).where(InsightRollup.id == 1)
        )
    result = {
        "enabled": True,
        "metrics": config["metrics"],
        "days": days,
        "period_start": start.isoformat(),
        "period_end": today.isoformat(),
        "timezone": "Asia/Kolkata",
        "coverage_note": (
            "Historical profile views use existing view logs. Search appearances and recruiter "
            "actions are recorded from this release; earlier activity may be unavailable."
        ),
        "aggregated_at": aggregated.isoformat() if aggregated else None,
    }
    if config["metrics"]["views"]:
        result["views"] = comparison(
            current.get("PROFILE_VIEW", 0), previous.get("PROFILE_VIEW", 0)
        )
    if config["metrics"]["search"]:
        result["search"] = comparison(
            current.get("SEARCH_APPEARANCE", 0), previous.get("SEARCH_APPEARANCE", 0)
        )
        result["keywords"] = [
            {"keyword": key, "count": count}
            for key, count in sorted(keywords.items(), key=lambda item: -item[1])[:5]
        ]
    if config["metrics"]["actions"]:
        result["actions"] = comparison(
            sum(current.get(key, 0) for key in ACTIONS),
            sum(previous.get(key, 0) for key in ACTIONS),
        )
        result["action_breakdown"] = [
            {"action": key, **comparison(current.get(key, 0), previous.get(key, 0))}
            for key in ACTIONS
        ]
        result["companies"] = [
            {
                **labels.get(
                    company, {"name": "Company no longer available", "industry": None, "city": None}
                ),
                "actions": count,
            }
            for company, count in sorted(companies.items(), key=lambda item: -item[1])[:20]
        ]
        result["companies_truncated"] = len(companies) > 20
    if config["metrics"]["strength"]:
        result["strength"] = strength(facts, config["rules"])
    if config["metrics"]["applications"]:
        result["applications"] = applications
    return result


async def application_page(session, ctx, offset):
    if ctx.role != "CANDIDATE":
        raise PermissionDeniedError()
    config = await configuration(session)
    if not config["metrics"]["applications"] or ctx.user_id.int % 100 >= config["rollout_percent"]:
        return {"items": [], "next_offset": None}
    await audit_event(
        session,
        action=AuditAction.PROFILE_INSIGHTS_READ,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="candidate",
        target_id=ctx.user_id,
        tenant_id=None,
    )
    async with get_admin_session_factory()() as reader, reader.begin():
        return await repo.timelines(reader, ctx.user_id, offset)


async def event_volumes(session, ctx):
    if ctx.role != "PLATFORM_ADMIN":
        raise PermissionDeniedError()
    async with get_admin_session_factory()() as reader, reader.begin():
        return await repo.volumes(reader)


async def record_shortlist(session, *, candidate_id, actor_id, tenant_id, application_id):
    return await repo.event(
        session,
        candidate_id=candidate_id,
        actor_id=actor_id,
        tenant_id=tenant_id,
        metric="SHORTLISTED",
        dedup_key=f"shortlisted:{application_id}",
        application_id=application_id,
    )
