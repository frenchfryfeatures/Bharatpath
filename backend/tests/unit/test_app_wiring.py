"""Smoke tests: the app builds, every module is registered, health works."""

from __future__ import annotations

import pytest

from app.modules import ALL_MODULES


def test_all_modules_registered() -> None:
    """Every module in the registry exposes a name, a prefix and a router hook.

    The client teams generate their code from openapi.json, which only lists
    what is mounted. Twenty modules from the plan, plus `engagement` (streaks).
    """
    assert len(ALL_MODULES) == 21
    for module in ALL_MODULES:
        assert isinstance(module.name, str) and module.name
        assert module.prefix.startswith("/")
        assert hasattr(module, "get_router")


def test_module_prefixes_are_unique() -> None:
    prefixes = [m.prefix for m in ALL_MODULES]
    assert len(prefixes) == len(set(prefixes)), "two modules share a prefix"


def test_app_builds(app) -> None:
    assert app.title == "BharatPath"


async def test_health_endpoint(client) -> None:
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_openapi_schema_generates(client) -> None:
    """The OpenAPI export is a deliverable, not a side effect."""
    response = await client.get("/api/v1/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["info"]["title"] == "BharatPath"
    assert "/api/v1/health" in schema["paths"]


@pytest.mark.parametrize("path", ["/api/v1/health", "/api/v1/health/ready"])
async def test_correlation_id_on_every_response(client, path: str) -> None:
    response = await client.get(path)
    assert response.headers.get("X-Request-ID")
