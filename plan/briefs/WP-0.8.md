# WP 0.8 — Runtime schemas and data dictionary (P5)

**SRD ids:** ARC-6, NFR-20, DOC-3 · **Depends on:** 0.5 · **Status:** active · **Designated interface WP**

## Goal

One zod schema for every PubSub document and message body in SRD §3, with TypeScript types inferred from them and a generated data dictionary.

## Acceptance

- Schemas, all carrying `schemaVersion`: `game-setup`, `forces:<id>`, `roles:<id>`, `rooms:<id>` (with participants and type-specific config), `objectives:<forceId>`, `assets:<id>`, `announcements` items, `game-state`, the theme object, and the message body `{type, schemaVersion, content}`.
- The design export file (ADM-16), with passwords impossible to include (§3 rule 9).
- Node-name helpers for every node in §3, and slug validation for ids (§3 rule 1).
- `parseDocument(kind, json)` that migrates by `schemaVersion` and returns a typed result instead of throwing (ARC-6, NFR-5).
- Cross-document checks for a design: references resolve, ids are unique, at most one umpire force (warning); and a helper that lists the assets the game theme uses, which are the only ones anonymous users may read (§3 rule 15).
- Size checks: assets against the configurable limit (default 100 KB) and every document against the PubSub item limit (PLY-53, R15).
- A generator that writes the data dictionary as Markdown from the schemas (DOC-3). CI fails if the committed copy, `docs/data-dictionary.md`, is out of date.
- Unit tests for every schema: a valid example, and each constraint rejected.

## Owns

`packages/schemas/`, `docs/data-dictionary.md`

## Consumes

Nothing.

## Notes

- After this WP merges, a schema change must be listed in the phase gate summary (working model item 4).
- The final message size cap waits for WP 0.1's stanza-size result. Until then the cap is set well below the ~885 KB drop point seen in the spike.
