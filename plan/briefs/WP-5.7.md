# WP 5.7 — Turns and the map: acceptance and review

**SRD ids:** SC-11, NFR-11, NFR-14, R28, R29 (also SC-6, ADM-16, ADM-43–46, PLY-55–60, D7, D21, D25, §3 rule 18, PLY-53, NFR-13) · **Depends on:** 5.3, 5.6, 5.8 · **Status:** done · **Security review required**

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
- **Structural change narrowed (added to this WP, product owner, Nov 4, 2026).** A structural change, the kind that moves `designVersion` and resets layouts (§3 rule 8, D6, PLY-5, R28), is only a room added or removed, or a change of any role's effective access to a room (none, read or write, by `effectiveAccess`). Re-ordering forces, roles or rooms no longer counts; moving a role between forces, the observer flag and the White Force flag count only through the access they change. `designStructure` (`admin-ops/src/target.ts`) is rebuilt from the sorted room ids and the effective-access matrix. SC-6 adds a rename and re-order of a room during play that keeps the layout.
- **Roles added or removed and the layout key.** Saved layouts are keyed by server, role and `designVersion` (PLY-5), so a new role has no layout to lose, and a deleted one is logged out. Under the narrowed rule a role added or removed counts through its access: one that sees no room changes nothing; one that sees any room (the usual case) changes the matrix, so the version moves and every online player's layout resets, although their own rooms did not change. Comparing only the roles present in both designs would avoid that; it is left as the owner's rule reads ("any role's effective access"), and recorded in the review.
- Moving assets in the scenario uses the form's latitude and longitude, not a drag, so it is the same on both backends and on any runner; a drag is covered by `world-editor.spec.ts`.

## Notes (done)

- **SC-11** (`apps/web/e2e/scenarios/sc-11-turn-and-map.spec.ts`) passes on the mock and on ejabberd, every SRD step, with axe on the turn confirmation and its change summary. **SC-6** passes on both, and now renames and re-orders a room during play and checks the layout stays.
- **R29** (no session eviction) is unchanged by Phase 5: recorded in the gate post's open risks and the release notes' known limits.
- **Performance** (`plan/reviews/phase-5-performance.md`): 600 assets are 169,732 bytes as one message (34% of the cap; 1,775 typical, 963 longest-field, 337 worst-case escaped assets fit); first map render 853 ms, live 322 ms, an editor edit 66 ms. New measurements: `scale.test.ts` (size, fit, parse, diff) and `perf.spec.ts` (the admin's edit, summary and publish at 600 assets).
- **Accessibility** (`plan/reviews/phase-5-accessibility.md`): a keyboard-only add, move and publish (`world-editor.spec.ts`) found A1, fixed: the asset form now takes focus when it opens and gives it back when it closes. A2 (tabbing from a table row to "Edit…" at scale) is recorded.
- **Security review** (`plan/reviews/phase-5-security-review.md`): H1 fixed in part (a world state buried behind many map-room posts is `unreached`, never `none`; "Look further back"; the admin cannot publish against it), M1 (the remaining denial) and M2 (the draft in `localStorage`) for the owner, M3 fixed in part (a warning on a draft from an earlier game), L2 and L6 fixed (the export says when it holds no world state; non-admin map-room posts are not parsed), L1, L3, L4, L5, L7 recorded.
- **Interface changes** (listed for the gate): `AccessInput` takes only the fields it reads; `SessionStore.searchWorldStateFurther` and `WorldStateView.unreached`; `WorldStateTransfer.forExport` returns `WorldStateForExport`; `readPublishedWorldState` returns `found`, `none` or `unavailable`.
- **Docs:** `site/pages/turns-and-map.md` (new), background and technical pages, `RELEASE-NOTES.md`, the SRD (§3 rule 8, D6, R28, the decision line), the plan's changes table, the data dictionary, the README chart (wp57, wp33, wp34 done; WP 3.3's hardware run is still with the owner). Blog posts may now be phase 5 (`tools/site/lib/blog.ts`). Gate post: `plan/reviews/gate-5-post.md` and `site/pages/blog/phase-5-turns-and-the-map.md`.
