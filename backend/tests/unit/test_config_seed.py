"""`scripts/seed_config.py` writes documents the application will accept.

Eight tunables steer things a customer feels. Without a row each falls back
to a default in code, invisible unless you read the source, so every
environment is seeded.

**The dangerous failure is not a missing row, it is a bad one.** Every reader
is deliberately strict: an unknown key or an out-of-range number raises
rather than falling back, because a default left live while the row looks
applied is the worse outcome. That strictness means a seed document with one
misspelt key is a 500 on the college dashboard, the employer's search, or the
renewal sweep -- discovered in production, by a customer.

These tests run the seed's own documents through the application's own
readers, so that failure is a red build instead.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"


def _seed_module() -> Any:
    """Import the script by path. It is not a package, and CI runs `pytest`
    bare so the repository root is not on `sys.path`."""
    spec = importlib.util.spec_from_file_location("seed_config", SCRIPTS / "seed_config.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["seed_config"] = module
    spec.loader.exec_module(module)
    return module


TUNABLES = _seed_module()._tunables()
KEYS = [t.key for t in TUNABLES]


@pytest.mark.parametrize("tunable", TUNABLES, ids=KEYS)
def test_the_seeded_document_is_one_the_application_accepts(tunable: Any) -> None:
    """The whole point. `verify` is the module's own reader, not a copy of it."""
    tunable.verify(tunable.document())


@pytest.mark.parametrize("tunable", TUNABLES, ids=KEYS)
def test_the_seeded_document_is_json(tunable: Any) -> None:
    """It goes into a JSONB column. A tuple, a dataclass or a datetime that
    survived `_asdict` would fail at the INSERT, inside a deploy step."""
    document = tunable.document()
    assert json.loads(json.dumps(document)) == document


@pytest.mark.parametrize("tunable", TUNABLES, ids=KEYS)
def test_the_seeded_document_carries_no_row_version(tunable: Any) -> None:
    """`version` names the `config_values` ROW, not the document.

    Three of these dataclasses carry a `version` field that the reader fills
    in from the row. Leaving it inside the JSON makes the document an unknown
    key to its own strict parser -- which the test above would catch, but this
    says why, at the place somebody would add a ninth tunable.
    """
    assert "version" not in tunable.document()


def test_every_config_key_read_by_the_application_is_seeded() -> None:
    """A ninth tunable added to a module and not to the seed would run on an
    invisible default again, which is the condition this script exists to end.

    Read from the source rather than from a list: a list would have to be
    updated by the same person who forgot the seed.
    """
    app_dir = Path(__file__).resolve().parents[2] / "app"
    # `SOMETHING_CONFIG_KEY = "module.thing"`, with or without `: Final` --
    # seven of the eight annotate it and `integrity` does not, so matching on
    # `: Final` silently missed one when this test was first written.
    declaration = re.compile(r'\w*CONFIG_KEY\w*\s*(?::\s*[^=]+)?=\s*"([a-z_]+\.[a-z_]+)"')
    found: set[str] = set()
    for path in app_dir.rglob("*.py"):
        found.update(declaration.findall(path.read_text(encoding="utf8")))

    # Guard against the guard: if the pattern stops matching, this test would
    # pass by finding nothing at all.
    assert len(found) >= len(KEYS), (
        f"only found {sorted(found)}; the declaration pattern has stopped matching"
    )
    missing = found - set(KEYS)
    assert missing == set(), (
        f"these config keys are read by the application and never seeded: {sorted(missing)}. "
        f"Add them to scripts/seed_config.py."
    )


def test_the_seed_refuses_nothing_it_would_write() -> None:
    """Belt and braces on the ordering inside `main`: every document is built
    and verified before a transaction opens, so a bad one aborts having
    written nothing rather than leaving half the keys seeded."""
    for tunable in TUNABLES:
        tunable.verify(tunable.document())
