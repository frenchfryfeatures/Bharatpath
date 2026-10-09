"""Layer 2, content addressing, bands and the display floor.

All pure. These are the parts of scoring that decide what a score *is* before
any database is involved, so they are cheap to pin exhaustively — including
the malformed-extraction cases that only arise years later, when a stored
extraction outlives the schema that validated it.
"""

from __future__ import annotations

from itertools import pairwise

import pytest
from pydantic import ValidationError

from app.modules.scoring.domain import (
    BANDS,
    BASE_SCORE,
    MAX_SCORE,
    band_for,
    canonical_qualification,
    canonical_seniority,
    display_value,
    extraction_cache_key,
    features_from_extraction,
    normalise_for_cache,
)
from app.modules.scoring.extractor import (
    EXTRACTION_PROMPT,
    PROMPT_VERSION,
    SCHEMA_VERSION,
    ExtractedResume,
    prompt_hash,
)

KEY = {"model_id": "m1", "prompt_version": "p1", "schema_version": "s1"}


# --- content addressing ----------------------------------------------------
def test_the_same_cv_always_lands_on_the_same_key() -> None:
    assert extraction_cache_key(text="Priya Sharma, engineer", **KEY) == extraction_cache_key(
        text="Priya Sharma, engineer", **KEY
    )


def test_whitespace_and_unicode_differences_do_not_split_the_cache() -> None:
    """The same CV re-uploaded as a DOCX instead of a PDF is the same CV.

    Different spacing and non-breaking spaces are the same words to a reader
    and different bytes to a hash — and two cache entries would mean two model
    calls and, worse, two scores that could differ for one document.
    """
    # The no-break space below is written as an escape, not pasted: it is
    # invisible in a diff, and this test exists precisely because of it.
    pdf_ish = "Priya  Sharma\n\nSenior\u00a0 Engineer"
    docx_ish = "Priya Sharma Senior Engineer"
    assert extraction_cache_key(text=pdf_ish, **KEY) == extraction_cache_key(text=docx_ish, **KEY)


def test_case_is_kept() -> None:
    """A CV in block capitals is a different document to a model. Folding case
    would merge two extractions that legitimately differ."""
    assert extraction_cache_key(text="priya sharma", **KEY) != extraction_cache_key(
        text="PRIYA SHARMA", **KEY
    )


@pytest.mark.parametrize("field", ["model_id", "prompt_version", "schema_version"])
def test_every_component_that_could_change_the_output_is_in_the_key(field: str) -> None:
    """**The one way this cache could corrupt a score rather than merely miss.**

    Leaving any component out would serve an extraction produced by a
    different model, or a different prompt, as though it were this one's.
    """
    changed = {**KEY, field: "different"}
    assert extraction_cache_key(text="same cv", **KEY) != extraction_cache_key(
        text="same cv", **changed
    )


def test_two_candidates_with_identical_text_share_one_entry() -> None:
    """Not the resume id and not the user id — that is the whole design.
    Cross-candidate consistency becomes exact rather than probabilistic."""
    assert extraction_cache_key(text="identical CV body", **KEY) == extraction_cache_key(
        text="identical CV body", **KEY
    )


def test_normalising_is_idempotent() -> None:
    once = normalise_for_cache("  a   b \n c  ")
    assert normalise_for_cache(once) == once


# --- Layer 2: the canonical vocabularies ----------------------------------
@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Senior Software Engineer", "senior"),
        ("Sr. Developer", "senior"),
        ("Team Lead", "lead"),
        ("Engineering Manager", "lead"),
        ("Principal Architect", "principal"),
        ("Chief Technology Officer", "executive"),
        ("Head of Operations", "executive"),
        ("Vice President, Sales", "executive"),
        ("Intern", "intern"),
        ("Summer Apprentice", "intern"),
    ],
)
def test_real_indian_cv_titles_resolve(title: str, expected: str) -> None:
    assert canonical_seniority(title) == expected


def test_an_unrecognised_title_is_unknown_rather_than_guessed() -> None:
    """**Guessing is how a scoring system starts rewarding inflated titles.**
    `unknown` scores zero, which is the safe direction to be wrong in."""
    assert canonical_seniority("Ninja Rockstar Guru") == "unknown"
    assert canonical_seniority("") == "unknown"
    assert canonical_seniority(None) == "unknown"


def test_longest_match_wins_so_a_prefix_never_shadows() -> None:
    """ "Senior Vice President" is an executive, not a senior."""
    assert canonical_seniority("Senior Vice President") == "executive"


@pytest.mark.parametrize(
    ("qualification", "expected"),
    [
        ("B.Tech Computer Science", "bachelor"),
        ("BE Mechanical", "bachelor"),
        ("B.Com", "bachelor"),
        ("MBA Finance", "master"),
        ("M.Tech", "master"),
        ("PhD Physics", "doctorate"),
        ("ITI Fitter", "diploma"),
        ("Polytechnic Diploma", "diploma"),
        ("HSC", "secondary"),
        ("12th Standard", "secondary"),
    ],
)
def test_indian_qualifications_resolve(qualification: str, expected: str) -> None:
    """Named explicitly rather than approximated from western equivalents —
    a B.Tech, a BE and an ITI diploma are what this market's CVs say."""
    assert canonical_qualification(qualification) == expected


def test_an_already_canonical_value_passes_through() -> None:
    """Layer 2 runs again on every replay, over features it normalised months
    ago. A second pass must be a no-op, not a second round of guessing."""
    for level in ("senior", "executive", "unknown"):
        assert canonical_seniority(level) == level
    for level in ("bachelor", "doctorate", "unknown"):
        assert canonical_qualification(level) == level


# --- Layer 2: deriving features -------------------------------------------
def test_experience_is_summed_from_the_roles_not_taken_on_trust() -> None:
    """The roles are checkable and the model's own total is not. A model that
    miscounts its arithmetic must not be able to move a score by 55 points."""
    features = features_from_extraction(
        {
            "total_experience_months": 9999,
            "roles": [{"months": 24, "seniority_level": "mid"}, {"months": 12}],
        }
    )
    assert features.total_experience_months == 36


def test_the_highest_seniority_reached_wins_not_the_most_recent() -> None:
    features = features_from_extraction(
        {
            "roles": [
                {"months": 60, "seniority_level": "Head of Engineering"},
                {"months": 12, "seniority_level": "Consultant"},
            ]
        }
    )
    assert features.highest_seniority == "executive"


def test_repeated_skills_count_once_at_their_best_evidence() -> None:
    """A CV listing Python under three roles is not three skills — and the
    band table counts distinct ones."""
    features = features_from_extraction(
        {
            "skills": [
                {"canonical_name": "Python", "evidence_strength": 1},
                {"canonical_name": "python", "evidence_strength": 4},
                {"canonical_name": "SQL", "evidence_strength": 2},
            ]
        }
    )
    assert features.skill_count == 2
    assert features.skill_evidence == 3  # mean of 4 and 2


def test_skill_evidence_rounds_down() -> None:
    """One well-evidenced skill beside nine bare keywords is mostly a keyword
    list. Rounding up would pay for the keywords."""
    features = features_from_extraction(
        {
            "skills": [
                {"canonical_name": "a", "evidence_strength": 4},
                {"canonical_name": "b", "evidence_strength": 1},
            ]
        }
    )
    assert features.skill_evidence == 2  # 5 // 2


@pytest.mark.parametrize(
    "extracted",
    [
        {},
        {"roles": "not a list"},
        {"roles": [None, "nonsense", {"months": "twelve"}]},
        {"skills": [{"canonical_name": ""}, {"no_name": 1}]},
        {"education": [{"qualification_level": None}]},
        {"role_progression": "high", "achievement_specificity": None},
        {"role_progression": True},
        {"certifications": "AWS"},
    ],
)
def test_a_malformed_extraction_degrades_instead_of_raising(extracted: dict) -> None:
    """**A replay that throws cannot answer a dispute**, which is the one
    thing it exists to do. Stored extractions outlive the schema that
    validated them, so every field is derived defensively."""
    features = features_from_extraction(extracted)
    assert features.total_experience_months >= 0
    assert 0 <= features.role_progression <= 4


def test_ordinals_are_clamped_even_though_the_schema_bounds_them() -> None:
    features = features_from_extraction({"role_progression": 99, "scope_of_responsibility": -3})
    assert features.role_progression == 4
    assert features.scope_of_responsibility == 0


# --- Layer 1 contract ------------------------------------------------------
def test_the_extraction_schema_cannot_carry_a_score() -> None:
    """**By construction, not by instruction.** The model is never asked for a
    total and could not return one: `extra="forbid"` makes an invented field a
    validation failure."""
    forbidden = {"score", "total", "rating", "points", "band", "value"}
    assert not (set(ExtractedResume.model_fields) & forbidden)

    with pytest.raises(ValidationError):
        ExtractedResume.model_validate({"score": 880})


def test_the_prompt_forbids_the_model_from_recording_protected_attributes() -> None:
    """Invariant 5, and wider.

    The *schema* cannot carry these: `scripts/check_no_age_fields.py` already
    proves no such field exists anywhere in the repository, `extractor.py`
    included, and `extra="forbid"` stops one arriving unannounced. What is
    left is the model volunteering them inside a field that legitimately
    holds free text — a job title, a field of study — so the prompt refuses
    them by name.

    The list is deliberately wider than age. Caste and religion are not
    invariant 5, but scoring on them would be the same class of harm, and a
    CV in this market often states them.
    """
    for attribute in ("age", "date of birth", "gender", "religion", "caste", "marital status"):
        assert attribute in EXTRACTION_PROMPT.lower(), (
            f"the prompt should tell the model to omit {attribute!r}"
        )


def test_the_prompt_tells_the_model_the_cv_is_data() -> None:
    """Belt and braces beside the schema (scoring-approach.md section 9). The
    schema is the real defence — a model that cannot return prose cannot obey
    an instruction written into a CV — but the directive costs nothing."""
    lowered = EXTRACTION_PROMPT.lower()
    assert "data, not instructions" in lowered
    assert "follow only these instructions" in lowered


def test_the_prompt_hash_moves_when_the_prompt_does() -> None:
    """`prompt_version` is a label a human maintains and can forget to bump.
    This is computed and cannot be, so a replay comparing both can tell an
    intentional change from one somebody made without moving the version."""
    import app.modules.scoring.extractor as ex

    original = ex.EXTRACTION_PROMPT
    before = prompt_hash()
    try:
        ex.EXTRACTION_PROMPT = original + "\nAlso rate their potential."
        assert prompt_hash() != before
    finally:
        ex.EXTRACTION_PROMPT = original
    assert prompt_hash() == before


def test_the_cache_key_components_are_versioned_strings() -> None:
    """Both must exist and both must be non-empty: an empty version string
    would silently collapse two different prompts onto one cache key."""
    assert isinstance(PROMPT_VERSION, str) and PROMPT_VERSION.strip()
    assert isinstance(SCHEMA_VERSION, str) and SCHEMA_VERSION.strip()


# --- bands and the display floor ------------------------------------------
def test_the_bands_cover_the_whole_scale_without_gaps_or_overlaps() -> None:
    """A gap would leave a real score with no band, and the band is what an
    employer sees — employers never see the raw number (R4)."""
    assert BANDS[0][1] == BASE_SCORE
    assert BANDS[-1][2] == MAX_SCORE
    for (_, _, prev_high), (_, next_low, _) in pairwise(BANDS):
        assert next_low == prev_high + 1


def test_strong_reaches_990_not_900() -> None:
    """900 is the resume-only ceiling. Stopping STRONG there would leave every
    candidate who bought an add-on in no band at all."""
    assert band_for(990) == "STRONG"
    assert band_for(901) == "STRONG"


def test_every_score_in_range_has_exactly_one_band() -> None:
    for value in range(BASE_SCORE, MAX_SCORE + 1):
        matches = [label for label, low, high in BANDS if low <= value <= high]
        assert len(matches) == 1, f"{value} matched {matches}"


def test_a_band_lookup_never_raises_at_a_serialization_boundary() -> None:
    """A display path that throws turns a bad number into a 500 for a
    candidate who did nothing wrong."""
    assert band_for(1) == "ENTRY"
    assert band_for(10_000) == "STRONG"


def test_the_display_floor_never_alters_a_real_score() -> None:
    """Invariant 2: stored == displayed, in every case the arithmetic can
    actually produce. The floor exists for the case that would be a bug."""
    for value in range(BASE_SCORE, MAX_SCORE + 1):
        assert display_value(value) == value


def test_the_floor_only_bites_below_the_base() -> None:
    assert display_value(699) == BASE_SCORE
    assert display_value(0) == BASE_SCORE
