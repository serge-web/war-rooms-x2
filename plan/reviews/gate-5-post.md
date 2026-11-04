# Gate G5: turns and the map (draft for posting)

Draft of the Phase 5 gate summary, for the phase PR's description (working model item 6), Nov 4, 2026. The public post is `site/pages/blog/phase-5-turns-and-the-map.md`; this one adds the internal detail. Internal links point into the repo; the security review stays off the site (DOC-2).

## Delivered, by SRD id

| WP | Delivered | SRD ids |
| --- | --- | --- |
| 5.1 | Spike checks S15 (item timestamps: fail, a new item per edit in server order) and S16 (byte shaping: pass, kept) on ejabberd 26.09 | R15, P7 |
| 5.2 | Turn and world-state schemas, JSON Schema export, the `map` room type, one map room per game, the 500 KB map-room cap, `game-state` provisioning | §3 rules 16–18, D25, D26, ARC-5, PLY-53 |
| 5.3 | `designVersion` only on structural changes, layout reset with a notice, `rooms:*` and `game-state` readable by every role, discovery from `directory`, room-name warning, rule 4 highlights | §3 rules 4, 8, 15; D6, PLY-5, PLY-30, PLY-60, ADM-9, R24 |
| 5.4 | The admin advances phases; the turn panel; composers paused in adjudication (advisory) | D7, ADM-43, PLY-55, PLY-56, R27 |
| 5.5 | The map room: Leaflet, milsymbol, details and a table, the newest valid world state from MAM, admin-only acceptance, 600 assets under 1 s | PLY-57–59, NFR-7, NFR-9, NFR-11, R23, R30 |
| 5.6 | The admin's world-state editor, browser draft and indicator, change summary, publish at a phase change or at any time, world state in export and import | ADM-16, ADM-44–46, R25, R26 |
| 5.8 | White Force objective editing: one item per author, newest by server order, publisher affiliations, clean-up | D21, §3 rule 14, PLY-35, R10 |
| 5.7 | SC-11 on both backends; SC-6 with the narrowed layout reset; performance, accessibility and security reviews; the structural-change narrowing; docs, release notes, this post | SC-11, NFR-11, NFR-14, R28, R29 |

## Acceptance results (WP 5.7)

- **SC-11** passes on the mock and on ejabberd (`apps/web/e2e/scenarios/sc-11-turn-and-map.spec.ts`). **SC-6** passes on both, now with a room renamed and re-ordered during play that keeps the layout.
- **Performance** (`plan/reviews/phase-5-performance.md`): 600 assets are 169,732 bytes as one message (34% of the cap; about 1,775 typical assets fit). Map tab first render 853 ms, live replacement 322 ms (target 1 s); an editor edit 66 ms. The map's chunks are lazy (`check:bundle` passes).
- **Accessibility** (`plan/reviews/phase-5-accessibility.md`): axe clean on the map, turn panel, the turn confirmation with the change summary (new), the editor, asset form and summary; a keyboard-only add, move and publish. Fixed A1 (the asset form's focus); A2 (tabbing from a table row to "Edit…" at 600 assets) stays.
- **Security** (`plan/reviews/phase-5-security-review.md`):
  - **H1** (High, fixed in part): any player could bury the admin's world state behind ~200 small map-room posts; after a reload clients said none was published and the admin's editor offered an empty map whose publish would wipe the state. Now `unreached`, never `none`; "Look further back"; no editing or publishing against it; export reports it. The owner accepted M1 for v1 (Nov 4, 2026).
  - **M1** (Medium, accepted for v1): the remaining denial; later options are a MAM `with` filter on the admin's real JID (needs a contract check), larger search pages, or a moderated map room (puts every role in the vault).
  - **M2** (Medium, accepted R25): the draft in plain `localStorage`, not tied to the login, survives logout.
  - **M3** (Medium, fixed in part): a stale draft from the game before now carries a warning; it is still not cleared on reset.
  - **L1–L7**: last writer wins between admin tabs; the export's 20 s fallback (fixed: it now says so); a phase change failing after its world state went out; the backend joining the map room; advisory adjudication; parsing before the sender check (fixed); a role added counts as structural.

## Interface changes after their designated WP

- `@wrx/domain` `AccessInput` (WP 1.6's access module) now takes only the fields it reads (`AccessForce`, `AccessRole`, `AccessRoom`), so `designStructure` can pass published documents. Wider inputs still type-check.
- `SessionStore` (WP 1.6) gains `searchWorldStateFurther(roomId)`; `WorldStateView` gains `unreached`, and `none` now means the archive was read to its start.
- `@wrx/admin-ui` `WorldStateTransfer.forExport` (WP 5.6) returns `WorldStateForExport` (source and state, or why there is none); `readPublishedWorldState` returns `found`, `none` or `unavailable`.
- `designStructure` (WP 5.3) is the room ids plus the effective-access matrix.

## Differences from the baseline plan chart

- Phase 5 ran as drawn: eight WPs, none added or split; WP 5.7 also took on the owner's narrowing of the structural change (Plan changes, Nov 4).
- The README chart now shows wp33 and wp34 done; they had stayed amber after merging. WP 3.3's real-hardware run is still with the product owner (its brief says so), and v1's release waits on it.

## Decided by the owner during Phase 5 (Nov 4, 2026)

- The world state may be published at any time, not only with a phase change (ADM-45).
- The map room's participants are fixed to every role (§3 rule 18).
- The design export carries the world state (ADM-16).
- White Force roles keep posting during adjudication (PLY-56).
- Structural change narrowed: rooms added/removed or a role's room access changes (§3 rule 8, D6, R28).
- Certificates are chosen per install.

## Open risks

- H1's remainder (M1) and the draft's confidentiality (M2), above.
- The map's first open has little margin on 1 s at 600 assets on a loaded machine.
- R30: the base map's tile server learns where players look; the demo uses OpenStreetMap's.
- R29 (no session eviction) is unchanged: deleting and recreating the role is still the only remedy.
- WebKit, real screen readers and ejabberd publish timing were not measured in this WP.

## Links

- Preview and screenshots: the phase PR's bot comment (map room, editor with a draft, change summary, adjudication).
- `plan/briefs/WP-5.7.md`, `plan/reviews/phase-5-*.md`, `RELEASE-NOTES.md`.
