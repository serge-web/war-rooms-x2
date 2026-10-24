# Decision: dockable layout library (WP 0.2, P3)

**Status:** decided, 2026-10-24 · **SRD ids:** PLY-4–6, PLY-8, PLY-11, PLY-26, PLY-40–42, ARC-9, D6, D15, NFR-13, NFR-14 · **Evidence:** `spike/layout/` (throwaway)

## Decision

**Use FlexLayout (`flexlayout-react` 0.11.1), wrapped in the ARC-9 workspace module.** Both libraries pass every scenario, but each needs app-side workarounds. FlexLayout adds about half the bundle weight, is entirely MIT with no paid tier, and its model is a plain object you can drive and unit-test without a DOM. That model lets reconciliation finish before anything renders. dockview has better popouts and a larger community, but it is now open-core: keyboard navigation and keyboard docking (NFR-14) are in the paid `dockview-enterprise`. It also shipped five major versions in the last twelve months.

## What was built

The prototype is one Vite 8 + React 19.3 + TypeScript strict app with one page per library. Each page has four workspaces, and each workspace has its own model, unread store and React provider (D15). All four show the same room ids, the worst case for collisions. Every layout change goes through the library's public API, behind a `window.wrx` harness. The Playwright tests read the DOM but never change it. One spec (`e2e/layout.spec.ts`) runs the same list against both libraries, twice: on the Vite dev server, where StrictMode double-invokes effects, and on the production build.

Run it with `cd spike/layout && pnpm install --ignore-workspace && pnpm test`. Result: **56 passed** (28 per project), and 168 of 168 with `--repeat-each=3`. The test run used Chromium 1.63 only.

## Results by scenario

✅ = passes with the library's own API · 🔧 = passes with an app-side workaround (public API only) · ❌ = gap

| # | Scenario | FlexLayout 0.11.1 | dockview 8.4.1 |
| --- | --- | --- | --- |
| 1 | Four workspaces, real mouse drag in one; other three `toJson()` byte-identical; a cross-workspace drag changes neither | 🔧 The drag passes and cross-layout drops are rejected. But **tab DOM ids come from node ids** (`flexlayout-tabbutton-<id>`), and FlexLayout moves focus with `document.getElementById`, so the same room in two workspaces gives duplicate ids, and Enter in workspace 2 focused workspace 1's panel (test `flexlayout gap`). Fix: namespace tab ids per workspace (`ws0:r1`). | ✅ The drag passes and cross-instance drops are rejected. DOM ids come from a global counter, so they are unique. The source workspace records `activeGroup`, which is focus state only. |
| 2 | Pop out a tab to a window, then close it; state, context and theme reach the popout; two workspaces pop out the same room independently | 🔧 Passes. **When a popout window is closed, FlexLayout turns it into a floating panel** (`CLOSE_POPOUT` sets the layout type to `float`); a change listener docks it back with `moveNode`. Close is detected only by the popout's `beforeunload`: a forced close strands the tab, invisible, in the model (test 2b). Under StrictMode (dev only) each pop-out opens a window, closes it and opens a second one. Needs `popout.html` next to the page. | ✅ Passes; it docks back to its original group, and it also recovers from a forced close (test 2b). It pops out per panel or per group. It needs `popout.html`, and the default `popoutUrl` is root-relative (`/popout.html`), so it must be overridden for base-path builds (DOC-11). It has no built-in pop-out button: we added a header action. |
| 3 | PLY-40 default for 1, 2, 3 and 7 rooms (1, 2, 3 and 3/2/2 columns, equal widths, in room order) | ✅ JSON row of equal-weight tabsets. | 🔧 Built as `SerializedDockview` plus `fromJSON`. Adding groups with `addGroup({direction:'right'})` halves the reference group each time, so the columns come out unequal. |
| 4 | PLY-41: add during play to the tabset with the fewest tabs, first on a tie; selected tabs unchanged; follows user rearrangement | ✅ | ✅ (tree order is read from `toJSON()`, because `api.groups` is in creation order) |
| 5 | Save to JSON; plain round trip; restore after one room removed and one added, keeping the user's arrangement and the mounted panel state; reset (PLY-42) | ✅ `Model.fromJson(saved, currentModel)` keeps matching tabs mounted, and reconciliation runs on the model before render. A lost room never mounts (5b). | ✅ `fromJSON(saved, {reuseExistingPanels: true})`, then reconcile. `fromJSON` creates every saved panel; a lost room's React panel did not mount only because `removePanel` runs before React commits (5b). |
| 6 | PLY-11: unread badge through the tab-render API, per workspace, and in a popout; the layout JSON is unchanged by counts | ✅ `onRenderTab` sets `values.content`. | ✅ `tabComponents` (this replaces the default tab, so there is no built-in close button). |
| 7 | NFR-14: keyboard | 🔧 Built in: arrow keys move along the tab strip, Enter selects, and Enter again focuses the panel. **No keyboard tab move**: Alt+Shift+Arrow is added via `Actions.moveNode`. After a move, focus drops to `<body>`. | 🔧 Built in: a roving tabindex, arrow keys, Enter. **Keyboard docking and the keymap need `dockview-enterprise`**: `keyboardNavigation: true` logs "ships in dockview-enterprise" and Ctrl+M does nothing (test `dockview gap`). We added Alt+Shift+Arrow via `panel.api.moveTo`. Focus drops to `<body>`. |
| — | PLY-26: per-panel theme via a custom property; one workspace's chrome re-themed alone | ✅ `--flexlayout-*` tokens are inherited and resolved on `.flexlayout__layout`, so setting them on any ancestor works. | ✅ `--dv-*` tokens are declared on the theme class at the component root, so an override must target that element. |
| — | React 19.3 + StrictMode, no console errors | ✅ Apart from the dev-only double window above. | ✅ It logs benign `ResizeObserver loop` window errors in dev. |

## Measurements

| | FlexLayout | dockview (`dockview-react` + `dockview` + `dockview-core`) |
| --- | --- | --- |
| Gzipped size added to a minimal React 19 production build (`pnpm measure`) | **+46.9 kB JS, +3.7 kB CSS** | **+86.0 kB JS, +9.8 kB CSS** |
| Types | Bundled. Clean under strict + `noUncheckedIndexedAccess` with `skipLibCheck: false`, and also with `exactOptionalPropertyTypes`. `any` appears 19 times; the ones that reach our code are `Model.doAction(): any`, `Action.data: Record<string, any>` and `getConfig(): any`. | Bundled. Clean under the repo's base settings with `skipLibCheck: false`; **15 errors in its own `.d.ts` under `exactOptionalPropertyTypes`**. `any` appears 37 times; the ones that reach our code are panel `params` (`[key: string]: any`) and `ISerializedLeafNode<T = any>`. The group state type is not exported. |
| Runs without a DOM (`pnpm headless`) | Yes: `Model`, `Actions` and `doAction` run in plain Node, so the WP 2.5 layout rules can be unit-tested (NFR-15). | No: `DockviewComponent` needs `document`. |
| Licence | MIT, single edition | MIT core. **`dockview-enterprise` is proprietary** and holds keyboard navigation and docking, layout history (undo), pinned tabs, multi-row tabs and auto-hide edge groups. |
| Latest release (pinned version, at least 14 days old) | 0.11.1, 2026-09-26 (pinned 0.11.1) | 8.6.1, 2026-10-19 (pinned 8.4.1, 2026-10-05) |
| Release cadence | 14 releases in 6 months, 16 in 12. Still pre-1.0, with breaking minor lines 0.8 to 0.11 in 12 months, after a quiet spell from May 2025 to January 2026. | 28 releases in 6 months, 36 in 12. **Five major lines (4 to 8) in 12 months.** |
| Repository (via shields.io; the GitHub pages and API were blocked by the proxy) | 1.4k stars; 27 open and 261 closed issues; 7 open PRs; 22 contributors; about 3 commits a month; one npm publisher (Caplin) | 3.5k stars; 72 open and 456 closed issues; 21 open PRs; 52 contributors; about 157 commits a month; one npm publisher |
| npm downloads, week to 2026-10-22 | 63k | 424k (`dockview-core`) |

## Trade-offs and weaknesses of the choice

FlexLayout's weaknesses, all of which WP 2.5 must handle:

1. **DOM ids are not instance-scoped (D15, D22).** Tab ids must be unique on the page, or focus management crosses workspaces. Namespace them per workspace *instance*, not per role, because two panes can hold the same role. Strip the prefix when saving and add it back when loading, so saved layouts stay portable. This is the most serious finding: it is silent until keyboard use.
2. **Popouts are fragile.** Closing the window turns it into a floating panel unless we dock it back. Close is detected only by `beforeunload`, so a crashed or killed popout leaves its tab in an invisible window layout. Restoring a saved layout that contains popouts reopens them without a user gesture, so they are blocked and become floating panels (per the docs; not tested). WP 2.5 should dock every non-main layout back on restore and on `CLOSE_POPOUT`. In dev, StrictMode opens two windows per pop-out.
3. **`any` at the action boundary.** `doAction` returns `any` and `Action.data` is `Record<string, any>`, so the workspace module must wrap actions in typed functions to satisfy the NFR-19 lint rules.
4. **Bus factor and churn.** The library is pre-1.0, has effectively one maintainer, and has a bursty history; minor versions can break. Pin exact versions and keep the adapter thin.
5. **No keyboard tab move.** Our Alt+Shift+Arrow works, but focus is lost after a move, and restoring it needs a DOM focus call (`getElementById` on the namespaced button id). The NFR-14 audit in WP 3.2 must cover it.

What we give up by not choosing dockview: popouts that recover on their own and return to their origin, safe DOM ids, a much more active project, and a paid upgrade path to real keyboard docking. We avoid nearly double the bundle size, five major versions a year, an open-core licence that already gates accessibility features, and a DOM-bound model. If WP 2.5 finds the FlexLayout popout handling unworkable, dockview is the fallback, and the adapter boundary keeps that switch contained.

## API facts for WP 2.5 (FlexLayout)

- **Docked tabsets in left-to-right order:** `model.visitLayoutNodes(Model.MAIN_LAYOUT_ID, n => n instanceof TabSetNode && out.push(n))`. Floating panels and popouts are separate layouts, so they are excluded.
- **PLY-41, add to the tabset with the fewest tabs:** pick the first tabset with the fewest `ts.getChildren().length`, then `model.doAction(Actions.addTab({type: 'tab', id, name, component: 'room'}, ts.getId(), DockLocation.CENTER, -1, false))`. Pass `select = false` so the visible tab is not disturbed.
- **PLY-40 default and PLY-42 reset:** `{layout: {type: 'row', children: columns.map(c => ({type: 'tabset', weight: 1, children: c.map(tab)}))}}`. Columns hold contiguous runs of rooms; their sizes differ by at most one, larger first (`defaultColumns` in `src/shared/rooms.ts`). Reset is `Model.fromJson(defaultJson, currentModel)`.
- **D6 and PLY-6, restore and reconcile:** `const next = Model.fromJson(saved, currentModel)`. Passing the current model keeps matching tabs mounted. Then call `next.doAction(Actions.deleteTab(id))` for each lost room, add each new room by the PLY-41 rule, and only then hand `next` to `<Layout model>`. Empty tabsets are removed automatically (`tabSetEnableDeleteWhenEmpty`).
- **Save:** `model.toJson()`, typed `IJsonModel`. Tabset ids are generated (`#<uuid>`), and global attributes are included.
- **PLY-11:** `onRenderTab={(node, v) => { v.content = <RoomTabLabel/> }}`. Have the label subscribe to the workspace's store (`useSyncExternalStore` through context), so a count change re-renders one label and never the layout. Context reaches popouts, because they are rendered through portals.
- **Popout:** set `tabEnablePopout: true` and `tabEnablePopoutIcon: true` in `global`, and pass `popoutURL="popout.html"` (relative). To dock back, register `model.addChangeListener({onAfterAction})` and, on `Actions.CLOSE_POPOUT`, `moveNode` each tab whose `getLayoutId() === action.data.layoutId` (deferred with `queueMicrotask`). `dockFloatToLayout` refuses `DockLocation.CENTER`, so it cannot merge into a tabset.
- **Keyboard move:** `Actions.moveNode(model.getActiveTabset().getSelectedNode().getId(), neighbour.getId(), DockLocation.CENTER, -1, true)`, from a capture-phase keydown handler on the workspace root.
- **Theming (PLY-26):** set `--flexlayout-*` on the workspace root, and per-room tokens as inline custom properties on the panel and the tab label. Inline tokens travel into popouts. Workspace-level tokens set on an ancestor do not: the popout is a separate document. This is untested; use `popoutClassName` or the tab's `className`.

## Not covered (open for WP 2.5 and WP 3.2)

Firefox and Safari (NFR-13: only Chromium is installed here); touch drag; a real screen reader; restoring a saved layout that contains popouts; per-workspace chrome theme inside popouts; and performance with 30 rooms (NFR-11).
