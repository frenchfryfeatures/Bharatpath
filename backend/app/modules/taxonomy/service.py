import hashlib
import json
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditAction, audit_event
from app.core.cache import get_redis
from app.core.errors import ConflictError, NotFoundError, RateLimitedError, ValidationError
from app.core.logging import get_logger
from app.core.tenant import TenantContext

from . import repository as repo
from .domain import LEVELS, PARENTS, PROFILE_KEYS, clean_name, normalize, slug_for
from .models import IndustryDepartmentPriority, OtherSubmission

logger = get_logger(__name__)


def invalid(message: Any, **params: Any) -> Any:
    return ValidationError(code="taxonomy_invalid", title=message, params=params)


async def lock_catalogue(session: AsyncSession) -> None:
    # Consistent lock order for imports, moves, moderation and individual edits.
    await session.execute(text("SELECT id FROM taxonomy_revision WHERE id=1 FOR UPDATE"))


async def row_for(
    session: AsyncSession, level: Any, option_id: Any, *, visible: Any = False, lock: Any = False
) -> Any:
    query = select(repo.MODELS[level]).where(repo.MODELS[level].id == option_id)
    if lock:
        query = query.with_for_update()
    row = await session.scalar(query)
    if not row or row.deleted_at or (visible and not row.is_visible):
        raise NotFoundError(title="This option is no longer available. Choose another option.")
    return row


async def usage(session: AsyncSession, level: Any, option_id: Any) -> Any:
    return int(
        await session.scalar(
            text("SELECT taxonomy_usage(:level, :id)"), {"level": level, "id": option_id}
        )
        or 0
    )


async def serialize(session: AsyncSession, level: Any, row: Any, *, admin: Any = False) -> Any:
    result = {
        "id": str(row.id),
        "name": row.name,
        "slug": row.slug,
        "sort_order": row.sort_order,
        "parent_id": str(repo.parent_id(row)) if repo.parent_id(row) else None,
        "type": getattr(row, "type", None),
        "is_visible": row.is_visible,
        "is_user_added": row.is_user_added,
        "version": row.version,
        "updated_at": row.updated_at.isoformat(),
    }
    if admin:
        result["usage_count"] = await usage(session, level, row.id)
        result["others_pending"] = await session.scalar(
            select(func.count())
            .select_from(OtherSubmission)
            .where(
                OtherSubmission.status == "pending",
                (OtherSubmission.parent_id == row.id)
                | (OtherSubmission.parent_chain[level + "_id"].astext == str(row.id)),
            )
        )
        parent = (
            await session.get(repo.MODELS[PARENTS[level]], repo.parent_id(row))
            if level in PARENTS
            else None
        )
        result["parent_name"] = parent.name if parent else None
    return result


async def revision(session: AsyncSession) -> Any:
    return await session.scalar(text("SELECT revision FROM taxonomy_revision WHERE id=1"))


async def changed(
    session: AsyncSession, ctx: TenantContext, action: Any, target: Any, metadata: Any = None
) -> Any:
    await audit_event(
        session,
        action=AuditAction.TAXONOMY_CHANGED,
        actor_id=ctx.user_id,
        actor_role=ctx.role,
        target_type="taxonomy",
        target_id=str(target),
        metadata={"operation": action, **(metadata or {})},
    )
    # Transactional invalidation: a rolled-back edit must never publish a new cache key.
    await session.execute(text("UPDATE taxonomy_revision SET revision=revision+1 WHERE id=1"))


async def list_options(
    session: AsyncSession,
    level: Any,
    *,
    parent: Any = None,
    industry: Any = None,
    q: Any = "",
    offset: Any = 0,
    limit: Any = 100,
    admin: Any = False,
) -> Any:
    if industry:
        await row_for(session, "industry", industry, visible=not admin)
    if parent and level in PARENTS:
        await row_for(session, PARENTS[level], parent, visible=not admin)
    cache_key = (
        f"taxonomy:list:{await revision(session)}:{level}:{parent}:{industry}:{q}:{offset}:{limit}"
    )
    if not admin:
        try:
            cached = await get_redis().get(cache_key)
            if cached:
                return json.loads(cached)
        except Exception:
            logger.debug("taxonomy_cache_unavailable")
    query = repo.option_query(level, parent=parent, industry=industry, visible=not admin, q=q)
    total = await session.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    rows = (await session.scalars(query.offset(offset).limit(limit))).all()
    result = {
        "items": [await serialize(session, level, row, admin=admin) for row in rows],
        "total": total,
        "offset": offset,
        "has_more": offset + len(rows) < total,
    }
    if not admin:
        with suppress(Exception):
            await get_redis().set(cache_key, json.dumps(result), ex=30)
    return result


async def write_option(
    session: AsyncSession,
    level: Any,
    payload: Any,
    ctx: TenantContext,
    option_id: Any = None,
    *,
    user_added: Any = False,
) -> Any:
    await lock_catalogue(session)
    if level in PARENTS:
        if not payload.parent_id:
            raise invalid("Choose a parent before adding this option.")
        await row_for(session, PARENTS[level], payload.parent_id)
    elif payload.parent_id:
        raise invalid("Industries and departments do not have a parent.")
    model = repo.MODELS[level]
    name = clean_name(payload.name)
    query = select(model).where(
        model.normalized_name == normalize(name), model.deleted_at.is_(None)
    )
    if level in PARENTS:
        query = query.where(getattr(model, repo.PARENT_COLUMNS[level]) == payload.parent_id)
    duplicate = await session.scalar(query)
    if duplicate and duplicate.id != option_id:
        raise ConflictError(
            code="taxonomy_duplicate",
            title="An option with this name already exists in the selected parent.",
            params={"option_id": str(duplicate.id)},
        )
    if option_id:
        row = await row_for(session, level, option_id, lock=True)
        if row.version != payload.version:
            raise ConflictError(
                code="taxonomy_changed",
                title="Another administrator changed this option. Refresh before saving.",
            )
        row.version += 1
    else:
        row = model(created_by=ctx.user_id, is_user_added=user_added)
        session.add(row)
    row.name, row.normalized_name, row.slug = name, normalize(name), slug_for(name)
    row.is_visible, row.sort_order, row.updated_by = (
        payload.is_visible,
        payload.sort_order,
        ctx.user_id,
    )
    if level in PARENTS:
        setattr(row, repo.PARENT_COLUMNS[level], payload.parent_id)
    if level == "department":
        row.type = payload.type
    try:
        await session.flush()
    except IntegrityError as exc:
        raise ConflictError(
            code="taxonomy_changed",
            title="Another administrator added the same option. Refresh the list.",
        ) from exc
    await session.refresh(row)
    await changed(session, ctx, "update" if option_id else "create", row.id, {"level": level})
    return await serialize(session, level, row, admin=True)


async def archive_option(
    session: AsyncSession, level: Any, option_id: Any, version: Any, ctx: TenantContext
) -> Any:
    await lock_catalogue(session)
    row = await row_for(session, level, option_id, lock=True)
    if row.version != version:
        raise ConflictError(
            code="taxonomy_changed", title="This option changed. Refresh before archiving."
        )
    # Archive only, including in-use options: snapshots and IDs remain resolvable.
    row.deleted_at, row.is_visible, row.updated_by = datetime.now(UTC), False, ctx.user_id
    row.version += 1
    await changed(session, ctx, "archive", row.id)
    return {"archived": True, "usage_count": await usage(session, level, row.id)}


async def delete_option(
    session: AsyncSession,
    level: Any,
    option_id: Any,
    version: Any,
    ctx: TenantContext,
    *,
    hard: Any = False,
) -> Any:
    await lock_catalogue(session)
    if not hard:
        return await archive_option(session, level, option_id, version, ctx)
    row = await row_for(session, level, option_id, lock=True)
    if row.version != version:
        raise ConflictError(
            code="taxonomy_changed", title="This option changed. Refresh before deleting."
        )
    children = 0
    for child_level, parent_level in PARENTS.items():
        if parent_level == level:
            children += int(
                (
                    await session.scalar(
                        select(func.count())
                        .select_from(repo.MODELS[child_level])
                        .where(
                            getattr(repo.MODELS[child_level], repo.PARENT_COLUMNS[child_level])
                            == row.id
                        )
                    )
                )
                or 0
            )
    history = await session.scalar(
        select(func.count())
        .select_from(OtherSubmission)
        .where(
            (OtherSubmission.resolved_option_id == row.id) | (OtherSubmission.parent_id == row.id)
        )
    )
    if await usage(session, level, row.id) or children or history:
        raise ConflictError(
            code="taxonomy_in_use", title="This option is in use. Hide or archive it instead."
        )
    if level in ("industry", "department"):
        column = (
            IndustryDepartmentPriority.industry_id
            if level == "industry"
            else IndustryDepartmentPriority.department_id
        )
        from sqlalchemy import delete

        await session.execute(delete(IndustryDepartmentPriority).where(column == row.id))
    await session.delete(row)
    await changed(session, ctx, "delete", option_id)
    return {"deleted": True}


async def reorder(session: AsyncSession, level: Any, payload: Any, ctx: TenantContext) -> Any:
    await lock_catalogue(session)
    if len(payload.ids) != len(set(payload.ids)):
        raise invalid("The order contains duplicate options.")
    rows = [await row_for(session, level, key, lock=True) for key in sorted(payload.ids)]
    if len({repo.parent_id(row) for row in rows}) > 1:
        raise invalid("Reorder options within one parent at a time.")
    for row in rows:
        if payload.versions.get(str(row.id)) != row.version:
            raise ConflictError(
                code="taxonomy_changed", title="The list changed. Refresh before reordering."
            )
    scope = repo.option_query(level, parent=repo.parent_id(rows[0]), visible=False)
    scope_ids = {row.id for row in (await session.scalars(scope)).all()}
    if set(payload.ids) != scope_ids:
        raise invalid("Reload the complete list before reordering.")
    positions = {key: rank for rank, key in enumerate(payload.ids)}
    for row in rows:
        row.sort_order, row.updated_by = positions[row.id], ctx.user_id
        row.version += 1
    await changed(session, ctx, "reorder", str(payload.ids[0]))
    return {"updated": len(rows)}


async def submit_other(
    session: AsyncSession, level: Any, value: Any, parent: Any, chain: Any, user_id: Any
) -> Any:
    from app.core.db import set_transaction_user

    await set_transaction_user(session, user_id)
    name, normalized = clean_name(value), normalize(value)
    context_key = await session.scalar(
        text("SELECT encode(sha256(convert_to(CAST(:chain AS jsonb)::text, 'UTF8')), 'hex')"),
        {"chain": json.dumps(chain)},
    )
    duplicate = await session.scalar(
        select(OtherSubmission).where(
            OtherSubmission.user_id == user_id,
            OtherSubmission.level == level,
            OtherSubmission.context_key == context_key,
            OtherSubmission.normalized_text == normalized,
        )
    )
    if duplicate:
        return duplicate
    # Serialize duplicate submissions from two concurrent saves by the same user.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": str(user_id)}
    )
    duplicate = await session.scalar(
        select(OtherSubmission).where(
            OtherSubmission.user_id == user_id,
            OtherSubmission.level == level,
            OtherSubmission.context_key == context_key,
            OtherSubmission.normalized_text == normalized,
        )
    )
    if duplicate:
        return duplicate
    recent = await session.scalar(
        select(func.count())
        .select_from(OtherSubmission)
        .where(
            OtherSubmission.user_id == user_id,
            OtherSubmission.created_at > func.now() - text("interval '1 day'"),
        )
    )
    if (recent or 0) >= 40:
        raise RateLimitedError(
            code="taxonomy_submission_limit",
            title="You have suggested several options today. Please try again tomorrow.",
        )
    row = OtherSubmission(
        level=level,
        raw_text=name,
        normalized_text=normalized,
        user_id=user_id,
        parent_id=parent,
        parent_chain=chain,
        context_key=context_key,
    )
    session.add(row)
    await session.flush()
    return row


async def validate_profile(session: AsyncSession, details: Any, previous: Any, user_id: Any) -> Any:
    """Labels are snapshots. Existing hidden IDs remain valid; new IDs must be visible."""
    chain: dict[str, str] = {}
    custom_parent = False
    for level in LEVELS:
        key = PROFILE_KEYS[level]
        selected = getattr(details, key + "_id", None)
        old_selected = getattr(previous, key + "_id", None)
        value = getattr(details, key)
        if key in details.taxonomy_others and not value.strip():
            raise invalid(
                "Enter an answer for Others or choose an option from the list.", fields=[key]
            )
        if (
            not selected
            and old_selected
            and value == getattr(previous, key, None)
            and key not in details.taxonomy_others
        ):
            selected = old_selected
            setattr(details, key + "_id", selected)
        parent = chain.get(PARENTS.get(level, "") + "_id")
        if selected and custom_parent:
            raise invalid("Use a custom answer for the fields below Others.")
        if selected:
            # Archived rows can still be retained, but never newly selected.
            row = await session.scalar(
                select(repo.MODELS[level])
                .where(repo.MODELS[level].id == selected)
                .with_for_update(read=True)
            )
            if not row or ((row.deleted_at or not row.is_visible) and selected != old_selected):
                raise invalid(
                    "This option is no longer available. Choose another option.", fields=[key]
                )
            if (
                level in PARENTS
                and str(repo.parent_id(row)) != str(parent)
                and not (
                    selected == old_selected
                    and str(getattr(previous, PROFILE_KEYS[PARENTS[level]] + "_id", ""))
                    == str(parent)
                )
            ):
                raise invalid("Choose an option from the selected parent.", fields=[key])
            if selected != old_selected:
                for ancestor_level in LEVELS[: LEVELS.index(level)]:
                    ancestor_id = chain.get(ancestor_level + "_id")
                    if ancestor_id:
                        await row_for(session, ancestor_level, UUID(ancestor_id), visible=True)
            details.taxonomy_others.pop(key, None)
            setattr(
                details,
                key,
                getattr(previous, key)
                if selected == old_selected and getattr(previous, key)
                else row.name,
            )
            chain[level + "_id"] = str(selected)
        elif value.strip():
            try:
                value = clean_name(value)
            except ValueError as exc:
                raise invalid(
                    "Use between 1 and 160 characters of plain text.", fields=[key]
                ) from exc
            # Old app versions submit names only: match known names, preserve unknown text.
            query = select(repo.MODELS[level]).where(
                repo.MODELS[level].normalized_name == normalize(value),
                repo.MODELS[level].deleted_at.is_(None),
            )
            if level in PARENTS:
                query = query.where(
                    getattr(repo.MODELS[level], repo.PARENT_COLUMNS[level])
                    == (UUID(parent) if parent else None)
                )
            match = await session.scalar(query) if not custom_parent else None
            explicitly_other = key in details.taxonomy_others
            if match and explicitly_other and match.is_visible:
                raise ConflictError(
                    code="taxonomy_use_existing",
                    title=f"Choose {match.name} from the list instead of Others.",
                    params={"fields": [key], "option_id": str(match.id)},
                )
            if match and not explicitly_other and match.is_visible:
                setattr(details, key + "_id", match.id)
                setattr(details, key, match.name)
                chain[level + "_id"] = str(match.id)
            else:
                setattr(details, key, clean_name(value))
                details.taxonomy_others[key] = clean_name(value)
                await submit_other(
                    session, level, value, UUID(parent) if parent else None, dict(chain), user_id
                )
                chain[level + "_text"] = normalize(value)
                custom_parent = True
        else:
            if any(
                getattr(details, PROFILE_KEYS[child] + "_id")
                for child in LEVELS[LEVELS.index(level) + 1 :]
            ):
                raise invalid("Choose the preceding fields first.", fields=[key])
    return details


async def others(
    session: AsyncSession,
    *,
    status: Any = "pending",
    level: Any = None,
    q: Any = "",
    offset: Any = 0,
    limit: Any = 50,
) -> Any:
    query = select(OtherSubmission).where(OtherSubmission.status == status)
    if level:
        query = query.where(OtherSubmission.level == level)
    if q:
        query = query.where(OtherSubmission.normalized_text.contains(q.casefold(), autoescape=True))
    total = await session.scalar(select(func.count()).select_from(query.subquery()))
    rows = (
        await session.scalars(
            query.order_by(OtherSubmission.created_at, OtherSubmission.id)
            .offset(offset)
            .limit(limit)
        )
    ).all()
    items: list[dict[str, Any]] = []
    for row in rows:
        count = await session.scalar(
            select(func.count())
            .select_from(OtherSubmission)
            .where(
                OtherSubmission.level == row.level,
                OtherSubmission.context_key == row.context_key,
                OtherSubmission.normalized_text == row.normalized_text,
            )
        )
        items.append(
            {
                "id": str(row.id),
                "level": row.level,
                "parent_id": str(row.parent_id) if row.parent_id else None,
                "parent_chain": row.parent_chain,
                "raw_text": row.raw_text,
                "status": row.status,
                "user_id": str(row.user_id),
                "created_at": row.created_at.isoformat(),
                "count": count,
                "version": row.version,
            }
        )
        items[-1]["user_email"] = await session.scalar(
            text("SELECT email FROM users WHERE id=:id"), {"id": row.user_id}
        )
        labels = []
        for chain_level in LEVELS:
            if row.parent_chain.get(chain_level + "_id"):
                option = await session.get(
                    repo.MODELS[chain_level], UUID(row.parent_chain[chain_level + "_id"])
                )
                labels.append(option.name if option else "Archived option")
            elif row.parent_chain.get(chain_level + "_text"):
                labels.append(row.parent_chain[chain_level + "_text"])
        items[-1]["parent_labels"] = labels
    return {"items": items, "total": total, "has_more": offset + len(items) < total}


async def resolve_other(
    session: AsyncSession, submission_id: Any, payload: Any, ctx: TenantContext
) -> Any:
    await lock_catalogue(session)
    from .schemas import OptionWrite

    initial = await session.get(OtherSubmission, submission_id)
    if not initial:
        raise NotFoundError()
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {
            "key": (
                f"taxonomy:resolve:{initial.level}:{initial.context_key}:{initial.normalized_text}"
            )
        },
    )
    row = await session.scalar(
        select(OtherSubmission)
        .where(OtherSubmission.id == submission_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if not row:
        raise NotFoundError()
    if row.version != payload.version or row.status != "pending":
        raise ConflictError(
            code="taxonomy_changed", title="This suggestion has already changed. Refresh the list."
        )
    option_id = None
    if payload.action == "approve":
        result = await write_option(
            session,
            row.level,
            OptionWrite(
                name=payload.name or row.raw_text,
                parent_id=payload.parent_id or row.parent_id,
                type=payload.type,
            ),
            ctx,
            user_added=True,
        )
        option_id = UUID(result["id"])
    if payload.action == "merge":
        if not payload.option_id:
            raise invalid("Choose an existing option to merge into.")
        target = await row_for(session, row.level, payload.option_id, visible=True)
        if (
            row.level in PARENTS
            and payload.parent_id
            and repo.parent_id(target) != payload.parent_id
        ):
            raise invalid("The merge target does not belong to the selected parent.")
        option_id = target.id
    # A narrow, actor-checked database function updates users across RLS boundaries.
    count = await session.scalar(
        text("SELECT taxonomy_resolve(:submission, :option, :actor, :action)"),
        {"submission": row.id, "option": option_id, "actor": ctx.user_id, "action": payload.action},
    )
    await session.refresh(row)
    await changed(session, ctx, payload.action, row.id)
    return {"resolved": count, "option_id": str(option_id) if option_id else None}


async def priorities(session: AsyncSession, industry: Any) -> Any:
    await row_for(session, "industry", industry)
    rows = (
        await session.execute(
            select(IndustryDepartmentPriority.department_id, IndustryDepartmentPriority.rank)
            .where(IndustryDepartmentPriority.industry_id == industry)
            .order_by(IndustryDepartmentPriority.rank)
        )
    ).all()
    ids = [str(row.department_id) for row in rows]
    return {"department_ids": ids, "revision": hashlib.sha256(json.dumps(ids).encode()).hexdigest()}


async def save_priorities(
    session: AsyncSession, industry: Any, payload: Any, ctx: TenantContext
) -> Any:
    await lock_catalogue(session)
    await row_for(session, "industry", industry, lock=True)
    old = await priorities(session, industry)
    if old["revision"] != payload.revision:
        raise ConflictError(
            code="taxonomy_changed",
            title="Another administrator changed these priorities. Refresh first.",
        )
    if len(set(payload.department_ids)) != len(payload.department_ids):
        raise invalid("Priorities contain duplicate departments.")
    for key in payload.department_ids:
        await row_for(session, "department", key)
    await session.execute(
        text("DELETE FROM industry_department_priority WHERE industry_id=:id"), {"id": industry}
    )
    for rank, key in enumerate(payload.department_ids):
        session.add(IndustryDepartmentPriority(industry_id=industry, department_id=key, rank=rank))
    await changed(session, ctx, "priorities", industry)
    return {"updated": len(payload.department_ids)}
