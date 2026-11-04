# WP 5.2 — Turn and world-state model

**SRD ids:** D7, D25, D26, §3 rules 15–18, ARC-5, ARC-6, PLY-53, PLY-58, PLY-59, P8 · **Depends on:** G4 · **Blocks:** 5.3, 5.4, 5.5 · **Status:** done

## Goal

The model the turn and map work packages build on: schemas for the turn state and the world state, their JSON Schema export for later external reconcilers (D26), the `map` room type with its one fixed-participant room per game, `game-state` published with turn 1 planning, the 500 KB world-state cap, and the store and hooks that read the turn and the newest valid world state, on the mock and on ejabberd. No map, turn or editor UI: those are WPs 5.5, 5.4 and 5.6.

## Acceptance

- **Schemas (`@wrx/schemas`, data dictionary regenerated, `pnpm check:dictionary`):**
  - `game-state` `{schemaVersion: 1, turn, phase: planning | adjudication}`, the turn a positive integer.
  - The world-state message body `{type: 'world-state', schemaVersion: 1, content: {turn, assets}}`, `assets` an object keyed by asset GUID (rule 16), each key its asset's `id`.
  - The asset with the fixed fields of rule 17 (`id`, `forceId`, `title`, `category`, `sidc`, `lat`, `lon`, `state`, `health`, `fuel`): GUIDs for the ids, bounded text, latitude −90 to 90, longitude −180 to 180, health and fuel 0 to 100, and a `sidc` that is a MIL-STD-2525/APP-6 code: 15 characters (letter-based, 2525C and APP-6 B/C) or 20 or 30 digits (number-based, 2525D and E, APP-6 D).
  - The `map` room config `{schemaVersion: 1, centre?, zoom?}`; `{}` reads as the defaults.
  - The message-body union takes the world-state body; a chat room refuses it, a map room takes nothing else.
- **JSON Schema export (D26, ARC-6, P8):** a script writes JSON Schema 2020-12 files for the world-state message body, the asset, the turn state, the room document and the map and chat room configs to `docs/json-schema/`, with `--check` in `pnpm check`; a test checks the export covers each schema and accepts and refuses what zod does on samples.
- **`map` room type (ARC-5):** registered beside `chat`, with its config schema, its message schema and the icon name `map`; the app registers a placeholder player panel that WP 5.5 replaces.
- **One map room per game (rule 18):** its participants are every force as a write entry, plus the White Force under rule 4.
  - `checkDesign` refuses a second map room, and a map room whose participants are not that set.
  - The draft always has exactly one: a new draft, an import and a stored draft gain one if they have none. Adding or deleting a force re-syncs its participants. Participant edits, a type change to or from `map`, a second map room and deleting it are refused.
  - The room editor says so, instead of offering those controls.
- **Publishing (admin-ops, mock seed):**
  - `game-state` is created as before and its document `{turn: 1, phase: 'planning'}` published when the node has no valid item. A later publish never resets the turn (WP 5.4 advances it); a reset (ADM-15) removes it with the node, and the next publish starts again at turn 1.
  - The map room is provisioned like any room.
  - The audit reports a missing or invalid turn state, not a turn other than 1.
  - Both work the same on the mock and on ejabberd.
  - `designVersion` semantics and `rooms:*` read access are unchanged (WP 5.3).
- **Map-room cap (PLY-53):** world-state messages in the map room may be up to 500,000 bytes (UTF-8 after XML escaping, the whole stanza, as the 64 KiB cap). The store's world-state send path checks the type, the room and the size; the transports take an optional per-send limit, never above 500,000; everything else stays at 65,536.
- **Store and hooks:**
  - `gameState()` and `useGameState()` read the live turn state.
  - `worldState(roomId)` and `useWorldState(roomId)` join the map room and page back through MAM, in small pages, to the newest valid world-state message from the admin's real JID. Messages from anyone else, or invalid ones, are ignored and logged (PLY-58, PLY-59), and later valid ones replace it live.
  - `sendWorldState(roomId, state)` gives WP 5.6 the cap-checked send.
  - Unit tests for each.
- **Mock:** the same node, document, room and cap; the demo seed gains the map room and an initial world state of a few assets per force, posted by the admin.
- **Contract tests (both backends):** every role reads `game-state`, no role but the admin publishes it, anonymous sessions read nothing; a world-state message near 500 KB round-trips live and through MAM; one over the limit, and a 100 KB message without the larger limit, are refused before sending.
- **Gates:** `pnpm check`, build plus `check:bundle`, `CI=1 pnpm e2e`, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, site build plus `check:site`, screenshots `--repeat`, and on ejabberd the contract, admin-ops, publish and audit suites.

## Notes

- **A design with no map room stays valid** for `checkDesign`, so designs from before Phase 5 and test designs still publish. The draft is what guarantees exactly one, since the admin designs only through it. A second map room, or one with other participants, is an error.
- **The map room's fixed participants are write entries** for every force, plus the White Force under rule 4. Members keep voice, so the map room adds no role to the observer vault, and clients accept only the admin's world states (D25, PLY-58). The SRD's first wording, read entries, was a drafting error, corrected on Nov 4 (§3 rule 18, §14).
- **The turn state is published once.** The planner leaves an existing valid `game-state` item alone, so republishing a design never moves the game back to turn 1.
- **The transport interface gains an optional third argument**, `send(room, body, {maxBytes})`. It is additive, so callers that pass nothing keep the 64 KiB cap.
- **The seed's world state lives in `DesignSeed`, not in the design file.** WP 5.6 adds it to the design file and export (ADM-16), and can reuse the fixture `sampleWorldState()`.
- The map room's messages are full states (D25). The store keeps the map room's timeline like any room's, so a long session holds every state published during it (R26).
