"""Expo push delivery for already persisted in-app messages."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.notifications import repository
from app.modules.notifications.domain import destination_for

logger = get_logger(__name__)
PUSH_URL = "https://exp.host/--/api/v2/push/send"
RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
#: Expo keeps a receipt for about a day; after that a ticket is never answered.
RECEIPT_RETENTION = timedelta(hours=24)

#: `RETRY` means Expo could not be reached: the row stays PENDING (until its
#: third attempt) and the caller should stop sending for this run.
SendOutcome = Literal["EMPTY", "SENT", "FAILED", "RETRY"]


def push_title(template_code: str) -> str:
    if "APPLICATION" in template_code or "SHORTLIST" in template_code:
        return "Application update"
    if "INTERVIEW" in template_code:
        return "Interview update"
    if template_code == "IN_APP_DAILY_REMINDER":
        return "Keep your streak going"
    return "BharatPath update"


def push_payload(
    *,
    token: str,
    notification_id: str,
    template_code: str,
    destination: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    # Keep private message details off the lock screen; the inbox has the text.
    # The destination is ids only, so the app can open the right screen.
    data: dict[str, Any] = {"notificationId": notification_id}
    if destination is not None:
        data["destination"] = destination
    return {
        "to": token,
        "title": push_title(template_code),
        "body": (
            "You haven't opened BharatPath today. Log in to keep your streak going."
            if template_code == "IN_APP_DAILY_REMINDER"
            else "You have a new update. Open BharatPath to read it."
        ),
        "data": data,
        "channelId": "default",
        "sound": "default",
        "priority": "high",
    }


async def _destination(session: AsyncSession, notification: Any) -> dict[str, str | None]:
    kind, aggregate_id, payload = await repository.source_event_of(
        session, event_id=getattr(notification, "source_event_id", None)
    )
    target = destination_for(
        notification.template_code,
        aggregate_type=kind,
        aggregate_id=aggregate_id,
        payload=payload,
    )
    return {"kind": target.kind, "id": target.id}


async def queue(session: AsyncSession) -> int:
    return await repository.queue_push_deliveries(
        session, since=datetime.now(UTC) - timedelta(days=1)
    )


async def send_one(session: AsyncSession) -> SendOutcome:
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
                    destination=await _destination(session, notification),
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
        logger.warning("push_send_failed", error_type=type(exc).__name__)
        if delivery.attempts >= 3:
            delivery.state = "FAILED"
            return "FAILED"
        return "RETRY"


async def check_receipts(session: AsyncSession) -> int:
    now = datetime.now(UTC)
    rows = await repository.unchecked_push_receipts(
        session, before=now - timedelta(minutes=15), after=now - RECEIPT_RETENTION
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
