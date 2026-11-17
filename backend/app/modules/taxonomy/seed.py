"""Idempotent, additive catalogue load and historical profile backfill."""

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from . import repository as repo
from .domain import LEVELS, PROFILE_KEYS, normalize, slug_for
from .models import IndustryDepartmentPriority
from .service import validate_profile
from .tabular import read_sheets


def load_source(path: Path) -> dict[str, Any]:
    if path.suffix.lower() == ".json":
        return cast(dict[str, Any], json.loads(path.read_text(encoding="utf-8")))
    if path.suffix.lower() == ".html":
        source = path.read_text(encoding="utf-8")
        decode = json.JSONDecoder().raw_decode
        html_departments = []
        for encoded in decode(source.split("const D=", 1)[1].lstrip())[0]:
            code, name, kind, children = encoded.split("|", 3)
            categories = []
            for child in children.split(";"):
                category, roles = child.split(":", 1)
                categories.append({"name": category, "roles": roles.split(",")})
            html_departments.append(
                {
                    "code": code,
                    "name": name,
                    "type": "Tech" if kind == "T" else "Non-tech",
                    "categories": categories,
                }
            )
        html_industries = [
            {"name": name, "priorities": codes.split(",")}
            for name, codes in decode(source.split("const I=", 1)[1].lstrip())[0]
        ]
        return {"departments": html_departments, "industries": html_industries}
    sheets = read_sheets(path.read_bytes(), path.name)
    master = sheets["Department Master"]
    headers = [h.strip().casefold().replace("_", " ") for h in master[0]]
    departments: dict[str, Any] = {}
    department = category = ""
    for values in master[1:]:
        data = dict(zip(headers, values, strict=False))
        department = data.get("department") or department
        if data.get("department"):
            category = ""
        category = data.get("role category") or category
        if not department or not category or not data.get("job role"):
            continue
        item = departments.setdefault(
            department,
            {
                "code": department,
                "name": department,
                "type": data.get("type") or "Non-tech",
                "categories": {},
            },
        )
        item["categories"].setdefault(category, []).append(data["job role"])
    industries: dict[str, Any] = {}
    priorities = sheets["Industry Dept Priority"]
    headers = [h.strip().casefold().replace("_", " ") for h in priorities[0]]
    for values in priorities[1:]:
        data = dict(zip(headers, values, strict=False))
        if data.get("industry") and data.get("department"):
            industries.setdefault(data["industry"], []).append(
                (
                    int(data.get("rank") or len(industries.get(data["industry"], []))),
                    data["department"],
                )
            )
    return {
        "departments": [
            {**d, "categories": [{"name": c, "roles": r} for c, r in d["categories"].items()]}
            for d in departments.values()
        ],
        "industries": [
            {"name": name, "priorities": [d for _, d in sorted(rows)]}
            for name, rows in industries.items()
        ],
    }


def counts(data: dict[str, Any]) -> tuple[int, int, int, int]:
    return (
        len(data["industries"]),
        len(data["departments"]),
        sum(len(d["categories"]) for d in data["departments"]),
        sum(len(c["roles"]) for d in data["departments"] for c in d["categories"]),
    )


async def seed(session: AsyncSession, data: dict[str, Any]) -> dict[str, Any]:
    actual = counts(data)
    if actual != (31, 29, 110, 507):
        raise ValueError(
            f"Seed counts are {actual}; expected (31, 29, 110, 507). No changes were made."
        )
    codes = {}
    written = 0

    async def insert(
        level: Any, name: Any, order: Any, parent: Any = None, kind: Any = None
    ) -> Any:
        nonlocal written
        model: Any = repo.MODELS[level]
        key = uuid5(NAMESPACE_URL, f"bharatpath:taxonomy:{level}:{parent}:{normalize(name)}")
        row = await session.get(model, key)
        if row:
            return row
        query = select(model).where(
            model.normalized_name == normalize(name), model.deleted_at.is_(None)
        )
        if level in repo.PARENT_COLUMNS:
            query = query.where(getattr(model, repo.PARENT_COLUMNS[level]) == parent)
        row = await session.scalar(query)
        if row:
            return row
        row = model(
            id=key,
            name=name,
            normalized_name=normalize(name),
            slug=slug_for(name),
            sort_order=order,
        )
        if level in repo.PARENT_COLUMNS:
            setattr(row, repo.PARENT_COLUMNS[level], parent)
        if kind:
            row.type = kind
        session.add(row)
        await session.flush()
        written += 1
        return row

    for rank, department in enumerate(data["departments"]):
        row = await insert("department", department["name"], rank, kind=department["type"])
        codes[department["code"]] = row.id
        for order, category in enumerate(department["categories"]):
            cat = await insert("category", category["name"], order, row.id)
            for position, role in enumerate(category["roles"]):
                await insert("role", role, position, cat.id)
    for rank, industry in enumerate(data["industries"]):
        row = await insert("industry", industry["name"], rank)
        existing = await session.scalar(
            select(IndustryDepartmentPriority.industry_id)
            .where(IndustryDepartmentPriority.industry_id == row.id)
            .limit(1)
        )
        if not existing:
            for order, code in enumerate(industry["priorities"]):
                session.add(
                    IndustryDepartmentPriority(
                        industry_id=row.id, department_id=codes[code], rank=order
                    )
                )
    await session.flush()
    if written:
        await session.execute(text("UPDATE taxonomy_revision SET revision=revision+1 WHERE id=1"))
    return {"counts": actual, "inserted": written}


async def backfill(session: AsyncSession) -> int:
    """Owner-only batch. Preserve all unrelated answers and never overwrite existing IDs."""
    rows = (
        await session.execute(
            text(
                "SELECT user_id,career FROM candidate_profiles "
                "WHERE jsonb_typeof(career->'details')='object' FOR UPDATE"
            )
        )
    ).all()
    changed = 0
    for user_id, career in rows:
        raw = career["details"]
        current = {PROFILE_KEYS[level]: raw.get(PROFILE_KEYS[level], "") or "" for level in LEVELS}
        current.update(
            {
                PROFILE_KEYS[level] + "_id": UUID(raw[PROFILE_KEYS[level] + "_id"])
                if raw.get(PROFILE_KEYS[level] + "_id")
                else None
                for level in LEVELS
            }
        )
        current["taxonomy_others"] = dict(raw.get("taxonomy_others") or {})
        details = SimpleNamespace(**current)
        await validate_profile(session, details, SimpleNamespace(**current), user_id)
        updated = {
            key: str(value) if isinstance(value, UUID) else value
            for key, value in vars(details).items()
        }
        if any(raw.get(key) != value for key, value in updated.items()):
            career["details"] = {**raw, **updated}
            await session.execute(
                text(
                    "UPDATE candidate_profiles SET career=CAST(:career AS jsonb) "
                    "WHERE user_id=:user"
                ),
                {"career": json.dumps(career), "user": user_id},
            )
            changed += 1
    return changed
