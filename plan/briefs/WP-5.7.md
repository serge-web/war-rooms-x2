# WP 5.7 — Turns and the map: acceptance and review

**SRD ids:** SC-11, NFR-11, NFR-14, R28, R29 (also SC-6, ADM-16, ADM-43–46, PLY-55–60, D7, D21, D25, §3 rule 18, PLY-53, NFR-13) · **Depends on:** 5.3, 5.6, 5.8 · **Status:** active · **Security review required**

## Goal

Prove Phase 5 end to end, measure it, review it, and close the phase: turns, the map room and its world state, the admin's world-state editor and White Force objective editing, on both backends.

## Acceptance

- **Scenario SC-11** (`apps/web/e2e/scenarios/sc-11-turn-and-map.spec.ts`, SRD §12) replaces its `test.fixme` and passes on the mock and on ejabberd, every step as the SRD writes it:
  1. in turn 1 planning, Blue CO and Red CO chat and see the map room's initial world state;
  2. the admin starts adjudication; every turn panel follows, and Blue's and Red's composers are disabled with an explanation;
  3. the admin moves two Blue assets, reduces a Red asset's health and adds a Red asset; the map says there are unpublished edits, held in this browser, and players still see the published state;
  4. the admin starts turn 2, reviews the change summary in the confirmation, and confirms;
  5. Blue's and Red's maps show the new world state for turn 2, and their composers work again;
  6. Red CO reloads; the map room loads the latest world state from MAM;
  7. in turn 2 planning the admin moves a misplaced Blue asset and uses "Publish world state"; after the change summary, every player sees the correction, with no phase change.
- **SC-6** checks the layout reset on a structural change (PLY-5, R28): the notice, the default layout with the new force's rooms and the map, and a half-written message kept. (Built in WP 5.3; this WP confirms it on both backends.)
- **Performance** (`plan/reviews/phase-5-performance.md`): a map room with about 600 assets, its world-state message size against the 500 KB map-room cap (PLY-53) and the largest state that fits; render time on the map, live and on first open (NFR-11, 1 s); the time to publish a large state as the admin; the bundle, with the map lazily loaded (`check:bundle`).
- **Accessibility** (`plan/reviews/phase-5-accessibility.md`, NFR-14): axe on the map panel, the turn panel, the turn panel's confirmation with the world-state change summary (not scanned in WP 5.6), the editor and the asset form; a keyboard-only path to add an asset and move one (the form's latitude and longitude, the keyboard alternative to dragging), as an e2e test.
- **Security review** (`plan/reviews/phase-5-security-review.md`) of the whole phase, including WP 5.6's weak points: the world-state draft in `localStorage` (confidentiality, a stale draft outliving a game under the same map-room GUID, not cleared by reset), last writer wins between admin tabs, the admin backend joining the map room, the export's 20 s fallback, White Force posting in adjudication, and the map room's fixed entries (§3 rule 18). Small in-scope problems are fixed with tests; the rest are findings with a severity and a recommendation.
- **Docs:** site pages for turns and the map (without the deny-listed terms; `check:site`), `docs/` where the schemas changed, `RELEASE-NOTES.md` for Phase 5, and the README chart (wp57 done; wp33 and wp34, merged, no longer shown active).
- **Gate G5 post:** a draft at `plan/reviews/gate-5-post.md`, and the gate's blog post on the site as for the earlier gates (`check:blog`, which then accepts phase 5).
- **Gates:** `pnpm check`, build plus `check:bundle`, `CI=1 pnpm e2e`, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, site build plus `check:site` and `check:blog`, screenshots `--repeat`; on ejabberd the contract, publish and audit suites and the ejabberd Playwright project.

## Owns

`apps/web/e2e/scenarios/sc-11-turn-and-map.spec.ts`, `sc-6-change-during-play.spec.ts`, new a11y and keyboard e2e for the map, `plan/reviews/phase-5-*.md`, `plan/reviews/gate-5-post.md`, the Phase 5 site pages and blog post, `RELEASE-NOTES.md`, the README chart, and fixes the review calls for.

## Consumes

Everything Phase 5 built, as frozen: the store's `advancePhase` and `sendWorldState`, the map panel and editor, the turn panel, the draft storage and the admin backend's transfer.

## Notes

- The SC-11 admin is the umpire in the game view (the map editor lives there, WP 5.6); the phase change goes from the column's turn panel, whose confirmation carries the change summary.
- Moving assets in the scenario uses the form's latitude and longitude, not a drag, so it is the same on both backends and on any runner; a drag is covered by `world-editor.spec.ts`.
