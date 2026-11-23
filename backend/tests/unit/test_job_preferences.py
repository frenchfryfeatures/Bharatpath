"""The profile's Preferences tab (2026-11-23): what is stored, what is never
asked, and how each answer moves the job engine's ranking."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.modules.candidate.career import CareerDetails, match_terms
from app.modules.candidate.career_service import KEPT_CAREER_BLOCKS, _kept_blocks
from app.modules.candidate.preferences import (
    JobPreferences,
    PreferencesPayload,
    stored_preferences,
)
from app.modules.jobs.domain import JobFacts, MatchTerms, score_job


def test_preferences_ask_nothing_about_who_someone_is() -> None:
    """Invariant 5 / C3: nothing here could steer who sees which job."""
    asked = set(PreferencesPayload.model_fields)
    assert asked == {
        "preferred_roles",
        "preferred_industries",
        "work_modes",
        "job_types",
        "open_to_relocation",
        "preferred_locations",
        "preferred_salary",
        "preferred_salary_currency",
    }
    # The exact list above is the guarantee; these spot-check the usual suspects.
    for forbidden in ("gender", "marital_status", "annual_salary"):
        assert forbidden not in asked


def test_choices_are_trimmed_deduplicated_and_capped() -> None:
    prefs = JobPreferences(
        preferred_roles=[" Data Analyst ", "data analyst", "Accountant"],
        work_modes=["REMOTE", "REMOTE", "HYBRID"],
    )
    assert prefs.preferred_roles == ["Data Analyst", "Accountant"]
    assert prefs.work_modes == ["REMOTE", "HYBRID"]
    with pytest.raises(ValidationError):
        JobPreferences(preferred_roles=[f"Role {i}" for i in range(6)])
    with pytest.raises(ValidationError):
        JobPreferences(work_modes=["ANYWHERE"])  # type: ignore[list-item]


def test_a_missing_or_malformed_block_reads_as_no_preference() -> None:
    assert stored_preferences(None) == JobPreferences()
    assert stored_preferences({"preferences": "nonsense"}) == JobPreferences()
    assert stored_preferences({"preferences": {"work_modes": ["MOON"]}}) == JobPreferences()


def test_saving_the_onboarding_form_keeps_the_preferences() -> None:
    """Every writer of `career` rebuilds it; the block must ride along."""

    from types import SimpleNamespace

    profile = SimpleNamespace(
        career={"details": {}, "preferences": {"work_modes": ["REMOTE"]}, "completed": True}
    )
    assert "preferences" in KEPT_CAREER_BLOCKS
    assert _kept_blocks(profile) == {"preferences": {"work_modes": ["REMOTE"]}}  # type: ignore[arg-type]
    assert _kept_blocks(None) == {}


def test_preferred_roles_and_industries_lead_the_terms() -> None:
    details = CareerDetails(key_skills=["SQL"], job_role="Clerk", industry="Retail")
    terms = match_terms(
        details,
        preferences=JobPreferences(
            preferred_roles=["Data Analyst"], preferred_industries=["Banking"]
        ),
    )
    assert {"data", "analyst", "clerk"} <= terms.title_words
    assert {"banking", "retail"} <= terms.industries


def _job(**fields: object) -> JobFacts:
    return JobFacts(**{"title": "Analyst", "skills": ["SQL"], **fields})  # type: ignore[arg-type]


def test_a_chosen_work_mode_ranks_above_another() -> None:
    terms = MatchTerms.build(skills=["sql"], work_modes=["HYBRID"])
    hybrid = score_job(terms, _job(work_mode="HYBRID"))
    onsite = score_job(terms, _job(work_mode="ONSITE"))
    assert hybrid and onsite and hybrid.relevance > onsite.relevance
    assert "WORK_MODE_MATCH" in hybrid.reasons


def test_a_chosen_job_type_ranks_above_another() -> None:
    terms = MatchTerms.build(skills=["sql"], job_types=["INTERNSHIP"])
    internship = score_job(terms, _job(job_type="INTERNSHIP"))
    contract = score_job(terms, _job(job_type="CONTRACT"))
    assert internship and contract and internship.relevance > contract.relevance
    assert "JOB_TYPE_MATCH" in internship.reasons


def test_relocation_softens_a_place_that_is_not_preferred() -> None:
    staying = MatchTerms.build(skills=["sql"], locations=["pune"])
    moving = MatchTerms.build(skills=["sql"], locations=["pune"], open_to_relocation=True)
    job = _job(location="Delhi", work_mode="ONSITE")
    assert score_job(moving, job).relevance > score_job(staying, job).relevance  # type: ignore[union-attr]


def test_no_preference_changes_nothing() -> None:
    """An empty tab must rank exactly as before it existed."""
    details = CareerDetails(key_skills=["SQL"], job_role="Analyst", preferred_locations=["Pune"])
    assert match_terms(details) == match_terms(details, preferences=JobPreferences())
