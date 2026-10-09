"""Where a message leaves the building: SMS and email, each behind one interface.

**SMS goes through Twilio Messaging** (plan §5.8 -- a separate product from
the Verify service that sends sign-in codes from the Cognito Lambdas).
**Email goes through SES** in `ap-south-1`. Neither is live yet:

* `none` (the default) -- nothing is configured, so every SMS and email is
  recorded as SKIPPED `PROVIDER_UNCONFIGURED`. The in-app inbox still works.
* `stub` -- local development and CI; `Settings` refuses it in staging and
  production. Records what it was asked to send in `sent`, so a test can read
  the message a person would have received.
* `twilio` / `ses` -- the real thing, used once credentials exist.

**What a real provider does not remove.** A Twilio account is not a DLT
registration: an SMS whose template has no `dlt_template_id` is never handed
to a provider at all (`domain.delivery_decision`), because the operator would
drop it silently (blockers D1). The template id is mapped to the sender on
Twilio's side during India DLT onboarding, so it is not a request parameter
here. SES starts in its sandbox, which delivers only to verified addresses,
until AWS grants production access.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Protocol

import httpx

from app.core.logging import get_logger
from app.settings import get_settings

logger = get_logger(__name__)


class DeliveryError(Exception):
    """The provider refused or could not be reached. `code` is recorded on the
    row as `failure_code`; the message itself never is."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class SmsProvider(Protocol):
    name: str
    configured: bool

    async def send(self, *, to: str, body: str, dlt_template_id: str) -> str: ...


class EmailProvider(Protocol):
    name: str
    configured: bool

    async def send(
        self, *, to: str, subject: str, body: str, headers: dict[str, str] | None = None
    ) -> str:
        """`headers` carries RFC 8058 unsubscribe headers on a nudge.
        Optional, so a provider that cannot set headers is
        still a valid implementation -- it sends the message without them
        rather than refusing to send it."""
        ...


# ---------------------------------------------------------------------------
# Unconfigured
# ---------------------------------------------------------------------------
class UnconfiguredSmsProvider:
    name = "none"
    configured = False

    async def send(self, *, to: str, body: str, dlt_template_id: str) -> str:
        raise DeliveryError("provider_unconfigured")


class UnconfiguredEmailProvider:
    name = "none"
    configured = False

    async def send(
        self, *, to: str, subject: str, body: str, headers: dict[str, str] | None = None
    ) -> str:
        raise DeliveryError("provider_unconfigured")


# ---------------------------------------------------------------------------
# Stub
# ---------------------------------------------------------------------------
@dataclass
class StubSmsProvider:
    name: str = "stub"
    configured: bool = True
    sent: list[dict[str, str]] = field(default_factory=list)

    async def send(self, *, to: str, body: str, dlt_template_id: str) -> str:
        self.sent.append({"to": to, "body": body, "dlt_template_id": dlt_template_id})
        return f"stub-sms-{len(self.sent)}"


@dataclass
class StubEmailProvider:
    name: str = "stub"
    configured: bool = True
    sent: list[dict[str, Any]] = field(default_factory=list)

    async def send(
        self, *, to: str, subject: str, body: str, headers: dict[str, str] | None = None
    ) -> str:
        self.sent.append(
            {"to": to, "subject": subject, "body": body, "headers": dict(headers or {})}
        )
        return f"stub-email-{len(self.sent)}"


# ---------------------------------------------------------------------------
# Real
# ---------------------------------------------------------------------------
class TwilioSmsProvider:
    """Twilio's Messages resource: one form-encoded POST per message.

    Sent from a Messaging Service rather than a bare number, because the India
    DLT sender header and template mapping hang off the service.
    """

    name = "twilio"
    configured = True
    _TIMEOUT_SECONDS = 10.0

    def __init__(self, *, account_sid: str, auth_token: str, messaging_service_sid: str) -> None:
        self._account_sid = account_sid
        self._auth_token = auth_token
        self._messaging_service_sid = messaging_service_sid

    async def send(self, *, to: str, body: str, dlt_template_id: str) -> str:
        url = f"https://api.twilio.com/2010-04-01/Accounts/{self._account_sid}/Messages.json"
        try:
            async with httpx.AsyncClient(timeout=self._TIMEOUT_SECONDS) as client:
                response = await client.post(
                    url,
                    auth=(self._account_sid, self._auth_token),
                    data={
                        "To": to,
                        "MessagingServiceSid": self._messaging_service_sid,
                        "Body": body,
                    },
                )
        except httpx.HTTPError as exc:
            raise DeliveryError("provider_unreachable") from exc
        if response.status_code >= 400:
            # Twilio's error code, never the body: it echoes the message.
            code = (
                response.json().get("code")
                if response.headers.get("content-type", "").startswith("application/json")
                else None
            )
            raise DeliveryError(f"twilio_{code or response.status_code}")
        return str(response.json()["sid"])


class SesEmailProvider:
    name = "ses"
    configured = True

    def __init__(self, *, from_address: str, region: str, endpoint_url: str | None) -> None:
        self._from = from_address
        self._region = region
        self._endpoint_url = endpoint_url

    async def send(
        self, *, to: str, subject: str, body: str, headers: dict[str, str] | None = None
    ) -> str:
        import boto3

        def _send() -> str:
            client = boto3.client(
                "sesv2", region_name=self._region, endpoint_url=self._endpoint_url
            )
            content: dict[str, Any] = {
                "Simple": {
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {"Text": {"Data": body, "Charset": "UTF-8"}},
                }
            }
            if headers:
                # SESv2 takes custom headers on the Simple content. This is
                # how `List-Unsubscribe` reaches the reader's mail client,
                # which is what draws its own Unsubscribe button.
                content["Simple"]["Headers"] = [
                    {"Name": name, "Value": value} for name, value in sorted(headers.items())
                ]
            result = client.send_email(
                FromEmailAddress=self._from,
                Destination={"ToAddresses": [to]},
                Content=content,
            )
            return str(result["MessageId"])

        try:
            return await asyncio.to_thread(_send)
        except Exception as exc:
            code = getattr(exc, "response", {}).get("Error", {}).get("Code", "unknown")
            raise DeliveryError(f"ses_{code}") from exc


@lru_cache(maxsize=1)
def get_sms_provider() -> SmsProvider:
    settings = get_settings()
    if settings.notifications_sms_provider == "stub":
        return StubSmsProvider()
    if settings.notifications_sms_provider == "twilio":
        assert settings.twilio_account_sid and settings.twilio_auth_token  # Settings refuses
        assert settings.twilio_messaging_service_sid
        return TwilioSmsProvider(
            account_sid=settings.twilio_account_sid,
            auth_token=settings.twilio_auth_token.get_secret_value(),
            messaging_service_sid=settings.twilio_messaging_service_sid,
        )
    return UnconfiguredSmsProvider()


@lru_cache(maxsize=1)
def get_email_provider() -> EmailProvider:
    settings = get_settings()
    if settings.notifications_email_provider == "stub":
        return StubEmailProvider()
    if settings.notifications_email_provider == "ses":
        assert settings.notifications_email_from  # Settings refuses
        return SesEmailProvider(
            from_address=settings.notifications_email_from,
            region=settings.aws_region,
            endpoint_url=settings.aws_endpoint_url,
        )
    return UnconfiguredEmailProvider()
