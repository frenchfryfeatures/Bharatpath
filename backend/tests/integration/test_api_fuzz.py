"""Property-based fuzzing of every documented endpoint (schemathesis).

Excluded from the default run (`-m 'not contract'` in `pyproject.toml`) and
not yet green -- `docs/blockers.md` E43. A full run takes about fifteen
minutes.

---

## What this adds that the rest of the suite does not

Every other test here calls an endpoint the way the product calls it. This
one calls it the way the internet does: a UUID path parameter that is not a
UUID, an integer where a string is declared, a string 10,000 characters long,
a negative limit, a null in a required field, a unicode surrogate in a name.

Two things are asserted, and the first is the one that matters.

**`not_a_server_error`.** A 500 is the API failing to have an opinion. Every
input here is one the schema says is possible, so a 500 means an unvalidated
value reached a handler, a database driver, or a `str()` on something that
was `None`. 4xx is a pass -- refusing malformed input is the correct
behaviour and the whole point.

**`response_schema_conformance`.** A response whose shape contradicts
`openapi.json` breaks the four client teams, who generate their code from it.
This is the only test that checks the document against reality rather than
against another copy of itself.

## Authenticated, deliberately

Fuzzing anonymously would test one line -- `current_user` refusing -- over
and over, and `tests/invariants/test_route_authorisation.py` already proves
that properly for every route. A real candidate token gets the generated
input *past* authentication and into the handlers, schemas and queries, which
is where the bugs are. Most operations then answer 403 or 404 because a
candidate may not call them; that is still a pass, and the request has still
travelled through the validation the test exists to exercise.

## Bounded on purpose

`MAX_EXAMPLES` is small. This runs on every CI push beside 2,500 other tests,
and property-based testing has sharply diminishing returns per example on
handlers that mostly reject early. The value is breadth -- every operation
gets exercised with hostile input -- not depth on any one of them. Raise it
locally when hunting something:

    pytest tests/integration/test_api_fuzz.py -q --hypothesis-seed=0
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
import schemathesis
from hypothesis import HealthCheck, settings
from schemathesis.checks import not_a_server_error
from schemathesis.specs.openapi.checks import (
    content_type_conformance,
    response_schema_conformance,
    status_code_conformance,
)

# Run this alone with `pytest -m contract`.
pytestmark = [pytest.mark.integration, pytest.mark.contract]

#: Per operation. See the module docstring.
MAX_EXAMPLES = 8

#: The checks this runs, chosen rather than defaulted.
#:
#: **`positive_data_acceptance` is deliberately not here.** It fails an
#: operation that refuses schema-compliant input -- and this API refuses
#: plenty, correctly. `city: ""` and `state_code: "00"` satisfy every
#: constraint JSON Schema can express and are still not a city and not a
#: state, so a Pydantic validator rejects them with a 422. Semantic
#: validation beyond what the schema can say is the right behaviour, not a
#: defect, and a check whose premise is "the schema is the whole
#: specification" does not hold for any API with real domain rules. Including
#: it would mean either 150 permanent failures or watering down the
#: validators to satisfy a test.
#:
#: `negative_data_rejection` is likewise absent: FastAPI already rejects
#: malformed input structurally, and the useful question is not "was it
#: rejected" but "was it rejected *cleanly*" -- which is `not_a_server_error`.
CHECKS = [
    # The one that matters. A 500 means an input the schema says is possible
    # reached a handler, a driver or a `str()` on something that was None.
    not_a_server_error,
    # The three that hold `openapi.json` to what the API actually does. The
    # four client teams generate their code from that document, so a response
    # contradicting it breaks them and nothing else here would notice.
    response_schema_conformance,
    status_code_conformance,
    content_type_conformance,
]

#: Operations excluded, each with the reason. **Not a convenience list** --
#: anything here is an endpoint the fuzzer cannot reach usefully, never one
#: that failed and was silenced. A test below fails if an entry stops
#: matching a real operation, so the list cannot rot.
EXCLUDED: dict[tuple[str, str], str] = {
    ("POST", "/api/v1/billing/dev/payments/{payment_id}/simulate"): (
        "Settles a payment. Present only with the stub gateway, and fuzzing it "
        "would grant entitlements to the token this test runs as, changing "
        "what every later operation in the same run is allowed to do."
    ),
    ("POST", "/api/v1/privacy/requests/deletion"): (
        "Erases the account the fuzzer is authenticated as, so every operation "
        "generated after it would run as a deleted user and test the erasure "
        "rather than itself."
    ),
}


@pytest.fixture
def fuzz_schema(app: Any) -> Any:
    """The live schema, loaded from the running app rather than the committed
    `openapi.json` -- so this cannot pass against a stale file."""
    schema = schemathesis.openapi.from_asgi("/api/v1/openapi.json", app)
    schema.config.update(base_url="http://testserver")
    return schema


api = schemathesis.pytest.from_fixture("fuzz_schema")


@api.parametrize()
@settings(
    max_examples=MAX_EXAMPLES,
    deadline=None,  # an ASGI round trip through the real stack is not fast
    # The generated data is deliberately hostile, so Hypothesis will often
    # filter and often find the same shallow rejection twice. Neither is a
    # problem with the test.
    suppress_health_check=[
        HealthCheck.too_slow,
        HealthCheck.filter_too_much,
        HealthCheck.function_scoped_fixture,
    ],
)
async def test_no_operation_answers_a_server_error(
    case: Any, client: Any, fuzz_headers: dict[str, str]
) -> None:
    """Generate one request, send it, and hold the answer to the checks.

    **The request is sent through the suite's own httpx client, not by
    `case.call_and_validate`.** Schemathesis' ASGI transport drives the app in
    an event loop it owns, and this suite already has one: `conftest` memoises
    a Redis client per test and disposes it in teardown, so a pool opened
    inside schemathesis' loop is closed from pytest-asyncio's. That surfaces
    as `got Future attached to a different loop` out of Redis teardown --
    a failure that looks like a fuzzing finding and is entirely an artefact of
    running two loops.

    Dispatching through the shared client keeps everything on one loop, and
    costs nothing: `as_transport_kwargs` is the same request, and
    `validate_response` takes an `httpx.Response` directly.
    """
    if (case.method.upper(), case.path) in EXCLUDED:
        pytest.skip(EXCLUDED[(case.method.upper(), case.path)])

    request = case.as_transport_kwargs(headers=fuzz_headers)
    response = await client.request(**_httpx_kwargs(request))
    case.validate_response(response, checks=CHECKS)


def _hostile(value: Any) -> str:
    """Make a generated value JSON-encodable without softening it.

    Schemathesis generates deliberately wrong types -- `bytes` where the
    schema says string is a normal, useful case. `json.dumps` refuses them,
    and the request then fails in the test process before the API ever sees
    it, which reads as 150 broken endpoints and is really one unencodable
    value. Latin-1 maps any byte to a character, so the hostile value still
    arrives; it is just carried as text, which is what an HTTP JSON body is.
    """
    if isinstance(value, bytes):
        return value.decode("latin-1")
    return str(value)


def _httpx_kwargs(request: dict[str, Any]) -> dict[str, Any]:
    """Schemathesis' transport kwargs, in the form httpx takes.

    Nearly a pass-through: `as_transport_kwargs` already chooses `json`,
    `data` or `files` from the operation's media type, so reconstructing the
    body here would only be a second, worse copy of that decision. The one
    change is encoding a `json` body ourselves, because httpx would refuse
    the hostile values the generator exists to produce.
    """
    kwargs: dict[str, Any] = {
        "method": request["method"],
        "url": request["url"],
        "headers": dict(request["headers"]),
        "params": request.get("params") or {},
        "cookies": request.get("cookies") or {},
    }
    if "json" in request:
        kwargs["content"] = json.dumps(request["json"], default=_hostile)
        kwargs["headers"].setdefault("Content-Type", "application/json")
    elif "data" in request:
        kwargs["data"] = request["data"]
    elif "files" in request:
        kwargs["files"] = request["files"]
    return kwargs


@pytest.fixture
def fuzz_headers(mint_token: Any) -> dict[str, str]:
    """A real candidate token. See the module docstring for why the fuzzer is
    authenticated rather than anonymous."""
    headers, _ = mint_token(pool="CANDIDATE", subject=f"fuzz-{uuid.uuid4()}")
    return dict(headers)


def test_the_exclusion_list_has_no_stale_entries(app: Any) -> None:
    """An entry that no longer names a real operation is an exclusion nobody
    is applying and a reader would still believe. Same guard as `PUBLIC` in
    `test_route_authorisation.py`."""
    documented = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    }
    stale = set(EXCLUDED) - documented
    assert not stale, f"EXCLUDED names operations that do not exist: {sorted(stale)}"


def test_the_fuzzer_covers_almost_every_operation(app: Any) -> None:
    """Guards the guard. If the schema failed to load, or a filter silently
    matched everything, this test file would pass while fuzzing nothing."""
    documented = [
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    ]
    assert len(documented) > 100, f"only {len(documented)} operations; the schema did not load"
    assert len(EXCLUDED) < 5, "exclusions are growing; each one is an operation nobody fuzzes"
