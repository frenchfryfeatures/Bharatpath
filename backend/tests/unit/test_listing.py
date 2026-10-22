"""The keyset that follows a sort, without a database (2026-10-21).

`app.core.listing` writes the ORDER BY and the "after this row" predicate for
every sortable admin list. The integration tests page through real rows; these
pin the SQL it writes and the cursor's rules.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.core.errors import ValidationError
from app.core.listing import (
    Key,
    SortField,
    contains,
    ordering,
    phone_digits,
    search_text,
)
from app.core.pagination import encode_cursor

ID = Key("t.id", "uuid", "id")
FIELDS = {
    "created_at": SortField((Key("t.created_at", "timestamptz", "created_at"), ID), "desc"),
    "name": SortField((Key("t.name", "text", "name", nullable=True), ID), "asc"),
    "rank": SortField(
        (
            Key("t.rank", "integer", "rank"),
            Key("t.created_at", "timestamptz", "created_at", fixed="asc"),
            ID,
        ),
        "desc",
    ),
}
AT = datetime(2026, 10, 21, 9, 30, 15, 123456, tzinfo=UTC)
ROW_ID = uuid.UUID("12345678-1234-5678-1234-567812345678")


def _cursor_after(sort: str, order: str | None, row: dict) -> str:
    first = ordering(FIELDS, sort=sort, order=order, cursor=None)  # type: ignore[arg-type]
    cursor = first.next_cursor([row], 1)
    assert cursor is not None
    return cursor


def test_the_first_page_has_no_predicate_and_the_sorts_own_default_order() -> None:
    first = ordering(FIELDS, sort="created_at", order=None, cursor=None)
    assert first.order == "desc"
    assert first.where() == ("TRUE", {})
    assert first.order_by() == "t.created_at DESC, t.id DESC"
    assert ordering(FIELDS, sort="name", order=None, cursor=None).order == "asc"


def test_one_direction_is_a_row_comparison_an_index_can_serve() -> None:
    cursor = _cursor_after("created_at", None, {"created_at": AT, "id": ROW_ID})
    page = ordering(FIELDS, sort="created_at", order=None, cursor=cursor)
    sql, params = page.where()
    assert sql == (
        "((t.created_at, t.id) < (CAST(:_after_0 AS timestamptz), CAST(:_after_1 AS uuid)))"
    )
    assert params == {"_after_0": AT, "_after_1": ROW_ID}, "values come back typed"


def test_nulls_sort_last_whichever_the_order() -> None:
    asc = ordering(FIELDS, sort="name", order="asc", cursor=None)
    desc = ordering(FIELDS, sort="name", order="desc", cursor=None)
    assert asc.order_by() == "((t.name) IS NULL) ASC, COALESCE(t.name, '') ASC, t.id ASC"
    assert desc.order_by() == "((t.name) IS NULL) ASC, COALESCE(t.name, '') DESC, t.id DESC"


def test_mixed_directions_expand_to_the_or_form() -> None:
    cursor = _cursor_after("name", "desc", {"name": None, "id": ROW_ID})
    sql, params = ordering(FIELDS, sort="name", order="desc", cursor=cursor).where()
    flag, value, ident = (
        "((t.name) IS NULL)",
        "COALESCE(t.name, '')",
        "t.id",
    )
    flag_b = "CAST(:_after_0_null AS boolean)"
    value_b = "COALESCE(CAST(:_after_0 AS text), '')"
    ident_b = "CAST(:_after_1 AS uuid)"
    assert sql == (
        f"(({flag} > {flag_b})"
        f" OR ({flag} = {flag_b} AND {value} < {value_b})"
        f" OR ({flag} = {flag_b} AND {value} = {value_b} AND {ident} < {ident_b}))"
    )
    assert params == {"_after_0": None, "_after_0_null": True, "_after_1": ROW_ID}


def test_a_fixed_key_keeps_its_way_whatever_order_is_asked_for() -> None:
    page = ordering(FIELDS, sort="rank", order="desc", cursor=None)
    assert page.order_by() == "t.rank DESC, t.created_at ASC, t.id DESC"


@pytest.mark.parametrize(
    ("issued", "asked"),
    [
        (("created_at", None), ("name", None)),
        (("created_at", "desc"), ("created_at", "asc")),
    ],
)
def test_a_cursor_from_another_sort_or_order_is_refused(
    issued: tuple[str, str | None], asked: tuple[str, str | None]
) -> None:
    """Applying it would compare a date with a name, or walk the wrong way:
    a page that skips or repeats rows rather than an error that says why."""
    row = {"created_at": AT, "name": "Asha", "id": ROW_ID}
    cursor = _cursor_after(*issued, row)
    with pytest.raises(ValidationError) as refused:
        ordering(FIELDS, sort=asked[0], order=asked[1], cursor=cursor)  # type: ignore[arg-type]
    assert refused.value.code == "invalid_cursor"


@pytest.mark.parametrize(
    "payload",
    [
        {"t": AT.isoformat(), "i": str(ROW_ID)},  # the old shape
        {"s": "created_at", "o": "desc", "k": [AT.isoformat()]},  # a key short
        {"s": "created_at", "o": "desc", "k": ["not a date", str(ROW_ID)]},
        {"s": "created_at", "o": "desc", "k": [None, str(ROW_ID)]},  # NULL, never NULL
        {"s": "rank", "o": "desc", "k": [True, AT.isoformat(), str(ROW_ID)]},
    ],
)
def test_a_malformed_cursor_is_refused(payload: dict) -> None:
    with pytest.raises(ValidationError) as refused:
        ordering(
            FIELDS, sort=payload.get("s", "created_at"), order=None, cursor=encode_cursor(payload)
        )
    assert refused.value.code == "invalid_cursor"


def test_an_unknown_sort_is_refused() -> None:
    with pytest.raises(ValidationError) as refused:
        ordering(FIELDS, sort="email", order=None, cursor=None)
    assert refused.value.code == "invalid_sort"


def test_a_short_page_has_no_next_cursor() -> None:
    page = ordering(FIELDS, sort="created_at", order=None, cursor=None)
    assert page.next_cursor([{"created_at": AT, "id": ROW_ID}], 2) is None


def test_rows_may_be_objects_as_well_as_mappings() -> None:
    class Row:
        created_at = AT
        id = ROW_ID

    page = ordering(FIELDS, sort="created_at", order=None, cursor=None)
    assert page.next_cursor([Row()], 1) == page.next_cursor([{"created_at": AT, "id": ROW_ID}], 1)


def test_search_text_is_literal() -> None:
    assert contains("50%_off\\") == "%50\\%\\_off\\\\%"
    assert search_text("  ") is None
    assert search_text(" Asha ") == "Asha"


@pytest.mark.parametrize(
    ("typed", "digits"),
    [("+91 98765-43210", "919876543210"), ("98765", "98765"), (None, None), ("   ", None)],
)
def test_a_phone_search_is_its_digits(typed: str | None, digits: str | None) -> None:
    assert phone_digits(typed) == digits


def test_a_phone_search_without_a_digit_is_refused_not_a_match_for_everyone() -> None:
    with pytest.raises(ValidationError) as refused:
        phone_digits("call me")
    assert refused.value.code == "phone_search_invalid"
