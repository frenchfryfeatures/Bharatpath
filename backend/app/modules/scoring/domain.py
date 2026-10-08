"""scoring - pure domain logic

Engine interface, versions, history, breakdown.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.

**This is Layer 3 of `docs/scoring-approach.md` §4: the model reads, code
scores.** Everything here is a pure function of facts the extractor produced.
The model never sees these weights and never learns what its ratings are worth,
so it cannot aim at a target score -- and neither can anyone writing
instructions into a CV.

The arithmetic was fixed by the client and is not ours to change:

    700 base + 0-200 resume + 30 course + 60 interviews = 990 exactly

Only the 0-200 resume band is defined here. The client delegated its shape to
us on 2026-09-11.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Final

#: Bump on any change that alters output. Stored on every score row, so a
#: candidate whose score moves can be told which version moved it, and a
#: replay can reproduce the number the rubric produced at the time.
RUBRIC_VERSION: Final = "v1-2026-09-11"

#: Layer 2. Bump when the mapping from a Layer 1 extraction onto
#: `ResumeFeatures` changes in a way that alters output -- a new seniority
#: synonym, a different rounding rule. Stored on every score, because a score
#: is only reproducible if the *normalisation* that produced its features is
#: identifiable too, not just the model and the weights.
TAXONOMY_VERSION: Final = "v1-2026-09-12"

BASE_SCORE: Final = 700
MAX_RESUME_POINTS: Final = 200
MAX_SCORE: Final = 990

#: Category ceilings. These sum to exactly MAX_RESUME_POINTS, asserted below
#: rather than trusted -- a rubric whose parts do not add up to its whole is
#: the kind of error that produces plausible wrong numbers for months.
CATEGORY_CAPS: Final[dict[str, int]] = {
    "experience_depth": 55,
    "role_progression": 45,
    "skills": 40,
    "achievements": 35,
    "education": 25,
}

assert sum(CATEGORY_CAPS.values()) == MAX_RESUME_POINTS, "rubric categories must sum to 200"


# ---------------------------------------------------------------------------
# Band tables
# ---------------------------------------------------------------------------
# Bands, not formulas, deliberately (`scoring-approach.md` §7). Extraction
# wobbles: the same CV read twice may yield 47 or 48 months. A band absorbs
# that before it reaches the score, so two runs agree. A continuous curve
# would turn every extraction wobble into a score change.

#: (inclusive lower bound in months, points)
EXPERIENCE_BANDS: Final[tuple[tuple[int, int], ...]] = (
    (240, 55),  # 20 years or more
    (120, 50),  # 10-20
    (72, 42),  # 6-10
    (36, 32),  # 3-6
    (12, 20),  # 1-3
    (1, 8),  # under a year
    (0, 0),  # no recorded experience
)

#: Highest seniority actually reached. A title is evidence, not proof, which
#: is why this is worth less than half the category on its own.
SENIORITY_POINTS: Final[dict[str, int]] = {
    "executive": 25,
    "principal": 23,
    "lead": 20,
    "senior": 16,
    "mid": 11,
    "junior": 5,
    "intern": 2,
    "unknown": 0,
}

#: Distinct canonical skills. Breadth past a dozen says little -- a CV listing
#: forty skills is a keyword list, not a wider engineer -- so this flattens.
SKILL_COUNT_BANDS: Final[tuple[tuple[int, int], ...]] = (
    (13, 20),
    (8, 17),
    (4, 12),
    (1, 6),
    (0, 0),
)

QUALIFICATION_POINTS: Final[dict[str, int]] = {
    "doctorate": 18,
    "master": 16,
    "bachelor": 13,
    "diploma": 8,
    "secondary": 4,
    "none": 0,
    "unknown": 0,
}

CERTIFICATION_BANDS: Final[tuple[tuple[int, int], ...]] = ((3, 7), (1, 3), (0, 0))

#: 0-4 ordinal ratings from Layer 1, mapped to points. Lookup tables rather
#: than multiplication so the curve is visible and adjustable per dimension.
PROGRESSION_POINTS: Final[tuple[int, ...]] = (0, 5, 10, 15, 20)
EVIDENCE_POINTS: Final[tuple[int, ...]] = (0, 5, 10, 15, 20)
SPECIFICITY_POINTS: Final[tuple[int, ...]] = (0, 5, 10, 15, 20)
SCOPE_POINTS: Final[tuple[int, ...]] = (0, 4, 8, 11, 15)


@dataclass(frozen=True, slots=True)
class ResumeFeatures:
    """What Layer 2 hands to Layer 3. Facts and bounded ratings only."""

    total_experience_months: int = 0
    highest_seniority: str = "unknown"
    role_progression: int = 0  # 0-4
    skill_count: int = 0
    skill_evidence: int = 0  # 0-4, average evidence strength
    achievement_specificity: int = 0  # 0-4
    scope_of_responsibility: int = 0  # 0-4
    highest_qualification: str = "unknown"
    certification_count: int = 0


@dataclass(frozen=True, slots=True)
class ResumeScore:
    points: int
    breakdown: dict[str, int]
    rubric_version: str = RUBRIC_VERSION


@dataclass(frozen=True, slots=True)
class AddOnContributions:
    """Points from things bought rather than demonstrated.

    Separated from the resume score because invariant 4-prime bounds them
    independently, and because a dispute about a course is a different
    conversation from a dispute about a CV.
    """

    course_points: int = 0
    interview_points: int = 0
    events: list[dict[str, object]] = field(default_factory=list)


MAX_COURSE_POINTS: Final = 30
MAX_INTERVIEW_POINTS: Final = 60


def _band(table: tuple[tuple[int, int], ...], value: int) -> int:
    for threshold, points in table:
        if value >= threshold:
            return points
    return 0


def _ordinal(table: tuple[int, ...], rating: int) -> int:
    """Clamp rather than trust. Layer 1 is schema-constrained to 0-4, but this
    function is also called on stored features from older extractions."""
    return table[max(0, min(rating, len(table) - 1))]


def score_resume(features: ResumeFeatures) -> ResumeScore:
    """Facts in, 0-200 out, with the category breakdown that produced it.

    The breakdown is always computed and always stored -- admin drill-down and
    dispute handling need it. It is never exposed to a candidate: the client
    confirmed on 2026-08-27, and again on 2026-09-11, that the score is never
    explained.
    """
    experience = _band(EXPERIENCE_BANDS, max(0, features.total_experience_months))

    seniority = SENIORITY_POINTS.get(features.highest_seniority.lower(), 0)
    progression = seniority + _ordinal(PROGRESSION_POINTS, features.role_progression)

    skills = _band(SKILL_COUNT_BANDS, max(0, features.skill_count)) + _ordinal(
        EVIDENCE_POINTS, features.skill_evidence
    )

    achievements = _ordinal(SPECIFICITY_POINTS, features.achievement_specificity) + _ordinal(
        SCOPE_POINTS, features.scope_of_responsibility
    )

    education = QUALIFICATION_POINTS.get(features.highest_qualification.lower(), 0) + _band(
        CERTIFICATION_BANDS, max(0, features.certification_count)
    )

    breakdown = {
        "experience_depth": min(experience, CATEGORY_CAPS["experience_depth"]),
        "role_progression": min(progression, CATEGORY_CAPS["role_progression"]),
        "skills": min(skills, CATEGORY_CAPS["skills"]),
        "achievements": min(achievements, CATEGORY_CAPS["achievements"]),
        "education": min(education, CATEGORY_CAPS["education"]),
    }
    return ResumeScore(points=sum(breakdown.values()), breakdown=breakdown)


def total_score(resume: ResumeScore, addons: AddOnContributions) -> int:
    """700 + resume + add-ons. Cannot exceed 990 arithmetically.

    The bound is asserted rather than clamped. 700 + 200 + 30 + 60 is exactly
    990, so if this ever fires it is a bug in a cap above it, and a silent
    clamp would hide that bug behind a plausible number.
    """
    course = min(max(0, addons.course_points), MAX_COURSE_POINTS)
    interview = min(max(0, addons.interview_points), MAX_INTERVIEW_POINTS)
    total = BASE_SCORE + resume.points + course + interview

    if not BASE_SCORE <= total <= MAX_SCORE:  # pragma: no cover - defensive
        raise ValueError(f"score {total} outside {BASE_SCORE}-{MAX_SCORE}; a cap is wrong")
    return total


# ---------------------------------------------------------------------------
# What this rubric deliberately does NOT score
# ---------------------------------------------------------------------------
# Both are extracted and stored -- an interviewer may reasonably want to see
# them -- and both contribute exactly zero points.
#
# **Employment gaps.** Penalising a gap is indirect discrimination: gaps fall
# disproportionately on women after childbirth, on carers, and on people with
# health conditions. That is the same class of harm invariant 5 already forbids
# in the form of age-gating, and it would be inconsistent to forbid one and
# quietly implement the other.
#
# **Institution prestige.** `institution_type` is extracted but only the
# qualification level is scored. Ranking colleges entrenches existing
# advantage, and in a product whose stated purpose is opening access it would
# work against the thing being sold. This is a business decision and the client
# can reverse it -- but it should be a decision, made once, in the open, rather
# than a weight nobody noticed.


def clamped_addon_points(addons: AddOnContributions) -> int:
    """The add-on points that actually count, after the caps.

    **Invariant 4-prime as one function.** `total_score` applies the same caps
    on its way to a total; this exposes the clamped figure so the total can be
    decomposed into `base_value + addon_value` without either caller
    re-deriving the caps and getting them subtly different. A row whose parts
    did not sum to its total would fail its CHECK constraint, which is the
    cheap version of this bug; the expensive version is a stored decomposition
    that sums correctly but attributes points to the wrong half.
    """
    course = min(max(0, addons.course_points), MAX_COURSE_POINTS)
    interview = min(max(0, addons.interview_points), MAX_INTERVIEW_POINTS)
    return course + interview


# ---------------------------------------------------------------------------
# Bands - what an employer sees instead of a number (R4)
# ---------------------------------------------------------------------------
#: `(label, inclusive lower bound, inclusive upper bound)`, ascending.
#:
#: The four labels are fixed by `docs/design-tokens.json` -> `score.bandLabels`,
#: which the mobile app and three web front-ends all read. Adding a fifth is a
#: design-system change, not a scoring change.
#:
#: **STRONG runs to 990, not 900.** 900 is the resume-only ceiling; the last 90
#: points come from the course and mock interviews. Stopping STRONG at 900
#: would leave every candidate who bought an add-on in no band at all -- and
#: the band is what an employer sees, because employers never see the raw
#: score (R4, 2026-08-24).
BANDS: Final[tuple[tuple[str, int, int], ...]] = (
    ("ENTRY", 700, 769),
    ("DEVELOPING", 770, 819),
    ("SOLID", 820, 864),
    ("STRONG", 865, MAX_SCORE),
)


def band_for(value: int) -> str:
    """The band a score falls in. Total over the whole 700-990 scale.

    Out-of-range values resolve to the nearest end rather than raising: this
    runs at a serialization boundary, and a display path that throws turns a
    bad number into a 500 for a candidate who did nothing wrong. A value that
    could reach here out of range has already failed a CHECK constraint.
    """
    for label, low, high in BANDS:
        if low <= value <= high:
            return label
    return BANDS[0][0] if value < BANDS[0][1] else BANDS[-1][0]


# ---------------------------------------------------------------------------
# The display floor (invariant 2)
# ---------------------------------------------------------------------------
def display_value(raw_value: int) -> int:
    """The number a human is shown, from the number that was stored.

    **The floor lives here and nowhere else.** Storing a floored value would
    make the stored score a lie about what the engine computed, and invariant
    1 asks a replay to reproduce what the engine computed -- so the raw value
    is written exactly as calculated and the floor is applied on the way out.

    Today it can never bite: `total_score` is 700 + non-negative parts, and a
    CHECK constraint refuses anything below 700. That is the point. If this
    function ever changes a number, a cap above it is broken, and the floor
    turns a wrong number into a merely unhelpful one instead of letting a
    sub-700 score reach a candidate.

    Invariant 2 also requires stored == displayed. It does, in every case the
    arithmetic can actually produce, which is what the invariant test asserts.
    """
    return max(BASE_SCORE, raw_value)


# ---------------------------------------------------------------------------
# Content addressing (scoring-approach.md section 6)
# ---------------------------------------------------------------------------
def normalise_for_cache(text: str) -> str:
    """The exact text the cache key is computed over.

    Whitespace and unicode form are normalised away so that the same CV
    re-uploaded as a DOCX instead of a PDF -- same words, different spacing,
    different quote characters -- lands on the same cache entry and therefore
    the same score. Case is deliberately **kept**: a CV in block capitals is a
    different document to a model, and pretending otherwise would silently
    merge two extractions that legitimately differ.

    NFKC first, because a CV pasted from a PDF viewer is full of ligatures and
    non-breaking spaces that are the same characters to a reader and different
    bytes to a hash.
    """
    cleaned = unicodedata.normalize("NFKC", text).replace("\u00a0", " ")
    return re.sub(r"\s+", " ", cleaned).strip()


def extraction_cache_key(
    *, text: str, model_id: str, prompt_version: str, schema_version: str
) -> str:
    """`sha256(normalised_text + model_id + prompt_version + schema_version)`.

    **Not the resume id and not the user id**, and that is the whole design:
    the model is called once per distinct CV ever, re-scoring after a course
    purchase costs nothing, and two candidates who submit identical text get
    identical extractions because it is literally the same row -- so
    cross-candidate consistency is exact rather than probabilistic.

    Every component that could change the output is in the key. Leaving any
    of them out would serve a cached extraction produced by a different model
    or a different prompt, which is the one way this cache could corrupt a
    score rather than merely miss.
    """
    material = "\x00".join([normalise_for_cache(text), model_id, prompt_version, schema_version])
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# LAYER 2 - normalisation (scoring-approach.md section 4)
# ---------------------------------------------------------------------------
#: Title vocabulary -> the canonical levels `SENIORITY_POINTS` scores.
#:
#: Longest match wins, so "senior vice president" resolves to executive rather
#: than being caught by "senior". A title we do not recognise is `unknown` and
#: scores zero: guessing from an unknown title is how a scoring system starts
#: rewarding inflated job titles.
SENIORITY_SYNONYMS: Final[tuple[tuple[str, str], ...]] = (
    ("vice president", "executive"),
    ("chief", "executive"),
    ("founder", "executive"),
    ("director", "executive"),
    ("partner", "executive"),
    ("head of", "executive"),
    ("principal", "principal"),
    ("staff", "principal"),
    ("architect", "principal"),
    ("lead", "lead"),
    ("manager", "lead"),
    ("supervisor", "lead"),
    ("senior", "senior"),
    ("sr.", "senior"),
    ("associate", "mid"),
    ("mid", "mid"),
    ("engineer ii", "mid"),
    ("executive", "executive"),
    ("junior", "junior"),
    ("jr.", "junior"),
    ("trainee", "junior"),
    ("graduate", "junior"),
    ("intern", "intern"),
    ("apprentice", "intern"),
)

#: Qualification vocabulary -> the canonical levels `QUALIFICATION_POINTS`
#: scores. Indian qualifications are named here explicitly rather than being
#: approximated from western ones: a B.Tech, a BE and an ITI diploma are what
#: this market's CVs actually say.
QUALIFICATION_SYNONYMS: Final[tuple[tuple[str, str], ...]] = (
    ("phd", "doctorate"),
    ("ph.d", "doctorate"),
    ("doctor", "doctorate"),
    ("dphil", "doctorate"),
    ("master", "master"),
    ("m.tech", "master"),
    ("mtech", "master"),
    ("m.sc", "master"),
    ("msc", "master"),
    ("mba", "master"),
    ("m.a", "master"),
    ("m.com", "master"),
    ("me ", "master"),
    ("bachelor", "bachelor"),
    ("b.tech", "bachelor"),
    ("btech", "bachelor"),
    ("b.e", "bachelor"),
    ("be ", "bachelor"),
    ("b.sc", "bachelor"),
    ("bsc", "bachelor"),
    ("b.com", "bachelor"),
    ("bcom", "bachelor"),
    ("b.a", "bachelor"),
    ("bca", "bachelor"),
    ("degree", "bachelor"),
    ("diploma", "diploma"),
    ("iti", "diploma"),
    ("polytechnic", "diploma"),
    ("certificate", "diploma"),
    ("secondary", "secondary"),
    ("hsc", "secondary"),
    ("ssc", "secondary"),
    ("12th", "secondary"),
    ("10th", "secondary"),
    ("high school", "secondary"),
)

#: Ranked worst to best, so "the highest reached" is a max over this order.
SENIORITY_ORDER: Final[tuple[str, ...]] = (
    "unknown",
    "intern",
    "junior",
    "mid",
    "senior",
    "lead",
    "principal",
    "executive",
)
QUALIFICATION_ORDER: Final[tuple[str, ...]] = (
    "unknown",
    "none",
    "secondary",
    "diploma",
    "bachelor",
    "master",
    "doctorate",
)


def _canonical(
    value: object, synonyms: tuple[tuple[str, str], ...], allowed: dict[str, int]
) -> str:
    """Resolve free text onto a canonical level. `unknown` when nothing fits."""
    if not isinstance(value, str):
        return "unknown"
    text = unicodedata.normalize("NFKC", value).strip().lower()
    if not text:
        return "unknown"
    # An already-canonical value passes through untouched, so a re-run over
    # stored features is a no-op rather than a second round of guessing.
    if text in allowed:
        return text
    for needle, canonical in synonyms:
        if needle in text:
            return canonical
    return "unknown"


def canonical_seniority(value: object) -> str:
    return _canonical(value, SENIORITY_SYNONYMS, SENIORITY_POINTS)


def canonical_qualification(value: object) -> str:
    return _canonical(value, QUALIFICATION_SYNONYMS, QUALIFICATION_POINTS)


def _clamp_ordinal(value: object) -> int:
    """Layer 1 is schema-constrained to 0-4. This is still clamped, because
    stored extractions outlive the schema that validated them."""
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return max(0, min(4, value))


def _rank(value: str, order: tuple[str, ...]) -> int:
    return order.index(value) if value in order else 0


def features_from_extraction(extracted: dict[str, object]) -> ResumeFeatures:
    """**Layer 2.** A Layer 1 extraction becomes the features Layer 3 scores.

    Pure and total: every field is derived defensively, because this runs
    against extractions stored months or years ago under a schema that has
    since moved on. A missing or malformed field degrades that one dimension
    to zero rather than raising -- a replay that throws is a replay that
    cannot answer a dispute, which is the one thing it exists to do.

    Two decisions worth knowing:

    * **Experience is summed from the roles, not read from the model's own
      total.** The roles are checkable and the total is not, and a model that
      miscounts its own arithmetic should not be able to move a score by
      fifty-five points. Where roles overlap the sum overstates slightly; the
      bands are wide enough that it does not cross a boundary.
    * **Skill evidence is the mean, rounded down.** A CV with one
      well-evidenced skill and nine bare keywords is mostly a keyword list,
      and rounding up would pay for the keywords.
    """
    roles = extracted.get("roles")
    roles = roles if isinstance(roles, list) else []

    months = 0
    best_seniority = "unknown"
    for role in roles:
        if not isinstance(role, dict):
            continue
        value = role.get("months")
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            months += value
        level = canonical_seniority(role.get("seniority_level"))
        if _rank(level, SENIORITY_ORDER) > _rank(best_seniority, SENIORITY_ORDER):
            best_seniority = level

    education = extracted.get("education")
    education = education if isinstance(education, list) else []
    best_qualification = "unknown"
    for entry in education:
        if not isinstance(entry, dict):
            continue
        level = canonical_qualification(entry.get("qualification_level"))
        if _rank(level, QUALIFICATION_ORDER) > _rank(best_qualification, QUALIFICATION_ORDER):
            best_qualification = level

    skills = extracted.get("skills")
    skills = skills if isinstance(skills, list) else []
    # Distinct canonical names. A CV listing "Python" three times across three
    # roles is not three skills, and `SKILL_COUNT_BANDS` counts distinct ones.
    seen: dict[str, int] = {}
    for skill in skills:
        if not isinstance(skill, dict):
            continue
        name = skill.get("canonical_name")
        if not isinstance(name, str) or not name.strip():
            continue
        key = name.strip().lower()
        strength = _clamp_ordinal(skill.get("evidence_strength"))
        seen[key] = max(seen.get(key, 0), strength)

    evidence = sum(seen.values()) // len(seen) if seen else 0

    certifications = extracted.get("certifications")
    certifications = certifications if isinstance(certifications, list) else []

    return ResumeFeatures(
        total_experience_months=months,
        highest_seniority=best_seniority,
        role_progression=_clamp_ordinal(extracted.get("role_progression")),
        skill_count=len(seen),
        skill_evidence=evidence,
        achievement_specificity=_clamp_ordinal(extracted.get("achievement_specificity")),
        scope_of_responsibility=_clamp_ordinal(extracted.get("scope_of_responsibility")),
        highest_qualification=best_qualification,
        certification_count=len(certifications),
    )


# ---------------------------------------------------------------------------
# Structured resumes (blocker E6)
# ---------------------------------------------------------------------------
def render_structured_resume(parsed: dict[str, object]) -> str:
    """The manual form, as the text Layer 1 reads. `""` if there is nothing.

    **Why a form is not scored directly.** It carries facts -- roles, years,
    qualifications, skills -- but not the three judgments Layer 1 makes:
    achievement specificity, role progression and scope of responsibility.
    Scored without them those dimensions are zero, so the same career would
    score lower through the form than through an upload. That is a plausible
    wrong number, which `scoring-approach.md` section 11 forbids. Rendered to
    text, the form takes the same path as an upload and is cached the same way.

    **Deliberately left out:** the candidate's name, which the model does not
    need, and the year a qualification was completed, which says nothing about
    ability and a great deal about age (invariant 5).

    Deterministic by construction -- the same form always renders the same
    text -- because the rendered text is what the extraction cache is keyed on.
    """
    lines: list[str] = []

    headline = parsed.get("headline")
    if isinstance(headline, str) and headline.strip():
        lines.append(f"Headline: {headline.strip()}")

    experience = parsed.get("experience")
    roles = [r for r in experience if isinstance(r, dict)] if isinstance(experience, list) else []
    if roles:
        lines.append("Experience:")
        for role in roles:
            title = str(role.get("title") or "").strip()
            employer = str(role.get("employer") or "").strip()
            start = role.get("start_year")
            end = role.get("end_year")
            span = ""
            if isinstance(start, int) and not isinstance(start, bool):
                ending = (
                    str(end) if isinstance(end, int) and not isinstance(end, bool) else "present"
                )
                span = f", {start} to {ending}"
            lines.append(f"- {title} at {employer}{span}")
            summary = role.get("summary")
            if isinstance(summary, str) and summary.strip():
                lines.append(f"  {summary.strip()}")

    education = parsed.get("education")
    entries = [e for e in education if isinstance(e, dict)] if isinstance(education, list) else []
    if entries:
        lines.append("Education:")
        for entry in entries:
            qualification = str(entry.get("qualification") or "").strip()
            institution = str(entry.get("institution") or "").strip()
            lines.append(f"- {qualification}, {institution}")

    skills = parsed.get("skills")
    names = (
        [n.strip() for n in skills if isinstance(n, str) and n.strip()]
        if isinstance(skills, list)
        else []
    )
    if names:
        lines.append("Skills: " + ", ".join(names))

    return "\n".join(lines)
