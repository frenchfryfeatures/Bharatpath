"""A student's photo reaches the student and our staff, and nobody else.

Decided 2026-10-09 (the backend lead): a face says gender, age and more, and
masked search exists so that an employer judges on band and skills
(invariant 5, C3). Showing a photo to an employer -- on a card, after a
reveal, or on an application -- or to a college is a product decision, not
a field someone adds.

Two locks:

1. **No employer- or college-facing schema has a field for a photo.** Walked
   over every response model those modules define, nested models included.
   An organisation's *logo* is allowed: it is the organisation's own face,
   shown to candidates on purpose.
2. **`profile_images.service.photo_url` -- the one way to read another
   person's photo -- is called only by the admin console.**
"""

from __future__ import annotations

import importlib
import inspect
import re
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
PHOTO_LIKE = re.compile(r"photo|avatar|portrait|selfie|face|picture", re.IGNORECASE)


def _models(module_name: str) -> list[type[BaseModel]]:
    schemas = importlib.import_module(f"app.modules.{module_name}.schemas")
    return [
        obj
        for _, obj in inspect.getmembers(schemas, inspect.isclass)
        if issubclass(obj, BaseModel) and obj.__module__ == schemas.__name__
    ]


@pytest.mark.parametrize("module_name", FACING_OTHERS)
def test_no_employer_or_college_schema_has_a_field_for_a_photo(module_name: str) -> None:
    found = [
        f"{model.__name__}.{field}"
        for model in _models(module_name)
        for field in model.model_fields
        if PHOTO_LIKE.search(field)
    ]
    assert not found, (
        f"{found} would show a person's photo to an employer or a college. A "
        "student's photo is theirs and staff's only (2026-10-09); widening that "
        "is a client decision, not a schema change."
    )


def test_only_the_admin_console_reads_another_persons_photo() -> None:
    callers = sorted(
        str(path.relative_to(ROOT))
        for path in (ROOT / "app").rglob("*.py")
        if "profile_images" not in path.parts
        and re.search(r"profile_images_service\.photo_url\(", path.read_text(encoding="utf-8"))
    )
    assert callers == [str(Path("app/modules/admin/service.py"))], callers
