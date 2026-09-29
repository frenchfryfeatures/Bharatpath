"""The search filter catalogue's rules, without a database (2026-09-24).

An option is a label and the other spellings that choosing it also searches.
The rules that matter: a spelling belongs to one option, custom text still
searches exactly as it did before the catalogue existed, and nothing a CV
could smuggle onto a card (a phone number, an email) becomes an option.
"""

from __future__ import annotations

from typing import get_args

import pytest

from app.modules.discovery.catalogue import CITIES, FILTER_CATALOGUE_VERSION, SKILLS
from app.modules.discovery.domain import (
    BADGE_LABELS,
    BAND_LABELS,
    MAX_OPTION_ALIASES,
    FilterOptionError,
    clashing_keys,
    filter_groups,
    filter_option_terms,
    option_key,
)
from app.modules.discovery.schemas import Badge, ScoreBand
from app.modules.scoring.domain import BANDS


# --- one option ---------------------------------------------------------------
def test_an_option_is_keyed_lower_cased_with_its_aliases_deduplicated() -> None:
    terms = filter_option_terms(
        "SKILL", label="  MS   Excel ", aliases=["Excel", "EXCEL", "ms excel", " Advanced Excel"]
    )
    assert terms.label == "MS Excel"
    assert terms.key == "ms excel"
    assert terms.aliases == ("excel", "advanced excel")
    assert terms.keys == ("ms excel", "excel", "advanced excel")


def test_a_city_names_its_state_and_a_skill_has_none() -> None:
    city = filter_option_terms("CITY", label="Pune", aliases=["Poona"], state_code="MH")
    assert (city.key, city.aliases, city.state_code) == ("pune", ("poona",), "MH")

    with pytest.raises(FilterOptionError, match="state_code"):
        filter_option_terms("CITY", label="Pune")
    with pytest.raises(FilterOptionError, match="not a state"):
        filter_option_terms("CITY", label="Pune", state_code="XX")
    with pytest.raises(FilterOptionError, match="only a city"):
        filter_option_terms("SKILL", label="Welding", state_code="MH")


@pytest.mark.parametrize(
    ("kind", "label"),
    [
        ("SKILL", "call 98765 43210"),
        ("SKILL", "me@example.com"),
        ("SKILL", "   "),
        ("SKILL", "x" * 81),
        # A city follows the candidate's own city rule: no digits, no `@`.
        ("CITY", "Pune 411001"),
        ("CITY", "pune@example.com"),
    ],
)
def test_nothing_that_could_be_contact_data_becomes_an_option(kind: str, label: str) -> None:
    with pytest.raises(FilterOptionError):
        filter_option_terms(kind, label=label, state_code="MH" if kind == "CITY" else None)  # type: ignore[arg-type]
    with pytest.raises(FilterOptionError):
        filter_option_terms(
            kind,  # type: ignore[arg-type]
            label="Nashik" if kind == "CITY" else "Welding",
            aliases=[label],
            state_code="MH" if kind == "CITY" else None,
        )


def test_aliases_are_bounded() -> None:
    aliases = [f"spelling {chr(97 + n)}" for n in range(MAX_OPTION_ALIASES + 1)]
    with pytest.raises(FilterOptionError, match="at most"):
        filter_option_terms("SKILL", label="Welding", aliases=aliases)
    filter_option_terms("SKILL", label="Welding", aliases=aliases[:MAX_OPTION_ALIASES])


# --- spellings --------------------------------------------------------------------
def test_one_spelling_belongs_to_one_option() -> None:
    pune = filter_option_terms("CITY", label="Pune", aliases=["Poona"], state_code="MH")
    poona = filter_option_terms("CITY", label="Poona", state_code="MH")
    welding_skill = filter_option_terms("SKILL", label="Pune")  # another kind: no clash
    assert clashing_keys([pune, poona]) == ["poona"]
    assert clashing_keys([pune, welding_skill]) == []


def test_a_chosen_option_searches_all_its_spellings_and_custom_text_itself() -> None:
    options = [("pune", ["poona"]), ("mumbai", ["bombay"])]
    assert filter_groups(["Poona", "BOMBAY", "Nashik"], options) == [
        ("pune", "poona"),
        ("mumbai", "bombay"),
        ("nashik",),
    ]
    # The same option named twice is searched once.
    assert filter_groups(["Pune", "poona"], options) == [("pune", "poona")]


def test_custom_skill_text_keeps_the_search_documents_key() -> None:
    """The trigger stores `lower(btrim(skill))` and does not collapse inner
    spaces, so neither may a custom filter -- or it would stop matching a CV
    that it matched before the catalogue existed."""
    assert filter_groups(["  Tool  Room "], []) == [("tool  room",)]
    assert option_key("  Tool  Room ") == "tool room"


# --- labels the panel draws --------------------------------------------------------
def test_the_panel_names_exactly_the_scoring_bands_and_the_badges() -> None:
    assert tuple(BAND_LABELS) == get_args(ScoreBand) == tuple(label for label, _, _ in BANDS)
    assert set(BADGE_LABELS) == set(get_args(Badge))


# --- the starter catalogue ----------------------------------------------------------
def test_the_starter_catalogue_is_flagged_as_ours() -> None:
    assert FILTER_CATALOGUE_VERSION.startswith("placeholder-"), (
        "the starter skills and cities were written by us, not the client. Dropping the "
        "prefix is a claim the client has approved them."
    )


def test_every_starter_option_is_valid_and_no_spelling_is_claimed_twice() -> None:
    terms = [
        filter_option_terms("SKILL", label=s.label, aliases=s.aliases, state_code=s.state_code)
        for s in SKILLS
    ] + [
        filter_option_terms("CITY", label=c.label, aliases=c.aliases, state_code=c.state_code)
        for c in CITIES
    ]
    assert clashing_keys(terms) == []
    assert any(s.featured for s in SKILLS)
    assert any(c.featured for c in CITIES)
