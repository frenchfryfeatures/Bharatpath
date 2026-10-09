#!/usr/bin/env python3
"""Export openapi.json.

The OpenAPI schema is a deliverable, not a side effect. Four client teams -
one mobile, three web - generate their clients from it, so CI exports it on
every merge to main and publishes it as a build artifact.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import create_app


def main() -> int:
    schema = create_app().openapi()
    out = Path(__file__).resolve().parent.parent / "openapi.json"
    out.write_text(json.dumps(schema, indent=2, sort_keys=True), encoding="utf-8")
    print(f"Wrote {out} - {len(schema.get('paths', {}))} path(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
