"""scoring - Pydantic request/response DTOs

Engine interface, versions, history, breakdown.

Separate Create / Update / Read schemas. ORM models are never exposed
directly - the schema IS the API contract, and for several modules it is also
where an invariant is enforced structurally.

**Nothing in this file may explain a score.** The client confirmed on
2026-08-27 and again on 2026-09-11 that the score is never explained to the
candidate: no breakdown screen, no category detail, no improvement
suggestions. The breakdown is still computed and stored -- admin drill-down
and dispute handling need it -- but it must not reach a candidate-facing
response, and `tests/invariants/test_score_never_explained.py` reads this
module and fails the build on a field that would.

That test scans every schema here, so the admin drill-down view does not
belong in this file. It lives in `admin`, where the role guard is.

**This contradicts PRD section 4.2**, which promises a category-by-category
breakdown and top improvement suggestions. The rescission is recorded
(`questions.txt` Q12, answered 7.3). The knock-on in PRD 4.5 -- telling a
candidate "what would need to improve" against a job threshold -- goes the
same way: eligibility messaging stays generic.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.core.schemas import ApiSchema


class _Base(ApiSchema):
    """Every schema in this module. `ApiSchema` strips the control
    characters Postgres cannot store -- see `app/core/schemas.py`."""


#: PENDING is an ordinary state, not an error. A candidate who has confirmed a
#: resume but whose scoring job has not finished is waiting, and the client
#: shows a spinner rather than a 404 for a resource that is about to exist.
#:
#: It is also what every failure resolves to. `scoring-approach.md` section 11:
#: we never produce a partial or degraded score, because a plausible wrong
#: number is unfixable once the candidate has seen it.
ScoreStatus = Literal["READY", "PENDING"]


class CandidateScoreResponse(_Base):
    """The candidate's own score. **The number, and nothing about it.**

    Deliberately absent, and each one is a decision rather than an oversight:

    * `breakdown` -- the score is never explained (client, 2026-08-27).
    * `base_value` / `addon_value` -- their difference is a breakdown by
      another name. A candidate who could see the split could compute what
      their course was worth, and the client's position is that they see the
      number only.
    * `model_id`, `prompt_version`, `raw_model_response`, `extracted_features`
      -- the reproducibility chain. It exists for disputes and admin
      drill-down, and it is not the candidate's view.
    * `resume_version_id` -- internal, and it would let a client correlate
      scores across versions into exactly the improvement history the client
      declined to show.
    """

    status: ScoreStatus
    value: int | None = Field(
        default=None,
        ge=700,
        le=990,
        description="The score, 700-990. Null while PENDING. Passed through "
        "`display_value` at this boundary and nowhere else, so what is stored "
        "is what was computed and what is shown is what is stored.",
    )
    band: str | None = Field(
        default=None,
        description="ENTRY, DEVELOPING, SOLID or STRONG. Null while PENDING.",
    )
    computed_at: datetime | None = None


class ScoreBandResponse(_Base):
    band: str = Field(description="ENTRY, DEVELOPING, SOLID or STRONG.")
    lowest: int = Field(description="Inclusive.")
    highest: int = Field(description="Inclusive.")


class ScoreScaleResponse(_Base):
    """The scale every score sits on, so a client never hardcodes it.

    **A fact about the scale, never about a person.** It is the same for
    everyone, which is why it is not behind the paywall: it says nothing about
    this candidate's number. What it must not become is a way to explain one --
    no distance to the next band, no split of the scale into what earns what.
    Those are a breakdown by another route (R11), and the forbidden-name scan
    in `test_score_never_explained.py` covers this schema like every other.
    """

    lowest: int = Field(description="The lowest score anyone can be shown (700).")
    highest: int = Field(description="The highest score anyone can hold (990).")
    bands: list[ScoreBandResponse] = Field(
        description="In order, lowest first. Together they cover the scale with no gap."
    )


class ScoreReplayResponse(_Base):
    """The result of re-running a stored score from its stored inputs.

    Not candidate-facing -- this answers a dispute, and the route that serves
    it is guarded. It still carries no breakdown: what a replay proves is that
    the number reproduces, and the number is the thing in dispute. The stored
    breakdown reaches a human through the admin drill-down, behind a role
    that is allowed to see it.
    """

    score_id: uuid.UUID
    reproduced: bool = Field(
        description="True when the stored score recomputed to the same value. "
        "A false here never reaches a client: a mismatch raises, because a "
        "replay that quietly disagrees would be used to answer a dispute and "
        "would answer it wrongly."
    )
    value: int
    algorithm_version: str
