"""Push content and delivery states without a live provider or database."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.modules.notifications import push
from app.modules.notifications.schemas import PushDeviceRequest


def test_push_payload_keeps_private_inbox_text_off_lock_screen() -> None:
    payload = push.push_payload(
        token="ExpoPushToken[example]",
        notification_id=str(uuid.uuid4()),
        template_code="IN_APP_APPLICATION_UPDATE",
    )
    assert payload["title"] == "Application update"
    assert payload["body"] == "You have a new update. Open BharatPath to read it."
    assert payload["channelId"] == "default"
    assert payload["sound"] == "default"


def test_only_expo_tokens_are_accepted() -> None:
    PushDeviceRequest(token="ExpoPushToken[abcdefghijklmnop]", platform="android")
    with pytest.raises(ValueError):
        PushDeviceRequest(token="https://attacker.example/", platform="android")


@pytest.mark.asyncio
async def test_invalid_device_is_deactivated(monkeypatch: pytest.MonkeyPatch) -> None:
    delivery = SimpleNamespace(state="PENDING", attempts=0, attempted_at=None, failure_code=None)
    notification = SimpleNamespace(
        id=uuid.uuid4(), template_code="IN_APP_APPLICATION_UPDATE", read_at=None
    )
    device = SimpleNamespace(id=uuid.uuid4(), token="ExpoPushToken[abcdefghijklmnop]")
    deactivated = []

    async def pending(*args, **kwargs):
        return [(delivery, notification, device)]

    async def deactivate(*args, **kwargs):
        deactivated.append(kwargs["device_id"])

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"data": {"status": "error", "details": {"error": "DeviceNotRegistered"}}}

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(push.repository, "pending_push_deliveries", pending)
    monkeypatch.setattr(push.repository, "deactivate_push_device", deactivate)
    monkeypatch.setattr(push.httpx, "AsyncClient", FakeClient)
    assert await push.send_one(SimpleNamespace()) == "FAILED"
    assert delivery.failure_code == "DeviceNotRegistered"
    assert deactivated == [device.id]


@pytest.mark.asyncio
async def test_malformed_expo_response_fails_without_crashing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    delivery = SimpleNamespace(state="PENDING", attempts=0, attempted_at=None, failure_code=None)
    notification = SimpleNamespace(
        id=uuid.uuid4(), template_code="IN_APP_APPLICATION_UPDATE", read_at=None
    )
    device = SimpleNamespace(id=uuid.uuid4(), token="ExpoPushToken[abcdefghijklmnop]")

    async def pending(*args, **kwargs):
        return [(delivery, notification, device)]

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"data": None}

    class FakeClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return FakeResponse()

    monkeypatch.setattr(push.repository, "pending_push_deliveries", pending)
    monkeypatch.setattr(push.httpx, "AsyncClient", FakeClient)
    assert await push.send_one(SimpleNamespace()) == "FAILED"
    assert delivery.failure_code == "provider_rejected"
