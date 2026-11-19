"""CSV-driven, additive education seed and historical profile backfill."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from . import repository as repo
from .domain import NA_NAME, PROFILE_KEYS, QUALIFICATION_ORDER, normalize, slug_for
from .models import CourseSpecialization
from .service import validate_profile


def load_csv(path: Path) -> list[tuple[str, str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != ["Highest Qualification", "Course", "Specialization"]:
            raise ValueError("Expected Highest Qualification,Course,Specialization columns.")
        rows: list[tuple[str, str, str]] = []
        for row in reader:
            values = (
                (row["Highest Qualification"] or "").strip(),
                (row["Course"] or "").strip(),
                (row["Specialization"] or "").strip(),
            )
            if not any(values):
                continue
            if not all(values):
                raise ValueError("Every seed row needs qualification, course and specialization.")
            for value in values:
                normalize(value)
            rows.append(values)
        return rows


def counts(rows: list[tuple[str, str, str]]) -> dict[str, int]:
    values = {(normalize(q), normalize(c), normalize(s)) for q, c, s in rows}
    return {
        "qualifications": len({q for q, c, s in values}),
        "courses": len({(q, c) for q, c, s in values}),
        "unique_specializations": len({s for q, c, s in values}),
        "course_specialization_links": len(values),
    }


async def seed(session: AsyncSession, rows: list[tuple[str, str, str]]) -> dict[str, Any]:
    await session.execute(text("SELECT id FROM taxonomy_revision WHERE id=1 FOR UPDATE"))
    order = {normalize(name): index for index, name in enumerate(QUALIFICATION_ORDER)}
    if any(normalize(q) not in order for q, c, s in rows):
        raise ValueError("Unknown qualification: use the supplied ordered qualification masters.")
    written = 0

    async def insert(level: str, name: str, parent: Any = None) -> Any:
        nonlocal written
        model = repo.MODELS[level]
        key = uuid5(NAMESPACE_URL, f"bharatpath:education:{level}:{parent}:{normalize(name)}")
        row = await session.get(model, key)
        if row:
            return row
        query = select(model).where(
            model.normalized_name == normalize(name), model.deleted_at.is_(None)
        )
        if level == "course":
            query = query.where(model.qualification_id == parent)
        row = await session.scalar(query)
        if row:
            return row
        row = model(
            id=key,
            name=name,
            normalized_name=normalize(name),
            slug=slug_for(name),
            sort_order=written,
        )
        if level == "qualification":
            row.sort_order = order[normalize(name)]
            row.level_rank = 9 - row.sort_order
        if level == "course":
            row.qualification_id = parent
        if level == "specialization":
            row.is_not_applicable = normalize(name) == normalize(NA_NAME)
        session.add(row)
        await session.flush()
        written += 1
        return row

    positions: dict[Any, int] = {}
    seen = set()
    for q, c, s in rows:
        identity = (normalize(q), normalize(c), normalize(s))
        if identity in seen:
            continue
        seen.add(identity)
        qualification = await insert("qualification", q)
        course = await insert("course", c, qualification.id)
        specialization = await insert("specialization", s)
        key = uuid5(NAMESPACE_URL, f"bharatpath:education:link:{course.id}:{specialization.id}")
        old = await session.get(CourseSpecialization, key)
        if not old:
            old = await session.scalar(
                select(CourseSpecialization).where(
                    CourseSpecialization.course_id == course.id,
                    CourseSpecialization.specialization_id == specialization.id,
                    CourseSpecialization.deleted_at.is_(None),
                )
            )
        if not old:
            session.add(
                CourseSpecialization(
                    id=key,
                    course_id=course.id,
                    specialization_id=specialization.id,
                    name=specialization.name,
                    normalized_name=specialization.normalized_name,
                    slug=specialization.slug,
                    sort_order=positions.get(course.id, 0),
                )
            )
            written += 1
        positions[course.id] = positions.get(course.id, 0) + 1
    await session.flush()
    if written:
        await session.execute(text("UPDATE taxonomy_revision SET revision=revision+1 WHERE id=1"))
    return {**counts(rows), "inserted": written}


async def backfill(session: AsyncSession) -> int:
    rows = (
        await session.execute(
            text(
                "SELECT user_id,career FROM candidate_profiles "
                "WHERE jsonb_typeof(career->'details')='object' FOR UPDATE"
            )
        )
    ).all()
    updated = 0
    for user_id, career in rows:
        raw = career["details"]
        values = {key: raw.get(key, "") or "" for key in PROFILE_KEYS.values()}
        values.update(
            {
                key + "_id": UUID(raw[key + "_id"]) if raw.get(key + "_id") else None
                for key in PROFILE_KEYS.values()
            }
        )
        values["education_others"] = dict(raw.get("education_others") or {})
        details = SimpleNamespace(**values)
        await validate_profile(session, details, SimpleNamespace(**values), user_id)
        result = {
            key: str(value) if isinstance(value, UUID) else value
            for key, value in vars(details).items()
        }
        if any(raw.get(key) != value for key, value in result.items()):
            career["details"] = {**raw, **result}
            await session.execute(
                text(
                    "UPDATE candidate_profiles SET career=CAST(:career AS jsonb) "
                    "WHERE user_id=:user"
                ),
                {"career": json.dumps(career), "user": user_id},
            )
            updated += 1
    return updated
