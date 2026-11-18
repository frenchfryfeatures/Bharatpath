"""Indexed counters and candidate-scoped projections; no raw recruiter identities leave here."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert

from app.core.models import ConfigValue

from .domain import IST
from .models import AnonymousTotal, InsightDay, InsightEvent, InsightRollup, SearchReceipt


async def config(session):
    row = await session.scalar(
        select(ConfigValue)
        .where(
            ConfigValue.key == "profile.insights", ConfigValue.effective_from <= datetime.now(UTC)
        )
        .order_by(ConfigValue.version.desc())
        .limit(1)
    )
    return (row.value, row.version) if row else (None, 0)


async def append_config(session, value, expected):
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended('config_values:profile.insights',0))")
    )
    _, version = await config(session)
    if version != expected:
        return None
    row = ConfigValue(
        key="profile.insights",
        version=version + 1,
        value=value,
        effective_from=datetime.now(UTC),
        note="Profile Insights admin configuration",
    )
    session.add(row)
    await session.flush()
    return version + 1


async def event(
    session,
    *,
    candidate_id,
    actor_id,
    tenant_id,
    metric,
    dedup_key,
    terms=None,
    application_id=None,
    occurred_at=None,
):
    statement = (
        insert(InsightEvent)
        .values(
            id=uuid.uuid4(),
            candidate_id=candidate_id,
            actor_id=actor_id,
            tenant_id=tenant_id,
            metric=metric,
            dedup_key=dedup_key,
            terms=terms or [],
            application_id=application_id,
            occurred_at=occurred_at or datetime.now(UTC),
            aggregated=False,
        )
        .on_conflict_do_nothing(index_elements=[InsightEvent.dedup_key])
    )
    result = await session.execute(statement)
    return result.rowcount == 1


async def issue_receipts(session, ctx, candidates, terms):
    receipts = {candidate: uuid.uuid4() for candidate in candidates}
    if receipts:
        await session.execute(
            insert(SearchReceipt),
            [
                {
                    "id": receipt,
                    "candidate_id": candidate,
                    "actor_id": ctx.user_id,
                    "tenant_id": ctx.tenant_id,
                    "terms": terms.get(candidate, []) if isinstance(terms, dict) else terms,
                    "expires_at": datetime.now(UTC) + timedelta(minutes=15),
                }
                for candidate, receipt in receipts.items()
            ],
        )
    return receipts


async def receipts_for(session, ctx, ids):
    return list(
        (
            await session.scalars(
                select(SearchReceipt)
                .where(
                    SearchReceipt.id.in_(ids),
                    SearchReceipt.actor_id == ctx.user_id,
                    SearchReceipt.tenant_id == ctx.tenant_id,
                    SearchReceipt.expires_at > datetime.now(UTC),
                    SearchReceipt.shown_at.is_(None),
                )
                .with_for_update()
            )
        ).all()
    )


async def rollup(session, now):
    # Serialize rollup and retention; event insertion stays independent and fast.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended('insights:retention',0))")
    )
    # Every batch claims only pending events. A failed transaction replays safely.
    rows = list(
        (
            await session.scalars(
                select(InsightEvent)
                .where(InsightEvent.aggregated.is_(False))
                .order_by(InsightEvent.occurred_at, InsightEvent.id)
                .limit(1000)
                .with_for_update(skip_locked=True)
            )
        ).all()
    )
    for row in rows:
        dimensions = [(row.metric, "")]
        if row.metric == "SEARCH_APPEARANCE":
            dimensions.extend(("SEARCH_KEYWORD", term) for term in set(row.terms))
        for metric, keyword in dimensions:
            statement = insert(InsightDay).values(
                candidate_id=row.candidate_id,
                day=row.occurred_at.astimezone(IST).date(),
                metric=metric,
                company_id=row.tenant_id or uuid.UUID(int=0),
                keyword=keyword,
                count=1,
            )
            await session.execute(
                statement.on_conflict_do_update(
                    index_elements=[
                        InsightDay.candidate_id,
                        InsightDay.day,
                        InsightDay.metric,
                        InsightDay.company_id,
                        InsightDay.keyword,
                    ],
                    set_={"count": InsightDay.count + 1},
                )
            )
        row.aggregated = True
    await session.flush()
    statement = insert(InsightRollup).values(id=1, updated_at=now)
    await session.execute(
        statement.on_conflict_do_update(index_elements=[InsightRollup.id], set_={"updated_at": now})
    )
    return len(rows)


async def purge(session, now):
    cutoff = now.astimezone(IST).date() - timedelta(days=365)
    rows = (
        await session.execute(
            select(InsightDay.metric, func.sum(InsightDay.count))
            .where(InsightDay.day < cutoff)
            .group_by(InsightDay.metric)
        )
    ).all()
    for metric, count in rows:
        statement = insert(AnonymousTotal).values(metric=metric, count=int(count))
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[AnonymousTotal.metric],
                set_={"count": AnonymousTotal.count + int(count)},
            )
        )
    await session.execute(InsightDay.__table__.delete().where(InsightDay.day < cutoff))
    await session.execute(
        InsightEvent.__table__.delete().where(
            InsightEvent.occurred_at < now - timedelta(days=365), InsightEvent.aggregated.is_(True)
        )
    )
    await session.execute(SearchReceipt.__table__.delete().where(SearchReceipt.expires_at < now))


async def daily(session, candidate, start, end):
    return (
        await session.execute(
            select(
                InsightDay.metric,
                InsightDay.day,
                InsightDay.company_id,
                InsightDay.keyword,
                InsightDay.count,
            ).where(
                InsightDay.candidate_id == candidate, InsightDay.day >= start, InsightDay.day <= end
            )
        )
    ).all()


async def facts(session, candidate):
    row = (
        await session.execute(
            text(
                """SELECT p.full_name,p.career,
                EXISTS(SELECT 1 FROM user_photos ph WHERE ph.user_id=p.user_id) AS photo,
                EXISTS(SELECT 1 FROM resume_versions v WHERE v.user_id=p.user_id) AS resume
                FROM candidate_profiles p WHERE p.user_id=:candidate"""
            ),
            {"candidate": candidate},
        )
    ).first()
    if not row:
        return {}
    return {
        **((row.career or {}).get("details") or {}),
        "full_name": row.full_name,
        "photo": row.photo,
        "resume": row.resume,
    }


async def companies(session, ids):
    if not ids:
        return {}
    # City is not collected as a dedicated company field; do not infer it.
    rows = (
        await session.execute(
            text("SELECT tenant_id, legal_name, industry FROM employers WHERE tenant_id=ANY(:ids)"),
            {"ids": list(ids)},
        )
    ).all()
    return {
        row.tenant_id: {"name": row.legal_name, "industry": row.industry, "city": None}
        for row in rows
    }


async def timelines(session, candidate, offset=0):
    rows = (
        (
            await session.execute(
                text(
                    """SELECT a.id,a.stage,a.created_at,j.title,e.legal_name AS company
                    FROM applications a JOIN jobs j ON j.id=a.job_id
                    JOIN employers e ON e.tenant_id=a.tenant_id
                    WHERE a.candidate_id=:candidate
                    ORDER BY a.created_at DESC,a.id DESC LIMIT 21 OFFSET :offset"""
                ),
                {"candidate": candidate, "offset": offset},
            )
        )
        .mappings()
        .all()
    )
    items = []
    for row in rows[:20]:
        events = (
            (
                await session.execute(
                    text(
                        """SELECT kind,to_stage,occurred_at AS created_at FROM application_events
                        WHERE application_id=:id ORDER BY occurred_at,id"""
                    ),
                    {"id": row["id"]},
                )
            )
            .mappings()
            .all()
        )
        # Legacy VIEWED may be inferred. Only a recorded application open is proof.
        opened = await session.scalar(
            select(func.min(InsightEvent.occurred_at)).where(
                InsightEvent.application_id == row["id"], InsightEvent.metric == "APPLICATION_VIEW"
            )
        )
        history = [
            {"stage": event["to_stage"], "at": event["created_at"].isoformat()}
            for event in events
            if event["kind"] == "STAGE_CHANGED" and event["to_stage"] != "VIEWED"
        ]
        if not any(event["stage"] == "SUBMITTED" for event in history):
            history.insert(0, {"stage": "SUBMITTED", "at": row["created_at"].isoformat()})
        if opened:
            history.append({"stage": "VIEWED", "at": opened.isoformat()})
        history.sort(key=lambda event: event["at"])
        items.append(
            {
                "id": str(row["id"]),
                "title": row["title"],
                "company": row["company"],
                "current_stage": row["stage"],
                "timeline": history,
            }
        )
    return {"items": items, "next_offset": offset + 20 if len(rows) > 20 else None}


async def volumes(session):
    rows = (
        await session.execute(
            select(
                InsightEvent.metric,
                func.count(),
                func.count().filter(InsightEvent.aggregated.is_(False)),
            ).group_by(InsightEvent.metric)
        )
    ).all()
    updated = await session.scalar(select(InsightRollup.updated_at).where(InsightRollup.id == 1))
    return {
        "events": [
            {"metric": metric, "retained": total, "pending": pending}
            for metric, total, pending in rows
        ],
        "aggregated_at": updated.isoformat() if updated else None,
    }
