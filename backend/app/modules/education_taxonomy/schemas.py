from typing import Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.core.schemas import ApiSchema

from .domain import clean_name

Level = Literal["qualification", "course", "specialization"]


class OptionWrite(ApiSchema):
    name: str = Field(min_length=1, max_length=160)
    parent_id: UUID | None = None
    level_rank: int = Field(default=1, ge=1, le=9)
    is_not_applicable: bool = False
    is_visible: bool = True
    sort_order: int = Field(default=0, ge=0, le=100000)
    version: int = Field(default=1, ge=1)
    _name = field_validator("name")(clean_name)


class Reorder(ApiSchema):
    parent_id: UUID | None = None
    ids: list[UUID] = Field(min_length=1, max_length=1000)
    versions: dict[str, int]


class Resolve(ApiSchema):
    action: Literal["approve", "merge", "reject"]
    name: str | None = Field(default=None, min_length=1, max_length=160)
    parent_id: UUID | None = None
    option_id: UUID | None = None
    level_rank: int = Field(default=1, ge=1, le=9)
    is_not_applicable: bool = False
    version: int = Field(ge=1)


class Links(ApiSchema):
    course_ids: list[UUID] = Field(min_length=1, max_length=1000)
    specialization_ids: list[UUID] = Field(min_length=1, max_length=1000)
    action: Literal["attach", "detach"]
    revision: int
