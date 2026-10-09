"""Resume versions, pure: version-chain rules and edit provenance.

No database. These are the rules the integration tests then exercise through
HTTP, kept here as pure functions so every branch is cheap to pin -- including
the ones that only show up after thirty edits, which no integration test would
ever set up.
"""

from __future__ import annotations

from app.modules.resume.domain import (
    EDIT_PARSER,
    PARSE_STATES,
    PARSE_TERMINAL,
    build_edited_parsed,
    edit_provenance,
    refuse_version_change,
)


# --- what closes a version -------------------------------------------------
def test_a_current_version_is_open_to_change() -> None:
    assert refuse_version_change(is_superseded=False) is None


def test_a_superseded_version_is_closed() -> None:
    """Editing one forks the chain; confirming one makes replaced content
    scorable. One rule, so the two callers cannot drift apart."""
    refusal = refuse_version_change(is_superseded=True)
    assert refusal is not None
    assert refusal.code == "resume_version_superseded"
    assert refusal.detail


# --- provenance ------------------------------------------------------------
def test_the_first_edit_keeps_the_machine_extractor_as_the_origin() -> None:
    """A replay has to be able to say which engine read the document, even
    after a human has corrected what it produced."""
    machine = {"parser": "local", "parser_version": "1+pypdf6.18"}

    provenance = edit_provenance(machine)

    assert provenance["parser"] == EDIT_PARSER
    assert provenance["edit_generation"] == 1
    assert provenance["origin"] == machine


def test_the_origin_never_nests_however_many_times_a_cv_is_corrected() -> None:
    """**The reason this is a function and not two lines in the service.**

    The obvious implementation embeds the previous extractor whole, and a
    candidate who tidies their CV thirty times then has thirty levels of JSON
    and a replay that has to recurse to find the parser. `origin` is copied
    forward flat instead, so both questions a replay asks stay one lookup deep.
    """
    machine = {"parser": "local", "parser_version": "1+pypdf6.18"}

    provenance = edit_provenance(machine)
    for _ in range(29):
        provenance = edit_provenance(provenance)

    assert provenance["edit_generation"] == 30
    assert provenance["origin"] == machine
    assert "origin" not in provenance["origin"], "the origin nested"


def test_provenance_survives_a_version_with_no_extractor_block() -> None:
    """Rows predating the extractor block exist -- `seeded_candidate` writes
    `parsed` as `{}`. An edit of one must not raise."""
    provenance = edit_provenance(None)

    assert provenance["edit_generation"] == 1
    assert provenance["origin"] == {}


def test_a_corrupt_generation_counter_does_not_propagate() -> None:
    """`parsed` is JSONB and nothing constrains its shape, so a hand-edited or
    migrated row can carry anything. Counting from a string would raise inside
    a request; counting from garbage as zero keeps the edit working and the
    provenance honest about at least the origin."""
    provenance = edit_provenance({"parser": "x", "edit_generation": "not a number"})

    assert provenance["edit_generation"] == 1


# --- the edited payload ----------------------------------------------------
def test_an_edit_replaces_content_and_rebuilds_provenance() -> None:
    previous = {
        "raw_text": "what the parser read",
        "page_count": 2,
        "extractor": {"parser": "local", "parser_version": "1"},
    }

    parsed = build_edited_parsed(
        previous_parsed=previous, replacement={"raw_text": "what the candidate meant"}
    )

    assert parsed["raw_text"] == "what the candidate meant"
    assert parsed["extractor"]["parser"] == EDIT_PARSER
    assert parsed["extractor"]["origin"]["parser"] == "local"


def test_an_edit_does_not_carry_stale_fields_forward() -> None:
    """A whole replacement, not a patch. `page_count` described the document
    the parser read; keeping it beside text a human rewrote would describe
    nothing, and the merge rules for a partial update are exactly the thing
    nobody would agree on later."""
    previous = {"raw_text": "old", "page_count": 2, "extractor": {"parser": "local"}}

    parsed = build_edited_parsed(previous_parsed=previous, replacement={"raw_text": "new"})

    assert "page_count" not in parsed


def test_a_client_cannot_forge_its_own_provenance() -> None:
    """`extractor` is rebuilt, never accepted. Otherwise a candidate could
    post an edit claiming its text came from the parser."""
    previous = {"raw_text": "old", "extractor": {"parser": "local", "parser_version": "1"}}

    parsed = build_edited_parsed(
        previous_parsed=previous,
        replacement={"raw_text": "new", "extractor": {"parser": "local", "parser_version": "1"}},
    )

    assert parsed["extractor"]["parser"] == EDIT_PARSER
    assert parsed["extractor"]["edit_generation"] == 1


# --- the parse state machine ----------------------------------------------
def test_there_is_no_running_state() -> None:
    """**Deliberate, and worth a test so it is argued for rather than added.**

    A worker that claims a file and dies leaves RUNNING behind with nothing to
    sweep it, so the state that exists to reassure the candidate is the one
    that strands them. QUEUED means "not finished", and redelivery fixes it.
    """
    assert "RUNNING" not in PARSE_STATES


def test_every_terminal_state_is_a_real_state() -> None:
    assert PARSE_TERMINAL <= PARSE_STATES


def test_queued_is_the_only_state_a_client_keeps_polling() -> None:
    assert {"QUEUED"} == PARSE_STATES - PARSE_TERMINAL
