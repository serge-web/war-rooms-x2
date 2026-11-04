# WP 5.6 — World-state editor for the admin

**SRD ids:** ADM-16, ADM-44, ADM-45, ADM-46, R25, R26 (also D25, §3 rules 16–18, PLY-53, NFR-14, DOC-10) · **Depends on:** 5.4, 5.5 · **Blocks:** 5.7 · **Status:** done

## Goal

The admin edits the world state on the map: adds, moves, edits and deletes assets (ADM-44). Edits build up as a draft held only in this browser, and the UI says so (ADM-45, R25). The admin publishes the draft as one full-state message, either with a phase change or at any time from "Publish world state", and only when it differs from the last published state. A change summary comes first (ADM-46). The design export carries a world state, and an import loads it as the admin's draft (ADM-16).

## Acceptance

- **Draft model (`@wrx/domain`, `world-draft.ts`, pure):**
  - operations on a world state: add, move, update any fixed field, delete. Each returns a new state or a refusal: the asset is invalid by `worldAssetSchema`, the id is unknown, or the state is over `LIMITS.worldStateAssets`;
  - `diffWorldStates(published, draft)`: assets added, removed and changed, with the fields that changed. Only the assets are compared, because the turn is stamped when the state is published;
  - `worldStateSize(state)`: the message checked with `fitsWorldStateStanza` (500 KB, PLY-53);
  - the stored form `{format, schemaVersion: 1, state, baseStanzaId?, savedAt}`, with a parser that drops a draft it cannot read, and the key `world-draft:v1:<server>:<mapRoomId>`.
- **Store:** `AdvancePhaseOptions.worldState?: {roomId, state}`. The store sends it with `sendWorldState` once the `stale` check has passed and before `game-state` moves. If the world state is refused, the phase change is refused and nothing moves.
- **Where the editor lives:** in the map room panel, in the admin's own game view (not in a preview as a role, and never for a player). See Notes.
- **Editor (ADM-44):**
  - **Add:** "Add asset…" opens a form at the map's centre, or "Place on map" then a click on the map opens the form at that point;
  - **Move:** drag a symbol, or change its latitude and longitude in the form;
  - **Edit:** a form with every fixed field (§3 rule 17). The force is a choice of the game's forces. The symbol code is checked by `sidcSchema` and shown as a live symbol preview. Health and fuel run 0 to 100, latitude and longitude are in range, and each error is shown at its field;
  - **Delete:** from the asset's details, after a confirmation.
  - Players and previews see no edit control.
- **Draft (ADM-45, R25):**
  - edits go to browser storage under the deployment's namespace (DOC-10), keyed by server and map-room GUID (one map room per game, rule 18), so each game has its own draft;
  - the first edit starts the draft from the latest published state, or from an empty state if none has been published;
  - while the draft differs from the published state, a banner in the map room says that unpublished edits exist, counts them, and says the draft is held only in this browser (clearing site data or changing device loses it, R25);
  - "Discard draft…" removes it after a confirmation;
  - the draft survives a reload, and other tabs of the same browser see it.
- **Publish:**
  - **On its own:** "Publish world state…" in the map room opens the change summary and then sends the draft, its turn set to the current turn. It is offered only while the draft differs.
  - **With a phase change:** the turn panel's confirmation (in the column and in the admin backend's header) shows the change summary in 5.4's `confirmDetails`, and passes the draft through `advancePhase({from, worldState})`, its turn set to the next phase's. With no differences, it says the world state is not published.
  - **After a publish** the draft is cleared, and the map shows the published state.
  - **R26:** the summary's help says that every publish sends the whole world state as one message, with its size.
- **Size check:** before sending, a world state over 500 KB is refused with its size and the limit, and with what to do. The publish button and the phase change with it are blocked; the store refuses it again.
- **Export and import (ADM-16):**
  - design file `schemaVersion` 3 adds an optional `worldState`. Version 2 files are read as before and upgraded (no world state); version 1 files are converted as before;
  - export includes the admin's draft if this browser holds one, otherwise the latest published state, otherwise none;
  - import loads a file's world state as the world-state draft for the imported design's map room, with a notice. It reaches the map room only when the admin publishes it;
  - `checkDesign` warns about world-state assets whose force is not in the design;
  - a stored admin design draft of version 2 still loads.
- **Tests:**
  - unit: draft operations, diff, size, the stored form, key; the store's `advancePhase` with a world state (sent first, refused when too large or stale); design file v3, v2 upgrade, checkDesign warning; export and import with and without a world state; the editor and summary components; the turn panel's summary;
  - e2e on the mock (`world-editor.spec.ts`): edit in the form, drag, add by click, delete, the summary, publish on its own and at a phase change, a player sees each live, the draft survives a reload, discard, export and import; axe on the editor, the asset form and the summary;
  - a scenario on both backends (`scenarios/world-state.spec.ts`): the admin edits and publishes once from "Publish world state", and Red sees it live;
  - screenshots: the editor with unpublished edits, and the change summary.
- **Gates:** `pnpm check`, build plus `check:bundle`, `CI=1 pnpm e2e`, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, site build plus `check:site`, screenshots `--repeat`; on ejabberd the contract, publish and audit suites and the ejabberd Playwright project.

## Owns

`packages/domain/src/world-draft.ts` and its tests, `advancePhase`'s world-state step, `packages/player-ui/src/map/` (the editor, the draft hook and storage, the summary), the world-state part of `turn-panel.tsx`, the design file version 3 (`design.ts`, `legacy.ts`), `admin-ui/src/publish/transfer.ts` and the export panel, `apps/web/e2e/world-editor.spec.ts`, `apps/web/e2e/scenarios/world-state.spec.ts`, the editor screenshots.

## Consumes

`sendWorldState`, `worldStateSchema`, `worldAssetSchema`, `sidcSchema`, `fitsWorldStateStanza` (WP 5.2); `advancePhase(options)` and `TurnPanelCore`'s `confirmDetails` (WP 5.4); `LazyMapView`, `MapViewProps`, the `view.ts` helpers, `useMapTiles` and the trimmed world-state timeline (WP 5.5). SC-11's spec stays WP 5.7's.

## Notes

- **The editor sits in the map room panel of the admin's game view, not in the admin backend.**
  - That view is where the admin plays as umpire (ADM-28, PLY-15): it has the map room joined (which `sendWorldState` needs), the turn panel whose phase change carries the draft, and the map, with the tiles and symbols, for dragging. SC-11 step 3 also says "the map shows unpublished edits".
  - The admin backend designs the game and does not join rooms. A second editor there would duplicate the map, or need another map. It would also split the draft's indicator across two views.
  - The backend still takes part. Its header's turn control shows the same change summary and publishes the same draft, because the draft is in browser storage, which both views read. Export and import are also in the backend, with the design.
  - A preview as a role never shows the editor, because a preview shows exactly what the role sees (ADM-30).
- **The turn is not edited.** The draft keeps the turn of the state it started from. At publish, the turn becomes the current turn (on its own) or the next phase's (with a phase change), so "World state for turn N" matches the turn panel. The diff compares assets only. A turn change alone is not a difference, so a phase change with no edits publishes no world state (ADM-45: "only if the draft differs").
- **Another publish while a draft is open.** The draft records the stanza-id of the state it started from. If a newer state is published (from another admin tab), the banner says so. The summary is always against the newest published state, so it is accurate, and publishing replaces that state with the draft. Merging is not offered.
- **Storage failure.** If the browser refuses to save (blocked or full storage), the editor says the edit is not kept, and the change still applies until reload.
- **The mock's "Reset to seed"** does not clear a world-state draft. The draft belongs to the admin's browser, not to the mock's database, and "Discard draft" removes it.

## Notes (done)

- **Where the code is.**
  - `@wrx/domain` `world-draft.ts`: the edits, the diff, the size and the stored form.
  - `@wrx/player-ui` `map/`:
    - `draft-storage.ts`: `WorldDraftStorage`, web and memory;
    - `world-draft.tsx`: `WorldDraftProvider`, `useAdminWorldDraft`, `readPublishedWorldState`;
    - `map-editor.tsx`, `asset-form.tsx`, `change-summary.tsx` and `symbol-preview.tsx`, which is lazy and shares the `symbols` chunk with the map.
  - The app gives the storage once, at the top (`App`'s `worldDrafts`, from `main.tsx` under the deployment's namespace).
  - The admin backend's export and import go through `WorldStateTransfer` (`AdminApp`'s `worldState`, implemented by the app's admin seam).
- **Confirmations are inline in the map room's side panel, not modal dialogs.** These are publish, discard and delete. A Radix dialog portals to the opener's `document`, so in a popped-out map it would open in the other window. The turn panel keeps its dialog, with the summary in `confirmDetails`.
- **`TurnPanelCore` gains `confirmBlocked`.**
  - While the published state is still being read, or the draft is over 500 KB, the confirm button is disabled.
  - `TurnPanel` renders a world-aware variant only for the admin's own view while a draft is held. Only then does it join the map room, so the admin backend's header joins it only while a draft exists.
- **No flash back after a publish.** After a publish, the storage remembers the published state until the map room's echo replaces the state it was published over. Without that, the map would show the old state for a moment, and a dragged symbol would jump back. The draft is removed only if its text is still the text that was published, so an edit made meanwhile in another view is kept.
- **The draft banner is a polite status**, styled as a warning, not an alert. A drag changes its count, and an alert would interrupt each time. The publish and discard buttons are in the editor's toolbar, not repeated in the banner.
- **The design draft never holds a world state.** `draftFromDesign` drops one, and import hands it to the world-state draft of the imported design's map room. Stored design drafts with a version 2 design are read as version 3. The data dictionary is regenerated: the design file's `worldState`.
- **Keyboard.** Dragging has a keyboard equivalent: the form's latitude and longitude fields. An asset is reached from the table, then "Edit…". "Place on map" needs a pointer, and "Add asset…" opens the form at the assets' centre.
- **Not built:**
  - merging a draft with a newer published state (the banner says one exists);
  - undo of one edit (discard undoes all);
  - server-side drafts (R25, post-v1);
  - clearing a draft on the mock's reset.
