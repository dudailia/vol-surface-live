"""Write JSON Schemas for the bundle and report to /schema (run in CI to catch drift)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from .bundle import Bundle


def schemas() -> dict[str, dict[str, object]]:
    out = {"bundle.schema.json": Bundle.model_json_schema(mode="serialization")}
    try:
        from .report import Report
    except ImportError:  # pragma: no cover
        pass
    else:
        out["report.schema.json"] = Report.model_json_schema(mode="serialization")
    return out


def main() -> None:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "../schema")
    root.mkdir(parents=True, exist_ok=True)
    for name, s in schemas().items():
        (root / name).write_text(json.dumps(s, indent=2, sort_keys=True) + "\n")
        print("wrote", root / name)


if __name__ == "__main__":
    main()
