"""Who reads the candidate's message (2026-10-13), behind one interface.

The planner turns a message into the JSON `domain.parse_plan` reads. It
decides what to do and what to say; code does it. Two implementations:

* **OpenAI** (`openai_planner.py`) -- the default.
* **Stub** -- tests and local work without a key; `Settings` refuses it in
  staging and production. Deterministic from the message: a few English
  keywords, so a developer can drive the chat by hand.

What a real implementation must satisfy:

  * It is shown `domain.PlanContext` and nothing else: no score, no
    threshold, no name, contact, CV or profile.
  * It returns exactly the shape `domain.parse_plan` reads. A refused plan
    is never repaired: the planner is asked again, told why
    (`PlanContext.refused`), up to `MAX_PLAN_ATTEMPTS`, then 503.
  * `model_id` pinned exactly and `prompt_version` bumped on any change to
    the instructions.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Any, Protocol

from fastapi import status

from app.core.errors import AppError
from app.modules.assistant.domain import PlanContext
from app.settings import get_settings


class AssistantUnavailableError(AppError):
    """The model could not be reached, or wrote nothing usable in
    `MAX_PLAN_ATTEMPTS` tries. Nothing happened; send the message again."""

    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    code = "assistant_unavailable"
    title = "The assistant could not answer just now"


class Planner(Protocol):
    name: str
    model_id: str
    prompt_version: str

    async def plan(self, *, context: PlanContext) -> dict[str, Any]: ...


_NUMBER = re.compile(r"\b(\d{1,2})\b")
_IN_PLACE = re.compile(r"\bin ([a-z][a-z ]{1,40})$")
_FILLER = frozenset(
    {"find", "search", "show", "me", "some", "any", "jobs", "job", "for", "a", "an", "the", "i",
     "want", "need", "looking", "please", "remote", "hybrid", "onsite"}
)  # fmt: skip


class StubPlanner:
    """Keywords, not language. "find python jobs in pune", "more", "show 2",
    "apply 1", "my applications", "match my profile", "similar"."""

    name = "stub"
    model_id = "stub-planner"
    prompt_version = "stub-1"

    async def plan(self, *, context: PlanContext) -> dict[str, Any]:
        text = " ".join(context.message.lower().split())
        words = set(re.findall(r"[a-z]+", text))
        number = _NUMBER.search(text)
        plan: dict[str, Any] = {
            "action": "REPLY",
            "search": None,
            "job_number": None,
            "applications": None,
            "reply": "Stub assistant: try 'find python jobs in pune'.",
            "reply_if_no_results": "Stub assistant: nothing found.",
            "suggestions": ["find jobs", "match my profile"],
        }
        if words & {"apply", "show", "open", "details"} and number:
            action = "APPLY" if "apply" in words else "SHOW_JOB"
            plan.update(action=action, job_number=int(number.group(1)), reply=f"Stub: {action}.")
        elif "more" in words:
            plan.update(action="MORE_RESULTS", reply="Stub: more jobs.")
        elif "applications" in words:
            plan.update(action="MY_APPLICATIONS", reply="Stub: your applications.")
        elif "profile" in words:
            plan.update(action="MATCH_MY_PROFILE", reply="Stub: jobs for your profile.")
        elif "similar" in words:
            plan.update(action="SIMILAR_TO_APPLIED", reply="Stub: jobs like those you applied to.")
        elif words & {"find", "search", "jobs", "job"}:
            place = _IN_PLACE.search(text)
            before = text[: place.start()] if place else text
            terms = [w for w in re.findall(r"[a-z0-9+#.]+", before) if w not in _FILLER]
            mode = next((m.upper() for m in ("remote", "hybrid", "onsite") if m in words), None)
            plan.update(
                action="SEARCH",
                search={
                    "keywords": terms,
                    "skills": terms,
                    "locations": [place.group(1).strip()] if place else [],
                    "work_mode": mode,
                    "min_salary_rupees": None,
                    "experience_years": None,
                    "only_jobs_open_to_me": "eligible" in words,
                },
                reply="Stub: here are some jobs.",
            )
        return plan


@lru_cache(maxsize=1)
def get_planner() -> Planner:
    settings = get_settings()
    if settings.assistant_provider == "openai":
        # Imported here: `openai_planner` imports this module.
        from app.modules.assistant.openai_planner import OpenAIPlanner

        return OpenAIPlanner(model_id=settings.assistant_model_id)
    if settings.assistant_provider == "stub":
        return StubPlanner()
    # Unreachable while `Settings` allows only the two above.
    raise AssistantUnavailableError()
