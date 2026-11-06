"""Generates the Python SDK's pydantic models from the JSON Schema export (Annex C PY-1, WP 6.1).

Each `docs/json-schema/<name>.schema.json` becomes `python/wrx/_models/<name>.py`, its root
class named after the file (`world-state-message` -> `WorldStateMessage`, as `exportName` in
packages/schemas/src/json-schema.ts names it in other files' `$defs`). With --check, writes
nothing and fails if any module is missing, stale or left over.

Run it with the virtual environment's Python, where datamodel-code-generator and its formatters
are pinned (python/requirements-dev.txt), so the output is the same on every machine:

    python/.venv/bin/python tools/python/generate_models.py [--check]
"""

from __future__ import annotations

import argparse
import filecmp
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "docs" / "json-schema"
OUT = ROOT / "python" / "wrx" / "_models"

OPTIONS = [
    "--input-file-type",
    "jsonschema",
    "--output-model-type",
    "pydantic_v2.BaseModel",
    # Pyodide 314 is CPython 3.14; 3.12 keeps the models readable by older interpreters too.
    "--target-python-version",
    "3.12",
    "--disable-timestamp",
    "--use-schema-description",
    "--use-field-description",
    "--enum-field-as-literal",
    "all",
    "--use-union-operator",
    "--use-standard-collections",
    "--use-double-quotes",
    "--formatters",
    "black",
    "isort",
]


def class_name(stem: str) -> str:
    return "".join(part[:1].upper() + part[1:] for part in stem.split("-"))


def generate(dest: Path) -> list[str]:
    codegen = Path(sys.executable).parent / "datamodel-codegen"
    modules = []
    for schema in sorted(SCHEMAS.glob("*.schema.json")):
        stem = schema.name.removesuffix(".schema.json")
        module = stem.replace("-", "_")
        header = (
            f"# Generated from docs/json-schema/{schema.name} by tools/python/generate_models.py\n"
            "# (datamodel-code-generator). Do not edit: run `pnpm python:models`."
        )
        subprocess.run(
            [
                str(codegen),
                "--input",
                str(schema),
                *OPTIONS,
                "--class-name",
                class_name(stem),
                "--custom-file-header",
                header,
                "--output",
                str(dest / f"{module}.py"),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        modules.append(module)
    lines = [
        '"""Models generated from docs/json-schema (PY-1). Do not edit: run `pnpm python:models`.',
        "",
        "Import them from `wrx.models`, which names the public ones.",
        '"""',
        "",
        "__all__ = [",
        *(f'    "{m}",' for m in modules),
        "]",
        "",
    ]
    (dest / "__init__.py").write_text("\n".join(lines), encoding="utf-8")
    return modules


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail if the models are stale")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        fresh = Path(tmp)
        generate(fresh)
        wanted = sorted(p.name for p in fresh.glob("*.py"))
        if args.check:
            have = sorted(p.name for p in OUT.glob("*.py")) if OUT.is_dir() else []
            _, mismatch, errors = filecmp.cmpfiles(fresh, OUT, wanted, shallow=False)
            extra = sorted(set(have) - set(wanted))
            stale = mismatch + errors + extra
            if stale:
                print(
                    f"python/wrx/_models is out of date ({', '.join(stale)}). "
                    "Run `pnpm python:models` and commit it.",
                    file=sys.stderr,
                )
                return 1
            print(f"python/wrx/_models is up to date ({len(wanted)} modules).")
            return 0
        OUT.mkdir(parents=True, exist_ok=True)
        for old in OUT.glob("*.py"):
            if old.name not in wanted:
                old.unlink()
        for name in wanted:
            (OUT / name).write_bytes((fresh / name).read_bytes())
        print(f"Wrote {len(wanted)} modules to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
