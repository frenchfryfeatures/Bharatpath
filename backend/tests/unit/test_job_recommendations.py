"""The home screen's recommended jobs: what they match on, and what they never do.

The ranking itself is pure (`jobs.domain.match`); the database only narrows
the board to jobs sharing a term. Through HTTP in
`tests/integration/test_job_recommendations.py`.
"""

from __future__ import annotations

import dataclasses

import pytest

from app.modules.candidate.career import CareerDetails, match_terms
from app.modules.jobs.domain import (
    DEFAULT_MATCH_WEIGHTS,
    MAX_TERMS,
    JobFacts,
    MatchTerms,
    MatchWeightsError,
    match,
    match_weights_document,
    match_weights_from_config,
    score_job,
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
    sees which jobs by it. Adding a field here is a product decision; the
    2026-11-23 job engine added preferences (salary wanted, industry),
    education level and whether they are a fresher -- never gender, age,
    college or current pay."""
    assert {f.name for f in dataclasses.fields(MatchTerms)} == {
        "skills",
        "title_words",
        "locations",
        "experience_months",
        "implied_title_words",
        "preferred_annual_salary_minor",
        "industries",
        "education_level",
        "fresher",
        "work_modes",
        "job_types",
        "open_to_relocation",
    }


def test_the_profile_terms_ignore_gender_and_current_pay() -> None:
    base = CareerDetails(key_skills=["Python"], job_role="Backend Developer")
    varied = base.model_copy(update={"gender": "FEMALE", "annual_salary": 5_00_000})
    assert match_terms(base) == match_terms(varied)


def test_only_a_rupee_salary_preference_is_read_and_never_converted() -> None:
    inr = CareerDetails(key_skills=["Python"], preferred_salary=6_00_000)
    usd = inr.model_copy(update={"preferred_salary_currency": "USD"})
    assert match_terms(inr).preferred_annual_salary_minor == 6_00_000 * 100
    assert match_terms(usd).preferred_annual_salary_minor is None


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


def _job(**fields: object) -> JobFacts:
    return JobFacts(**{"title": "", **fields})  # type: ignore[arg-type]


def test_a_fuller_match_ranks_above_a_thinner_one() -> None:
    terms = MatchTerms.build(
        skills=["python", "sql"], titles=["Data Engineer"], locations=["pune"], experience_months=24
    )
    strong = score_job(
        terms,
        _job(
            title="Data Engineer",
            skills=["Python", "SQL"],
            location="Pune",
            experience_min_months=12,
        ),
    )
    weak = score_job(
        terms,
        _job(
            title="Data Engineer",
            skills=["Python", "SQL", "Spark", "Scala"],
            location="Delhi",
            experience_min_months=60,
        ),
    )
    assert strong is not None and weak is not None
    assert strong.relevance > weak.relevance
    assert {"STRONG_SKILLS_MATCH", "ROLE_MATCH", "PREFERRED_LOCATION", "EXPERIENCE_FITS"} <= set(
        strong.reasons
    )


def test_the_same_job_ranks_differently_for_different_people() -> None:
    backend = _job(
        title="Backend Engineer", skills=["Python", "FastAPI", "PostgreSQL"], location="Bengaluru"
    )
    frontend = _job(title="Frontend Engineer", skills=["React", "TypeScript"], location="Pune")
    a = MatchTerms.build(skills=["python", "postgres", "fastapi"], locations=["bengaluru"])
    b = MatchTerms.build(skills=["reactjs", "typescript", "python"], locations=["pune"])

    def rank(terms: MatchTerms) -> list[JobFacts]:
        def relevance(job: JobFacts) -> int:
            found = score_job(terms, job)
            return found.relevance if found else -1

        return sorted([backend, frontend], key=relevance, reverse=True)

    assert rank(a)[0] is backend
    assert rank(b)[0] is frontend


def test_skills_imply_a_role_the_candidate_never_named() -> None:
    """Python, FastAPI and PostgreSQL make a backend candidate."""
    terms = MatchTerms.build(skills=["Python", "FastAPI", "PostgreSQL"])
    assert "backend" in terms.implied_title_words
    found = score_job(terms, _job(title="Backend Developer", skills=[]))
    assert found is not None and found.relevance > 0
    assert "ROLE_MATCH" not in found.reasons  # implied, not chosen


def test_synonyms_are_one_skill() -> None:
    terms = MatchTerms.build(skills=["JS", "Postgres", "ReactJS"])
    found = score_job(terms, _job(title="X", skills=["JavaScript", "PostgreSQL", "React"]))
    assert found is not None
    assert found.matched_skills == ("JavaScript", "PostgreSQL", "React")


def test_missing_optional_fields_do_not_penalise() -> None:
    """A job that says nothing about salary or education scores the same
    whether or not the candidate filled those in."""
    job = _job(title="Accountant", skills=["Tally", "GST"])
    bare = MatchTerms.build(skills=["tally", "gst"], titles=["Accountant"])
    full = MatchTerms.build(
        skills=["tally", "gst"],
        titles=["Accountant"],
        preferred_annual_salary_minor=50_00_000,
        education_level=4,
    )
    assert score_job(bare, job).relevance == score_job(full, job).relevance  # type: ignore[union-attr]


def test_salary_below_the_preference_ranks_lower() -> None:
    terms = MatchTerms.build(skills=["sql"], preferred_annual_salary_minor=6_00_000 * 100)
    pays = score_job(terms, _job(title="Analyst", skills=["SQL"], salary_max_minor=60_000 * 100))
    short = score_job(terms, _job(title="Analyst", skills=["SQL"], salary_max_minor=20_000 * 100))
    assert pays is not None and short is not None
    assert "SALARY_FITS" in pays.reasons and pays.relevance > short.relevance


def test_remote_jobs_fit_any_location() -> None:
    terms = MatchTerms.build(skills=["python"], locations=["indore"])
    found = score_job(
        terms, _job(title="Dev", skills=["Python"], location="Mumbai", work_mode="REMOTE")
    )
    assert found is not None and "REMOTE" in found.reasons


def test_relevance_stays_between_0_and_100() -> None:
    terms = MatchTerms.build(
        skills=["python"],
        titles=["Developer"],
        experience_months=0,
        fresher=True,
        education_level=4,
        industries=["IT"],
        preferred_annual_salary_minor=1,
        locations=["pune"],
    )
    found = score_job(
        terms,
        _job(
            title="Python Developer",
            skills=["Python"],
            location="Pune",
            experience_min_months=0,
            description="python developer",
            salary_max_minor=10**9,
            industry="IT",
            minimum_education="GRADUATE",
            job_type="INTERNSHIP",
        ),
    )
    assert found is not None and 0 <= found.relevance <= 100
    assert found.relevance >= 80


def test_matched_skills_keep_the_jobs_spelling_once() -> None:
    terms = MatchTerms.build(skills=["python"])
    found = match(
        terms,
        title="",
        skills=["Python", "PYTHON ", "Go"],
        location=None,
        experience_min_months=None,
    )
    assert found is not None
    assert found.matched_skills == ("Python", "PYTHON ")


def test_the_weights_document_round_trips_and_is_strict() -> None:
    document = match_weights_document()
    assert match_weights_from_config(document) == DEFAULT_MATCH_WEIGHTS
    for bad in (
        {**document, "gender": 5},
        {**document, "skills": -1},
        {**document, "skills": True},
        dict.fromkeys(document, 0),
        {"skills": 1},
    ):
        with pytest.raises(MatchWeightsError):
            match_weights_from_config(bad)


def test_the_match_never_reads_a_threshold() -> None:
    """The order never sorts jobs a score clears above ones it does not: that
    is the gap R11 rules out, drawn as a list."""
    import inspect

    assert "min_score" not in inspect.signature(match).parameters
