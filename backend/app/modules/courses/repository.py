"""courses - data access

Catalogue, purchase, completion, +30 contribution.

All database access for this module lives here. Private to the module:
no other module may import it (import-linter contract `module-privacy`).

`course_completions` and `course_purchases` are append-only: an insert and
reads, nothing else, and the app role holds no UPDATE or DELETE on either.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.courses.models import (
    Course,
    CourseCompletion,
    CourseLesson,
    CourseLessonProgress,
    CourseModule,
    CoursePurchase,
)


async def active_courses(session: AsyncSession) -> list[Course]:
    result = await session.execute(
        select(Course).where(Course.active.is_(True)).order_by(Course.code, Course.version.desc())
    )
    return list(result.scalars())


async def get_course(session: AsyncSession, *, course_id: uuid.UUID) -> Course | None:
    return await session.get(Course, course_id)


async def latest_course_version(session: AsyncSession, *, code: str) -> Course | None:
    result = await session.execute(
        select(Course).where(Course.code == code).order_by(Course.version.desc()).limit(1)
    )
    return result.scalar_one_or_none()


async def insert_course(
    session: AsyncSession,
    *,
    code: str,
    title: str,
    price_minor: int,
    contribution_points: int,
    active: bool,
    version: int,
) -> Course:
    row = Course(
        code=code,
        title=title,
        price_minor=price_minor,
        contribution_points=contribution_points,
        active=active,
        version=version,
    )
    session.add(row)
    await session.flush()
    return row


async def purchased_course_ids(session: AsyncSession, *, user_id: uuid.UUID) -> set[uuid.UUID]:
    result = await session.execute(
        select(CoursePurchase.course_id).where(CoursePurchase.user_id == user_id)
    )
    return set(result.scalars())


async def completed_course_ids(session: AsyncSession, *, user_id: uuid.UUID) -> set[uuid.UUID]:
    result = await session.execute(
        select(CourseCompletion.course_id).where(CourseCompletion.user_id == user_id)
    )
    return set(result.scalars())


async def has_purchase(session: AsyncSession, *, user_id: uuid.UUID, course_id: uuid.UUID) -> bool:
    result = await session.execute(
        select(CoursePurchase.id).where(
            CoursePurchase.user_id == user_id, CoursePurchase.course_id == course_id
        )
    )
    return result.first() is not None


async def insert_purchase(
    session: AsyncSession, *, user_id: uuid.UUID, course_id: uuid.UUID, payment_id: uuid.UUID
) -> bool:
    """False if this user already owns the course. The database guard refuses
    the insert outright unless `payment_id` is their verified payment for it."""
    result = await session.execute(
        pg_insert(CoursePurchase)
        .values(id=uuid.uuid4(), user_id=user_id, course_id=course_id, payment_id=payment_id)
        .on_conflict_do_nothing(constraint="uq_course_purchase_once")
        .returning(CoursePurchase.id)
    )
    return result.scalar_one_or_none() is not None


async def get_completion(
    session: AsyncSession, *, user_id: uuid.UUID, course_id: uuid.UUID
) -> CourseCompletion | None:
    result = await session.execute(
        select(CourseCompletion).where(
            CourseCompletion.user_id == user_id, CourseCompletion.course_id == course_id
        )
    )
    return result.scalar_one_or_none()


async def insert_completion(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    contribution_version: str,
    points_awarded: int,
) -> CourseCompletion | None:
    """**The only write path to `course_completions`.** None if already recorded."""
    result = await session.execute(
        pg_insert(CourseCompletion)
        .values(
            id=uuid.uuid4(),
            user_id=user_id,
            course_id=course_id,
            contribution_version=contribution_version,
            points_awarded=points_awarded,
        )
        .on_conflict_do_nothing(constraint="uq_course_completion_once")
        .returning(CourseCompletion.id)
    )
    completion_id = result.scalar_one_or_none()
    if completion_id is None:
        return None
    return await session.get(CourseCompletion, completion_id)


async def completions_for(session: AsyncSession, *, user_id: uuid.UUID) -> list[CourseCompletion]:
    result = await session.execute(
        select(CourseCompletion)
        .where(CourseCompletion.user_id == user_id)
        .order_by(CourseCompletion.completed_at, CourseCompletion.id)
    )
    return list(result.scalars())


# --- purchases by code (2026-09-29) -----------------------------------------------
async def purchase_for_code(
    session: AsyncSession, *, user_id: uuid.UUID, code: str
) -> CoursePurchase | None:
    """The candidate's purchase of any version of this course. Lessons belong
    to the code, so a buyer of version 1 keeps them when version 2 is priced."""
    result = await session.execute(
        select(CoursePurchase)
        .join(Course, Course.id == CoursePurchase.course_id)
        .where(CoursePurchase.user_id == user_id, Course.code == code)
        .order_by(CoursePurchase.purchased_at)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def purchased_course_codes(session: AsyncSession, *, user_id: uuid.UUID) -> set[str]:
    result = await session.execute(
        select(Course.code)
        .join(CoursePurchase, CoursePurchase.course_id == Course.id)
        .where(CoursePurchase.user_id == user_id)
    )
    return set(result.scalars())


async def completed_course_codes(session: AsyncSession, *, user_id: uuid.UUID) -> set[str]:
    result = await session.execute(
        select(Course.code)
        .join(CourseCompletion, CourseCompletion.course_id == Course.id)
        .where(CourseCompletion.user_id == user_id)
    )
    return set(result.scalars())


async def set_course_active(session: AsyncSession, *, course: Course, active: bool) -> Course:
    course.active = active
    await session.flush()
    return course


# --- modules and lessons ------------------------------------------------------------
async def modules_for(
    session: AsyncSession, *, course_code: str, include_inactive: bool = False
) -> list[CourseModule]:
    query = select(CourseModule).where(CourseModule.course_code == course_code)
    if not include_inactive:
        query = query.where(CourseModule.active.is_(True))
    result = await session.execute(query.order_by(CourseModule.sort_order, CourseModule.created_at))
    return list(result.scalars())


async def lessons_for(
    session: AsyncSession, *, module_ids: list[uuid.UUID], include_inactive: bool = False
) -> list[CourseLesson]:
    if not module_ids:
        return []
    query = select(CourseLesson).where(CourseLesson.module_id.in_(module_ids))
    if not include_inactive:
        query = query.where(CourseLesson.active.is_(True), CourseLesson.media_ready_at.is_not(None))
    result = await session.execute(query.order_by(CourseLesson.sort_order, CourseLesson.created_at))
    return list(result.scalars())


async def get_module(
    session: AsyncSession, *, module_id: uuid.UUID, lock: bool = False
) -> CourseModule | None:
    query = select(CourseModule).where(CourseModule.id == module_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def get_lesson(
    session: AsyncSession, *, lesson_id: uuid.UUID, lock: bool = False
) -> CourseLesson | None:
    query = select(CourseLesson).where(CourseLesson.id == lesson_id)
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    return (await session.execute(query)).scalar_one_or_none()


async def insert_module(session: AsyncSession, **values: object) -> CourseModule:
    row = CourseModule(**values)
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def insert_lesson(session: AsyncSession, **values: object) -> CourseLesson:
    row = CourseLesson(**values)
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def save(session: AsyncSession, row: object) -> None:
    await session.flush()
    await session.refresh(row)


# --- progress -------------------------------------------------------------------
async def progress_for(
    session: AsyncSession, *, user_id: uuid.UUID, lesson_ids: list[uuid.UUID]
) -> list[CourseLessonProgress]:
    if not lesson_ids:
        return []
    result = await session.execute(
        select(CourseLessonProgress).where(
            CourseLessonProgress.user_id == user_id,
            CourseLessonProgress.lesson_id.in_(lesson_ids),
        )
    )
    return list(result.scalars())


async def lock_progress(
    session: AsyncSession, *, user_id: uuid.UUID, lesson_id: uuid.UUID
) -> CourseLessonProgress:
    """The row, created at position zero on first open, and locked: two
    heartbeats from two tabs cannot both move it."""
    await session.execute(
        pg_insert(CourseLessonProgress)
        .values(user_id=user_id, lesson_id=lesson_id)
        .on_conflict_do_nothing(index_elements=["user_id", "lesson_id"])
    )
    result = await session.execute(
        select(CourseLessonProgress)
        .where(CourseLessonProgress.user_id == user_id, CourseLessonProgress.lesson_id == lesson_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one()


async def course_codes(session: AsyncSession) -> list[str]:
    result = await session.execute(select(Course.code).distinct().order_by(Course.code))
    return list(result.scalars())
