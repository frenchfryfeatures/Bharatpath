"""scoring - business rules and transaction boundaries

Engine interface, versions, history, breakdown.

Services own the transaction. They never touch `Request`, and anything that
reveals private data writes its audit row on the same session before the
transaction closes.

**This module is where invariants 1, 2, 3 and 4-prime become true at runtime.**
The rules themselves live in `domain.py` (pure, property-tested) and in the
database (CHECK constraints, INSERT-only grants); this file is the one path
that runs them in order.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.core.logging import get_logger
from app.core.outbox import emit
from app.modules.courses import service as courses_service
from app.modules.interview import service as interview_service
from app.modules.resume import service as resume_service
from app.modules.scoring import repository
from app.modules.scoring.domain import (
    RUBRIC_VERSION,
    TAXONOMY_VERSION,
    AddOnContributions,
    clamped_addon_points,
    extraction_cache_key,
    features_from_extraction,
    render_structured_resume,
    score_resume,
    total_score,
)
from app.modules.scoring.events import MODULE
from app.modules.scoring.extractor import (
    PROMPT_VERSION,
    SCHEMA_VERSION,
    ExtractionInvalidError,
    ResumeExtractor,
    get_resume_extractor,
    prompt_hash,
)
from app.settings import Settings, get_settings

logger = get_logger(__name__)

#: Identifies the whole computation, not just the weights. A score is
#: reproducible only if every layer that touched it is named, so this composes
#: the taxonomy (Layer 2) and rubric (Layer 3) versions rather than tracking a
#: number somebody has to remember to bump.
ALGORITHM_VERSION: str = f"{TAXONOMY_VERSION}+{RUBRIC_VERSION}"

#: Versions the add-on folding rule. Separate from the rubric because "a
#: course is worth 30" can change without any weight changing.
CONTRIBUTION_VERSION: str = "v1-2026-09-12"


class ScoreNotFoundError(NotFoundError):
    code = "score_not_found"
    title = "Score not found"


class ReplayMismatchError(ConflictError):
    """**Invariant 1, failing.** A stored score did not reproduce.

    Raised rather than logged. A replay that quietly returns a different
    number is worse than no replay at all: it would be used to answer a
    dispute, and it would answer it wrongly.
    """

    code = "score_replay_mismatch"
    title = "Score did not reproduce"


@dataclass(frozen=True, slots=True)
class ScoreResult:
    """What the engine produced. Not a serialization shape -- see `schemas.py`,
    where the candidate-facing view deliberately drops the breakdown."""

    score_id: uuid.UUID
    raw_value: int
    base_value: int
    addon_value: int
    breakdown: dict[str, int]
    resume_version_id: uuid.UUID


async def _extraction_for(
    session: AsyncSession,
    *,
    text: str,
    extractor: ResumeExtractor,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """The cache-first path into Layer 1.

    Returns `(raw_response, extracted_features, cache_key)`. **The model is
    called only on a miss**, which is what makes one call per distinct CV
    ever, and what makes re-scoring after a purchase cost nothing.
    """
    key = extraction_cache_key(
        text=text,
        model_id=extractor.model_id,
        prompt_version=PROMPT_VERSION,
        schema_version=SCHEMA_VERSION,
    )

    cached = await repository.get_extraction(session, cache_key=key)
    if cached is not None:
        logger.info("extraction_cache_hit", cache_key=key[:16])
        return cached.raw_response, cached.extracted_features, key

    extraction = await extractor.extract(text=text)
    if extraction.model_id != extractor.model_id:
        # The key was computed from the extractor's declared model. If the
        # result came from a different one, storing it under this key would
        # serve it to future requests as though that model had produced it.
        raise ExtractionInvalidError(
            params={"detail": "extractor returned a different model id than it declared"}
        )

    features = extraction.features.model_dump(mode="json")
    await repository.put_extraction(
        session,
        cache_key=key,
        model_id=extraction.model_id,
        prompt_version=extraction.prompt_version,
        schema_version=extraction.schema_version,
        raw_response=extraction.raw_response,
        extracted_features=features,
    )
    logger.info("extraction_stored", cache_key=key[:16], model_id=extraction.model_id)
    return extraction.raw_response, features, key


async def persist(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    resume_version_id: uuid.UUID,
    extracted_features: dict[str, Any],
    raw_model_response: dict[str, Any] | None,
    model_id: str | None,
    addons: AddOnContributions | None = None,
    extraction_cache_key: str | None = None,
) -> ScoreResult:
    """**The sole write path for a score.**

    Runs Layers 2 and 3 over the given extraction and appends one row. Nothing
    else in the codebase inserts into `scores`, which is half of invariant 3
    -- the other half is the app role having no UPDATE or DELETE grant.

    Every component of the total is stored separately (`base_value`,
    `addon_value`, `raw_value`) rather than only the total, because
    `resume_version_id` stopped being sufficient to reproduce a score the
    moment the client made add-ons move it.

    `extraction_cache_key` is optional only for callers holding an extraction
    that never came from the cache (tests seeding a score directly). Both
    production paths pass it, because a score without it is a score whose
    cached reading an erasure cannot reach.
    """
    addons = addons or AddOnContributions()

    features = features_from_extraction(extracted_features)
    resume_score = score_resume(features)
    raw_value = total_score(resume_score, addons)

    # Decomposed from the clamped contributions rather than the requested
    # ones, so `base_value + addon_value = raw_value` holds even when a caller
    # passes more add-on points than the caps allow -- which is what the
    # CHECK constraint on the row asserts, and what invariant 4-prime means.
    addon_value = clamped_addon_points(addons)
    base_value = raw_value - addon_value

    row = await repository.insert_score(
        session,
        user_id=user_id,
        resume_version_id=resume_version_id,
        algorithm_version=ALGORITHM_VERSION,
        raw_value=raw_value,
        base_value=base_value,
        addon_value=addon_value,
        contributing_events=list(addons.events),
        contribution_version=CONTRIBUTION_VERSION,
        breakdown=dict(resume_score.breakdown),
        model_id=model_id,
        prompt_version=PROMPT_VERSION,
        prompt_hash=prompt_hash(),
        raw_model_response=raw_model_response,
        extracted_features=extracted_features,
        taxonomy_version=TAXONOMY_VERSION,
        rubric_version=RUBRIC_VERSION,
        extraction_cache_key=extraction_cache_key,
    )

    await emit(
        session,
        event_type=f"{MODULE}.score_computed",
        aggregate_type="score",
        aggregate_id=row.id,
        payload={"user_id": str(user_id), "resume_version_id": str(resume_version_id)},
    )
    logger.info("score_persisted", score_id=str(row.id), value=raw_value)

    return ScoreResult(
        score_id=row.id,
        raw_value=raw_value,
        base_value=base_value,
        addon_value=addon_value,
        breakdown=dict(resume_score.breakdown),
        resume_version_id=resume_version_id,
    )


async def score_confirmed_resume(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    addons: AddOnContributions | None = None,
    settings: Settings | None = None,
) -> ScoreResult:
    """Score the candidate's confirmed resume, end to end.

    **The confirm gate is the first thing this does** (SRS 1.4.4), through
    `resume.service.get_scorable_version` -- the only function that returns a
    scorable version, and the only route `scoring` has into that module. An
    unconfirmed resume raises there and never reaches Layer 1.
    """
    settings = settings or get_settings()

    version = await resume_service.get_scorable_version(session, user_id=user_id)
    if addons is None:
        addons = await addons_for(session, user_id=user_id)

    parsed = version.parsed if isinstance(version.parsed, dict) else {}
    text = parsed.get("raw_text")
    if not isinstance(text, str) or not text.strip():
        # A structured version -- the manual form, or a correction made through
        # it -- has facts and no prose. It still goes through Layer 1, rendered
        # to text: see `render_structured_resume` for why scoring the form
        # directly would give form-fillers a lower score for the same career.
        text = render_structured_resume(parsed)
    if not text.strip():
        raise ExtractionInvalidError(
            params={"detail": "this resume version carries nothing to extract from"}
        )

    extractor = get_resume_extractor(settings)
    raw_response, features, cache_key = await _extraction_for(
        session, text=text[: settings.resume_max_text_chars], extractor=extractor
    )

    return await persist(
        session,
        user_id=user_id,
        resume_version_id=version.id,
        extracted_features=features,
        raw_model_response=raw_response,
        model_id=extractor.model_id,
        extraction_cache_key=cache_key,
        addons=addons,
    )


async def addons_for(session: AsyncSession, *, user_id: uuid.UUID) -> AddOnContributions:
    """The add-on contributions a score computed now folds in.

    **Scoring reads the add-ons; the add-ons never reach scoring** (invariant
    4'). Each completion becomes one entry in `contributing_events`, carrying
    its id and the points frozen on it, which is what `replay` reads back.

    **Every completed interview session is listed, including a fourth**, at
    the +20 it recorded. The +60 cap is applied by `total_score` and
    `clamped_addon_points`, here and on replay, and nowhere else -- so the
    stored events say exactly what was completed, and the stored value says
    what counted.
    """
    courses = await courses_service.contributions_for(session, user_id=user_id)
    interviews = await interview_service.contributions_for(session, user_id=user_id)
    return AddOnContributions(
        course_points=sum(c.points for c in courses),
        interview_points=sum(i.points for i in interviews),
        events=[
            {
                "kind": "course",
                "id": str(c.completion_id),
                "course_id": str(c.course_id),
                "points": c.points,
                "contribution_version": c.contribution_version,
            }
            for c in courses
        ]
        + [
            {
                "kind": "interview",
                "id": str(i.session_id),
                "points": i.points,
                "contribution_version": i.contribution_version,
            }
            for i in interviews
        ],
    )


def _event_keys(events: Any) -> set[tuple[str, str]]:
    return {
        (str(e.get("kind")), str(e.get("id")))
        for e in (events if isinstance(events, list) else [])
        if isinstance(e, dict)
    }


async def rescore_for_addons(session: AsyncSession, *, user_id: uuid.UUID) -> ScoreResult | None:
    """Re-score after an add-on completion, **without calling the model**.

    Runs Layers 2 and 3 over the extraction stored on the latest score, with
    today's add-ons, and appends a row -- the resume-derived part cannot move,
    because its input is the stored response and not a fresh reading.

    None when there is nothing to do: no score yet (the pending score will
    fold the add-on in when it lands), or the latest score already carries
    exactly these contributions -- which is what makes a redelivered event a
    no-op. If the prompt has changed since that score, the stored extraction
    belongs to another prompt, so this goes the long way round through the
    confirm gate and the content-addressed cache instead.
    """
    latest = await repository.latest_score(session, user_id=user_id)
    if latest is None:
        return None
    addons = await addons_for(session, user_id=user_id)
    if _event_keys(latest.contributing_events) == _event_keys(addons.events):
        return None
    if latest.prompt_version != PROMPT_VERSION or not isinstance(latest.extracted_features, dict):
        return await score_confirmed_resume(session, user_id=user_id, addons=addons)
    return await persist(
        session,
        user_id=user_id,
        resume_version_id=latest.resume_version_id,
        extracted_features=latest.extracted_features,
        raw_model_response=latest.raw_model_response,
        model_id=latest.model_id,
        extraction_cache_key=latest.extraction_cache_key,
        addons=addons,
    )


async def replay(session: AsyncSession, *, score_id: uuid.UUID) -> ScoreResult:
    """**Invariant 1.** Recompute a stored score from its stored inputs.

    Re-runs Layers 2 and 3 over the extraction captured on the row. **It never
    calls the model**, and it cannot: the stored `extracted_features` are the
    input. That is the whole trick -- the model's output was treated as an
    input to scoring, captured once and kept, so a dispute raised in 2029
    about a score computed in 2026 gets an exact answer even after the model
    has been retired.

    Raises rather than returning a different number. A replay that silently
    disagreed with the row would be used to answer a dispute and would answer
    it wrongly.

    Add-ons are replayed from `contributing_events`, not recounted from
    today's purchases -- a score reproduces as it was, not as it would be now.
    """
    row = await repository.get_score(session, score_id=score_id)
    if row is None:
        raise ScoreNotFoundError()

    stored_features = row.extracted_features if isinstance(row.extracted_features, dict) else {}
    features = features_from_extraction(stored_features)
    resume_score = score_resume(features)

    events = list(row.contributing_events or [])
    addons = AddOnContributions(
        course_points=_points_of_kind(events, "course"),
        interview_points=_points_of_kind(events, "interview"),
        events=events,
    )
    recomputed = total_score(resume_score, addons)

    if recomputed != row.raw_value or dict(resume_score.breakdown) != dict(row.breakdown or {}):
        logger.error(
            "replay_mismatch",
            score_id=str(score_id),
            stored=row.raw_value,
            recomputed=recomputed,
            algorithm_version=row.algorithm_version,
        )
        raise ReplayMismatchError(
            params={
                "stored": row.raw_value,
                "recomputed": recomputed,
                "algorithm_version": row.algorithm_version,
            }
        )

    return ScoreResult(
        score_id=row.id,
        raw_value=row.raw_value,
        base_value=row.base_value,
        addon_value=row.addon_value,
        breakdown=dict(row.breakdown or {}),
        resume_version_id=row.resume_version_id,
    )


def _points_of_kind(events: list[dict[str, Any]], kind: str) -> int:
    """Sum the points a stored score attributed to one kind of add-on.

    Reads `contributing_events` rather than counting today's purchases: a
    replay reproduces the score as it was, not as it would be now. A candidate
    who bought a second course last week must not change what last month's
    score reproduces to.
    """
    total = 0
    for event in events:
        if not isinstance(event, dict) or event.get("kind") != kind:
            continue
        points = event.get("points")
        if isinstance(points, int) and not isinstance(points, bool):
            total += max(0, points)
    return total


async def get_score(session: AsyncSession, *, score_id: uuid.UUID) -> Any:
    """One stored score row by id, or None. **Read only.**

    Exists for the integrity task, which needs the stored extraction and must
    never be able to change a number (SRS 1.4.5). It is handed the row, not a
    write path -- and `test_discovery_suppression.py` fails the build if that
    task ever names one.
    """
    return await repository.get_score(session, score_id=score_id)


async def score_for_version(session: AsyncSession, *, resume_version_id: uuid.UUID) -> Any:
    """Any score already computed for this resume version, or None.

    The scoring task's idempotency check. The outbox relays at-least-once, so
    a confirmation can arrive twice; two score rows for one resume version
    would both claim to be current and which one won would depend on the
    query.
    """
    return await repository.score_for_resume_version(session, resume_version_id=resume_version_id)


async def get_latest(session: AsyncSession, *, user_id: uuid.UUID) -> Any:
    """The candidate's current score row, or None if nothing is computed yet.

    None is an ordinary state, not an error: a candidate who has confirmed a
    resume but whose scoring job has not run yet is *pending*, and the route
    says so rather than 404ing on a resource that is about to exist.
    """
    return await repository.latest_score(session, user_id=user_id)
