#!/bin/sh
# Generates Python models from the exported JSON Schemas (ARC-6, docs/json-schema) with
# datamodel-code-generator, as pydantic v2 models and as plain dataclasses (PY-1).
# Usage, from the repo root: sh spike/s17-pyodide/scripts/gen-models.sh [path to datamodel-codegen]
# The tool is not a dependency of the repo: install it in a virtual environment of your own
# (python3 -m venv venv && venv/bin/pip install datamodel-code-generator==0.90.0).
set -eu
codegen="${1:-datamodel-codegen}"
out=spike/s17-pyodide/models
mkdir -p "$out"
for kind in pydantic dataclasses; do
  case $kind in
    pydantic) type=pydantic_v2.BaseModel ;;
    dataclasses) type=dataclasses.dataclass ;;
  esac
  "$codegen" --input docs/json-schema/world-state-message.schema.json --input-file-type jsonschema \
    --output-model-type "$type" --target-python-version 3.12 --disable-timestamp \
    --output "$out/world_state_$kind.py"
done
"$codegen" --version > "$out/GENERATOR_VERSION"
