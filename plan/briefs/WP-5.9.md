# WP 5.9 — Phase 5 polish: review findings

**SRD ids:** ADM-43, ADM-45, ADM-15, R25, R28, NFR-11, NFR-14 (also §3 rule 8, D6, PLY-5, PLY-57) · **Depends on:** 5.7 · **Status:** active

## Goal

Fix the Phase 5 review findings left open by WP 5.7 that are small enough to close before the v1 release: L3 and M3 from the security review, L7 (R28) from the security review and the brief, A2 from the accessibility review, and the margin of the map's first render at 600 assets from the performance review.

## Acceptance

- **L3, a phase change that fails after its world state went out** (`phase-5-security-review.md`). `advancePhase` with `worldState` says, when only the `game-state` publish failed, that the world state was published and the phase did not move (`AdvancePhaseError.worldStateSent`). The turn panel says so in its confirmation, clears the draft as published (the map shows no unpublished edits), keeps the confirmation open, and a second confirmation moves only the phase without sending the world state again. Tests: `world.store.test.ts`, `editor.test.tsx`.
- **M3, a stale draft outliving its game.** The admin backend's reset confirmation (ADM-15), and the mock host's "Reset to seed" if it applies, offer to discard a world-state draft held in this browser for the game being reset (`world-draft:v1:<server>:<mapRoomId>`). The offer is shown only when such a draft exists, unticked, and the admin chooses: nothing is discarded without that choice. Tests: unit and `e2e:admin-ui`.
- **L7, a role added or removed is not structural** (R28, §3 rule 8). `designStructure` compares the room ids and the effective access of the roles present in both designs only. Rooms added or removed, or a role present in both whose access to a room changes, stay structural. The planner compares the two designs with a function (`structuralChange`) instead of one string. SRD §3 rule 8, D6, R28 and the layouts note, the data dictionary, `RELEASE-NOTES.md` (the L7 known limit goes), and a dated decision line (Nov 4, 2026). Tests: `target.test.ts`, `plan.test.ts`.
- **A2, the asset table at scale** (`phase-5-accessibility.md`). One Tab stop for the asset table's rows (a roving tab index, arrow keys, Home and End between rows), so "Edit…" is a few Tab presses from any row at 600 assets. axe stays clean; a keyboard e2e test measures the Tab presses at 600 assets.
- **The map's first render at 600 assets** (`phase-5-performance.md`): find the cost (symbol generation, marker creation, layout) and bring the full-suite time well under the 1 s target (aim: under 700 ms). The review gets before and after numbers.
- **Reviews:** the security, accessibility and performance reviews mark these fixed. The plan gets a WP 5.9 row in Phase 5, and the README chart a wp59 node, done at the end. `pnpm check:trace` passes.
- **Gates:** `pnpm check`, build plus `check:bundle`, `CI=1 pnpm e2e`, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, site build plus `check:site` and `check:blog`, screenshots `--repeat`; on ejabberd the contract, publish and audit suites and the ejabberd Playwright project.

## Owns

The fixes above and their tests: `packages/domain/src/store.ts` (`advancePhase`), `packages/player-ui/src/column/turn-panel.tsx`, `packages/player-ui/src/map/` (the table, the leaflet view, symbols), `packages/admin-ops/src/target.ts` and `publish/plan.ts`, the reset confirmation in `packages/admin-ui`, the e2e tests named, `plan/reviews/phase-5-*.md`, the SRD lines named, the data dictionary, `RELEASE-NOTES.md`, the plan's Phase 5 table and the README chart.

## Consumes

Everything Phase 5 built, as frozen except where named above.

## Notes

- L3 changes the store interface: `advancePhase` returns `AdvancePhaseResult`, whose error may carry `worldStateSent`. No other caller exists.
