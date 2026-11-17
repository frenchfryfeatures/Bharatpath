from typing import Any

from sqlalchemy import select

from .models import Course, CourseSpecialization, Qualification, Specialization

MODELS: dict[str, Any] = {
    "qualification": Qualification,
    "course": Course,
    "specialization": Specialization,
}
PARENT_COLUMNS = {"course": "qualification_id"}


def parent_id(row: Any) -> Any:
    return getattr(row, "qualification_id", None)


def option_query(
    level: str, *, parent: Any = None, industry: Any = None, visible: bool = True, q: str = ""
) -> Any:
    model = MODELS[level]
    query = select(model).where(model.deleted_at.is_(None))
    if q:
        query = query.where(model.normalized_name.contains(q.casefold().strip(), autoescape=True))
    if level == "course" and parent:
        query = query.where(Course.qualification_id == parent)
    if level == "specialization" and parent:
        query = query.join(
            CourseSpecialization, CourseSpecialization.specialization_id == Specialization.id
        ).where(CourseSpecialization.course_id == parent, CourseSpecialization.deleted_at.is_(None))
        if visible:
            query = query.where(CourseSpecialization.is_visible)
    if visible:
        query = query.where(model.is_visible)
        if level == "course":
            query = query.join(Qualification).where(
                Qualification.is_visible, Qualification.deleted_at.is_(None)
            )
        if level == "specialization" and parent:
            query = (
                query.join(Course, Course.id == CourseSpecialization.course_id)
                .join(Qualification)
                .where(
                    Course.is_visible,
                    Course.deleted_at.is_(None),
                    Qualification.is_visible,
                    Qualification.deleted_at.is_(None),
                )
            )
    order = (
        CourseSpecialization.sort_order
        if level == "specialization" and parent
        else model.sort_order
    )
    return query.order_by(order, model.name, model.id)
