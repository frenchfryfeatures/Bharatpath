"""One call to the OpenAI Responses API with a strict JSON schema, and nothing else.

Shared by CV extraction (`scoring/openai_extractor.py`) and interview feedback
(`interview/evaluation.py`). Both want the same thing: JSON shaped by *our*
schema or a typed failure -- never prose, never a partial answer.

Plain `httpx`, not the `openai` SDK: the surface used is one endpoint, and a
transport a test can replace (`_transport`) is what lets the suite prove what
we send without calling a model.

* **`store: false`.** Nothing we send is kept for the dashboard or training.
* **No sampling parameters.** Reasoning models reject `temperature`; stability
  comes from coarse anchored ratings and the extraction cache, not sampling.
* **Where the text goes.** The default endpoint processes in the US, so a CV
  sent here leaves India. Plan §13 N2 permits that while it is open; say so
  wherever it matters, and point `OPENAI_BASE_URL` at a data-residency
  project if N2 closes the other way.
"""

from __future__ import annotations

import json
from typing import Any, Final

import httpx
from pydantic import BaseModel

from app.core.logging import get_logger
from app.settings import get_settings

logger = get_logger(__name__)

#: A reasoning model on a long CV takes tens of seconds. A timeout shorter
#: than the call turns every slow success into a retry that bills again.
TIMEOUT: Final = httpx.Timeout(180.0, connect=10.0)

#: Keywords strict mode refuses. Our own `model_validate` still enforces them
#: after the call -- a schema the API enforced is a claim, validation is the check.
_UNSUPPORTED: Final = frozenset({"default", "maxLength", "minLength", "title", "propertyNames"})

#: Replaced in tests with an `httpx.MockTransport`. Never set in the app.
_transport: httpx.AsyncBaseTransport | None = None


class OpenAIUnavailableError(Exception):
    """Not reached, refused, throttled or failing. Retryable; not about the input."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class OpenAIOutputInvalidError(Exception):
    """The model answered, but not usably: truncated, refused, or not JSON."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def strict_schema(schema: dict[str, Any] | type[BaseModel]) -> dict[str, Any]:
    """A JSON schema in the shape strict structured outputs accepts.

    Every object closed and every property required (an optional field is a
    nullable one, which pydantic already writes as `anyOf [..., null]`), and
    the keywords strict mode rejects removed.
    """
    raw = schema.model_json_schema() if isinstance(schema, type) else schema
    strict: dict[str, Any] = _strict(json.loads(json.dumps(raw)))
    return strict


def _strict(node: Any) -> Any:
    if isinstance(node, list):
        return [_strict(item) for item in node]
    if not isinstance(node, dict):
        return node
    out = {k: _strict(v) for k, v in node.items() if k not in _UNSUPPORTED}
    if isinstance(node.get("properties"), dict):
        # Keys under `properties` are field names, not keywords: a field
        # called `title` (a role's job title) must survive the stripping.
        out["properties"] = {k: _strict(v) for k, v in node["properties"].items()}
    if out.get("type") == "object" and isinstance(out.get("properties"), dict):
        out["additionalProperties"] = False
        out["required"] = list(out["properties"])
    if "$ref" in out:
        # A $ref may not carry siblings in strict mode.
        return {"$ref": out["$ref"]}
    return out


async def create_json_response(
    *,
    model: str,
    instructions: str,
    user_text: str,
    schema_name: str,
    schema: dict[str, Any],
    max_output_tokens: int,
    reasoning_effort: str,
) -> dict[str, Any]:
    """POST /responses. Returns the whole response body as a dict."""
    settings = get_settings()
    if settings.openai_api_key is None:
        raise OpenAIUnavailableError("no_api_key")
    payload = {
        "model": model,
        "instructions": instructions,
        "input": user_text,
        "reasoning": {"effort": reasoning_effort},
        "text": {
            "format": {"type": "json_schema", "name": schema_name, "schema": schema, "strict": True}
        },
        "max_output_tokens": max_output_tokens,
        "store": False,
    }
    headers = {"Authorization": f"Bearer {settings.openai_api_key.get_secret_value()}"}
    try:
        async with httpx.AsyncClient(
            base_url=settings.openai_base_url, timeout=TIMEOUT, transport=_transport
        ) as client:
            response = await client.post("/responses", json=payload, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("openai_unreachable", model=model, reason=type(exc).__name__)
        raise OpenAIUnavailableError(type(exc).__name__) from exc

    if response.status_code != 200:
        # The error body names the problem (a schema the API rejected, a model
        # the key cannot use) and never echoes the input, so it is safe to log.
        detail = _error_detail(response)
        logger.warning("openai_refused", model=model, status=response.status_code, detail=detail)
        raise OpenAIUnavailableError(f"http_{response.status_code}")
    body: dict[str, Any] = response.json()
    return body


def output_json(body: dict[str, Any]) -> Any:
    """The JSON the model wrote, or `OpenAIOutputInvalidError`."""
    if body.get("status") == "incomplete":
        reason = (body.get("incomplete_details") or {}).get("reason") or "incomplete"
        raise OpenAIOutputInvalidError(str(reason))
    if body.get("status") not in (None, "completed"):
        raise OpenAIOutputInvalidError(f"status_{body.get('status')}")
    texts: list[str] = []
    for item in body.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for part in item.get("content") or []:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "refusal":
                raise OpenAIOutputInvalidError("refusal")
            if part.get("type") == "output_text" and isinstance(part.get("text"), str):
                texts.append(part["text"])
    if len(texts) != 1:
        raise OpenAIOutputInvalidError("no_output")
    try:
        return json.loads(texts[0])
    except json.JSONDecodeError as exc:
        raise OpenAIOutputInvalidError("not_json") from exc


def storable(body: dict[str, Any]) -> dict[str, Any]:
    """What is kept for the record: the answer, the model that gave it, why it
    stopped, and what it cost. Not the response id or reasoning item ids, which
    say nothing about the input and would make identical answers differ."""
    kept = {
        "model": body.get("model"),
        "status": body.get("status"),
        "incomplete_details": body.get("incomplete_details"),
        "output_text": [
            part.get("text")
            for item in body.get("output") or []
            if isinstance(item, dict) and item.get("type") == "message"
            for part in item.get("content") or []
            if isinstance(part, dict) and part.get("type") == "output_text"
        ],
        "usage": body.get("usage"),
    }
    return dict(json.loads(json.dumps(kept, default=str)))


def _error_detail(response: httpx.Response) -> str:
    try:
        error = response.json().get("error") or {}
        return str(error.get("code") or error.get("type") or error.get("message") or "")[:200]
    except (ValueError, AttributeError):
        return ""
