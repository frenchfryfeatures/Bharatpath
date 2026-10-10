"""KYB review: the flags a reviewer may set, and what changed since (2026-10-10)."""

from __future__ import annotations

from app.modules.kyb.domain import changes_since, flag_refusal

KNOWN = frozenset({"pan", "legal_name", "doc_pan"})


def test_only_a_send_back_or_a_rejection_points_at_fields() -> None:
    assert flag_refusal(decision="MORE_INFO_REQUIRED", flagged=["pan"], known_fields=KNOWN) is None
    assert flag_refusal(decision="REJECTED", flagged=["doc_pan"], known_fields=KNOWN) is None
    assert flag_refusal(decision="APPROVED", flagged=["pan"], known_fields=KNOWN) == (
        "kyb_flags_not_allowed",
        [],
    )
    assert flag_refusal(decision="APPROVED", flagged=[], known_fields=KNOWN) is None


def test_a_flag_names_a_field_the_form_has_once() -> None:
    assert flag_refusal(decision="REJECTED", flagged=["pan", "gstn"], known_fields=KNOWN) == (
        "kyb_flag_unknown_field",
        ["gstn"],
    )
    assert flag_refusal(decision="REJECTED", flagged=["pan", "pan"], known_fields=KNOWN) == (
        "kyb_flag_duplicate",
        ["pan"],
    )


def test_what_changed_is_answers_that_differ_and_documents_uploaded_again() -> None:
    fields, documents = changes_since(
        reviewed_answers={"pan": "AAAAA1111A", "city": "Pune", "gstin": "X"},
        answers={"pan": "BBBBB2222B", "city": "Pune", "tan": "Y"},
        reviewed_documents={"doc_pan": "1", "doc_gst": "2"},
        documents={"doc_pan": "3", "doc_gst": "2", "doc_registration": "4"},
    )
    assert fields == ["gstin", "pan", "tan"]
    assert documents == ["doc_pan", "doc_registration"]


def test_nothing_changed_is_two_empty_lists() -> None:
    same = {"pan": "AAAAA1111A"}
    assert changes_since(
        reviewed_answers=same, answers=dict(same), reviewed_documents={}, documents={}
    ) == ([], [])
