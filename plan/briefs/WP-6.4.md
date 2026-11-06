# WP 6.4 — Act and adjudicate

**SRD ids:** Annex C PD6, PD7, PD8, PD9, PY-2 (act and adjudicate), PY-8, PY-9 (also PR2, ADM-44–46, PLY-53, PLY-56, D25, §3 rules 4 and 18) · **Depends on:** 6.3 · **Status:** in progress

## Goal

Scripts act and adjudicate (PY-2): they send text and templated messages, react to messages and phase changes, and the White Force proposes world states to the admin in a built-in umpire room (PD6, PD8, PY-8). The admin loads a proposal into the world-state draft after its change summary (ADM-46). An admin script writes on top of the draft without losing hand edits, and may, when the admin turns it on per script, publish without review (PD7, PY-9, PR2).

## Acceptance

- **Protocol 2** (`@wrx/schemas/bridge`, the JSON Schema export and the generated Python models). Version 1's read operations unchanged; added:
  - `sendMessage {roomId, text}` and `sendTemplate {roomId, templateId, values}`: only rooms the role can write; the advisory adjudication pause applies as in the composer (PLY-56), White Force exempt; the result is the stanza id.
  - `readDraft {}` and `writeDraft {state}`: admin only; the draft write replaces the stopgap `wrx_draft`.
  - `postProposal {state, summary}`: White Force roles that are not observers only; schema and 500 KB cap before posting (PLY-53); allowed in adjudication.
  - Events, delivered by the bridge while a run is active: `subscribeMessages {roomId}` and `subscribePhase {}`; in Python `game.on_message(room, handler)`, `game.on_phase(handler)`, and `await game.run_forever(seconds=None)`, which keeps the run alive, bounded by its time limit; a handler may call `game.stop()` to end it cleanly.
- **The umpire room (PD8, PY-8).** Room type `umpire`, one per game, made by the draft with the map room and created by publishing. Its participants are fixed (the design editor shows the room but cannot remove it or edit its members): the White Force as a write entry, so its roles that are not observers write and its observers read (rule 4), plus a read entry for each White Force observer that has assigned rooms elsewhere, so every White Force role sees it. Players of other forces have no access. Its observers are in the vault and revoked as for any read-only entry (ADM-37). Design check, publish planner, contract and publish tests on both backends, the data dictionary; SRD §3 rule 18 extended and a dated note in §14.
- **The proposal message (`world-proposal`).** Its own schema (`{state, summary}`), the 500 KB map-room cap, validated before posting and on receipt, accepted only in the umpire room and only from the admin or a White Force role. The admin's client shows it as a card with "Load into draft…", which shows the change summary first (ADM-46); every other client shows the card only.
- **Draft semantics (6.3's weak point).** A script's draft write is applied as the change from what it was based on (the draft it read with `readDraft`, else the published state at the run's start) onto the draft as it is when the run ends, so hand edits survive. After the run the panel shows what the script changed in the draft and how the draft now differs from the published state.
- **Opt-in publishing (PD7, PY-9, PR2).** The per-script `autoPublish` setting works for the admin's scripts: off by default; turning it on needs a confirmation that it changes the live map without review. A clean run that wrote the draft then publishes it at once, mid-phase included, after the same checks as a manual publish, and the publish is recorded with its change summary and the script's name where the admin sees it.
- **Runner timing (6.2's flaky tests).** A run's time limit starts when the script starts, not when the worker does; the probe canary listens on a free port. Root cause recorded.
- **PR previews and Pyodide (owner, Nov 6, 2026).** A PR preview includes `py/` only when the PR touches the runner, the SDK or Python files; the main site always does. Without it, the Scripts panel says it is unavailable in this build.
- **Tests:** unit and e2e on the mock (an admin script sends a message; a White Force script posts a proposal and the admin loads it; auto-publish on and off; an `on_message` handler reacts; the pause holds for a role outside the White Force; hand edits survive an admin script); contract tests for the umpire room on both backends; the ejabberd Playwright project if Docker runs.
- **Docs:** `docs/python-sdk.md` (writes, events, proposals), the site's umpire page, release notes.
- **Gates:** `pnpm check`, `pnpm check:python`, build and `check:bundle`, `CI=1 pnpm e2e` twice, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, the site build with `check:site` and `check:blog`, screenshots `--repeat`; on ejabberd the contract, publish and audit suites and the Playwright project, if Docker runs.

## Owns

`packages/schemas/src/bridge.ts`, the umpire room and proposal schemas, `docs/json-schema/`, `docs/data-dictionary.md`; `python/`; `packages/py-runner/`; the umpire room in `packages/domain` (registry, store) and `packages/admin-ui` (draft, rooms section); `packages/player-ui/src/scripts/` and the proposal card; the contract suite's umpire-room checks and the publish tests; `apps/web/e2e/scripts*.spec.ts`, `apps/web/e2e/py-runner*`; the site build's `py/` rule and `.github/workflows/site-build.yml`; `docs/python-sdk.md`, the site's umpire page, `RELEASE-NOTES.md`; the README chart's wp64.

## Consumes

The runner and the panel (WPs 6.2, 6.3); the bridge protocol 1 (6.1); the world-state draft and the change summary (5.6); the publish planner and the vault (2.x, 5.3); the store's send paths and the pause (PLY-56).

## Notes

- **Why the White Force as a force entry.** A role entry for a White Force observer assigns it (rule 4), limiting it to the rooms naming it; a force entry does not. So the umpire room names the White Force, and adds a role entry only for an observer already assigned elsewhere, for whom one more does not change its other rooms.
