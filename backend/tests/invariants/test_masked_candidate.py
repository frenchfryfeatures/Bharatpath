"""plan.md Day 13: the masked card cannot hold a phone, an email or the score.

It held no name either until 2026-10-06, when the product decision was to
show the candidate's name on search cards (`full_name`). That one field is
named below, and nothing else that identifies may join it.

"Structurally incapable", not "not populated". A card that merely leaves a
field empty is one careless line away from filling it; a card with no field is
a visible change to this file. So the rule is held by reading the schema, the
search document's columns, and the OpenAPI contract the clients are built from.

Also held here: the labels a card carries are the scoring module's, because
`discovery` may not import `scoring` and so repeats them.
"""

from __future__ import annotations

import ast
import json
import uuid
from pathlib import Path
from typing import Any, get_args

import pytest
from pydantic import ValidationError

from app.modules.discovery.domain import BADGE_FOR_ADDON_KIND
from app.modules.discovery.schemas import Badge, MaskedCandidate, ScoreBand
from app.modules.scoring.domain import BANDS

pytestmark = pytest.mark.invariant

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "alembic" / "versions" / "0001_baseline_schema.py"

#: Widening this is a product decision about what every paying employer sees
#: of every candidate before a reveal. It belongs in review, not in a refactor.
CARD_FIELDS = frozenset(
    {
        "candidate_id",
        "full_name",
        "band",
        "experience_years",
        "skills",
        "badges",
        "city",
        "state_code",
    }
)

#: The one identifying field a card may carry (2026-10-06). A second one is
#: a product decision too, made here and not by a refactor.
ALLOWED_IDENTIFYING = frozenset({"full_name"})

#: Fragments no card field may be named with.
IDENTIFYING = (
    "name",
    "phone",
    "mobile",
    "email",
    "contact",
    "address",
    "score",
    "raw",
    "value",
    "breakdown",
    "resume",
)


def _card(**overrides: Any) -> MaskedCandidate:
    fields: dict[str, Any] = {
        "candidate_id": uuid.uuid4(),
        "band": "SOLID",
        "experience_years": 6,
        "skills": ["SAP"],
        "badges": [],
    }
    return MaskedCandidate(**{**fields, **overrides})


def test_the_card_carries_exactly_the_agreed_fields() -> None:
    assert set(MaskedCandidate.model_fields) == CARD_FIELDS


def test_no_card_field_is_named_for_identity_or_the_score() -> None:
    for name in set(MaskedCandidate.model_fields) - ALLOWED_IDENTIFYING:
        assert not [f for f in IDENTIFYING if f in name], name


@pytest.mark.parametrize(
    "smuggled", ["phone", "email", "contact", "score", "raw_value", "display_name"]
)
def test_the_card_refuses_a_field_it_does_not_declare(smuggled: str) -> None:
    with pytest.raises(ValidationError):
        _card(**{smuggled: "x"})


def test_no_card_field_is_free_form() -> None:
    """A `dict` or `Any` field would hold anything at all, the score included."""
    for name, field in MaskedCandidate.model_fields.items():
        rendered = repr(field.annotation)
        assert "dict" not in rendered and "Any" not in rendered, name


def test_contact_details_cannot_ride_in_on_a_skill_or_a_city() -> None:
    card = _card(skills=["SAP", "ravi.k@example.com", "+91 98765 43210"], city="call 9876543210")
    assert card.skills == ["SAP"]
    assert card.city is None


def test_the_band_is_a_label_never_a_number() -> None:
    with pytest.raises(ValidationError):
        _card(band=812)


def test_the_card_bands_are_the_scoring_bands() -> None:
    assert get_args(ScoreBand) == tuple(label for label, _, _ in BANDS)


def test_badges_are_exactly_the_addons_scoring_folds_in() -> None:
    assert set(get_args(Badge)) == set(BADGE_FOR_ADDON_KIND.values())
    scoring = (ROOT / "app" / "modules" / "scoring" / "service.py").read_text(encoding="utf-8")
    for kind in BADGE_FOR_ADDON_KIND:
        assert f'_points_of_kind(events, "{kind}")' in scoring, (
            f"scoring no longer reads add-on kind {kind!r}; the badge for it would never appear"
        )


def test_the_search_document_holds_no_score_and_nothing_identifying() -> None:
    from app.modules.discovery.models import CandidateSearchDocument

    assert set(CandidateSearchDocument.__table__.columns.keys()) == {
        "user_id",
        "score_id",
        "resume_version_id",
        "computed_at",
        "band",
        "band_rank",
        "experience_months",
        "skills",
        "skill_keys",
        "badges",
        "search_vector",
    }


def test_the_search_route_answers_with_masked_cards(app: Any) -> None:
    spec = app.openapi()
    operation = spec["paths"]["/api/v1/employer/discovery/candidates"]["get"]
    response = operation["responses"]["200"]["content"]["application/json"]["schema"]
    assert "MaskedCandidate" in json.dumps(response)
    assert set(spec["components"]["schemas"]["MaskedCandidate"]["properties"]) == CARD_FIELDS


def _migration_function(name: str) -> str:
    source = MIGRATION.read_text(encoding="utf-8")
    node = next(
        n for n in ast.walk(ast.parse(source)) if isinstance(n, ast.FunctionDef) and n.name == name
    )
    return ast.get_source_segment(source, node) or ""


def test_the_projection_trigger_is_generated_from_the_rules_it_mirrors() -> None:
    """Bands, badges and the contact filter written out by hand in SQL would
    drift from the Python the moment someone moved a boundary."""
    body = _migration_function("_create_candidate_search_projection")
    for source in ("BANDS", "BADGE_FOR_ADDON_KIND", "CONTACT_LIKE_PATTERN", "MAX_SKILL_LENGTH"):
        assert source in body, f"the trigger no longer derives from {source}"


def test_only_the_trigger_may_write_search_documents() -> None:
    grants = _migration_function("_apply_append_only_grants")
    assert "REVOKE INSERT, UPDATE, DELETE ON candidate_search_documents" in grants
