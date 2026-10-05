"""Invariant 7: masked without an active access window, and the raw score never revealed.

Restructured by R14. There is no per-candidate unlock: the employer's
subscription IS the access window, checked by `require_active_access_window`
on the one route that reveals a candidate. So this holds four things:

* the reveal refuses an employer without a live window, **including one whose
  window ended a moment ago** -- there is no cached entitlement to go stale;
* no employer response, anywhere, has a field for the raw score;
* the revealed profile carries exactly its agreed fields;
* **export is not a feature**: no file downloads, no bulk or export routes, and
  a revealed profile never appears inside a list.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from sqlalchemy import text

from app.core.pagination import MAX_PAGE_SIZE
from tests.conftest import _seed_url, sessions
from tests.integration.test_candidate_marketplace import API, _employer
from tests.integration.test_masked_search import SEARCH, _candidate, _token

pytestmark = pytest.mark.invariant

REVEAL_PATH = f"{API}/employer/discovery/candidates/{{candidate_id}}"
#: What an employer sees once they open a profile. Widening it is a product
#: decision about every candidate's personal data, not a refactor.
REVEALED_FIELDS = frozenset(
    {
        "candidate_id",
        "full_name",
        "phone",
        "email",
        "score",
        "band",
        "experience_years",
        "skills",
        "badges",
        "city",
        "state_code",
        # 2026-10-05: the confirmed CV the score was built from, asked for by
        # the employer portal and agreed by the backend owner.
        "resume",
        # 2026-10-05: the organisation's own shortlist record of this person.
        "shortlist",
    }
)
EMPLOYER_SURFACES = (f"{API}/employer", f"{API}/college", f"{API}/admin")
JSON_TYPES = {"application/json", "application/problem+json"}


def _schema_names(spec: dict[str, Any], node: Any, seen: set[str] | None = None) -> set[str]:
    """Every component schema reachable from `node`."""
    seen = set() if seen is None else seen
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            name = ref.rsplit("/", 1)[1]
            if name not in seen:
                seen.add(name)
                _schema_names(spec, spec["components"]["schemas"][name], seen)
        for value in node.values():
            _schema_names(spec, value, seen)
    elif isinstance(node, list):
        for value in node:
            _schema_names(spec, value, seen)
    return seen


def _employer_operations(spec: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    return [
        (method.upper(), path, operation)
        for path, operations in spec["paths"].items()
        if path.startswith(EMPLOYER_SURFACES)
        for method, operation in operations.items()
    ]


def _success_schema(operation: dict[str, Any]) -> Any:
    return {
        code: response.get("content", {})
        for code, response in operation.get("responses", {}).items()
        if code.startswith("2")
    }


# --- structure ------------------------------------------------------------------
def test_no_employer_response_has_a_field_for_the_raw_score(app: Any) -> None:
    """R4: "no real score ever". The display score may be revealed; the stored
    raw value is never serialized to an employer, a college or an admin screen."""
    spec = app.openapi()
    offenders: list[str] = []
    for method, path, operation in _employer_operations(spec):
        for name in _schema_names(spec, _success_schema(operation)):
            properties = spec["components"]["schemas"][name].get("properties", {})
            offenders += [
                f"{method} {path} -> {name}.{field}"
                for field in properties
                if "raw" in field.lower()
            ]
    assert not offenders, offenders


def test_the_revealed_profile_carries_exactly_the_agreed_fields(app: Any) -> None:
    from app.modules.candidate.schemas import RevealedCandidate

    assert set(RevealedCandidate.model_fields) == REVEALED_FIELDS
    spec = app.openapi()
    operation = spec["paths"][REVEAL_PATH]["get"]
    assert "RevealedCandidate" in _schema_names(spec, _success_schema(operation))


def test_the_revealed_profile_refuses_a_raw_score() -> None:
    from pydantic import ValidationError

    from app.modules.candidate.schemas import RevealedCandidate

    with pytest.raises(ValidationError):
        RevealedCandidate.model_validate(
            {
                "candidate_id": "6f1c2a9e-4a8d-4f5e-9f7a-3c2b1d0e9f8a",
                "score": 812,
                "raw_value": 812,
                "band": "SOLID",
                "experience_years": 3,
                "skills": [],
                "badges": [],
            }
        )


def test_export_is_not_a_feature(app: Any) -> None:
    """One payment buys the whole pool (R14), so a way to take it all at once is
    the thing the abuse controls exist to prevent. No file responses, no route
    named for exporting, and a revealed profile only ever arrives one at a time."""
    spec = app.openapi()
    for method, path, operation in _employer_operations(spec):
        lowered = path.lower()
        assert not [w for w in ("export", "download", "bulk", "csv") if w in lowered], path
        for content in _success_schema(operation).values():
            assert set(content) <= JSON_TYPES, f"{method} {path} answers {sorted(content)}"
        if (method, path) != ("GET", REVEAL_PATH):
            reached = _schema_names(spec, _success_schema(operation))
            assert "RevealedCandidate" not in reached, f"{method} {path} returns revealed profiles"

    limit = next(p for p in spec["paths"][SEARCH]["get"]["parameters"] if p["name"] == "limit")
    assert "maximum" in json.dumps(limit["schema"]) and str(MAX_PAGE_SIZE) in json.dumps(limit)


# --- behaviour ------------------------------------------------------------------
async def _reveal(client: Any, employer: dict[str, Any], candidate_id: Any) -> Any:
    return await client.get(f"{SEARCH}/{candidate_id}", headers=employer["headers"])


async def _end_window(tenant_id: str) -> None:
    async with sessions(_seed_url())() as session, session.begin():
        await session.execute(
            text(
                "UPDATE subscriptions SET current_period_start = now() - interval '2 days', "
                "current_period_end = now() - interval '1 second' "
                "WHERE subscriber_type = 'TENANT' AND subscriber_id = :t"
            ),
            {"t": tenant_id},
        )


@pytest.mark.integration
async def test_a_window_lapsing_mid_session_refuses_the_very_next_read(
    client: Any, mint_token: Any
) -> None:
    """The plan's expiry test. Same token, same session, one request apart."""
    candidate = await _candidate(mint_token, _token())
    employer = await _employer(client, mint_token)

    opened = await _reveal(client, employer, candidate["id"])
    assert opened.status_code == 200, opened.text

    await _end_window(employer["tenant_id"])

    refused = await _reveal(client, employer, candidate["id"])
    assert refused.status_code == 402, refused.text
    assert refused.json()["code"] == "access_window_expired"
    assert opened.json()["phone"] not in refused.text

    search = await client.get(SEARCH, headers=employer["headers"])
    assert search.status_code == 402
    assert search.json()["code"] == "subscription_required"


@pytest.mark.integration
async def test_an_employer_with_no_window_is_never_shown_a_profile(
    client: Any, mint_token: Any
) -> None:
    from tests.integration.test_jobs import _set_kyb

    candidate = await _candidate(mint_token, _token())
    headers, _ = mint_token(pool="BUSINESS", email=f"{_token()}@example.test")
    created = await client.post(
        f"{API}/employer/organisation", json={"legal_name": "Unpaid Pvt Ltd"}, headers=headers
    )
    assert created.status_code == 201, created.text
    await _set_kyb(created.json()["tenant_id"], "APPROVED")

    response = await client.get(f"{SEARCH}/{candidate['id']}", headers=headers)
    assert response.status_code == 402
    assert response.json()["code"] == "access_window_expired"
