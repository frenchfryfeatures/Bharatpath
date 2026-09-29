"""courses - business rules and transaction boundaries

Catalogue, purchase, completion, +30 contribution.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**A purchase is recorded by billing, after a verified callback, and nowhere
else** (`record_purchase`). The database refuses a purchase row whose payment
is not verified, so there is no second way in.

**A completion moves a score (invariant 3), so it is written here and by no
route.** Since 2026-09-29 the rule is the client's: every published lesson
watched (`domain.evaluate_completion`). A candidate reports where they are in
a lesson (`record_progress`); the server decides whether that lesson is
watched (`domain.lesson_watched`) and, when the last one is, records the
completion **as the system**. `record_completion` still refuses any caller
that is not the system or platform staff, and **no endpoint records a
completion directly**.

**Lessons are built by staff** (`create_module`, `create_lesson`, ...), each a
YouTube video or an uploaded file, and the course goes on sale only when staff
publish it with at least one playable lesson (`set_published`).

**This module imports nothing from `scoring`** (invariant 4'). Scoring reads
`contributions_for` when it computes a score.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import storage
from app.core.audit import AuditAction, audit_event
from app.core.deps import PLATFORM_ADMIN
from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError
from app.core.errors import ValidationError as AppValidationError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.modules.courses import repository
from app.modules.courses.catalogue import COURSE_CODE, COURSE_TITLE
from app.modules.courses.domain import (
    ACCEPTED_VIDEO_TYPES,
    MAX_COURSE_CONTRIBUTION,
    MAX_VIDEO_BYTES,
    MEDIA_UPLOAD,
    MEDIA_YOUTUBE,
    MIN_VIDEO_BYTES,
    CourseProgress,
    clamp_contribution,
    clamp_position,
    evaluate_completion,
    lesson_media_key,
    lesson_watched,
    percent_complete,
    sniff_video,
    youtube_embed_url,
    youtube_video_id,
)
from app.modules.courses.events import COMPLETION_RECORDED
from app.modules.courses.models import (
    Course,
    CourseCompletion,
    CourseLesson,
    CourseLessonProgress,
    CourseModule,
)
from app.modules.subscriptions.catalogue import COURSE_PRODUCT
from app.settings import Settings, get_settings

logger = get_logger(__name__)

#: The actor role for writes the platform makes itself -- a graded assessment,
#: when one exists.
SYSTEM_ACTOR: Final = "SYSTEM"

#: Who may record a completion. Never CANDIDATE.
COMPLETION_WRITER_ROLES: Final = frozenset({SYSTEM_ACTOR, PLATFORM_ADMIN})


class CourseNotFoundError(NotFoundError):
    code = "course_not_found"
    title = "Course not found"


class CourseAlreadyPurchasedError(ConflictError):
    code = "course_already_purchased"
    title = "This course is already yours"


class CourseNotPurchasedError(ConflictError):
    code = "course_not_purchased"
    title = "This course has not been bought"


class CourseModuleNotFoundError(NotFoundError):
    code = "course_module_not_found"
    title = "Course module not found"


class CourseLessonNotFoundError(NotFoundError):
    code = "course_lesson_not_found"
    title = "Lesson not found"


class CourseLessonMediaInvalidError(AppValidationError):
    """`params.reason`: `youtube_url_invalid`, `media_kind_mismatch`,
    `upload_missing`, `upload_not_video`, `upload_too_large`, `upload_too_small`."""

    code = "course_lesson_media_invalid"
    title = "The lesson's video cannot be used"


class CourseNotPublishableError(ConflictError):
    """A course goes on sale only with at least one playable lesson."""

    code = "course_not_publishable"
    title = "Add a playable lesson before publishing"


class CourseNotCompleteError(AppValidationError):
    """`params.reason` is the completion rule's code, e.g. `assessment_not_passed`."""

    code = "course_not_complete"
    title = "The course is not complete"


@dataclass(frozen=True, slots=True)
class CatalogueEntry:
    course: Course
    purchased: bool
    completed: bool
    lessons_total: int
    lessons_completed: int

    @property
    def percent_complete(self) -> int:
        return percent_complete(CourseProgress(self.lessons_total, self.lessons_completed))


@dataclass(frozen=True, slots=True)
class CompletionResult:
    completion: CourseCompletion
    created: bool


@dataclass(frozen=True, slots=True)
class CourseContribution:
    """One completion as scoring folds it in."""

    completion_id: uuid.UUID
    course_id: uuid.UUID
    points: int
    contribution_version: str


async def _published_lessons(session: AsyncSession, *, code: str) -> list[CourseLesson]:
    modules = await repository.modules_for(session, course_code=code)
    return await repository.lessons_for(session, module_ids=[m.id for m in modules])


async def _watched(
    session: AsyncSession, *, user_id: uuid.UUID, lessons: list[CourseLesson]
) -> int:
    rows = await repository.progress_for(
        session, user_id=user_id, lesson_ids=[lesson.id for lesson in lessons]
    )
    return sum(1 for r in rows if r.completed_at is not None)


async def list_catalogue(session: AsyncSession, *, user_id: uuid.UUID) -> list[CatalogueEntry]:
    """Courses on sale, each saying whether this candidate owns it. **A course
    is on sale only once staff publish it** with a playable lesson
    (`set_published`), so an empty course is never sold: +30 points for
    watching nothing is the refund and the review this exists to prevent.

    Ownership is by course code, so a buyer of an earlier price keeps it."""
    courses = await repository.active_courses(session)
    purchased = await repository.purchased_course_codes(session, user_id=user_id)
    completed = await repository.completed_course_codes(session, user_id=user_id)
    entries: list[CatalogueEntry] = []
    seen: set[str] = set()
    for course in courses:
        if course.code in seen:
            continue
        seen.add(course.code)
        lessons = await _published_lessons(session, code=course.code)
        watched = await _watched(session, user_id=user_id, lessons=lessons)
        entries.append(
            CatalogueEntry(
                course,
                course.code in purchased,
                course.code in completed,
                len(lessons),
                watched,
            )
        )
    return entries


async def purchasable_course(
    session: AsyncSession, *, user_id: uuid.UUID, course_id: uuid.UUID
) -> Course:
    """An active course this user does not own. Purchasable once (client,
    2026-08-27), and the unique key on purchases holds that too."""
    course = await repository.get_course(session, course_id=course_id)
    if course is None or not course.active:
        raise CourseNotFoundError()
    if await repository.purchase_for_code(session, user_id=user_id, code=course.code) is not None:
        raise CourseAlreadyPurchasedError()
    return course


async def record_purchase(
    session: AsyncSession, *, user_id: uuid.UUID, course_id: uuid.UUID, payment_id: uuid.UUID
) -> bool:
    """Called by billing after a verified callback. False if already owned --
    a second verified payment for the same course grants nothing twice."""
    created = await repository.insert_purchase(
        session, user_id=user_id, course_id=course_id, payment_id=payment_id
    )
    if not created:
        logger.warning("course_purchase_already_recorded", course_id=str(course_id))
    return created


async def record_completion(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    progress: CourseProgress,
    actor_id: uuid.UUID | None,
    actor_role: str,
    request_id: str | None = None,
) -> CompletionResult:
    """**A score-moving write.** Role-restricted, purchase-gated, judged by the
    versioned completion rule, audited in this transaction, and announced to
    scoring through the outbox -- so a rolled-back completion never re-scores.

    Idempotent: a second call returns the recorded completion and writes, audits
    and emits nothing.
    """
    if actor_role not in COMPLETION_WRITER_ROLES:
        raise PermissionDeniedError(code="course_completion_not_writable")
    course = await repository.get_course(session, course_id=course_id)
    if course is None:
        raise CourseNotFoundError()
    if not await repository.has_purchase(session, user_id=user_id, course_id=course_id):
        raise CourseNotPurchasedError()

    existing = await repository.get_completion(session, user_id=user_id, course_id=course_id)
    if existing is not None:
        return CompletionResult(existing, created=False)

    decision = evaluate_completion(progress)
    if not decision.complete:
        raise CourseNotCompleteError(params={"reason": decision.reason})

    points = clamp_contribution(course.contribution_points)
    row = await repository.insert_completion(
        session,
        user_id=user_id,
        course_id=course_id,
        contribution_version=decision.rule_version,
        points_awarded=points,
    )
    if row is None:
        # Recorded by a concurrent call between the read and the insert.
        raced = await repository.get_completion(session, user_id=user_id, course_id=course_id)
        if raced is None:  # pragma: no cover - the conflict means it exists
            raise CourseNotPurchasedError()
        return CompletionResult(raced, created=False)

    await audit_event(
        session,
        action=AuditAction.COURSE_COMPLETION_RECORDED,
        actor_id=actor_id,
        actor_role=actor_role,
        target_type="course_completion",
        target_id=row.id,
        request_id=request_id,
        metadata={
            "candidate_id": str(user_id),
            "course_id": str(course_id),
            "points_awarded": points,
            "rule_version": decision.rule_version,
        },
    )
    await emit(
        session,
        event_type=COMPLETION_RECORDED,
        aggregate_type="course_completion",
        aggregate_id=row.id,
        payload={
            "user_id": str(user_id),
            "course_id": str(course_id),
            "completion_id": str(row.id),
            "points_awarded": points,
        },
    )
    logger.info("course_completion_recorded", course_id=str(course_id), points=points)
    return CompletionResult(row, created=True)


async def contributions_for(
    session: AsyncSession, *, user_id: uuid.UUID
) -> list[CourseContribution]:
    """Every completion this candidate has, at the points frozen on each."""
    return [
        CourseContribution(
            completion_id=row.id,
            course_id=row.course_id,
            points=clamp_contribution(row.points_awarded),
            contribution_version=row.contribution_version,
        )
        for row in await repository.completions_for(session, user_id=user_id)
    ]


async def sync_catalogue(session: AsyncSession) -> int:
    """Write the one course from `catalogue.py`. Returns the rows written.

    A changed title, price or contribution is a new version, never an edit,
    as for plans. **Whether it is on sale is not decided here**: it is off
    when first written and staff turn it on with `set_published` once it has
    a playable lesson. A new version keeps whatever the previous one was, so
    re-running the seed never takes a published course off sale or puts an
    empty one on.
    """
    desired = (COURSE_TITLE, COURSE_PRODUCT.price_minor, MAX_COURSE_CONTRIBUTION)
    latest = await repository.latest_course_version(session, code=COURSE_CODE)
    if (
        latest is not None
        and (latest.title, latest.price_minor, latest.contribution_points) == desired
    ):
        return 0
    active = latest.active if latest is not None else False
    if latest is not None:
        latest.active = False
    await repository.insert_course(
        session,
        code=COURSE_CODE,
        title=COURSE_TITLE,
        price_minor=COURSE_PRODUCT.price_minor,
        contribution_points=MAX_COURSE_CONTRIBUTION,
        active=active,
        version=latest.version + 1 if latest is not None else 1,
    )
    return 1


# ---------------------------------------------------------------------------
# Lessons, as a candidate sees them (2026-09-29)
# ---------------------------------------------------------------------------
#: A presigned lesson link lasts as long as the longest lesson, so seeking
#: late in a video does not fail on an expired signature.
LESSON_URL_TTL_SECONDS: Final = 4 * 60 * 60


@dataclass(frozen=True, slots=True)
class LessonView:
    lesson: CourseLesson
    #: None while the course is locked -- never a link to a video not bought.
    media_url: str | None
    position_seconds: int
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class ModuleView:
    module: CourseModule
    lessons: tuple[LessonView, ...]


@dataclass(frozen=True, slots=True)
class CourseView:
    course: Course
    purchased: bool
    completed: bool
    modules: tuple[ModuleView, ...]
    lessons_total: int
    lessons_completed: int

    @property
    def percent_complete(self) -> int:
        return percent_complete(CourseProgress(self.lessons_total, self.lessons_completed))


async def _media_url(lesson: CourseLesson, *, settings: Settings) -> str | None:
    if lesson.media_kind == MEDIA_YOUTUBE and lesson.youtube_video_id:
        return youtube_embed_url(lesson.youtube_video_id)
    if lesson.media_kind == MEDIA_UPLOAD and lesson.s3_key and lesson.media_ready_at:
        return await storage.presign_get(
            bucket=settings.s3_bucket_course_media,
            key=lesson.s3_key,
            expires_in=LESSON_URL_TTL_SECONDS,
        )
    return None


async def course_detail(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    settings: Settings | None = None,
) -> CourseView:
    """The syllabus of a course on sale, or of one this candidate bought.

    **Locked until bought**: module and lesson titles and lengths are shown so
    the candidate can see what they would get, and `media_url` is None on
    every lesson until the purchase is recorded.
    """
    settings = settings or get_settings()
    course = await repository.get_course(session, course_id=course_id)
    if course is None:
        raise CourseNotFoundError()
    purchase = await repository.purchase_for_code(session, user_id=user_id, code=course.code)
    if not course.active and purchase is None:
        raise CourseNotFoundError()
    completed = course.code in await repository.completed_course_codes(session, user_id=user_id)
    modules = await repository.modules_for(session, course_code=course.code)
    lessons = await repository.lessons_for(session, module_ids=[m.id for m in modules])
    progress = {
        p.lesson_id: p
        for p in await repository.progress_for(
            session, user_id=user_id, lesson_ids=[lesson.id for lesson in lessons]
        )
    }
    views: list[ModuleView] = []
    for module in modules:
        mine: list[LessonView] = []
        for lesson in (x for x in lessons if x.module_id == module.id):
            row = progress.get(lesson.id)
            mine.append(
                LessonView(
                    lesson=lesson,
                    media_url=await _media_url(lesson, settings=settings) if purchase else None,
                    position_seconds=row.position_seconds if row else 0,
                    completed_at=row.completed_at if row else None,
                )
            )
        if mine:
            views.append(ModuleView(module, tuple(mine)))
    return CourseView(
        course=course,
        purchased=purchase is not None,
        completed=completed,
        modules=tuple(views),
        lessons_total=len(lessons),
        lessons_completed=sum(1 for p in progress.values() if p.completed_at is not None),
    )


@dataclass(frozen=True, slots=True)
class ProgressResult:
    progress: CourseLessonProgress
    #: This report made the lesson count as watched.
    lesson_completed_now: bool
    lessons_total: int
    lessons_completed: int
    #: The course completion this report recorded, if it was the last lesson.
    course_completed_now: bool

    @property
    def percent_complete(self) -> int:
        return percent_complete(CourseProgress(self.lessons_total, self.lessons_completed))


async def record_progress(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    course_id: uuid.UUID,
    lesson_id: uuid.UUID,
    position_seconds: int,
    now: datetime | None = None,
    request_id: str | None = None,
) -> ProgressResult:
    """Where the candidate is in a lesson. The app reports it every few
    seconds while playing and when it pauses or closes.

    **The server decides "watched"** (`domain.lesson_watched`): far enough in,
    and long enough since first opened. When that makes every published
    lesson watched, the completion is recorded here, **as the system**, in the
    same transaction -- the score moves because of what the rule saw, never
    because a candidate said they were done.
    """
    now = now or datetime.now(UTC)
    course = await repository.get_course(session, course_id=course_id)
    if course is None:
        raise CourseNotFoundError()
    purchase = await repository.purchase_for_code(session, user_id=user_id, code=course.code)
    if purchase is None:
        raise CourseNotPurchasedError()
    lessons = await _published_lessons(session, code=course.code)
    lesson = next((x for x in lessons if x.id == lesson_id), None)
    if lesson is None:
        raise CourseLessonNotFoundError()

    row = await repository.lock_progress(session, user_id=user_id, lesson_id=lesson_id)
    position = clamp_position(position_seconds, duration_seconds=lesson.duration_seconds)
    row.position_seconds = position
    row.furthest_seconds = max(row.furthest_seconds, position)
    newly = row.completed_at is None and lesson_watched(
        duration_seconds=lesson.duration_seconds,
        furthest_seconds=row.furthest_seconds,
        first_opened_at=row.first_opened_at,
        now=now,
    )
    if newly:
        row.completed_at = now
    await repository.save(session, row)

    watched = await _watched(session, user_id=user_id, lessons=lessons)
    course_done = False
    if newly:
        progress = CourseProgress(lessons_total=len(lessons), lessons_completed=watched)
        if evaluate_completion(progress).complete:
            result = await record_completion(
                session,
                user_id=user_id,
                course_id=purchase.course_id,
                progress=progress,
                actor_id=None,
                actor_role=SYSTEM_ACTOR,
                request_id=request_id,
            )
            course_done = result.created
    return ProgressResult(row, newly, len(lessons), watched, course_done)


@dataclass(frozen=True, slots=True)
class CourseStatus:
    """One course, as staff or a college (with consent) see a candidate's
    progress through it."""

    code: str
    title: str
    purchased: bool
    purchased_at: datetime | None
    lessons_total: int
    lessons_completed: int
    completed_at: datetime | None

    @property
    def percent_complete(self) -> int:
        return percent_complete(CourseProgress(self.lessons_total, self.lessons_completed))


async def status_for(session: AsyncSession, *, user_id: uuid.UUID) -> list[CourseStatus]:
    """Every course on sale or bought: whether bought, how far, whether done.
    Read by the console and by a college's consented view, on their sessions."""
    courses = {c.code: c for c in await repository.active_courses(session)}
    for code in await repository.purchased_course_codes(session, user_id=user_id):
        if code not in courses:
            latest = await repository.latest_course_version(session, code=code)
            if latest is not None:
                courses[code] = latest
    completions = {
        c.course_id: c for c in await repository.completions_for(session, user_id=user_id)
    }
    out: list[CourseStatus] = []
    for code, course in sorted(courses.items()):
        purchase = await repository.purchase_for_code(session, user_id=user_id, code=code)
        lessons = await _published_lessons(session, code=code)
        completion = completions.get(purchase.course_id) if purchase else None
        out.append(
            CourseStatus(
                code=code,
                title=course.title,
                purchased=purchase is not None,
                purchased_at=purchase.purchased_at if purchase else None,
                lessons_total=len(lessons),
                lessons_completed=await _watched(session, user_id=user_id, lessons=lessons),
                completed_at=completion.completed_at if completion else None,
            )
        )
    return out


# ---------------------------------------------------------------------------
# Building the course -- the console (2026-09-29)
# ---------------------------------------------------------------------------
# Called by `admin.service`, which decides who may and writes the audit row.


@dataclass(frozen=True, slots=True)
class AdminCourseView:
    course: Course
    modules: tuple[tuple[CourseModule, tuple[CourseLesson, ...]], ...]


async def admin_courses(session: AsyncSession) -> list[AdminCourseView]:
    """Every course code at its latest version, with every module and lesson,
    switched off or not yet ready included."""
    out: list[AdminCourseView] = []
    for code in await repository.course_codes(session):
        course = await repository.latest_course_version(session, code=code)
        if course is None:  # pragma: no cover - the code came from a row
            continue
        modules = await repository.modules_for(session, course_code=code, include_inactive=True)
        lessons = await repository.lessons_for(
            session, module_ids=[m.id for m in modules], include_inactive=True
        )
        out.append(
            AdminCourseView(
                course,
                tuple((m, tuple(x for x in lessons if x.module_id == m.id)) for m in modules),
            )
        )
    return out


async def _course_by_code(session: AsyncSession, code: str) -> Course:
    course = await repository.latest_course_version(session, code=code)
    if course is None:
        raise CourseNotFoundError()
    return course


async def create_module(
    session: AsyncSession, *, code: str, title: str, sort_order: int, created_by: uuid.UUID
) -> CourseModule:
    await _course_by_code(session, code)
    return await repository.insert_module(
        session, course_code=code, title=title, sort_order=sort_order, created_by=created_by
    )


async def update_module(
    session: AsyncSession,
    *,
    module_id: uuid.UUID,
    title: str | None,
    sort_order: int | None,
    active: bool | None,
) -> tuple[CourseModule, list[str]]:
    row = await repository.get_module(session, module_id=module_id, lock=True)
    if row is None:
        raise CourseModuleNotFoundError()
    moved: list[str] = []
    for field, value in (("title", title), ("sort_order", sort_order), ("active", active)):
        if value is not None and getattr(row, field) != value:
            setattr(row, field, value)
            moved.append(field)
    if moved:
        await repository.save(session, row)
    return row, moved


def _youtube_id_or_refuse(url: str) -> str:
    video_id = youtube_video_id(url)
    if video_id is None:
        raise CourseLessonMediaInvalidError(params={"reason": "youtube_url_invalid"})
    return video_id


async def create_lesson(
    session: AsyncSession,
    *,
    module_id: uuid.UUID,
    title: str,
    description: str | None,
    duration_seconds: int,
    sort_order: int,
    youtube_url: str | None,
    created_by: uuid.UUID,
    now: datetime | None = None,
) -> CourseLesson:
    """A YouTube lesson is playable at once. Without a link the lesson waits
    for its upload: `issue_lesson_upload`, PUT the file, then
    `confirm_lesson_upload`, and only then do candidates see it."""
    module = await repository.get_module(session, module_id=module_id)
    if module is None:
        raise CourseModuleNotFoundError()
    lesson_id = uuid.uuid4()
    if youtube_url is not None:
        media: dict[str, object] = {
            "media_kind": MEDIA_YOUTUBE,
            "youtube_video_id": _youtube_id_or_refuse(youtube_url),
            "media_ready_at": now or datetime.now(UTC),
        }
    else:
        media = {
            "media_kind": MEDIA_UPLOAD,
            "s3_key": lesson_media_key(course_code=module.course_code, lesson_id=str(lesson_id)),
        }
    return await repository.insert_lesson(
        session,
        id=lesson_id,
        module_id=module_id,
        title=title,
        description=description,
        duration_seconds=duration_seconds,
        sort_order=sort_order,
        created_by=created_by,
        **media,
    )


async def update_lesson(
    session: AsyncSession,
    *,
    lesson_id: uuid.UUID,
    changes: dict[str, object],
    now: datetime | None = None,
) -> tuple[CourseLesson, list[str]]:
    """`changes` may name title, description, duration_seconds, sort_order,
    active and youtube_url. A YouTube link replaces a YouTube lesson's video;
    an uploaded lesson is re-uploaded instead."""
    row = await repository.get_lesson(session, lesson_id=lesson_id, lock=True)
    if row is None:
        raise CourseLessonNotFoundError()
    moved: list[str] = []
    url = changes.pop("youtube_url", None)
    if url is not None:
        if row.media_kind != MEDIA_YOUTUBE:
            raise CourseLessonMediaInvalidError(params={"reason": "media_kind_mismatch"})
        video_id = _youtube_id_or_refuse(str(url))
        if video_id != row.youtube_video_id:
            row.youtube_video_id = video_id
            row.media_ready_at = now or datetime.now(UTC)
            moved.append("youtube_video_id")
    for field, value in changes.items():
        if value is not None and getattr(row, field) != value:
            setattr(row, field, value)
            moved.append(field)
    if moved:
        await repository.save(session, row)
    return row, moved


@dataclass(frozen=True, slots=True)
class LessonUploadTicket:
    url: str
    expires_in_seconds: int
    max_bytes: int
    accepted_types: tuple[str, ...]


async def issue_lesson_upload(
    session: AsyncSession, *, lesson_id: uuid.UUID, settings: Settings | None = None
) -> LessonUploadTicket:
    """A presigned PUT for an uploaded lesson's video. Re-issuing replaces the
    video: the lesson leaves the course until the new file is confirmed."""
    settings = settings or get_settings()
    row = await repository.get_lesson(session, lesson_id=lesson_id, lock=True)
    if row is None:
        raise CourseLessonNotFoundError()
    if row.media_kind != MEDIA_UPLOAD or row.s3_key is None:
        raise CourseLessonMediaInvalidError(params={"reason": "media_kind_mismatch"})
    row.media_ready_at = None
    await repository.save(session, row)
    ttl = settings.presigned_url_ttl_seconds
    url = await storage.presign_put(
        bucket=settings.s3_bucket_course_media, key=row.s3_key, expires_in=ttl
    )
    return LessonUploadTicket(url, ttl, MAX_VIDEO_BYTES, ACCEPTED_VIDEO_TYPES)


async def confirm_lesson_upload(
    session: AsyncSession,
    *,
    lesson_id: uuid.UUID,
    now: datetime | None = None,
    settings: Settings | None = None,
) -> CourseLesson:
    """Judge what landed: size from S3, format from the bytes. A file that is
    not a video is deleted and the lesson stays unplayable."""
    settings = settings or get_settings()
    row = await repository.get_lesson(session, lesson_id=lesson_id, lock=True)
    if row is None:
        raise CourseLessonNotFoundError()
    if row.media_kind != MEDIA_UPLOAD or row.s3_key is None:
        raise CourseLessonMediaInvalidError(params={"reason": "media_kind_mismatch"})
    bucket = settings.s3_bucket_course_media
    meta = await storage.head_object(bucket=bucket, key=row.s3_key)
    if meta is None:
        raise CourseLessonMediaInvalidError(params={"reason": "upload_missing"})
    size = int(meta["size_bytes"])
    mime = sniff_video(await storage.read_head_bytes(bucket=bucket, key=row.s3_key, count=64))
    reason = (
        "upload_too_large"
        if size > MAX_VIDEO_BYTES
        else "upload_too_small"
        if size < MIN_VIDEO_BYTES
        else "upload_not_video"
        if mime is None
        else None
    )
    if reason is not None:
        await storage.delete_object(bucket=bucket, key=row.s3_key)
        raise CourseLessonMediaInvalidError(params={"reason": reason})
    row.mime, row.size_bytes, row.media_ready_at = mime, size, now or datetime.now(UTC)
    await repository.save(session, row)
    return row


async def set_published(session: AsyncSession, *, code: str, published: bool) -> Course:
    """Put the course on sale, or take it off. **On sale needs a playable
    lesson.** Taking it off sale stops new purchases; everyone who bought it
    keeps their lessons."""
    course = await _course_by_code(session, code)
    if published and not await _published_lessons(session, code=code):
        raise CourseNotPublishableError()
    return await repository.set_course_active(session, course=course, active=published)
