#!/bin/sh
# `pnpm check:python` (WP 6.1): the Python SDK's checks. Creates python/.venv on first use with
# python3 (or $PYTHON), 3.12 or later, and installs python/requirements-dev.txt into it (again
# whenever that file changes; this needs the package index once). Then: the JSON Schema export,
# the SDK's test fixtures and its generated models are current, and pytest passes.
#
# Not part of `pnpm check`, so a machine without Python still runs that; CI runs both.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
venv="$root/python/.venv"
requirements="$root/python/requirements-dev.txt"

if [ ! -x "$venv/bin/python" ]; then
  "${PYTHON:-python3}" -m venv "$venv"
fi
"$venv/bin/python" -c 'import sys; sys.exit(sys.version_info < (3, 12))' || {
  echo "python/.venv needs Python 3.12 or later; remove it and set PYTHON" >&2
  exit 1
}
if ! cmp -s "$requirements" "$venv/.requirements-dev.txt"; then
  "$venv/bin/python" -m pip install --quiet --disable-pip-version-check -r "$requirements"
  cp "$requirements" "$venv/.requirements-dev.txt"
fi

node "$root/packages/schemas/scripts/export-json-schema.ts" --check
node "$root/packages/mock-server/scripts/python-fixtures.ts" --check
"$venv/bin/python" "$root/tools/python/generate_models.py" --check
cd "$root/python"
"$venv/bin/python" -m pytest
