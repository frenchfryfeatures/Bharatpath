"""Unit tests for the main Jobs tab multi-parameter re-ranking engine."""

from __future__ import annotations

import pytest

from app.modules.jobs.domain import (
    DEFAULT_MATCH_WEIGHTS,
    JobFacts,
    MatchTerms,
    applied_behavior_weight,
    recency_bonus,
    rerank_board_score,
)


def test_adaptive_behavior_weight_ramps_and_saturates() -> None:
    assert applied_behavior_weight(0) == 0.0
    assert applied_behavior_weight(1) == pytest.approx(0.07)
    assert applied_behavior_weight(5) == pytest.approx(0.35)
    assert applied_behavior_weight(12) == pytest.approx(0.35)


def test_recency_bonus_decays_linearly_over_30_days() -> None:
    assert recency_bonus(0.0) == 5.0
    assert recency_bonus(15.0) == 2.5
    assert recency_bonus(30.0) == 0.0
    assert recency_bonus(60.0) == 0.0


def test_preferences_rank_matching_job_above_unrelated_job() -> None:
    profile_terms = MatchTerms.build(
        skills=["Python", "FastAPI", "PostgreSQL"],
        titles=["Backend Developer"],
        locations=["Noida", "Bengaluru"],
        work_modes=["HYBRID", "REMOTE"],
        job_types=["FULL_TIME"],
        preferred_annual_salary_minor=12_00_000 * 100,
        industries=["Technology"],
        experience_months=24,
    )
    strong_job = JobFacts(
        title="Backend Developer (Python)",
        skills=["Python", "FastAPI", "PostgreSQL"],
        location="Noida",
        work_mode="HYBRID",
        job_type="FULL_TIME",
        salary_max_minor=14_00_000 * 100,
        salary_period="YEARLY",
        industry="Technology",
        experience_min_months=12,
        experience_max_months=36,
    )
    unrelated_job = JobFacts(
        title="Branch Sales Executive",
        skills=["Field Sales", "Cold Calling"],
        location="Jaipur",
        work_mode="ONSITE",
        job_type="FULL_TIME",
    )

    s_strong = rerank_board_score(
        strong_job, profile_terms=profile_terms, applied_terms=None, applied_count=0, age_days=5
    )
    s_unrelated = rerank_board_score(
        unrelated_job, profile_terms=profile_terms, applied_terms=None, applied_count=0, age_days=0
    )
    assert s_strong > s_unrelated
    # Unrelated jobs still get a positive recency score (never dropped from browse).
    assert s_unrelated == 5.0


def test_applied_jobs_continuously_shift_reranking_score() -> None:
    profile_terms = MatchTerms.build(
        skills=["Python", "SQL"],
        titles=["Software Engineer"],
        locations=["Bengaluru"],
    )
    applied_terms = MatchTerms.build(
        skills=["React Native", "TypeScript", "Mobile"],
        titles=["Mobile App Developer"],
        locations=["Bengaluru"],
        work_modes=["REMOTE"],
    )
    mobile_job = JobFacts(
        title="Mobile App Developer",
        skills=["React Native", "TypeScript"],
        location="Bengaluru",
        work_mode="REMOTE",
    )

    # With 0 applications, only profile_terms applies (0 match on mobile_job).
    score_0 = rerank_board_score(
        mobile_job,
        profile_terms=profile_terms,
        applied_terms=applied_terms,
        applied_count=0,
        age_days=10,
        weights=DEFAULT_MATCH_WEIGHTS,
    )
    # With 2 applications, behavioral weight alpha(2) = 0.14 lifts mobile_job.
    score_2 = rerank_board_score(
        mobile_job,
        profile_terms=profile_terms,
        applied_terms=applied_terms,
        applied_count=2,
        age_days=10,
        weights=DEFAULT_MATCH_WEIGHTS,
    )
    # With 5 applications, behavioral weight alpha(5) = 0.35 lifts mobile_job further.
    score_5 = rerank_board_score(
        mobile_job,
        profile_terms=profile_terms,
        applied_terms=applied_terms,
        applied_count=5,
        age_days=10,
        weights=DEFAULT_MATCH_WEIGHTS,
    )
    assert score_0 < score_2 < score_5
