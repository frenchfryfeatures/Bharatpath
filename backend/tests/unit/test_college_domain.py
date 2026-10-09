"""The college domain -- referral codes, roster files, invitations, seats.

Pure functions, so every rule that decides who can attach themselves to a
roster, what a college is told about its file, and how many students a
college pays for is exercised here without a database.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import get_args

import pytest

from app.modules.college import domain
from app.modules.college.domain import (
    CODE_ALPHABET,
    CODE_LENGTH,
    INVITATION_VALID_FOR,
    ISSUE_ALREADY_ON_ROSTER,
    ISSUE_DUPLICATE_IN_FILE,
    ISSUE_INVALID_EMAIL,
    ISSUE_INVALID_PHONE,
    ISSUE_MISSING_CONTACT,
    MAX_ROSTER_ROWS,
    RosterFileInvalid,
    allocation_refusal,
    code_from_bytes,
    code_state,
    format_code,
    invitation_state,
    mark_already_on_roster,
    normalise_code,
    normalise_indian_mobile,
    parse_roster_csv,
    roster_fingerprint,
)

NOW = datetime(2026, 9, 17, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Referral codes are credentials
# ---------------------------------------------------------------------------
def test_the_alphabet_has_no_lookalikes_and_divides_a_byte() -> None:
    assert len(CODE_ALPHABET) == 32 == len(set(CODE_ALPHABET))
    assert not set("ILOU") & set(CODE_ALPHABET)


def test_a_code_carries_sixty_bits() -> None:
    """Sixty bits is the design; a shorter code is a guessable one."""
    assert CODE_LENGTH * 5 >= 60


def test_a_code_is_built_from_the_randomness_given() -> None:
    assert code_from_bytes(bytes(range(12))) == "0123456789AB"
    assert code_from_bytes(bytes([0xFF] * 12)) == "Z" * 12
    with pytest.raises(ValueError):
        code_from_bytes(b"short")


def test_generated_codes_use_the_alphabet_and_differ() -> None:
    codes = {code_from_bytes(secrets.token_bytes(CODE_LENGTH)) for _ in range(500)}
    assert len(codes) == 500
    assert all(len(c) == CODE_LENGTH and set(c) <= set(CODE_ALPHABET) for c in codes)


@pytest.mark.parametrize(
    ("typed", "stored"),
    [
        ("ABCD-EFGH-JKMN", "ABCDEFGHJKMN"),
        ("abcd efgh jkmn", "ABCDEFGHJKMN"),
        (" abcdefghjkmn ", "ABCDEFGHJKMN"),
        ("OOOO-IIII-LLLL", "000011111111"),
    ],
)
def test_a_typed_code_forgives_case_spacing_and_lookalikes(typed: str, stored: str) -> None:
    assert normalise_code(typed) == stored


@pytest.mark.parametrize(
    "typed", ["", "ABCD-EFGH-JKM", "ABCD-EFGH-JKMNP", "ABCD-EFGH-JKMU", "ÀBCDEFGHJKMN"]
)
def test_anything_else_is_not_a_code(typed: str) -> None:
    assert normalise_code(typed) is None


def test_a_code_prints_in_groups_of_four() -> None:
    assert format_code("ABCDEFGHJKMN") == "ABCD-EFGH-JKMN"
    assert normalise_code(format_code("ABCDEFGHJKMN")) == "ABCDEFGHJKMN"


def test_revocation_wins_then_expiry_then_use() -> None:
    later = NOW + timedelta(days=1)
    earlier = NOW - timedelta(days=1)
    assert code_state(revoked_at=NOW, expires_at=earlier, uses=5, max_uses=5, now=NOW) == "REVOKED"
    assert code_state(revoked_at=None, expires_at=NOW, uses=5, max_uses=5, now=NOW) == "EXPIRED"
    assert code_state(revoked_at=None, expires_at=later, uses=5, max_uses=5, now=NOW) == "EXHAUSTED"
    assert code_state(revoked_at=None, expires_at=later, uses=4, max_uses=5, now=NOW) == "ACTIVE"
    assert code_state(revoked_at=None, expires_at=later, uses=9, max_uses=None, now=NOW) == "ACTIVE"


# ---------------------------------------------------------------------------
# Roster files: previewed, never trusted
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "normal"),
    [
        ("9876543210", "+919876543210"),
        ("+91 98765 43210", "+919876543210"),
        ("91 98765 43210", "+919876543210"),
        ("919876543210", "+919876543210"),
        ("09876543210", "+919876543210"),
        ("98765-43210", "+919876543210"),
        ("5876543210", None),
        ("987654321", None),
        ("+1 415 555 0100", None),
    ],
)
def test_an_indian_mobile_is_normalised_or_refused(raw: str, normal: str | None) -> None:
    assert normalise_indian_mobile(raw) == normal


def test_each_row_carries_its_own_issues() -> None:
    parsed = parse_roster_csv(
        "Name,Phone,Email,Student_Ref\n"
        "Asha,98765 43210,asha@example.com,R1\n"
        "Bad phone,12345,,R2\n"
        "Bad email,,not-an-email,R3\n"
        "No contact,,,R4\n"
    )
    by_ref = {row.student_ref: row for row in parsed.rows}
    assert by_ref["R1"].state == "VALID"
    assert by_ref["R1"].phone == "+919876543210" and by_ref["R1"].email == "asha@example.com"
    assert by_ref["R2"].issues == (ISSUE_INVALID_PHONE,) and by_ref["R2"].state == "INVALID"
    assert by_ref["R3"].issues == (ISSUE_INVALID_EMAIL,)
    assert by_ref["R4"].issues == (ISSUE_MISSING_CONTACT,)
    assert [row.row_number for row in parsed.rows] == [2, 3, 4, 5]


def test_a_contact_seen_earlier_in_the_file_is_a_duplicate_however_it_is_written() -> None:
    parsed = parse_roster_csv(
        "phone,email\n9876543210,\n+91 98765 43210,\n,A@Example.com\n,a@example.com\n"
    )
    states = [(row.state, row.issues) for row in parsed.rows]
    assert states == [
        ("VALID", ()),
        ("DUPLICATE", (ISSUE_DUPLICATE_IN_FILE,)),
        ("VALID", ()),
        ("DUPLICATE", (ISSUE_DUPLICATE_IN_FILE,)),
    ]


def test_a_contact_already_on_the_roster_is_marked() -> None:
    parsed = parse_roster_csv("phone,email\n9876543210,\n9876543211,\n")
    marked = mark_already_on_roster(
        parsed.rows, phones=frozenset({"+919876543211"}), emails=frozenset()
    )
    assert [row.state for row in marked] == ["VALID", "DUPLICATE"]
    assert marked[1].issues == (ISSUE_ALREADY_ON_ROSTER,)


def test_columns_that_are_not_read_are_reported_and_dropped() -> None:
    """A college's own records are not ours to copy, however the sheet is laid out."""
    parsed = parse_roster_csv(chr(0xFEFF) + "Phone,Category,Year of passing\n9876543210,GEN,2025\n")
    assert parsed.ignored_columns == ("category", "year of passing")
    assert not hasattr(parsed.rows[0], "category")


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("", "roster_empty"),
        ("phone,email\n", "roster_empty"),
        ("name,roll\nAsha,1\n", "roster_no_contact_column"),
        ("phone\n" + "x" * domain.MAX_ROSTER_BYTES, "roster_too_large"),
        ("phone\n" + "9876543210\n" * (MAX_ROSTER_ROWS + 1), "roster_too_many_rows"),
    ],
    ids=["no_header", "no_rows", "no_contact_column", "too_large", "too_many_rows"],
)
def test_an_unusable_file_is_refused_whole(text: str, code: str) -> None:
    with pytest.raises(RosterFileInvalid) as caught:
        parse_roster_csv(text)
    assert caught.value.code == code


def test_blank_lines_are_not_rows() -> None:
    assert len(parse_roster_csv("phone\n\n9876543210\n,\n").rows) == 1


def test_the_same_file_from_two_machines_is_the_same_import() -> None:
    assert roster_fingerprint("phone\r\n9876543210\r\n") == roster_fingerprint(
        "phone\n9876543210\n"
    )
    assert roster_fingerprint("phone\n9876543210") != roster_fingerprint("phone\n9876543211")


# ---------------------------------------------------------------------------
# Invitations and seats
# ---------------------------------------------------------------------------
def test_an_invitation_expires_by_the_clock_not_by_a_sweep() -> None:
    sent = NOW - INVITATION_VALID_FOR
    assert invitation_state(stored="SENT", sent_at=sent, now=NOW) == "EXPIRED"
    assert invitation_state(stored="SENT", sent_at=sent + timedelta(seconds=1), now=NOW) == "SENT"
    assert invitation_state(stored="ACCEPTED", sent_at=sent, now=NOW) == "ACCEPTED"
    assert invitation_state(stored=None, sent_at=None, now=NOW) is None


def test_invitations_only_move_forward() -> None:
    assert ("NONE", "PENDING") in domain.INVITE_TRANSITIONS
    assert ("ACCEPTED", "DECLINED") not in domain.INVITE_TRANSITIONS
    assert all(b != "EXPIRED" for _, b in domain.INVITE_TRANSITIONS)


@pytest.mark.parametrize(
    ("requested", "used", "allowance", "refusal"),
    [
        (250, 0, 250, None),
        (100, 40, 250, None),
        (0, 0, None, None),
        (39, 40, 250, "college_seats_below_used"),
        (251, 0, 250, "college_seats_exceed_plan"),
        (10, 0, None, "college_seats_no_plan"),
        (-1, 0, 250, "college_seats_negative"),
    ],
)
def test_an_allocation_stays_between_what_is_used_and_what_is_paid_for(
    requested: int, used: int, allowance: int | None, refusal: str | None
) -> None:
    assert allocation_refusal(requested=requested, used=used, plan_allowance=allowance) == refusal


# ---------------------------------------------------------------------------
# The contract matches the data
# ---------------------------------------------------------------------------
def test_the_schema_offers_exactly_the_forms_institution_types() -> None:
    from app.modules.college.forms import INSTITUTION_TYPES
    from app.modules.college.schemas import InstitutionType

    assert set(get_args(InstitutionType)) == {code for code, _ in INSTITUTION_TYPES}


def test_every_option_source_the_form_names_is_supplied() -> None:
    from app.modules.college.forms import COLLEGE_FORM
    from app.modules.college.service import COLLEGE_OPTIONS, form_options

    named = {f.options_source for f in COLLEGE_FORM.fields if f.options_source}
    assert named == set(COLLEGE_OPTIONS) == set(form_options())


def test_no_college_facing_schema_names_a_score() -> None:
    """ROSTER consent is counting, not seeing. Nothing about a student's score
    has a field on this surface (invariant 7 walks OpenAPI for the raw one).

    **One exception, by name**: `CollegeStudentResponse`, served only
    behind a live INDIVIDUAL consent whose words name the score, with its field
    list fixed by `tests/invariants/test_invariant_09_consent.py`."""
    import inspect

    from pydantic import BaseModel

    from app.modules.college import schemas

    individually_consented = {"CollegeStudentResponse"}
    for name, model in inspect.getmembers(schemas, inspect.isclass):
        if name in individually_consented:
            continue
        if issubclass(model, BaseModel) and model.__module__ == schemas.__name__:
            assert not [n for n in model.model_fields if "score" in n or "band" in n], model
