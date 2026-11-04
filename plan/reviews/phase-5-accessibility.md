# Phase 5 accessibility (WP 5.7: NFR-14, WCAG 2.2 AA, turns and the map)

The method is Phase 3's (`phase-3-accessibility.md`): axe-core 4.14.0 through `@axe-core/playwright`, rules WCAG 2.0, 2.1 and 2.2 at A and AA, colour contrast included, no violation allowed, findings excluded only by rule and selector with a reason here (none are). Each scan attaches its result to the test report. Chromium only in this environment; WebKit runs in CI's browser job and was not run here.

## What is scanned

| Screen | Test |
| --- | --- |
| The map room with an asset selected (map, symbols, details, attribution) | `apps/web/e2e/map.spec.ts` |
| The map room's table with an asset's details | `map.spec.ts` |
| The turn panel in adjudication, as a player | `apps/web/e2e/scenarios/turns.spec.ts` (both backends) |
| The composer paused for adjudication, with its note | `turns.spec.ts` (both backends) |
| The turn panel's controls, as the umpire | `apps/web/e2e/a11y.spec.ts`, "workspace as the umpire" (the whole page) |
| **The turn panel's confirmation dialog with the world-state change summary** (not scanned by WP 5.6) | `apps/web/e2e/scenarios/sc-11-turn-and-map.spec.ts` (both backends) |
| The world-state editor's toolbar and draft note | `apps/web/e2e/world-editor.spec.ts` |
| The asset form with a field in error | `world-editor.spec.ts` |
| The "Publish world state?" change summary | `world-editor.spec.ts` |
| **The editor with a draft, in the table, with the draft banner and an asset's details** | `world-editor.spec.ts`, keyboard test (WP 5.7) |
| The design import with a world state, and its notice | `world-editor.spec.ts` |
| **The map room when the world state is further back** ("Look further back") | `apps/web/e2e/scenarios/map-room.spec.ts` (both backends, WP 5.7) |
| The objectives editor, as the umpire (the same dialog White Force roles get in WP 5.8; not scanned as one of them) | `a11y.spec.ts`, "objectives dialog" |

Every scan passes with no violation.

## Keyboard (NFR-14: keyboard alternatives to drag and drop)

`world-editor.spec.ts`, "the keyboard alone adds an asset and moves one, then publishes" (WP 5.7), drives the editor with key presses only, after the login:

1. **Add.** Focus "Add asset…", Enter: the form opens and takes focus (its heading). Tab to Title, type; Tab to Force (a native select, arrow keys); Tab to Category, type; Latitude and Longitude, select all and type; Enter submits. Focus returns to "Add asset…". The new symbol is on the map and the banner counts one change.
2. **Move, the alternative to dragging.** "Table", Enter; the asset's row button, Enter (details open, the row is pressed); "Edit…", Enter: the form takes focus. Latitude and longitude, typed; Enter. Focus returns to the asset's "Edit…". The details show the new position.
3. **Publish.** "Publish world state…", Enter: the summary takes focus (its heading); its "Publish world state" button, Enter. The banner goes.

The phase change with the summary is a Radix dialog (focus trapped, Escape closes, focus returns), checked by SC-11 and `turns.spec.ts`. Players' keyboard use of the map (pan with the arrows, zoom with plus and minus, the table's rows) is WP 5.5's test in `map.spec.ts`.

## Findings fixed in WP 5.7

- **A1. The asset form did not take focus, and lost it on closing** (found by the keyboard test). After "Add asset…" or "Edit…", focus stayed on the button that opened the form, or fell to the page's body when that button went away (Edit… is replaced by the form). A keyboard or screen-reader user had to find the form by tabbing through the rest of the panel, and after saving was back at the top of the page. Now the form focuses its heading when it opens, as the confirmations already did, and on closing gives focus back to the opener if it is still there ("Add asset…") or to the first action of the panel that replaces the form (the asset's "Edit…"), never stealing it from elsewhere. `packages/player-ui/src/map/asset-form.tsx`; e2e above.

## Findings that stay

- **A2. From a table row to its "Edit…" a keyboard user tabs past every later row** (Low; Medium at scale). The details panel follows the table in the page, so at 600 assets an asset near the top is up to 600 tab stops from its own "Edit…" (Shift+Tab from the panel's end is shorter for rows near the bottom). Screen-reader users can follow the row's `aria-controls` to the details. Recommendation: a roving tab stop in the table (one Tab stop, arrow keys between rows), or the details placed before the table in the reading order. Not changed here: it reorders a WP 5.5 component used by every player.
- **A3. "Place on map" needs a pointer** (accepted, WP 5.6). The keyboard path is "Add asset…", which opens the form at the assets' centre, and the form's latitude and longitude.
- **A4. Dragging a symbol has no keyboard equivalent on the map itself**; the form is the alternative NFR-14 asks for (above). Symbols are hidden from assistive technology (`aria-hidden` on the marker pane), and the table is the accessible view of the same state.
- **A5. The change summary for a very large draft** is a list of every change; at hundreds of changes it is long to read in the dialog. Its first line counts the changes ("4 assets: 1 added, 0 removed, 3 changed"). Not measured with a screen reader.
- **A6. Not run here:** WebKit (Safari) and any real screen reader. NFR-13 makes Safari a SHOULD; CI's browser job runs the same tests on WebKit.
