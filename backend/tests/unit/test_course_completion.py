"""The course-completion rule, and the contribution cap.

The rule is the client's since 2026-09-29: every published lesson watched
(`docs/blockers.md` C1, closed). Before that it was a placeholder we wrote,
and these tests held its properties -- versioned, strict, capped -- rather than
its thresholds, so that replacing it broke only what encoded a decision. The
properties survive; the thresholds below are now the client's.
"""

from __future__ import annotations

import pytest

from app.modules.courses.domain import (
    COMPLETION_RULE_VERSION,
    MAX_COURSE_CONTRIBUTION,
    CourseProgress,
    clamp_contribution,
    evaluate_completion,
    percent_complete,
)


def _progress(done: int, total: int = 10) -> CourseProgress:
    return CourseProgress(lessons_total=total, lessons_completed=done)


# --- the properties that survived the placeholder --------------------------
def test_every_decision_carries_the_rule_version() -> None:
    """A completion moves a score. Two candidates judged under different rules
    are not comparable, and the stored version is what makes that visible."""
    for progress in (_progress(10), _progress(3), _progress(0, total=0)):
        assert evaluate_completion(progress).rule_version == COMPLETION_RULE_VERSION


def test_the_version_names_the_clients_rule_not_the_placeholder() -> None:
    """The provisional rule never recorded a completion; a row stamped with
    this version was judged by the client's rule."""
    assert "provisional" not in COMPLETION_RULE_VERSION
    assert COMPLETION_RULE_VERSION.startswith("lessons-watched-")


def test_a_reason_is_always_a_code_never_a_sentence() -> None:
    """Rendered in the candidate's language, so it cannot be English prose."""
    decision = evaluate_completion(_progress(3))
    assert " " not in decision.reason


# --- every lesson, and nothing less ---------------------------------------
def test_one_lesson_short_does_not_complete() -> None:
    decision = evaluate_completion(_progress(9, total=10))
    assert not decision.complete
    assert decision.reason == "lessons_incomplete"


def test_every_lesson_watched_completes() -> None:
    assert evaluate_completion(_progress(10, total=10)).complete
    assert evaluate_completion(_progress(1, total=1)).complete


def test_a_course_with_no_lessons_never_completes() -> None:
    """Otherwise 0/0 is a division error, or worse, 30 points for nothing."""
    decision = evaluate_completion(_progress(0, total=0))
    assert not decision.complete
    assert decision.reason == "course_has_no_lessons"


def test_the_percentage_rounds_down_so_nearly_done_never_reads_done() -> None:
    assert percent_complete(_progress(0, total=0)) == 0
    assert percent_complete(_progress(1, total=3)) == 33
    assert percent_complete(_progress(299, total=300)) == 99
    assert percent_complete(_progress(3, total=3)) == 100
    assert percent_complete(_progress(5, total=3)) == 100


# --- invariant 4-prime: contributions are bounded -------------------------
@pytest.mark.parametrize("points", [0, 1, 15, 29, 30])
def test_values_within_the_cap_are_unchanged(points: int) -> None:
    assert clamp_contribution(points) == points


@pytest.mark.parametrize("points", [31, 100, 10_000])
def test_nothing_exceeds_the_cap(points: int) -> None:
    assert clamp_contribution(points) == MAX_COURSE_CONTRIBUTION


@pytest.mark.parametrize("points", [-1, -30])
def test_a_negative_contribution_cannot_reduce_a_score(points: int) -> None:
    """Add-ons add. A course that could subtract would be a way to attack
    another candidate's score if a completion were ever mis-attributed."""
    assert clamp_contribution(points) == 0


def test_no_sequence_of_completions_exceeds_the_cap() -> None:
    """Invariant 4-prime as a property: ordering and quantity are irrelevant."""
    for sequence in ([30, 30, 30], [1] * 50, [29, 2], [10, 10, 10, 10]):
        assert all(clamp_contribution(p) <= MAX_COURSE_CONTRIBUTION for p in sequence)
        assert clamp_contribution(sum(sequence)) <= MAX_COURSE_CONTRIBUTION
