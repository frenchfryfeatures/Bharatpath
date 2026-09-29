"""courses - HTTP layer

Catalogue, lessons, progress, purchase, +30 contribution.

Routes only. No business logic, no repository access.
import-linter enforces the second half of that sentence.

Pay-first (R13): a course is a tool, so the catalogue and checkout need an
active subscription. The course itself is **locked until bought**: its
syllabus is visible, and no lesson is playable. **There is no completion
route** -- a candidate reports progress through a lesson, and the server
decides when the course is complete (`courses/service.py`).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status

from app.core.deps import (
    CANDIDATE,
    CurrentUser,
    DbSession,
    get_request_id,
    require_active_subscription,
    require_role,
)
from app.modules.billing import service as billing_service
from app.modules.billing.schemas import CheckoutResponse
from app.modules.courses import service
from app.modules.courses.schemas import (
    CourseDetailResponse,
    CourseResponse,
    LessonProgressRequest,
    LessonProgressResponse,
    LessonSchema,
    ModuleSchema,
)

router = APIRouter()

PayingCandidate = [Depends(require_role(CANDIDATE)), Depends(require_active_subscription)]


@router.get(
    "",
    response_model=list[CourseResponse],
    dependencies=PayingCandidate,
    summary="Courses on sale, and which the candidate owns",
)
async def list_courses(user: CurrentUser, session: DbSession) -> list[CourseResponse]:
    entries = await service.list_catalogue(session, user_id=user.user_id)
    return [
        CourseResponse(
            id=entry.course.id,
            code=entry.course.code,
            title=entry.course.title,
            price_minor=entry.course.price_minor,
            purchased=entry.purchased,
            completed=entry.completed,
            locked=not entry.purchased,
            lessons_total=entry.lessons_total,
            lessons_completed=entry.lessons_completed,
            percent_complete=entry.percent_complete,
        )
        for entry in entries
    ]


@router.get(
    "/{course_id}",
    response_model=CourseDetailResponse,
    dependencies=PayingCandidate,
    summary="A course's modules and lessons; playable only once bought",
)
async def get_course(
    course_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> CourseDetailResponse:
    view = await service.course_detail(session, user_id=user.user_id, course_id=course_id)
    return CourseDetailResponse(
        id=view.course.id,
        code=view.course.code,
        title=view.course.title,
        price_minor=view.course.price_minor,
        purchased=view.purchased,
        completed=view.completed,
        locked=not view.purchased,
        lessons_total=view.lessons_total,
        lessons_completed=view.lessons_completed,
        percent_complete=view.percent_complete,
        modules=[
            ModuleSchema(
                id=m.module.id,
                title=m.module.title,
                lessons=[
                    LessonSchema(
                        id=item.lesson.id,
                        title=item.lesson.title,
                        description=item.lesson.description,
                        duration_seconds=item.lesson.duration_seconds,
                        media_kind=item.lesson.media_kind,
                        media_url=item.media_url,
                        position_seconds=item.position_seconds,
                        completed=item.completed_at is not None,
                    )
                    for item in m.lessons
                ],
            )
            for m in view.modules
        ],
    )


@router.post(
    "/{course_id}/lessons/{lesson_id}/progress",
    response_model=LessonProgressResponse,
    dependencies=PayingCandidate,
    summary="Report where the candidate is in a lesson",
)
async def record_progress(
    course_id: uuid.UUID,
    lesson_id: uuid.UUID,
    payload: LessonProgressRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> LessonProgressResponse:
    """Send every ~15 seconds while playing, and on pause and close. The
    server decides when a lesson counts as watched -- far enough in, and long
    enough since it was first opened -- and completes the course when the
    last one is. 409 `course_not_purchased` for a course not bought."""
    result = await service.record_progress(
        session,
        user_id=user.user_id,
        course_id=course_id,
        lesson_id=lesson_id,
        position_seconds=payload.position_seconds,
        request_id=get_request_id(request),
    )
    return LessonProgressResponse(
        lesson_id=lesson_id,
        position_seconds=result.progress.position_seconds,
        completed=result.progress.completed_at is not None,
        lessons_total=result.lessons_total,
        lessons_completed=result.lessons_completed,
        percent_complete=result.percent_complete,
        course_completed=result.course_completed_now
        or result.lessons_completed >= result.lessons_total > 0,
    )


@router.post(
    "/{course_id}/checkout",
    response_model=CheckoutResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=PayingCandidate,
    summary="Buy a course",
)
async def checkout_course(
    course_id: uuid.UUID, user: CurrentUser, session: DbSession
) -> CheckoutResponse:
    """Nothing is granted here; the purchase is recorded when the gateway's
    signed callback has been processed."""
    payment = await billing_service.checkout_course(
        session, user_id=user.user_id, course_id=course_id
    )
    return CheckoutResponse.of(payment)
