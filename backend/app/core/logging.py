"""structlog configuration with a PII redaction filter.

Two things must never appear in a log line, and both are enforced here rather
than by remembering:

  * **OTP values.** Twilio Verify generates and checks the code, so no OTP
    should ever reach our process at all - this filter is the second line.
  * **Candidate PII.** Phone, email, name, and raw resume text. Under the DPDP
    Act a log aggregator full of resumes is a data store nobody is treating
    like one.
"""

from __future__ import annotations

import logging
import re
import sys
from typing import Any

import structlog
from structlog.typing import EventDict, WrappedLogger

# Keys whose values are replaced wholesale, at any depth.
REDACTED_KEYS = frozenset(
    {
        "phone",
        "phone_number",
        "mobile",
        "email",
        "email_address",
        "name",
        "full_name",
        "first_name",
        "last_name",
        "otp",
        "otp_code",
        "code",
        "password",
        "token",
        "access_token",
        "id_token",
        "refresh_token",
        "authorization",
        "auth_token",
        "secret",
        "api_key",
        "resume_text",
        "parsed",
        "raw_model_response",
        "cognito_sub",
    }
)

REDACTION = "[redacted]"

# Belt and braces: catch a phone number or email that arrives inside a string
# rather than under one of the keys above.
_PHONE_RE = re.compile(r"\+?\d[\d\s\-]{8,14}\d")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def _scrub(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return value
    if isinstance(value, dict):
        return {
            k: (REDACTION if k.lower() in REDACTED_KEYS else _scrub(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return type(value)(_scrub(v, depth + 1) for v in value)
    if isinstance(value, str):
        value = _EMAIL_RE.sub(REDACTION, value)
        value = _PHONE_RE.sub(REDACTION, value)
        return value
    return value


def redact_pii(_logger: WrappedLogger, _method: str, event_dict: EventDict) -> EventDict:
    """structlog processor. Runs on every event, in every environment."""
    return {
        k: (REDACTION if k.lower() in REDACTED_KEYS else _scrub(v)) for k, v in event_dict.items()
    }


def configure_logging(*, debug: bool = False) -> None:
    logging.basicConfig(
        format="%(message)s", stream=sys.stdout, level=logging.DEBUG if debug else logging.INFO
    )
    # DEBUG=true should mean *our* debug output, not every HTTP hop boto3 makes
    # to S3/SQS. Without this, one resume preview prints dozens of botocore lines.
    for noisy in (
        "botocore", "boto3", "s3transfer", "urllib3", "aiobotocore", "kombu", "asyncio",
        "httpcore", "httpx", "openai", "multipart", "watchfiles",
    ):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            redact_pii,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            (structlog.dev.ConsoleRenderer() if debug else structlog.processors.JSONRenderer()),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.DEBUG if debug else logging.INFO
        ),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> Any:
    return structlog.get_logger(name)
