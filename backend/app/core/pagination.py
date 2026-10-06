"""Cursor pagination primitives.

Cursor, not offset. Offset pagination over a growing table gets slower as it
goes and skips or repeats rows when the underlying data changes mid-page.

`total` is optional on purpose: SRS 2.24.2 says to show totals only where the
API can safely provide them, and on the candidate discovery query a total is
both expensive and a small information leak about pool size.
"""

from __future__ import annotations

import base64
import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from pydantic import BaseModel, Field

MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 50


class Page[T](BaseModel):
    items: list[T]
    next_cursor: str | None = None
    total: int | None = Field(
        default=None,
        description="Present only where the API can compute it cheaply and safely.",
    )


def encode_cursor(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True, default=str)
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> dict[str, Any]:
    padded = cursor + "=" * (-len(cursor) % 4)
    try:
        return dict(json.loads(base64.urlsafe_b64decode(padded).decode()))
    except Exception as exc:
        from app.core.errors import ValidationError

        raise ValidationError(code="invalid_cursor") from exc


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_PAGE_SIZE
    return max(1, min(limit, MAX_PAGE_SIZE))


#: List filters take calendar days, and a day is an Indian one.
IST = timezone(timedelta(hours=5, minutes=30), "IST")


def ist_day_range(first: date | None, last: date | None) -> tuple[datetime | None, datetime | None]:
    """`[start, end)` instants covering IST days `first` to `last`, both
    inclusive; either end may be open. A range that ends before it starts is
    422 `invalid_date_range` rather than an empty page that explains nothing."""
    if first is not None and last is not None and last < first:
        from app.core.errors import ValidationError

        raise ValidationError(code="invalid_date_range")
    start = datetime.combine(first, time.min, IST) if first is not None else None
    end = datetime.combine(last + timedelta(days=1), time.min, IST) if last is not None else None
    return start, end
