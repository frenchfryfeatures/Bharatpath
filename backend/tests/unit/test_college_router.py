"""HTTP-boundary compatibility for the college Students page."""

import pytest
from pydantic import TypeAdapter, ValidationError

from app.modules.college.router import StudentStageQuery


@pytest.mark.parametrize(
    ("typed", "normalised"),
    [
        ("All", "ALL"),
        ("linked", "LINKED"),
        ("Invited", "INVITED"),
        ("consent_pending", "CONSENT_PENDING"),
    ],
)
def test_student_stage_filter_is_case_insensitive(typed: str, normalised: str) -> None:
    assert TypeAdapter(StudentStageQuery).validate_python(typed) == normalised


def test_unknown_student_stage_is_still_refused() -> None:
    with pytest.raises(ValidationError):
        TypeAdapter(StudentStageQuery).validate_python("UNKNOWN")
