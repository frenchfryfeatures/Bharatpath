"""courses - Pydantic request/response DTOs

Catalogue, purchase, completion, +30 contribution.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**No field says what a course is worth to the score.** The score is never
explained (R11), and a price beside a points figure is the "points for sale"
reading the course pricing note in `subscriptions/catalogue.py` warns about.
How the app describes the course is copy for the client to approve.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import Field

from app.core.schemas import ApiSchema


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


class CourseResponse(_Base):
    id: uuid.UUID
    code: str
    title: str
    price_minor: int = Field(ge=0, description="Paise.")
    currency: str = "INR"
    purchased: bool
    completed: bool
    locked: bool = Field(
        description="True until the candidate buys the course. A locked course shows its "
        "syllabus and never a playable lesson."
    )
    lessons_total: int = Field(ge=0, description="Lessons published now.")
    lessons_completed: int = Field(ge=0)
    percent_complete: int = Field(ge=0, le=100, description="Whole percent, rounded down.")


class LessonSchema(_Base):
    id: uuid.UUID
    title: str
    description: str | None = None
    duration_seconds: int
    media_kind: Literal["YOUTUBE", "UPLOAD"]
    media_url: str | None = Field(
        description="None while the course is locked. YOUTUBE: an embed URL for an iframe. "
        "UPLOAD: a presigned GET for a <video> element, valid for four hours; fetch the "
        "course again for a fresh one."
    )
    position_seconds: int = Field(ge=0, description="Where to resume.")
    completed: bool


class ModuleSchema(_Base):
    id: uuid.UUID
    title: str
    lessons: list[LessonSchema]


class CourseDetailResponse(CourseResponse):
    modules: list[ModuleSchema]


class LessonProgressRequest(_Base):
    position_seconds: int = Field(
        ge=0, le=86_400, description="Where the player is now, in whole seconds."
    )


class LessonProgressResponse(_Base):
    lesson_id: uuid.UUID
    position_seconds: int
    completed: bool = Field(description="This lesson counts as watched.")
    lessons_total: int
    lessons_completed: int
    percent_complete: int = Field(ge=0, le=100)
    course_completed: bool = Field(
        description="Every published lesson is watched and the course is complete."
    )
