from typing import Any

from sqlalchemy import func, select

from .models import Department, Industry, IndustryDepartmentPriority, JobRole, RoleCategory

MODELS = {"industry": Industry, "department": Department, "category": RoleCategory, "role": JobRole}
PARENT_COLUMNS = {"category": "department_id", "role": "category_id"}


def parent_id(row: Any) -> Any:
    return getattr(row, "department_id", getattr(row, "category_id", None))


def option_query(
    level: Any, *, parent: Any = None, industry: Any = None, visible: Any = True, q: Any = ""
) -> Any:
    model = MODELS[level]
    query = select(model).where(model.deleted_at.is_(None))
    if parent and level in PARENT_COLUMNS:
        query = query.where(getattr(model, PARENT_COLUMNS[level]) == parent)
    if q:
        query = query.where(model.normalized_name.contains(q.casefold().strip(), autoescape=True))
    if visible:
        query = query.where(model.is_visible.is_(True))
        if level == "category":
            query = query.join(Department).where(
                Department.is_visible, Department.deleted_at.is_(None)
            )
        if level == "role":
            query = (
                query.join(RoleCategory)
                .join(Department)
                .where(
                    RoleCategory.is_visible,
                    RoleCategory.deleted_at.is_(None),
                    Department.is_visible,
                    Department.deleted_at.is_(None),
                )
            )
    if level == "department" and industry:
        query = query.outerjoin(
            IndustryDepartmentPriority,
            (IndustryDepartmentPriority.department_id == Department.id)
            & (IndustryDepartmentPriority.industry_id == industry),
        )
        return query.order_by(
            func.coalesce(IndustryDepartmentPriority.rank, 1000000),
            model.sort_order,
            model.name,
            model.id,
        )
    return query.order_by(model.sort_order, model.name, model.id)


async def visible_names(session: Any, level: Any) -> list[str]:
    """Every visible option name at one level, one spelling each, by name.
    For flat pickers (job preferences) that do not walk the hierarchy."""
    rows = await session.scalars(option_query(level, visible=True).order_by(None))
    names = {row.name.strip(): None for row in rows if row.name and row.name.strip()}
    return sorted(names, key=str.casefold)
