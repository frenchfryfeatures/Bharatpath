"""scoring - SQLAlchemy ORM models.

Engine interface, versions, history, breakdown.

**This table is where invariants 1, 2 and 3 live.** Three rules govern it and
none is enforced by remembering:

* **INSERT-only.** The application role has no UPDATE and no DELETE on
  `scores`. "Score history" is simply every row; nothing is ever mutated.
* **Reproducible.** Every row stores the complete chain that produced it -
  resume version, algorithm version, the add-on completions folded in, and the
  full model-extraction chain. `replay(score_id)` recomputes from stored
  inputs and **never re-invokes the model**, so a dispute raised in 2029 about
  a score computed in 2026 gets an exact answer.
* **Never explained to the candidate.** `breakdown` is computed and stored for
  admin drill-down and disputes, and no candidate-facing schema may expose it
  (client, 2026-08-27). A schema test enforces that, not a code review.

**The arithmetic** (client, 2026-08-27), which closes exactly:

    base                                    700
    resume judgment      0 - 200      ->  700 - 900
    course (one, once)        +30      ->  730 - 930
    interviews (3 x 20)       +60      ->  790 - 990
                                            ---
    maximum                                 990   = 700 + 200 + 30 + 60
    minimum                                 700

990 is arithmetic, not a clamp. The CHECK constraint below asserts the range;
**if it ever fires, that is a bug, not a business rule.**
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.mixins import UUIDPrimaryKey


class Score(Base, UUIDPrimaryKey):
    """One computed score. Never updated, never deleted."""

    __tablename__ = "scores"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    resume_version_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("resume_versions.id"), nullable=False
    )
    algorithm_version: Mapped[str] = mapped_column(String(32), nullable=False)

    # -- the number, decomposed ------------------------------------------
    # `base_value` is the resume-derived part (700 + 0..200). `addon_value` is
    # the bounded sum of contributions. Both are stored because
    # `resume_version_id` alone stopped reproducing the total the moment the
    # client made add-ons move the score (2026-08-24).
    raw_value: Mapped[int] = mapped_column(Integer, nullable=False)
    base_value: Mapped[int] = mapped_column(Integer, nullable=False)
    addon_value: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Exactly which completions were folded in, with their ids. Without this,
    # replay recomputes a base score and disagrees with the stored total the
    # first time anyone buys a course.
    contributing_events: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb"), nullable=False
    )
    contribution_version: Mapped[str] = mapped_column(String(32), nullable=False)

    # -- the model-extraction chain (scoring-approach.md section 5) --------
    # Stored so replay never has to call the model again. This is what makes
    # replay bit-identical in perpetuity, even after the model is retired.
    model_id: Mapped[str | None] = mapped_column(String(128))
    prompt_version: Mapped[str | None] = mapped_column(String(32))
    prompt_hash: Mapped[str | None] = mapped_column(String(64))
    raw_model_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    extracted_features: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    taxonomy_version: Mapped[str | None] = mapped_column(String(32))
    rubric_version: Mapped[str | None] = mapped_column(String(32))

    #: Which `resume_extractions` row Layer 1 came from. Not needed to replay
    #: -- the response is on this row, which is the whole point of storing it
    #: -- but it is the **only** link from a person to the extraction cache,
    #: and without it an erasure cannot reach the cached reading of their CV
    #: The cache is content-addressed and shared, so the erasure
    #: deletes a key only when no other candidate's score still names it.
    extraction_cache_key: Mapped[str | None] = mapped_column(String(64), index=True)

    # Stored for admin drill-down and disputes. NEVER serialized to a
    # candidate - the client confirmed the score is never explained.
    breakdown: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb"), nullable=False
    )

    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        # Invariant 2. An assertion that fires here is a bug, not a rule.
        CheckConstraint("raw_value BETWEEN 700 AND 990", name="ck_scores_range_700_990"),
        CheckConstraint("base_value BETWEEN 700 AND 900", name="ck_scores_base_range"),
        # Invariant 4-prime at the database level: course +30, interviews +60.
        CheckConstraint("addon_value BETWEEN 0 AND 90", name="ck_scores_addon_cap"),
        CheckConstraint("raw_value = base_value + addon_value", name="ck_scores_components_sum"),
        Index("ix_scores_user_computed", "user_id", "computed_at"),
        Index("ix_scores_resume_version", "resume_version_id"),
    )


# "The latest score per candidate" is `DISTINCT ON (user_id) ... ORDER BY
# user_id, computed_at DESC, id DESC` inside the discovery visibility CTE, which
# every masked search runs. `ix_scores_user_computed` is ascending on
# `computed_at` and lacks `id`, so it cannot serve that order; this one matches
# it exactly.
Index("ix_scores_user_latest", Score.user_id, Score.computed_at.desc(), Score.id.desc())


class ResumeExtraction(Base):
    """The reproducibility spine (scoring-approach.md section 6).

    Content-addressed on the *normalised CV text* plus the model, prompt and
    schema versions - not on the resume id and not on the user id. Three
    things follow:

      * The model is called **exactly once per distinct CV, ever.**
      * Re-scoring after a course purchase reads this table and never calls
        the model: no cost, no drift, instant.
      * **Two candidates with identical CV text share one entry**, so
        cross-candidate consistency is exact rather than probabilistic.
    """

    __tablename__ = "resume_extractions"

    # sha256(normalised_text + model_id + prompt_version + schema_version)
    cache_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    model_id: Mapped[str] = mapped_column(String(128), nullable=False)
    prompt_version: Mapped[str] = mapped_column(String(32), nullable=False)
    schema_version: Mapped[str] = mapped_column(String(32), nullable=False)
    raw_response: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    extracted_features: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
