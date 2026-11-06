"""Writes sample-scripts.json, the importable bundle of these examples, from the .py files.

    python python/examples/make_bundle.py          # write it
    python python/examples/make_bundle.py --check  # fail if it is stale

The bundle is the Scripts panel's export format (`wrx-script-bundle`, version 1); importing it
adds every script with "Publish without review" off. `pnpm test` checks that the panel's
importer accepts it (packages/domain/src/examples.test.ts).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
BUNDLE = HERE / "sample-scripts.json"
EXPORTED_AT = "2026-11-06T14:57:32.847Z"

# (file, name in the panel, time limit in seconds), in the order the panel lists them.
SCRIPTS = [
    ("game_summary.py", "Game summary", 30),
    ("asset_report.py", "Asset report (pandas)", 60),
    ("recent_messages.py", "Recent messages", 30),
    ("turn_notice.py", "Turn notice", 30),
    ("advance_blue.py", "Advance Blue (admin)", 30),
    ("resupply.py", "Resupply (admin)", 30),
    ("propose_damage.py", "Propose damage (White Force)", 30),
]


def bundle() -> str:
    scripts = [
        {
            "name": name,
            "code": (HERE / file).read_text(encoding="utf-8"),
            "settings": {"timeLimitSeconds": seconds, "autoPublish": False},
        }
        for file, name, seconds in SCRIPTS
    ]
    doc = {"format": "wrx-script-bundle", "version": 1, "exportedAt": EXPORTED_AT, "scripts": scripts}
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    text = bundle()
    if "--check" in sys.argv:
        if BUNDLE.read_text(encoding="utf-8") != text:
            sys.exit("python/examples/sample-scripts.json is stale: run make_bundle.py")
        print("python/examples/sample-scripts.json is up to date.")
    else:
        BUNDLE.write_text(text, encoding="utf-8")
        print(f"Wrote {BUNDLE.name} ({len(SCRIPTS)} scripts)")
