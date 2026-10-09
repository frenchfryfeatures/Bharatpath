"""The security-scan hook that sits between an upload and any processing.

**This is a seam, not a scanner.** `NullDocumentScanner` performs no malware
detection whatsoever. It exists so the call site, the `scan_status` column and
the refusal path are all real and exercised now, rather than being
retrofitted around working code later -- retrofitting a gate is how a gate ends
up with something already past it.

Real scanning is infrastructure: **GuardDuty Malware Protection for S3** is the
intended implementation -- it scans on object-create and tags the object, so
this module becomes a tag read rather than a byte scan, and no CV is ever
streamed through the application for AV.

**Owed before launch.** Tracked in docs/progress.md. Until then
`resume_scan_enabled` defaults to off, and the status recorded is `PENDING` --
not `CLEAN`. Recording `CLEAN` from a scanner that scans nothing would be a
lie told to every later reader of that column, including whoever decides it is
safe to parse.
"""

from __future__ import annotations

from typing import Final, Literal, Protocol, runtime_checkable

from app.core.logging import get_logger
from app.settings import Settings, get_settings

logger = get_logger(__name__)

ScanStatus = Literal["PENDING", "CLEAN", "INFECTED", "FAILED"]

#: Statuses that permit parsing to proceed. PENDING is included only because
#: no real scanner is wired yet; when one is, remove it here and the gate
#: tightens everywhere at once.
PROCESSABLE: Final[frozenset[str]] = frozenset({"CLEAN", "PENDING"})


@runtime_checkable
class DocumentScanner(Protocol):
    @property
    def name(self) -> str: ...

    async def scan(self, *, bucket: str, key: str) -> ScanStatus: ...


class NullDocumentScanner:
    """Scans nothing and says so, loudly and in the record."""

    name = "none"

    async def scan(self, *, bucket: str, key: str) -> ScanStatus:
        logger.warning(
            "document_not_scanned",
            bucket=bucket,
            key=key,
            detail="no malware scanning configured; status recorded as PENDING",
        )
        return "PENDING"


def get_document_scanner(settings: Settings | None = None) -> DocumentScanner:
    """The single place a scanner is chosen. GuardDuty switches here."""
    settings = settings or get_settings()
    if not settings.resume_scan_enabled:
        return NullDocumentScanner()
    raise NotImplementedError(
        "resume_scan_enabled is on but no scanner is implemented. "
        "Wire GuardDuty Malware Protection for S3 before enabling this."
    )


def may_process(status: str) -> bool:
    return status in PROCESSABLE
