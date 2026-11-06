# WP 6.1 — Python SDK models and read layer

**SRD ids:** Annex C PD1, PD2, PY-1, PY-2 (the read layer), PY-3; ARC-6 (also D26, §3 rules 16–18) · **Depends on:** S17 · **Status:** active

## Goal

The Python SDK `wrx`, in `python/`: pydantic models generated from the JSON Schema export, and the read layer (game, turn, forces, roles, rooms, a room's messages, the world state, objectives) with pandas helpers loaded on use, all through an abstract bridge whose operations are a versioned protocol shared with the browser runner (WP 6.2) and, later, the native runner.

## Acceptance

- **Schema export (ARC-6, S17's findings).** The asset model is named (`$defs` names, not `Assets`); the 5,000-asset cap is `maxProperties`; "each key is its asset's id", which JSON Schema cannot say, is described in the schema and checked by the SDK. The chat and template message bodies, forces, roles, objectives and the game setup are exported. `pnpm check:json-schema` and `pnpm check:dictionary` pass, both regenerated.
- **The bridge protocol, version 1.** The read operations, their request and result shapes, and the reply envelope, in zod in `packages/schemas/src/bridge.ts` (imported as `@wrx/schemas/bridge`, so the app's main bundle does not carry it), exported as `docs/json-schema/bridge-protocol.schema.json`. Python's models of it are generated from that file; a test checks that the SDK's operation table is the protocol's.
- **The package.** `python/wrx/` with `pyproject.toml`: pure Python, pydantic 2.12 (Pyodide ships 2.12.5), pandas optional. `Game` with `context`, `setup`, `turn`, `forces`, `roles`, `rooms`, `room(id).messages(...)` (async iteration over pages), `world_state()`, `objectives(force)`; role-scoped: it exposes only what the bridge returns (PD2). `to_frame` for messages, turns and assets imports pandas only when called (PY-3).
- **Generated models are current.** `tools/python/generate_models.py` regenerates `python/wrx/_models/` from `docs/json-schema/` with datamodel-code-generator; `--check` fails when they are stale.
- **Tests.** pytest against a fake bridge, with fixtures generated from the mock's demo seed (`packages/mock-server/scripts/python-fixtures.ts`, checked current); models refuse bad data (`lat` 200, a key that is not its asset's id, 5,001 assets) and round-trip.
- **Gates:** `NODE_OPTIONS=--max-old-space-size=8192 pnpm check`; `pnpm check:python`; build plus `check:bundle`; site build plus `check:site`. CI runs `check:python` with `actions/setup-python`.

## Owns

`python/`, `tools/python/`, `packages/schemas/src/bridge.ts` and its test, `packages/schemas/src/json-schema.ts` and its test, the export's `.meta` additions in `packages/schemas/src/world.ts` and `template.ts`, `docs/json-schema/`, `docs/data-dictionary.md`, `docs/python-sdk.md`, the `check:python` script and CI step, the README chart's wp61.

## Consumes

The zod schemas of `packages/schemas` as frozen (only export metadata added); the mock's demo seed (`packages/mock-server/src/demo.ts`) for fixtures; S17's record (`plan/decisions/S17.md`) and its spike.

## Notes

- WP 6.2 (the browser runner) answers the protocol on the page: it imports `@wrx/schemas/bridge`, parses each call with `parseBridgeCall` and replies with `bridgeOk` or `bridgeError`. It owns the worker messages around them (`init`, `run`, `call`, `reply`).
- Version 1 is the read layer only. `writeDraft` and `postProposal` (S17's names) are left for WP 6.4, in a later version.
