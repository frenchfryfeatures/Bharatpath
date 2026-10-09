"""End to end: extraction cache, persistence, replay, re-score.

Against a real Postgres, because the guarantees being tested are enforced
there: the CHECK constraints that hold the scale, the append-only grant, and
the content-addressed primary key that makes one model call per distinct CV.

**Layer 1 is stubbed throughout.** No test may call a model — it would be
slow, billable and non-deterministic, and the point of the design is that
everything below Layer 1 is none of those things. The stub counts its calls,
which is how the cache and replay guarantees are actually asserted rather
than assumed.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import text

from app.modules.scoring.domain import AddOnContributions
from app.modules.scoring.extractor import (
    PROMPT_VERSION,
    SCHEMA_VERSION,
    ExtractedResume,
    Extraction,
    ExtractionUnavailableError,
    prompt_hash,
)
from tests.conftest import _seed_url, sessions

pytestmark = pytest.mark.integration

CV_TEXT = (
    "Arjun Mehta - Senior Data Engineer, Pune\n"
    "Tata Consultancy Services, Senior Data Engineer, 2019 to 2025\n"
    "Infosys, Data Engineer, 2016 to 2019\n"
    "B.E. Information Technology, Pune University, 2015\n"
    "Skills: Spark, Airflow, Python, SQL, Kafka"
)

EXTRACTED = {
    "total_experience_months": 108,
    "roles": [
        {
            "title": "Senior Data Engineer",
            "employer": "TCS",
            "months": 72,
            "seniority_level": "senior",
            "is_managerial": False,
        },
        {
            "title": "Data Engineer",
            "employer": "Infosys",
            "months": 36,
            "seniority_level": "mid",
            "is_managerial": False,
        },
    ],
    "education": [{"qualification_level": "bachelor", "field": "IT", "institution_type": ""}],
    "skills": [
        {"canonical_name": n, "evidence_strength": 3}
        for n in ("Spark", "Airflow", "Python", "SQL", "Kafka")
    ],
    "certifications": [],
    "languages": [],
    "achievement_specificity": 2,
    "role_progression": 3,
    "scope_of_responsibility": 2,
}


class StubExtractor:
    """A Layer 1 stand-in that counts how often it was asked to read.

    The count is the assertion in several tests below: the cache promises one
    model call per distinct CV ever, and replay promises none at all. Both are
    only provable by watching the call.
    """

    model_id = "stub-model-1"

    def __init__(self, features: dict[str, Any] | None = None) -> None:
        self.calls = 0
        self._features = features if features is not None else EXTRACTED

    async def extract(self, *, text: str) -> Extraction:
        self.calls += 1
        return Extraction(
            features=ExtractedResume.model_validate(self._features),
            raw_response={"stub": True, "chars": len(text)},
            model_id=self.model_id,
            prompt_version=PROMPT_VERSION,
            prompt_hash=prompt_hash(),
            schema_version=SCHEMA_VERSION,
        )


class FailingExtractor:
    model_id = "stub-model-1"

    async def extract(self, *, text: str) -> Extraction:
        raise ExtractionUnavailableError()


@pytest.fixture
def stub_extractor(monkeypatch: pytest.MonkeyPatch) -> StubExtractor:
    from app.modules.scoring import service as scoring_service

    stub = StubExtractor()
    monkeypatch.setattr(scoring_service, "get_resume_extractor", lambda settings=None: stub)
    return stub


@pytest.fixture
def cv() -> str:
    """A CV whose text no other test shares.

    **The extraction cache is keyed on the text and nothing else** -- not the
    user, not the resume, not the test -- and rows outlive the test that wrote
    them. So two tests using the same CV body share one cache entry, and the
    second one sees zero model calls no matter what it was trying to prove.
    That is the cache behaving exactly as designed; it just means a test that
    counts calls has to own its document.
    """
    return CV_TEXT + f"\nReference: {uuid.uuid4()}"


@pytest.fixture
async def candidate() -> uuid.UUID:
    user_id = uuid.uuid4()
    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "INSERT INTO users (id, pool, phone, status, locale) "
                "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
            ),
            {"u": str(user_id), "p": f"+9199{uuid.uuid4().int % 10**8:08d}"},
        )
    return user_id


async def _confirmed_resume(user_id: uuid.UUID, body: str = CV_TEXT) -> uuid.UUID:
    """A resume that has been through the confirm gate, which is the only
    kind scoring can see."""
    from app.modules.resume import service as resume_service

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        row = await resume_service.create_pasted_version(session, user_id=user_id, text=body)
    async with factory() as session, session.begin():
        await resume_service.confirm_version(session, user_id=user_id, resume_version_id=row.id)
    return row.id


async def _score(user_id: uuid.UUID, addons: AddOnContributions | None = None):
    from app.modules.scoring import service

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        return await service.score_confirmed_resume(session, user_id=user_id, addons=addons)


# --- the confirm gate, from the scoring side ------------------------------
async def test_an_unconfirmed_resume_is_never_scored(
    candidate: uuid.UUID, stub_extractor: StubExtractor, cv: str
) -> None:
    """SRS 1.4.4 from the other end. Scoring reaches resume only through
    `get_scorable_version`, so an unreviewed CV cannot even reach Layer 1 —
    which is also why the model was never called."""
    from app.modules.resume import service as resume_service
    from app.modules.resume.service import ResumeNotConfirmedError

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await resume_service.create_pasted_version(session, user_id=candidate, text=cv)

    with pytest.raises(ResumeNotConfirmedError):
        await _score(candidate)
    assert stub_extractor.calls == 0, "an unconfirmed CV was sent to the model"


# --- persistence: the whole chain -----------------------------------------
async def test_a_score_stores_everything_needed_to_replay_it(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    """Invariant 1. A row missing any part of the chain is a score nobody can
    reproduce, and a dispute nobody can answer."""
    await _confirmed_resume(candidate)
    result = await _score(candidate)

    factory = sessions(_seed_url())
    async with factory() as session:
        row = (
            (
                await session.execute(
                    text("SELECT * FROM scores WHERE id = :i"), {"i": str(result.score_id)}
                )
            )
            .mappings()
            .one()
        )

    assert row["model_id"] == "stub-model-1"
    assert row["prompt_version"] == PROMPT_VERSION
    assert row["prompt_hash"] == prompt_hash()
    assert row["raw_model_response"] is not None
    assert row["extracted_features"] is not None
    assert row["taxonomy_version"]
    assert row["rubric_version"]
    assert row["algorithm_version"]
    assert row["contribution_version"]


async def test_the_components_always_sum_to_the_total(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    """Held by a CHECK constraint as well as here: `raw = base + addon`."""
    await _confirmed_resume(candidate)
    result = await _score(candidate, AddOnContributions(course_points=30, interview_points=40))

    assert result.base_value + result.addon_value == result.raw_value
    assert result.addon_value == 70


async def test_add_on_caps_hold_end_to_end(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    """Invariant 4-prime through the real write path, not just the pure
    function. A caller asking for more than the caps allow gets the caps."""
    await _confirmed_resume(candidate)
    result = await _score(candidate, AddOnContributions(course_points=500, interview_points=500))

    assert result.addon_value == 90
    assert result.base_value + result.addon_value == result.raw_value
    assert result.raw_value <= 990


async def test_a_score_is_within_the_scale(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    await _confirmed_resume(candidate)
    result = await _score(candidate)
    assert 700 <= result.raw_value <= 990
    assert 700 <= result.base_value <= 900


async def test_scoring_emits_an_event(candidate: uuid.UUID, stub_extractor: StubExtractor) -> None:
    await _confirmed_resume(candidate)
    result = await _score(candidate)

    factory = sessions(_seed_url())
    async with factory() as session:
        count = await session.scalar(
            text(
                "SELECT count(*) FROM outbox "
                "WHERE event_type = 'scoring.score_computed' AND aggregate_id = :a"
            ),
            {"a": str(result.score_id)},
        )
    assert count == 1


# --- the extraction cache -------------------------------------------------
async def test_the_model_is_called_once_per_distinct_cv(
    candidate: uuid.UUID, stub_extractor: StubExtractor, cv: str
) -> None:
    """**The cost guarantee.** Re-scoring after a purchase re-runs Layer 3
    only: no model call, no bill, and no opportunity to drift."""
    await _confirmed_resume(candidate, cv)

    first = await _score(candidate)
    second = await _score(candidate, AddOnContributions(course_points=30))

    assert stub_extractor.calls == 1, "the cached extraction was not reused"
    assert second.base_value == first.base_value, "the resume-derived part drifted"
    assert second.raw_value == first.raw_value + 30


async def test_two_candidates_with_identical_text_share_one_extraction(
    stub_extractor: StubExtractor, cv: str
) -> None:
    """Content addressing is on the text, not the user. Cross-candidate
    consistency becomes exact rather than probabilistic."""
    factory = sessions(_seed_url())
    users = []
    for _ in range(2):
        user_id = uuid.uuid4()
        async with factory() as session, session.begin():
            await session.execute(
                text(
                    "INSERT INTO users (id, pool, phone, status, locale) "
                    "VALUES (:u, 'CANDIDATE', :p, 'ACTIVE', 'en')"
                ),
                {"u": str(user_id), "p": f"+9199{uuid.uuid4().int % 10**8:08d}"},
            )
        await _confirmed_resume(user_id, cv)
        users.append(user_id)

    a = await _score(users[0])
    b = await _score(users[1])

    assert stub_extractor.calls == 1
    assert a.raw_value == b.raw_value
    assert a.breakdown == b.breakdown

    async with factory() as session:
        entries = await session.scalar(text("SELECT count(*) FROM resume_extractions"))
    assert entries >= 1


async def test_a_different_cv_gets_its_own_extraction(
    candidate: uuid.UUID, stub_extractor: StubExtractor, cv: str
) -> None:
    from app.modules.resume import service as resume_service

    await _confirmed_resume(candidate, cv)
    await _score(candidate)

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        newer = await resume_service.create_pasted_version(
            session, user_id=candidate, text=cv + "\nAlso: Terraform, dbt, Snowflake"
        )
    async with factory() as session, session.begin():
        await resume_service.confirm_version(session, user_id=candidate, resume_version_id=newer.id)
    await _score(candidate)

    assert stub_extractor.calls == 2, "a different CV reused another CV's extraction"


# --- replay: invariant 1 --------------------------------------------------
async def test_replay_reproduces_a_stored_score_exactly(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    from app.modules.scoring import service

    await _confirmed_resume(candidate)
    original = await _score(candidate)

    factory = sessions(_seed_url())
    async with factory() as session:
        replayed = await service.replay(session, score_id=original.score_id)

    assert replayed.raw_value == original.raw_value
    assert replayed.breakdown == original.breakdown


async def test_replay_reproduces_a_score_that_carries_add_ons(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    """**A replay that only reproduces base scores is a replay that breaks the
    first time someone buys a course.** The plan calls this out by name."""
    from app.modules.scoring import service

    await _confirmed_resume(candidate)
    original = await _score(
        candidate,
        AddOnContributions(
            course_points=30,
            interview_points=40,
            events=[
                {"kind": "course", "points": 30, "id": "c1"},
                {"kind": "interview", "points": 20, "id": "i1"},
                {"kind": "interview", "points": 20, "id": "i2"},
            ],
        ),
    )

    factory = sessions(_seed_url())
    async with factory() as session:
        replayed = await service.replay(session, score_id=original.score_id)

    assert replayed.raw_value == original.raw_value
    assert replayed.addon_value == 70


async def test_replay_never_calls_the_model(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    """**The whole trick.** The model's output was captured once as an *input*
    to scoring, so a replay in 2029 of a score computed in 2026 is exact even
    after the model is retired."""
    from app.modules.scoring import service

    await _confirmed_resume(candidate)
    original = await _score(candidate)
    calls_after_scoring = stub_extractor.calls

    factory = sessions(_seed_url())
    async with factory() as session:
        await service.replay(session, score_id=original.score_id)

    assert stub_extractor.calls == calls_after_scoring


async def test_replay_of_a_missing_score_is_a_404(stub_extractor: StubExtractor) -> None:
    from app.modules.scoring import service
    from app.modules.scoring.service import ScoreNotFoundError

    factory = sessions(_seed_url())
    async with factory() as session:
        with pytest.raises(ScoreNotFoundError):
            await service.replay(session, score_id=uuid.uuid4())


async def test_replay_raises_when_a_stored_score_does_not_reproduce(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    """**Invariant 1 failing, loudly.** A replay that quietly returned a
    different number would be used to answer a dispute and would answer it
    wrongly. Simulated by corrupting the stored total as the migrator, which
    the app role could not do.
    """
    from app.modules.scoring import service
    from app.modules.scoring.service import ReplayMismatchError

    await _confirmed_resume(candidate)
    original = await _score(candidate)

    factory = sessions(_seed_url())
    async with factory() as session, session.begin():
        await session.execute(
            text(
                "UPDATE scores SET raw_value = raw_value + 5, "
                "base_value = base_value + 5 WHERE id = :i"
            ),
            {"i": str(original.score_id)},
        )

    async with factory() as session:
        with pytest.raises(ReplayMismatchError):
            await service.replay(session, score_id=original.score_id)


# --- failure: pending, never a partial score ------------------------------
async def test_an_extraction_failure_writes_no_score(
    candidate: uuid.UUID, monkeypatch: pytest.MonkeyPatch, cv: str
) -> None:
    """`scoring-approach.md` section 11: we never produce a partial or
    degraded score. A plausible wrong number is unfixable once the candidate
    has seen it."""
    from app.modules.scoring import service

    monkeypatch.setattr(service, "get_resume_extractor", lambda settings=None: FailingExtractor())
    await _confirmed_resume(candidate, cv)

    with pytest.raises(ExtractionUnavailableError):
        await _score(candidate)

    factory = sessions(_seed_url())
    async with factory() as session:
        count = await session.scalar(
            text("SELECT count(*) FROM scores WHERE user_id = :u"), {"u": str(candidate)}
        )
    assert count == 0, "a failed extraction produced a score anyway"


async def test_no_extractor_configured_means_pending_not_zero(
    candidate: uuid.UUID, cv: str
) -> None:
    """The default build has no Layer 1 wired. That must mean *pending*, not a
    score computed from an empty extraction — which would be 700 and would
    look entirely plausible."""
    from app.modules.scoring.extractor import ExtractionUnavailableError as Unavailable

    await _confirmed_resume(candidate, cv)
    with pytest.raises(Unavailable):
        await _score(candidate)


# --- the task: idempotent by resume version -------------------------------
async def test_a_redelivered_confirmation_does_not_score_twice(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    """At-least-once delivery. Two score rows for one resume version would
    both claim to be current, and which won would depend on the query."""
    from app.tasks.score_resume import _score as run_task

    version_id = await _confirmed_resume(candidate)

    first = await run_task(str(candidate), str(version_id))
    second = await run_task(str(candidate), str(version_id))

    assert first["status"] == "scored"
    assert second["status"] == "already_scored"
    assert first["score_id"] == second["score_id"]

    factory = sessions(_seed_url())
    async with factory() as session:
        count = await session.scalar(
            text("SELECT count(*) FROM scores WHERE user_id = :u"), {"u": str(candidate)}
        )
    assert count == 1


async def test_the_task_is_quiet_when_nothing_is_confirmed(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    """A superseded version whose replacement is not confirmed yet. Ordinary,
    and not worth a retry — the next confirmation emits its own event."""
    from app.tasks.score_resume import _score as run_task

    result = await run_task(str(candidate), str(uuid.uuid4()))
    assert result["status"] == "not_confirmed"


# --- the latest score -----------------------------------------------------
async def test_the_latest_score_is_the_most_recent(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    from app.modules.scoring import service

    await _confirmed_resume(candidate)
    await _score(candidate)
    second = await _score(candidate, AddOnContributions(course_points=30))

    factory = sessions(_seed_url())
    async with factory() as session:
        latest = await service.get_latest(session, user_id=candidate)

    assert latest is not None
    assert latest.id == second.score_id


async def test_one_candidates_score_is_not_anothers(
    candidate: uuid.UUID, stub_extractor: StubExtractor
) -> None:
    from app.modules.scoring import service

    await _confirmed_resume(candidate)
    await _score(candidate)

    factory = sessions(_seed_url())
    async with factory() as session:
        assert await service.get_latest(session, user_id=uuid.uuid4()) is None
