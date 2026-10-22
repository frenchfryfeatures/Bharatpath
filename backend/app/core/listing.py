"""Sorting and searching a list: a keyset that follows the sort.

Built for the admin console's lists (2026-10-21) and usable by any list that
pages with a cursor (`app.core.pagination`).

**A cursor carries its sort.** Keyset paging needs the last row's value of
every ORDER BY term, so the cursor names the sort and the order it was issued
under, beside those values. A cursor from another sort or order is
`invalid_cursor` -- never a page that silently skips or repeats rows.

**NULLs sort last, whichever the order.** A nullable key becomes two terms:
whether it is NULL (always ascending), then its value coalesced to a floor of
its type, so a NULL compares equal to a NULL and the id decides.

**The SQL is text with bound values.** A raw query embeds the fragments, and a
Core statement takes them through `text()`. Expressions are module constants
written by us; only values are bound, never request text.

A key whose terms all run one way compiles to a row comparison
(`(a, b) < (:x, :y)`), which an index on `(a, b)` serves directly. Mixed
directions -- a NULL flag beside a descending value -- expand to the OR form.
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final, Literal

from app.core.errors import ValidationError
from app.core.pagination import decode_cursor, encode_cursor

SortOrder = Literal["asc", "desc"]
Cast = Literal["text", "timestamptz", "uuid", "bigint", "integer", "boolean"]

#: What a NULL becomes in a coalesced term. Any constant works, because the
#: NULL flag ahead of it already separates NULLs from values.
_FLOOR: Final[dict[str, str]] = {
    "text": "''",
    "timestamptz": "'-infinity'::timestamptz",
    "uuid": "'00000000-0000-0000-0000-000000000000'::uuid",
    "bigint": "0",
    "integer": "0",
    "boolean": "false",
}


@dataclass(frozen=True)
class Key:
    """One ORDER BY key. `sql` is the expression, `cast` the type its cursor
    value is bound as, `column` where that value is read off a result row
    (a mapping key or an attribute). `fixed` keeps a key one way whatever
    order is asked for -- a queue sorted by severity is still oldest first
    within each severity."""

    sql: str
    cast: Cast
    column: str
    nullable: bool = False
    fixed: SortOrder | None = None


@dataclass(frozen=True)
class SortField:
    """A sort a caller may ask for. The last key must be unique (an id), so
    the order is total and a page boundary never falls between equals."""

    keys: tuple[Key, ...]
    default_order: SortOrder


@dataclass(frozen=True)
class _Term:
    expr: str
    bind: str
    ascending: bool


@dataclass(frozen=True)
class Ordering:
    """A resolved sort: which field, which way, and where the last page ended."""

    sort: str
    order: SortOrder
    field: SortField
    after: tuple[Any, ...] | None

    def _terms(self) -> list[tuple[_Term, int, bool]]:
        """Each term with the key it reads and whether it is a NULL flag."""
        terms: list[tuple[_Term, int, bool]] = []
        for index, key in enumerate(self.field.keys):
            forward = (key.fixed or self.order) == "asc"
            param = f":_after_{index}"
            if key.nullable:
                floor = _FLOOR[key.cast]
                terms.append(
                    (
                        _Term(f"(({key.sql}) IS NULL)", f"CAST({param}_null AS boolean)", True),
                        index,
                        True,
                    )
                )
                terms.append(
                    (
                        _Term(
                            f"COALESCE({key.sql}, {floor})",
                            f"COALESCE(CAST({param} AS {key.cast}), {floor})",
                            forward,
                        ),
                        index,
                        False,
                    )
                )
            else:
                terms.append(
                    (_Term(key.sql, f"CAST({param} AS {key.cast})", forward), index, False)
                )
        return terms

    def order_by(self) -> str:
        return ", ".join(
            f"{term.expr} {'ASC' if term.ascending else 'DESC'}" for term, _, _ in self._terms()
        )

    def where(self) -> tuple[str, dict[str, Any]]:
        """The predicate for rows after the cursor, and its bound values.
        `TRUE` on the first page."""
        if self.after is None:
            return "TRUE", {}
        terms = self._terms()
        params: dict[str, Any] = {}
        for index, value in enumerate(self.after):
            params[f"_after_{index}"] = value
            if self.field.keys[index].nullable:
                params[f"_after_{index}_null"] = value is None
        directions = {term.ascending for term, _, _ in terms}
        if len(directions) == 1:
            op = ">" if directions.pop() else "<"
            left = ", ".join(term.expr for term, _, _ in terms)
            right = ", ".join(term.bind for term, _, _ in terms)
            return f"(({left}) {op} ({right}))", params
        clauses = []
        for position, (term, _, _) in enumerate(terms):
            equal = [f"{t.expr} = {t.bind}" for t, _, _ in terms[:position]]
            op = ">" if term.ascending else "<"
            clauses.append("(" + " AND ".join([*equal, f"{term.expr} {op} {term.bind}"]) + ")")
        return "(" + " OR ".join(clauses) + ")", params

    def next_cursor(self, rows: Sequence[Any], limit: int) -> str | None:
        if len(rows) < limit:
            return None
        last = rows[-1]
        values = [_dump(_read(last, key.column)) for key in self.field.keys]
        return encode_cursor({"s": self.sort, "o": self.order, "k": values})


def ordering(
    fields: Mapping[str, SortField],
    *,
    sort: str,
    order: SortOrder | None,
    cursor: str | None,
) -> Ordering:
    """Resolve `sort` and `order` against the fields a list offers, and decode
    a cursor that must have been issued under the same two. An unknown sort
    is 422 `invalid_sort` (the router's `Literal` normally answers first)."""
    field = fields.get(sort)
    if field is None:
        raise ValidationError(code="invalid_sort", params={"sort": sort, "allowed": sorted(fields)})
    resolved: SortOrder = order or field.default_order
    after: tuple[Any, ...] | None = None
    if cursor is not None:
        payload = decode_cursor(cursor)
        raw = payload.get("k")
        if (
            payload.get("s") != sort
            or payload.get("o") != resolved
            or not isinstance(raw, list)
            or len(raw) != len(field.keys)
        ):
            raise ValidationError(code="invalid_cursor")
        try:
            after = tuple(_load(value, key) for value, key in zip(raw, field.keys, strict=True))
        except (TypeError, ValueError) as exc:
            raise ValidationError(code="invalid_cursor") from exc
    return Ordering(sort=sort, order=resolved, field=field, after=after)


def _read(row: Any, column: str) -> Any:
    return row[column] if isinstance(row, Mapping) else getattr(row, column)


def _dump(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _load(value: Any, key: Key) -> Any:
    if value is None:
        if not key.nullable:
            raise ValueError("a NULL for a key that is never NULL")
        return None
    match key.cast:
        case "timestamptz":
            return datetime.fromisoformat(str(value))
        case "uuid":
            return uuid.UUID(str(value))
        case "bigint" | "integer":
            if isinstance(value, bool) or not isinstance(value, int):
                raise TypeError("not an integer")
            return value
        case "boolean":
            if not isinstance(value, bool):
                raise TypeError("not a boolean")
            return value
        case _:
            if not isinstance(value, str):
                raise TypeError("not text")
            return value


# ---------------------------------------------------------------------------
# Search terms
# ---------------------------------------------------------------------------
def contains(term: str) -> str:
    """A LIKE pattern matching `term` anywhere, with `%`, `_` and `\\` taken
    as characters. Use with `ESCAPE '\\'`."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search_text(term: str | None) -> str | None:
    """A search box's text, trimmed; blank is no search."""
    if term is None:
        return None
    return term.strip() or None


_NOT_DIGIT = re.compile(r"\D")


def phone_digits(term: str | None) -> str | None:
    """The digits of a phone search, so `+91 98765-43210` and `9876543210`
    both match what is stored (E.164, digits after the `+`). Text with no
    digit at all is 422 `phone_search_invalid` rather than a search that
    matches everyone."""
    text = search_text(term)
    if text is None:
        return None
    digits = _NOT_DIGIT.sub("", text)
    if not digits:
        raise ValidationError(code="phone_search_invalid")
    return digits
