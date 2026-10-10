"""Expo push delivery for already persisted in-app messages."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.notifications import repository

logger = get_logger(__name__)
PUSH_URL = "https://exp.host/--/api/v2/push/send"
RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"


def push_title(template_code: str) -> str:
    if "APPLICATION" in template_code or "SHORTLIST" in template_code:
        return "Application update"
    if "INTERVIEW" in template_code:
        return "Interview update"
    return "BharatPath update"


def push_payload(*, token: str, notification_id: str, template_code: str) -> dict[str, Any]:
    # Keep private message details off the lock screen; the inbox has the text.
    return {
        "to": token,
        "title": push_title(template_code),
        "body": "You have a new update. Open BharatPath to read it.",
        "data": {"notificationId": notification_id},
        "channelId": "default",
        "sound": "default",
        "priority": "high",
    }


async def queue(session: AsyncSession) -> int:
    return await repository.queue_push_deliveries(
        session, since=datetime.now(UTC) - timedelta(days=1)
    )


async def send_one(session: AsyncSession) -> str:
    now = datetime.now(UTC)
    rows = await repository.pending_push_deliveries(
        session, before=now - timedelta(minutes=1), limit=1
    )
    if not rows:
        return "EMPTY"
    delivery, notification, device = rows[0]
    if notification.read_at is not None:
        delivery.state = "FAILED"
        delivery.failure_code = "already_read"
        return "FAILED"
    delivery.attempts += 1
    delivery.attempted_at = now
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                PUSH_URL,
                json=push_payload(
                    token=device.token,
                    notification_id=str(notification.id),
                    template_code=notification.template_code,
                ),
            )
            response.raise_for_status()
            payload = response.json()
            ticket = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(ticket, dict):
            ticket = {}
        if ticket.get("status") != "ok" or not isinstance(ticket.get("id"), str):
            details = ticket.get("details")
            code = str(
                details.get("error", "provider_rejected")
                if isinstance(details, dict)
                else "provider_rejected"
            )[:64]
            delivery.state = "FAILED"
            delivery.failure_code = code
            if code == "DeviceNotRegistered":
                await repository.deactivate_push_device(session, device_id=device.id)
            return "FAILED"
        delivery.state = "SENT"
        delivery.ticket_id = ticket["id"][:128]
        return "SENT"
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
        delivery.failure_code = "provider_unreachable"
        if delivery.attempts >= 3:
            delivery.state = "FAILED"
        logger.warning("push_send_failed", error_type=type(exc).__name__)
        return delivery.state


async def check_receipts(session: AsyncSession) -> int:
    rows = await repository.unchecked_push_receipts(
        session, before=datetime.now(UTC) - timedelta(minutes=15)
    )
    if not rows:
        return 0
    ids = [delivery.ticket_id for delivery, _ in rows if delivery.ticket_id]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(RECEIPTS_URL, json={"ids": ids})
            response.raise_for_status()
            payload = response.json()
            receipts = payload.get("data") if isinstance(payload, dict) else None
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
        logger.warning("push_receipts_failed", error_type=type(exc).__name__)
        return 0
    checked = 0
    if not isinstance(receipts, dict):
        logger.warning("push_receipts_malformed")
        return 0
    for delivery, device in rows:
        receipt = receipts.get(delivery.ticket_id)
        if not isinstance(receipt, dict):
            continue
        delivery.receipt_checked_at = datetime.now(UTC)
        checked += 1
        if receipt.get("status") == "error":
            details = receipt.get("details")
            code = str(
                details.get("error", "receipt_error")
                if isinstance(details, dict)
                else "receipt_error"
            )[:64]
            delivery.state = "FAILED"
            delivery.failure_code = code
            if code == "DeviceNotRegistered":
                await repository.deactivate_push_device(session, device_id=device.id)
    return checked
