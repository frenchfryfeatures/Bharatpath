"""The global rate-limit tier, switched on.

The suite runs with `RATE_LIMIT_GLOBAL_ENABLED=false` because its single test
"IP" makes more requests a minute than any person could. These tests switch
it on with a tiny limit and a subject nobody else uses -- a fresh forwarded IP,
a fresh user, a fresh organisation -- because Redis counters outlive a test.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.settings import get_settings
from tests.integration.test_candidate_marketplace import _candidate

pytestmark = pytest.mark.integration

HEALTH = "/api/v1/health"
PRIVACY = "/api/v1/privacy/requests"


def _ip() -> str:
    n = uuid.uuid4().int
    return f"10.{n % 250}.{(n >> 8) % 250}.{(n >> 16) % 250}"


@pytest.fixture
def global_limits(monkeypatch: pytest.MonkeyPatch) -> Any:
    settings = get_settings()
    monkeypatch.setattr(settings, "rate_limit_global_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_per_ip_per_minute", 3)
    monkeypatch.setattr(settings, "rate_limit_per_user_per_minute", 3)
    monkeypatch.setattr(settings, "rate_limit_per_tenant_per_minute", 5)
    return settings


async def test_an_ip_is_limited_before_it_authenticates(client: Any, global_limits: Any) -> None:
    ip = {"X-Forwarded-For": _ip()}
    for _ in range(3):
        assert (await client.get(HEALTH, headers=ip)).status_code == 200
    over = await client.get(HEALTH, headers=ip)
    assert over.status_code == 429
    assert over.json()["code"] == "rate_limited"
    assert over.headers["Retry-After"] == "60"
    # A different address is a different budget.
    assert (await client.get(HEALTH, headers={"X-Forwarded-For": _ip()})).status_code == 200


async def test_a_spoofed_leading_forwarded_entry_does_not_buy_a_fresh_budget(
    client: Any, global_limits: Any
) -> None:
    real = _ip()
    for _ in range(3):
        await client.get(HEALTH, headers={"X-Forwarded-For": f"{_ip()}, {real}"})
    over = await client.get(HEALTH, headers={"X-Forwarded-For": f"{_ip()}, {real}"})
    assert over.status_code == 429, "only the hop our balancer appended counts"


async def test_a_user_is_limited_across_addresses(
    client: Any, mint_token: Any, global_limits: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = await _candidate(mint_token, scored=False)
    monkeypatch.setattr(global_limits, "rate_limit_per_ip_per_minute", 1000)
    for _ in range(3):
        headers = {**me["headers"], "X-Forwarded-For": _ip()}
        assert (await client.get(PRIVACY, headers=headers)).status_code == 200
    over = await client.get(PRIVACY, headers={**me["headers"], "X-Forwarded-For": _ip()})
    assert over.status_code == 429


async def test_an_organisation_shares_one_budget_across_its_staff(
    client: Any, mint_token: Any, global_limits: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(global_limits, "rate_limit_per_ip_per_minute", 1000)
    monkeypatch.setattr(global_limits, "rate_limit_per_user_per_minute", 1000)
    monkeypatch.setattr(global_limits, "rate_limit_per_tenant_per_minute", 1000)
    owner, _ = mint_token(pool="BUSINESS", email=f"{uuid.uuid4().hex[:10]}@example.test")
    created = await client.post(
        "/api/v1/employer/organisation", json={"legal_name": "Budget Pvt Ltd"}, headers=owner
    )
    assert created.status_code == 201, created.text

    monkeypatch.setattr(global_limits, "rate_limit_per_tenant_per_minute", 2)
    statuses = [
        (await client.get("/api/v1/employer/organisation", headers=owner)).status_code
        for _ in range(4)
    ]
    assert statuses[-1] == 429 and statuses.count(429) >= 1


async def test_the_global_tier_fails_open_and_a_specific_limit_fails_closed(
    client: Any, mint_token: Any, global_limits: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core import ratelimit

    me = await _candidate(mint_token, scored=False)

    def redis_down() -> Any:
        raise ConnectionError("redis is unreachable")

    monkeypatch.setattr(ratelimit, "get_redis", redis_down)
    headers = {**me["headers"], "X-Forwarded-For": _ip()}
    assert (await client.get(PRIVACY, headers=headers)).status_code == 200, (
        "a Redis outage must not take the whole API down"
    )
    refused = await client.post(f"{PRIVACY}/export", headers=headers)
    assert refused.status_code == 429
    assert refused.json()["code"] == "rate_limit_unavailable"
