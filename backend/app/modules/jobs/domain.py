"""jobs - pure domain logic

Composer, validation, publish gate, lifecycle.

No I/O. No database, no HTTP, no clock, no randomness that is not passed in.
mypy runs in strict mode here and import-linter forbids I/O imports, because
this is the layer the invariant property tests exercise directly.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Final, Literal

#: SRS 1.20.6: `DRAFT -> PUBLISHED -> PAUSED -> PUBLISHED -> CLOSED`.
#:
#: CLOSED is terminal. A job that reopens is a new job: candidates who applied
#: to the closed one were told it closed, and silently reviving it would put
#: them back in a pipeline they had been released from.
TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    "DRAFT": frozenset({"PUBLISHED", "CLOSED"}),
    "PUBLISHED": frozenset({"PAUSED", "CLOSED"}),
    "PAUSED": frozenset({"PUBLISHED", "CLOSED"}),
    "CLOSED": frozenset(),
}

#: A live job is not edited in place. Changing the salary or the requirements
#: of a job people have already applied to is a bait-and-switch, so an employer
#: pauses it first -- which takes it off the board while it changes.
EDITABLE_STATES: Final[frozenset[str]] = frozenset({"DRAFT", "PAUSED"})


def refuse_transition(current: str, target: str) -> str | None:
    """The error code for a transition the lifecycle forbids, or None."""
    if target not in TRANSITIONS.get(current, frozenset()):
        return "job_invalid_transition"
    return None


def is_editable(status: str) -> bool:
    return status in EDITABLE_STATES


# ---------------------------------------------------------------------------
# Threshold preview: a count, and only a coarse one
# ---------------------------------------------------------------------------
#: Thresholds are previewed in steps of ten, and counts are reported to the
#: nearest ten below with anything under ten reported as "fewer than ten".
#:
#: **This endpoint is a leak vector.** An employer who could
#: preview any threshold and see an exact count could binary-search for the
#: score of the one candidate whose presence changes the count by one. Steps of
#: ten on the input and rounding on the output mean one person moving in or out
#: rarely changes the answer at all, and the rate limit bounds how many
#: questions can be asked. Coarse enough to be useless for fingerprinting,
#: precise enough to tell "almost nobody" from "hundreds".
THRESHOLD_STEP: Final = 10
MIN_REPORTED_COUNT: Final = 10


def coarse_count(count: int) -> tuple[int, bool]:
    """`(approximate count, fewer than ten)`. Never an exact small number."""
    if count < MIN_REPORTED_COUNT:
        return 0, True
    return (count // MIN_REPORTED_COUNT) * MIN_REPORTED_COUNT, False


# ---------------------------------------------------------------------------
# Eligibility: does a candidate's score meet a job's threshold?
# ---------------------------------------------------------------------------
Eligibility = Literal["ELIGIBLE", "BELOW_THRESHOLD", "SCORE_PENDING"]


def eligibility(*, min_score: int | None, score: int | None) -> Eligibility:
    """Three answers and no reasons.

    `score` is the server's stored score, never a value from the request.
    `SCORE_PENDING` wins over everything, a job with no threshold included:
    nobody can apply until they have a score, so calling them eligible would
    promise an application the service then refuses.

    **Never how far below.** The client confirmed the score is never explained
    (R11), and "you need 40 more" is an explanation. That is also why the
    candidate board never shows the threshold itself: next to their own score,
    it tells them the gap.
    """
    if score is None:
        return "SCORE_PENDING"
    if min_score is None or score >= min_score:
        return "ELIGIBLE"
    return "BELOW_THRESHOLD"


# ---------------------------------------------------------------------------
# Recommendations: which board jobs resemble what a candidate wants
# ---------------------------------------------------------------------------
# Two home-screen sections draw on this (2026-10-09): jobs like the ones the
# candidate applied to, and jobs that fit their career profile. Both ask the
# same question -- how much does a job overlap a set of terms -- and differ
# only in where the terms come from, so there is one rule and two callers.
#
# **What the terms may hold is fixed by `MatchTerms`, and it is short on
# purpose:** skills, words of a job title, places and months of experience.
# Nothing about who someone is -- no gender, no age, no college -- because a
# ranking that used one would steer who sees which jobs by it (invariant 5,
# C3). `test_recommendations.py` holds the field list.
#
# **Never the threshold.** Eligibility is shown beside each job exactly as on
# the board; it plays no part in the order, which would otherwise sort the
# jobs a candidate's score clears above the ones it does not -- the gap R11
# rules out, drawn as a list.

#: A job must share a skill or a title word (its own, or one the candidate's
#: skills imply) with the terms to be recommended at all. A city or an
#: experience fit alone is not a reason: it would fill the section with every
#: job in Pune.
#
# ---------------------------------------------------------------------------
# The job engine (2026-11-23)
# ---------------------------------------------------------------------------
# Each job is scored per dimension on 0..1, and the relevance is the weighted
# mean **over the dimensions both sides say something about**. A dimension
# neither the profile nor the posting fills is left out of the mean rather
# than scored zero, so an empty optional field never pushes a job down -- and
# never pushes it up either: a small coverage factor keeps a job that matched
# on one thin dimension below one that matched on several.
#
# The weights are `config_values` key `jobs.match_weights` (strict:
# `match_weights_from_config`), defaulting to `DEFAULT_MATCH_WEIGHTS`.
# **No relevance number leaves the server**: callers get the order and a
# short list of reason codes, never the figure, which beside a job would read
# like a second score.

MatchDimension = Literal[
    "skills",
    "role",
    "experience",
    "responsibilities",
    "location",
    "salary",
    "education",
    "industry",
    "job_type",
]
MATCH_DIMENSIONS: Final[tuple[MatchDimension, ...]] = (
    "skills",
    "role",
    "experience",
    "responsibilities",
    "location",
    "salary",
    "education",
    "industry",
    "job_type",
)


@dataclass(frozen=True)
class MatchWeights:
    """Relative weights, any positive scale; the engine normalises them."""

    skills: float = 25.0
    role: float = 15.0
    experience: float = 15.0
    responsibilities: float = 10.0
    location: float = 10.0
    salary: float = 10.0
    education: float = 5.0
    industry: float = 5.0
    job_type: float = 5.0

    def of(self, dimension: MatchDimension) -> float:
        return float(getattr(self, dimension))


DEFAULT_MATCH_WEIGHTS: Final = MatchWeights()


class MatchWeightsError(ValueError):
    """A `jobs.match_weights` row that is not a valid weight document."""


def match_weights_from_config(document: object) -> MatchWeights:
    """Strict: every dimension, a number from 0 to 100, at least one above
    zero, nothing else. A bad row raises rather than falling back to the
    defaults, which would rank on numbers nobody chose."""
    if not isinstance(document, dict):
        raise MatchWeightsError("not_an_object")
    if set(document) != set(MATCH_DIMENSIONS):
        raise MatchWeightsError("wrong_keys")
    values: dict[str, float] = {}
    for key in MATCH_DIMENSIONS:
        value = document[key]
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise MatchWeightsError(f"not_a_number:{key}")
        if not 0 <= value <= 100:
            raise MatchWeightsError(f"out_of_range:{key}")
        values[key] = float(value)
    if not any(values.values()):
        raise MatchWeightsError("all_zero")
    return MatchWeights(**values)


def match_weights_document(weights: MatchWeights = DEFAULT_MATCH_WEIGHTS) -> dict[str, float]:
    """The config row's shape, built from the dataclass so the seed can never
    drift from the code."""
    return {key: weights.of(key) for key in MATCH_DIMENSIONS}


#: Words too common in job titles to say anything about the job.
TITLE_STOPWORDS: Final[frozenset[str]] = frozenset(
    {
        "and", "for", "the", "with", "of", "in", "at", "to", "a", "an", "or",
        "job", "jobs", "role", "opening", "vacancy", "urgent", "hiring",
        "senior", "junior", "sr", "jr", "lead", "head", "trainee", "intern",
        "fresher", "freshers", "executive", "associate", "assistant",
        "full", "part", "time", "remote", "onsite", "hybrid",
    }
)  # fmt: skip
#: Shorter tokens are mostly noise ("ii", "vp"); real two-letter skills such
#: as "ui" or "qa" still match through `skills`.
MIN_TITLE_WORD_LENGTH: Final = 3
#: Bounds on what one request can ask the database to compare.
MAX_TERMS: Final = 60
#: A home-screen section's default and largest length.
RECOMMENDATIONS_DEFAULT: Final = 10
RECOMMENDATIONS_MAX: Final = 50

# Kept for callers that read the old names; the engine no longer adds them.
SKILL_WEIGHT: Final = 3
TITLE_WORD_WEIGHT: Final = 4
LOCATION_WEIGHT: Final = 2
EXPERIENCE_FIT_WEIGHT: Final = 1

#: Spellings of one skill. Compared after `skill_key`; the first is canonical.
SKILL_SYNONYMS: Final[tuple[tuple[str, ...], ...]] = (
    ("javascript", "js", "ecmascript"),
    ("typescript", "ts"),
    ("react", "reactjs", "react.js"),
    ("react native", "react-native"),
    ("node.js", "nodejs", "node"),
    ("next.js", "nextjs"),
    ("vue", "vuejs", "vue.js"),
    ("angular", "angularjs"),
    ("postgresql", "postgres", "psql"),
    ("mysql", "my sql"),
    ("mongodb", "mongo"),
    ("python", "python3"),
    ("golang", "go"),
    ("c++", "cpp"),
    ("c#", "csharp", "c sharp"),
    (".net", "dotnet", "asp.net"),
    ("machine learning", "ml"),
    ("artificial intelligence", "ai"),
    ("amazon web services", "aws"),
    ("google cloud", "gcp"),
    ("microsoft excel", "excel", "ms excel", "advanced excel"),
    ("tally", "tally erp", "tally prime"),
    ("ui/ux", "ui ux", "ux", "ui design", "ux design"),
    ("kubernetes", "k8s"),
    ("continuous integration", "ci/cd", "ci cd"),
    ("customer service", "customer support"),
    ("accounting", "accounts", "bookkeeping"),
)
_CANONICAL: Final[dict[str, str]] = {
    variant: group[0] for group in SKILL_SYNONYMS for variant in group
}

#: Skills that make a role likely even when the candidate never named it:
#: someone with Python, FastAPI and PostgreSQL is a backend candidate. Two of
#: a family imply its role words, which then count for less than words the
#: candidate chose themselves.
SKILL_FAMILIES: Final[tuple[tuple[frozenset[str], frozenset[str]], ...]] = (
    (
        frozenset({"python", "fastapi", "django", "flask", "postgresql", "mysql", "golang",
                   "java", "spring", "node.js", "mongodb", "redis", "sql"}),
        frozenset({"backend", "developer", "engineer", "software"}),
    ),
    (
        frozenset({"react", "javascript", "typescript", "html", "css", "next.js", "vue",
                   "angular", "tailwind"}),
        frozenset({"frontend", "developer", "engineer", "web"}),
    ),
    (
        frozenset({"react native", "flutter", "kotlin", "swift", "android", "ios"}),
        frozenset({"mobile", "android", "developer", "app"}),
    ),
    (
        frozenset({"machine learning", "pandas", "numpy", "tensorflow", "pytorch",
                   "statistics", "sql", "power bi", "tableau"}),
        frozenset({"data", "analyst", "scientist", "engineer"}),
    ),
    (
        frozenset({"amazon web services", "google cloud", "kubernetes", "docker", "terraform",
                   "linux", "continuous integration"}),
        frozenset({"devops", "cloud", "engineer", "sre"}),
    ),
    (
        frozenset({"accounting", "tally", "gst", "microsoft excel", "taxation", "audit"}),
        frozenset({"accountant", "accounts", "finance"}),
    ),
    (
        frozenset({"customer service", "communication", "crm", "telecalling", "english"}),
        frozenset({"customer", "support", "service", "telecaller"}),
    ),
    (
        frozenset({"sales", "negotiation", "lead generation", "crm", "marketing"}),
        frozenset({"sales", "marketing", "business", "development"}),
    ),
)  # fmt: skip
#: How much an implied role word counts against one the candidate chose.
IMPLIED_ROLE_FACTOR: Final = 0.5

#: Education, lowest first, in the job composer's vocabulary.
EDUCATION_LEVELS: Final[tuple[str, ...]] = (
    "NONE",
    "CLASS_10",
    "CLASS_12",
    "DIPLOMA",
    "GRADUATE",
    "POST_GRADUATE",
    "DOCTORATE",
)
#: Months-per-period to compare a posted range with a yearly preference.
_PERIODS_PER_YEAR: Final[dict[str, float]] = {
    "HOURLY": 2080.0,
    "DAILY": 260.0,
    "MONTHLY": 12.0,
    "ANNUAL": 1.0,
    # The composer's default and the board's documented unit: per month.
    "": 12.0,
}


def skill_key(skill: str) -> str:
    """A skill as compared: trimmed, lower-cased and folded to one spelling."""
    key = " ".join(skill.strip().lower().split())
    return _CANONICAL.get(key, key)


def title_words(text: str) -> frozenset[str]:
    r"""The words of a job title that say what the job is.

    Letters and digits only, so every word is safe inside the database's word
    boundary match (`\m...\M`) without escaping.
    """
    words = re.findall(r"[a-z0-9]+", text.lower())
    return frozenset(
        w for w in words if len(w) >= MIN_TITLE_WORD_LENGTH and w not in TITLE_STOPWORDS
    )


def implied_role_words(skills: Iterable[str]) -> frozenset[str]:
    keys = {skill_key(s) for s in skills}
    implied: set[str] = set()
    for family, words in SKILL_FAMILIES:
        if len(keys & family) >= 2:
            implied |= words
    return frozenset(implied)


def education_rank(level: str) -> int | None:
    try:
        return EDUCATION_LEVELS.index(level)
    except ValueError:
        return None


@dataclass(frozen=True)
class MatchTerms:
    """What a recommendation is matched on. **Nothing about who someone is**
    -- no gender, no age, no college, no current pay. Adding a field is a
    product decision; 2026-11-23 added the candidate's *preferences*
    (salary they want, industry) and their education level, never their
    current salary."""

    skills: frozenset[str] = frozenset()
    title_words: frozenset[str] = frozenset()
    locations: frozenset[str] = frozenset()
    experience_months: int | None = None
    #: Role words the skills imply (`SKILL_FAMILIES`), minus `title_words`.
    implied_title_words: frozenset[str] = frozenset()
    #: Yearly, paise. Only an INR preference is kept: amounts are never
    #: converted between currencies.
    preferred_annual_salary_minor: int | None = None
    industries: frozenset[str] = frozenset()
    #: `education_rank` of the highest qualification, when known.
    education_level: int | None = None
    #: The candidate is looking for a first job (a fresher).
    fresher: bool = False
    #: Preferences tab (2026-11-23): ONSITE/HYBRID/REMOTE wanted; empty = any.
    work_modes: frozenset[str] = frozenset()
    #: FULL_TIME/PART_TIME/CONTRACT/INTERNSHIP/FREELANCE wanted; empty = any.
    job_types: frozenset[str] = frozenset()
    #: A job outside the preferred places still fits partly.
    open_to_relocation: bool = False

    @classmethod
    def build(
        cls,
        *,
        skills: Iterable[str] = (),
        titles: Iterable[str] = (),
        locations: Iterable[str] = (),
        experience_months: int | None = None,
        preferred_annual_salary_minor: int | None = None,
        industries: Iterable[str] = (),
        education_level: int | None = None,
        fresher: bool = False,
        work_modes: Iterable[str] = (),
        job_types: Iterable[str] = (),
        open_to_relocation: bool = False,
    ) -> MatchTerms:
        """Normalised and capped. The first `MAX_TERMS` of each kind win, so a
        caller lists the strongest signals first."""
        skill_list = list(skills)
        keys = _first_distinct((skill_key(s) for s in skill_list), MAX_TERMS)
        words = _first_distinct((w for t in titles for w in sorted(title_words(t))), MAX_TERMS)
        places = _first_distinct((p.strip().lower() for p in locations), MAX_TERMS)
        implied = sorted(implied_role_words(keys) - set(words))[:MAX_TERMS]
        return cls(
            skills=frozenset(keys),
            title_words=frozenset(words),
            locations=frozenset(places),
            experience_months=experience_months,
            implied_title_words=frozenset(implied),
            preferred_annual_salary_minor=preferred_annual_salary_minor,
            industries=frozenset(i.strip().lower() for i in industries if i and i.strip()),
            education_level=education_level,
            fresher=fresher,
            work_modes=frozenset(m.strip().upper() for m in work_modes if m and m.strip()),
            job_types=frozenset(t.strip().upper() for t in job_types if t and t.strip()),
            open_to_relocation=open_to_relocation,
        )

    @property
    def is_empty(self) -> bool:
        """Nothing a job could match. A section with no basis says so rather
        than showing the newest jobs under a heading that claims otherwise."""
        return not self.skills and not self.title_words

    @property
    def narrowing_words(self) -> frozenset[str]:
        """Title words the database narrows on: chosen and implied."""
        return self.title_words | self.implied_title_words


def _first_distinct(values: Iterable[str], limit: int) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value and value not in seen:
            seen.append(value)
            if len(seen) == limit:
                break
    return seen


#: Short, candidate-facing reasons a job was ranked where it was.
MatchReason = Literal[
    "STRONG_SKILLS_MATCH",
    "SOME_SKILLS_MATCH",
    "ROLE_MATCH",
    "EXPERIENCE_FITS",
    "PREFERRED_LOCATION",
    "REMOTE",
    "SALARY_FITS",
    "EDUCATION_FITS",
    "INDUSTRY_MATCH",
    "ENTRY_LEVEL",
    "WORK_MODE_MATCH",
    "JOB_TYPE_MATCH",
]


@dataclass(frozen=True)
class JobFacts:
    """What the engine reads about one job. Built from the row and its
    `details` document by the service; every field but the title optional."""

    title: str
    skills: Sequence[str] = ()
    location: str | None = None
    experience_min_months: int | None = None
    experience_max_months: int | None = None
    description: str = ""
    responsibilities: Sequence[str] = ()
    preferred_skills: Sequence[str] = ()
    work_mode: str | None = None
    salary_max_minor: int | None = None
    salary_period: str = ""
    industry: str = ""
    minimum_education: str = ""
    job_type: str = ""


@dataclass(frozen=True)
class Match:
    #: 0..100, internal only. Never serialised.
    relevance: int
    #: The job's own spellings of the skills it shares with the terms.
    matched_skills: tuple[str, ...]
    reasons: tuple[MatchReason, ...] = ()


def _experience_fit(have: int, low: int | None, high: int | None) -> float:
    if low is not None and have < low:
        # Short by a year halves it; short by two or more is no fit.
        return max(0.0, 1.0 - (low - have) / 24)
    if high is not None and have > high + 24:
        # Well past the range: likely over-qualified, still worth showing.
        return 0.6
    return 1.0


def _words_in(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9+#.]+", text.lower()))


def score_job(
    terms: MatchTerms, job: JobFacts, *, weights: MatchWeights = DEFAULT_MATCH_WEIGHTS
) -> Match | None:
    """How well one job fits `terms`, or None when it shares no skill and no
    title word (chosen or implied) with them. See the section comment."""
    required = {skill_key(s): s for s in job.skills}
    preferred = {skill_key(s) for s in job.preferred_skills}
    matched = tuple(dict.fromkeys(s for s in job.skills if skill_key(s) in terms.skills))
    matched_keys = {skill_key(s) for s in matched}
    preferred_hits = (preferred - set(required)) & terms.skills
    job_words = title_words(job.title)
    chosen_words = job_words & terms.title_words
    implied_words = job_words & terms.implied_title_words
    if not matched and not preferred_hits and not chosen_words and not implied_words:
        return None

    parts: dict[MatchDimension, float] = {}
    reasons: list[MatchReason] = []

    # Skills: how much of what the job asks for the candidate has; a job's
    # "nice to have" skills count for half.
    if required or preferred:
        asked = len(required) + 0.5 * len(preferred - set(required))
        have = len(matched_keys) + 0.5 * len(preferred_hits)
        parts["skills"] = min(1.0, have / asked) if asked else 0.0
        if parts["skills"] >= 0.6:
            reasons.append("STRONG_SKILLS_MATCH")
        elif have:
            reasons.append("SOME_SKILLS_MATCH")

    # Role: the share of the job title's words the candidate's roles cover.
    if job_words and (terms.title_words or terms.implied_title_words):
        covered = len(chosen_words) + IMPLIED_ROLE_FACTOR * len(implied_words - chosen_words)
        parts["role"] = min(1.0, covered / len(job_words))
        if chosen_words:
            reasons.append("ROLE_MATCH")

    if terms.experience_months is not None and (
        job.experience_min_months is not None or job.experience_max_months is not None
    ):
        parts["experience"] = _experience_fit(
            terms.experience_months, job.experience_min_months, job.experience_max_months
        )
        if parts["experience"] >= 0.99:
            reasons.append("EXPERIENCE_FITS")

    # Responsibilities: the candidate's skills and role words named in the
    # description and responsibilities -- what the work actually involves.
    body = " ".join([job.description, *job.responsibilities]).lower()
    vocabulary = terms.skills | terms.title_words
    if body.strip() and vocabulary:
        words = _words_in(body)
        hits = sum(1 for term in vocabulary if (term in words if " " not in term else term in body))
        parts["responsibilities"] = min(1.0, hits / max(3, min(len(vocabulary), 8)))

    # Location and work mode, one dimension (the spec's "location and work
    # mode"): the place fit and, when the candidate chose work modes, the
    # mode fit, averaged.
    fits: list[float] = []
    if job.work_mode == "REMOTE":
        fits.append(1.0)
        reasons.append("REMOTE")
    elif terms.locations and job.location:
        place = job.location.lower()
        if any(p in place for p in terms.locations):
            fits.append(1.0)
            reasons.append("PREFERRED_LOCATION")
        else:
            fits.append(0.5 if terms.open_to_relocation else 0.0)
    if terms.work_modes and job.work_mode:
        wanted = job.work_mode.upper() in terms.work_modes
        fits.append(1.0 if wanted else 0.0)
        if wanted:
            reasons.append("WORK_MODE_MATCH")
    if fits:
        parts["location"] = sum(fits) / len(fits)

    if terms.preferred_annual_salary_minor and job.salary_max_minor:
        yearly = job.salary_max_minor * _PERIODS_PER_YEAR.get(job.salary_period, 12.0)
        ratio = yearly / terms.preferred_annual_salary_minor
        parts["salary"] = 1.0 if ratio >= 1 else max(0.0, (ratio - 0.6) / 0.4)
        if ratio >= 1:
            reasons.append("SALARY_FITS")

    needed = education_rank(job.minimum_education) if job.minimum_education else None
    if needed is not None and terms.education_level is not None:
        parts["education"] = 1.0 if terms.education_level >= needed else 0.0
        if parts["education"]:
            reasons.append("EDUCATION_FITS")

    if job.industry and terms.industries:
        industry = job.industry.strip().lower()
        parts["industry"] = (
            1.0 if any(i in industry or industry in i for i in terms.industries) else 0.0
        )
        if parts["industry"]:
            reasons.append("INDUSTRY_MATCH")

    # Job type: the candidate's chosen types when they gave any, and whether
    # the role suits a fresher or an experienced person, averaged.
    type_fits: list[float] = []
    if job.job_type and terms.job_types:
        chosen = job.job_type.upper() in terms.job_types
        type_fits.append(1.0 if chosen else 0.0)
        if chosen:
            reasons.append("JOB_TYPE_MATCH")
    if job.job_type and terms.experience_months is not None:
        entry = job.job_type == "INTERNSHIP" or (job.experience_min_months or 0) == 0
        suits = entry if terms.fresher else job.job_type != "INTERNSHIP"
        type_fits.append(1.0 if suits else 0.3)
        if terms.fresher and entry:
            reasons.append("ENTRY_LEVEL")
    if type_fits:
        parts["job_type"] = sum(type_fits) / len(type_fits)

    total = sum(weights.of(d) for d in MATCH_DIMENSIONS)
    used = sum(weights.of(d) for d in parts)
    if used <= 0:
        return None
    mean = sum(weights.of(d) * v for d, v in parts.items()) / used
    # A job that matched on one thin dimension is not a perfect match.
    coverage = (used / total) ** 0.25
    relevance = round(100 * mean * coverage)
    return Match(relevance=relevance, matched_skills=matched, reasons=tuple(reasons))


def match(
    terms: MatchTerms,
    *,
    title: str,
    skills: Sequence[str],
    location: str | None,
    experience_min_months: int | None,
) -> Match | None:
    """The engine over a job's columns alone -- kept for callers that have
    no `details` document to hand."""
    return score_job(
        terms,
        JobFacts(
            title=title,
            skills=skills,
            location=location,
            experience_min_months=experience_min_months,
        ),
    )


#: Maximum weight given to behavioral applied-job signals once a candidate has
#: at least `APPLIED_BEHAVIOR_SATURATION` recent applications.
MAX_APPLIED_BEHAVIOR_WEIGHT: Final = 0.35
APPLIED_BEHAVIOR_SATURATION: Final = 5
#: Gentle recency tie-breaker (points out of 100) decaying linearly over 30 days.
MAX_RECENCY_BONUS: Final = 5.0
RECENCY_HORIZON_DAYS: Final = 30.0


def applied_behavior_weight(applied_count: int) -> float:
    """Adaptive blend weight alpha(n) in [0, 0.35] that grows as the user
    applies to more jobs, saturating at 5 applications."""
    if applied_count <= 0:
        return 0.0
    return MAX_APPLIED_BEHAVIOR_WEIGHT * min(1.0, applied_count / APPLIED_BEHAVIOR_SATURATION)


def recency_bonus(age_days: float) -> float:
    """Linear recency tie-breaker in [0, 5] over a 30-day window."""
    if age_days <= 0:
        return MAX_RECENCY_BONUS
    return MAX_RECENCY_BONUS * max(0.0, 1.0 - age_days / RECENCY_HORIZON_DAYS)


def rerank_board_score(
    job: JobFacts,
    *,
    profile_terms: MatchTerms | None,
    applied_terms: MatchTerms | None,
    applied_count: int = 0,
    age_days: float = 0.0,
    weights: MatchWeights = DEFAULT_MATCH_WEIGHTS,
) -> float:
    """Composite re-ranking score for the main Jobs tab.

    Combines multi-parameter profile & Job Preferences fit (`S_pref`) with
    continuously updated behavioral fit from recently applied jobs (`S_applied`),
    blended by adaptive weight `alpha(n)`, plus a gentle recency bonus `R(j)`.
    Unmatched jobs still receive `R(j)` so browse/search never drops valid jobs.
    """
    has_pref = profile_terms is not None and not profile_terms.is_empty
    has_applied = applied_terms is not None and not applied_terms.is_empty and applied_count > 0

    pref_match = score_job(profile_terms, job, weights=weights) if has_pref and profile_terms else None
    applied_match = score_job(applied_terms, job, weights=weights) if has_applied and applied_terms else None

    s_pref = float(pref_match.relevance) if pref_match else 0.0
    s_applied = float(applied_match.relevance) if applied_match else 0.0
    bonus = recency_bonus(age_days)

    if has_pref and has_applied:
        alpha = applied_behavior_weight(applied_count)
        return (1.0 - alpha) * s_pref + alpha * s_applied + bonus
    if has_pref:
        return s_pref + bonus
    if has_applied:
        return s_applied + bonus
    return bonus
