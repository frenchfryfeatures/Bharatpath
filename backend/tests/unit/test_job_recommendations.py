"""The home screen's recommended jobs: what they match on, and what they never do.

The ranking itself is pure (`jobs.domain.match`); the database only narrows
the board to jobs sharing a term. Through HTTP in
`tests/integration/test_job_recommendations.py`.
"""

from __future__ import annotations

import dataclasses

from app.modules.candidate.career import CareerDetails, match_terms
from app.modules.jobs.domain import (
    EXPERIENCE_FIT_WEIGHT,
    LOCATION_WEIGHT,
    MAX_TERMS,
    SKILL_WEIGHT,
    TITLE_WORD_WEIGHT,
    MatchTerms,
    match,
    title_words,
)


def _match(terms: MatchTerms, **job: object) -> object:
    fields: dict[str, object] = {
        "title": "",
        "skills": [],
        "location": None,
        "experience_min_months": None,
    }
    return match(terms, **{**fields, **job})  # type: ignore[arg-type]


# --- what a recommendation may be matched on --------------------------------
def test_match_terms_hold_nothing_about_who_someone_is() -> None:
    """Invariant 5 and C3: a ranking that read gender or age would steer who
    sees which jobs by it. Adding a field here is a product decision."""
    assert {f.name for f in dataclasses.fields(MatchTerms)} == {
        "skills",
        "title_words",
        "locations",
        "experience_months",
    }


def test_the_profile_terms_ignore_gender_and_salary() -> None:
    base = CareerDetails(key_skills=["Python"], job_role="Backend Developer")
    varied = base.model_copy(
        update={"gender": "FEMALE", "preferred_salary": 9_00_000, "annual_salary": 5_00_000}
    )
    assert match_terms(base) == match_terms(varied)


def test_the_profile_terms_read_skills_roles_places_and_experience() -> None:
    details = CareerDetails(
        work_status="EXPERIENCED",
        experience_years=3,
        experience_months=4,
        key_skills=[" Python ", "SQL", "python"],
        job_role="Data Engineer",
        job_title="Software Developer",
        preferred_locations=["Pune"],
        current_city="Nagpur",
    )
    terms = match_terms(details)
    assert terms.skills == {"python", "sql"}
    assert terms.title_words == {"data", "engineer", "software", "developer"}
    assert terms.locations == {"pune", "nagpur"}
    assert terms.experience_months == 40


def test_a_fresher_has_no_experience_and_an_unanswered_form_has_none_known() -> None:
    assert match_terms(CareerDetails(work_status="FRESHER")).experience_months == 0
    assert match_terms(CareerDetails()).experience_months is None


def test_the_profile_city_stands_in_for_an_unfilled_current_city() -> None:
    assert match_terms(CareerDetails(), city="Indore").locations == {"indore"}


def test_an_empty_profile_is_no_basis() -> None:
    assert match_terms(CareerDetails(preferred_locations=["Pune"])).is_empty
    assert not match_terms(CareerDetails(key_skills=["Excel"])).is_empty
    assert not match_terms(CareerDetails(job_role="Accountant")).is_empty


def test_terms_are_capped_keeping_the_first() -> None:
    terms = MatchTerms.build(skills=[f"skill{i}" for i in range(MAX_TERMS + 10)])
    assert len(terms.skills) == MAX_TERMS
    assert "skill0" in terms.skills and f"skill{MAX_TERMS}" not in terms.skills


# --- title words ------------------------------------------------------------
def test_title_words_drop_noise_and_punctuation() -> None:
    assert title_words("Sr. Java Developer (Remote) - Urgent Hiring!") == {"java", "developer"}


def test_title_words_are_safe_inside_a_regular_expression() -> None:
    """They go into the database's `\\m(...)\\M` unescaped."""
    for word in title_words("C++ / C# .NET (Node.js) [ops]* a|b $x ^y"):
        assert word.isalnum(), word


# --- the match ---------------------------------------------------------------
def test_a_job_sharing_neither_a_skill_nor_a_title_word_is_not_a_match() -> None:
    terms = MatchTerms.build(skills=["Python"], locations=["Pune"], experience_months=24)
    assert _match(terms, title="Welder", skills=["TIG welding"], location="Pune") is None


def test_relevance_adds_up_the_signals() -> None:
    terms = MatchTerms.build(
        skills=["python", "sql"],
        titles=["Data Engineer"],
        locations=["pune"],
        experience_months=24,
    )
    found = _match(
        terms,
        title="Data Engineer",
        skills=["Python", "SQL", "Spark"],
        location="Pune, Maharashtra",
        experience_min_months=12,
    )
    assert found is not None
    assert found.relevance == (  # type: ignore[attr-defined]
        2 * SKILL_WEIGHT + 2 * TITLE_WORD_WEIGHT + LOCATION_WEIGHT + EXPERIENCE_FIT_WEIGHT
    )
    assert found.matched_skills == ("Python", "SQL")  # type: ignore[attr-defined]


def test_matched_skills_keep_the_jobs_spelling_once() -> None:
    terms = MatchTerms.build(skills=["python"])
    found = _match(terms, skills=["Python", "PYTHON ", "Go"])
    assert found.matched_skills == ("Python", "PYTHON ")  # type: ignore[attr-defined]
    assert found.relevance == SKILL_WEIGHT  # type: ignore[attr-defined]


def test_experience_fits_only_when_known_and_enough() -> None:
    terms = MatchTerms.build(skills=["python"], experience_months=12)
    fits = _match(terms, skills=["Python"], experience_min_months=12)
    short = _match(terms, skills=["Python"], experience_min_months=36)
    assert fits.relevance == SKILL_WEIGHT + EXPERIENCE_FIT_WEIGHT  # type: ignore[attr-defined]
    assert short.relevance == SKILL_WEIGHT  # type: ignore[attr-defined]
    unknown = MatchTerms.build(skills=["python"])
    assert _match(unknown, skills=["Python"]).relevance == SKILL_WEIGHT  # type: ignore[attr-defined]


def test_the_match_never_reads_a_threshold() -> None:
    """The order never sorts jobs a score clears above ones it does not: that
    is the gap R11 rules out, drawn as a list."""
    import inspect

    assert "min_score" not in inspect.signature(match).parameters
