"""A student's photo reaches the student and our staff, and nobody else.

Decided 2026-10-09 (the backend lead): a face says gender, age and more, and
masked search exists so that an employer judges on band and skills
(invariant 5, C3). Showing a photo to an employer -- on a card, after a
reveal, or on an application -- or to a college is a product decision, not
a field someone adds.

Re-confirmed 2026-10-10, when every surface that names an organisation got
its logo: logos go everywhere an employer or a college is named; a student's
photo still goes only to the student's own screens and the console.

Three locks:

1. **No employer- or college-facing schema has a field for a photo.** Walked
   over every response model those modules define, and the employer-facing
   models that live elsewhere (`EMPLOYER_FACING_ELSEWHERE`), nested models
   included, whichever module defines them. An organisation's *logo* is
   allowed: it is the organisation's own face, shown on purpose.
2. **`profile_images.service.photo_url` and `photo_urls` -- the ways to read
   another person's photo -- are called only by the admin console.**
3. **`own_photo_url` takes no id**: it reads the verified caller's own photo
   and cannot be pointed at anyone else.
"""

from __future__ import annotations

import importlib
import inspect
import re
import typing
from pathlib import Path

import pytest
from pydantic import BaseModel

pytestmark = pytest.mark.invariant

ROOT = Path(__file__).resolve().parents[2]

#: Every module whose schemas an employer or a college reads.
FACING_OTHERS = (
    "discovery",
    "applications",
    "employer",
    "jobs",
    "kyb",
    "college",
    "analytics",
)
#: Employer-facing response models defined in a module that also serves the
#: candidate, so the module as a whole is not in `FACING_OTHERS`.
EMPLOYER_FACING_ELSEWHERE = (("candidate", "RevealedCandidate"),)
PHOTO_LIKE = re.compile(r"photo|avatar|portrait|selfie|face|picture", re.IGNORECASE)


def _nested(model: type[BaseModel], seen: set[type[BaseModel]]) -> None:
    """`model` and every model its fields hold, at any depth, from any module."""
    if model in seen:
        return
    seen.add(model)
    for field in model.model_fields.values():
        stack: list[object] = [field.annotation]
        while stack:
            annotation = stack.pop()
            if inspect.isclass(annotation) and issubclass(annotation, BaseModel):
                _nested(annotation, seen)
            stack.extend(typing.get_args(annotation))


def _models(module_name: str) -> set[type[BaseModel]]:
    schemas = importlib.import_module(f"app.modules.{module_name}.schemas")
    seen: set[type[BaseModel]] = set()
    for _, obj in inspect.getmembers(schemas, inspect.isclass):
        if issubclass(obj, BaseModel) and obj.__module__ == schemas.__name__:
            _nested(obj, seen)
    return seen


def _photo_fields(models: set[type[BaseModel]]) -> list[str]:
    return sorted(
        f"{model.__module__}.{model.__name__}.{field}"
        for model in models
        for field in model.model_fields
        if PHOTO_LIKE.search(field)
    )


@pytest.mark.parametrize("module_name", FACING_OTHERS)
def test_no_employer_or_college_schema_has_a_field_for_a_photo(module_name: str) -> None:
    found = _photo_fields(_models(module_name))
    assert not found, (
        f"{found} would show a person's photo to an employer or a college. A "
        "student's photo is theirs and staff's only (2026-10-09); widening that "
        "is a client decision, not a schema change."
    )


@pytest.mark.parametrize(("module_name", "model_name"), EMPLOYER_FACING_ELSEWHERE)
def test_no_employer_facing_model_elsewhere_has_a_field_for_a_photo(
    module_name: str, model_name: str
) -> None:
    """The reveal is `candidate.schemas.RevealedCandidate`: the candidate
    module also serves the candidate their own profile, which may carry their
    photo, so it is walked by name rather than as a module."""
    model = getattr(importlib.import_module(f"app.modules.{module_name}.schemas"), model_name)
    seen: set[type[BaseModel]] = set()
    _nested(model, seen)
    found = _photo_fields(seen)
    assert not found, f"{found} would show a person's photo to an employer."


def test_the_walk_reaches_models_nested_from_other_modules() -> None:
    """The CV on the reveal is `resume.schemas.SharedResumeView`; a walk
    that stopped at the module boundary would miss a photo added there."""
    from app.modules.candidate.schemas import RevealedCandidate
    from app.modules.resume.schemas import SharedResumeView

    seen: set[type[BaseModel]] = set()
    _nested(RevealedCandidate, seen)
    assert SharedResumeView in seen


def test_only_the_admin_console_reads_another_persons_photo() -> None:
    callers = sorted(
        str(path.relative_to(ROOT))
        for path in (ROOT / "app").rglob("*.py")
        if "profile_images" not in path.parts
        and re.search(r"profile_images_service\.photo_urls?\(", path.read_text(encoding="utf-8"))
    )
    assert callers == [str(Path("app/modules/admin/service.py"))], callers


def test_the_own_photo_reader_takes_no_id() -> None:
    from app.modules.profile_images.service import own_photo_url

    assert set(inspect.signature(own_photo_url).parameters) == {"session", "ctx"}
