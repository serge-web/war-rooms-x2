# Phase 5 performance (WP 5.7: NFR-11 for the map room, PLY-53)

Measured on 4 November 2026 against the mock-only build (`pnpm build`, `vite preview`), in headless Chromium from Playwright 1.63, on the development container (the same kind of machine as `phase-3-performance.md` and `phase-4-performance.md`, which explain how a time-to-frame is taken). Every number below is printed by a test on every CI run, so each run records its own:

- `apps/web/e2e/perf.spec.ts`, "NFR-11: a world state of 600 assets renders on the map in under 1 s, the map preloaded" (WP 5.9), "NFR-11: a world state of 600 assets renders on the map in under 1 s" (WP 5.5) and "the admin edits and publishes a 600-asset world state" (WP 5.7);
- `packages/mock-server/src/scale.test.ts`, "measures a 600-asset state, the most assets that fit, and the client-side costs" (WP 5.7).

## The fixture

`scaleWorldState(scaleDesign(), 600)`: 600 assets spread over the scale game's four player forces, about 60 by 40 km, each with a title such as "Red unit 37", a category, a mix of letter-based and 20-digit symbol codes, a position to five decimals, a state, health and fuel. It is generated from a fixed seed, so it is the same on every run, and loaded with `scaleState({ messages: 200, worldAssets: 600 })`: the Phase 3 scale game (50 roles, 30 rooms) whose map room holds the state as the admin's message.

## World-state size against the 500 KB map-room cap (PLY-53, D25)

Each publish is one message holding the whole state (D25), measured as the transport counts it: the XML-escaped body plus the stanza envelope (`worldStateSize`, `fitsWorldStateStanza`).

| Measure | Value |
| --- | --: |
| 600-asset state, as one message | 169,732 bytes (34% of the 500,000-byte cap) |
| Per asset, typical | 283 bytes |
| Most assets that fit, typical | 1,775 |
| Most that fit, every text field at its longest (title 120, category and state 60 characters, 30-digit code) | 963 |
| Most that fit, every character one XML escapes to 5 bytes (`&` → `&amp;`), the worst case | 337 |
| `LIMITS.worldStateAssets` (schema ceiling) | 5,000 |

NFR-11's 600 assets fit with room to spare: three times over at typical sizes, and still at the longest plain text. Only a deliberately hostile state (every character an `&`) fails at 600; the editor and the store refuse it before sending, with its size (WP 5.6). The 5,000-asset schema ceiling is never reached before the byte cap; it bounds only what a reader parses from a forged message.

## Client-side costs at 600 assets (Node 22, medians of five)

| Step | Time |
| --- | --: |
| `worldStateSchema.parse` (every reader, every accepted state) | 2.9 ms |
| `worldStateSize` (before every publish, and in the editor's checks) | 0.6 ms |
| `diffWorldStates` (the change summary, on every draft edit) | 0.5 ms |

None of these is near a budget. The CI guard fails at 250 ms for the three together.

## Render and publish in the browser

| Measure | Value | Target |
| --- | --: | --: |
| Map tab's first render, the map preloaded (WP 5.9): click to the frame with all 600 symbols, MAM search included | 357 ms alone (median of 5); 380 and 419 ms in two full parallel suite runs (WP 5.9; 696 ms alone before) | 1,000 ms |
| Map tab's first render right after login: the click as soon as the workspace shows its tabs | 671 ms alone (median of 5); 1,054 and 1,137 ms in two full parallel suite runs (WP 5.9; 853 ms alone and 961 ms in the suite in WP 5.7, 900 ms alone re-measured) | 1,000 ms |
| A new 600-asset state from the admin, every symbol replaced: send to the frame showing it, on a player's map | 322 ms (this run); 140–400 ms in WP 5.5's runs | 1,000 ms |
| Admin: an edit saved from the asset form to the frame showing the draft's banner | 66 ms | 100 ms (typing-class response) |
| Admin: "Publish world state…" to the change summary on screen | 34 ms | 1,000 ms |
| Admin: the summary's "Publish world state" to the published state on the admin's map | 50 ms | 1,000 ms |

The guards are 3 × the target (the edit 6 ×), as for the other budgets.

### The map's first render (WP 5.9)

WP 5.7 measured 853 ms alone and 961 ms in the full suite against the 1 s target. WP 5.9 profiled it (Chrome's CPU profile and trace, through Playwright's CDP session) and found most of the time was not drawing 600 symbols:

| Cost found | Size | Change |
| --- | --: | --- |
| React's Suspense fallback throttle: the lazy map view suspends on its first render even when its chunk has loaded, and React then holds the boundary's content back for up to 300 ms | ~300 ms | `LazyMapView` loads the chunk itself and renders at once when it is loaded (`lazy.tsx`); a spinner while it loads |
| The map's chunk still loading when the tab opens soon after login: it was fetched when the browser was first idle, which a workspace joining 31 rooms rarely is | 0–300 ms | The chunk starts loading with the player's login (`player-client.tsx`) and at the workspace's mount |
| milsymbol's one-time set-up on the first symbol drawn (97 distinct codes then cost ~15 ms) | ~100 ms | A warm-up, a step per idle period after the chunk loads: three symbols, then Leaflet on a hidden map with one draggable marker (`warmUp`) |
| Symbols cached per map, so each map (a remount, a popout, another pane) drew them again | per map | One cache by code and size for every map (`sharedSymbols`); it holds nothing of a session |
| The map room joined at login (the tabs' unread badges and the online list join every room) with 50-message history pages, each message up to 500 KB, and searched for its state only when the map opened | per login: 3.4 MB once 20 states of 600 assets are published | A map room is watched for its world state from its first join: 5-message pages, the newest state kept, found before the map opens (`store.ts`) |
| Creating 600 Leaflet markers (dragging enabled for the admin) | ~90 ms | Unchanged |
| Painting 600 symbol images | ~70 ms | Unchanged |

Before and after, the same tests on the same machine, five runs each (alone) and the full parallel suite:

| Measure | Before, alone | After, alone | Before, 4 at once | After, 4 at once | After, full suite |
| --- | --: | --: | --: | --: | --: |
| First render, the map preloaded | 696 ms (624–833) | 357 ms (311–413) | 865 ms (815–915) | 587 ms (412–676) | 380, 419 ms |
| First render right after login | 900 ms (852–953) | 671 ms (593–757) | 1,410 ms (1,055–1,886) | 1,000 ms (689–1,271) | 1,054, 1,137 ms |

Medians (and ranges) of five runs alone and of four runs of four tests at once (`--workers=4`, a loaded runner); the full suite is `CI=1 pnpm e2e`, run twice. The aim was under 700 ms in the full suite: met for the preloaded render, the usual case, at about 400 ms. Not met for a click at the moment the tabs appear, which in the loaded suite is still around 1 s.

"Before" runs the new test against the WP 5.7 code. The right-after-login case also waits for the mock: as the workspace joins its 31 rooms, the mock host saves its whole database after each request that may change it, which held the map room's join back by 150–200 ms here (a 100 ms save delay, tried and reverted, took it to 465–643 ms). That is the mock's cost, not the client's; a real server does not have it.

**What "published and shown" measures.** The admin's map shows the just-published state at once, from the draft storage's memory of it (WP 5.6's "no flash back"), so this is the send and the local switch, not the server's echo. The echo's cost for a reader is the live row above, 140–400 ms through the mock.

**Publishing on ejabberd.** Not timed by a test here. Spike check S16 (WP 5.1, `plan/decisions/S16.md`) measured the admin's 2 MB message in 0.5 s over the reference deployment's WebSocket; the admin is not slowed by the per-player byte limit, so a 170 KB state goes through at once. SC-11 publishes on ejabberd (seven assets); it is a correctness test, not a timing one.

## Bundle (NFR-7)

`pnpm build` then `pnpm check:bundle`: every asset reference is relative (sizes as of WP 5.9). The map is lazily loaded and does not weigh on the first paint:

| Chunk | Size | gzip | Loaded |
| --- | --: | --: | --- |
| `index` (the app) | 1,012 kB | 300 kB | at start |
| `symbols` (milsymbol) | 862 kB | 200 kB | with the map (fetched from the login on, `MapPreload`; WP 5.9) or the asset form's symbol preview |
| `leaflet-map` (Leaflet and the map view) | 154 kB | 45 kB | with the map |
| `AdminApp` | 632 kB | 195 kB | the admin backend only |

Neither Leaflet nor milsymbol is in the `index` chunk (searched). The symbol preview in the asset form shares the `symbols` chunk with the map, so the editor adds no second copy.

## Weak points

- **The map tab's first open** at 600 assets: improved in WP 5.9 (above), now under half the 1 s target once the map has preloaded (about 400 ms in the full suite). Opened the moment the tabs appear, it still waits for the map chunk and for the mock's other joins: 1,054 and 1,137 ms in the two full-suite runs, over the target, though it was worse before under the same load. The guard is 3 × the target, so CI does not fail it. Leaflet places one `<img>` per asset (about 90 ms to create, 70 ms to paint); if the target machines are much slower than this container, a canvas renderer or clustering is the next step.
- **The warm-up is a long task** of about 100 ms (milsymbol's set-up) in an idle period after login; a key press in that moment waits for it.
- **The change summary at scale is not measured.** The timed summary lists one change. A draft that changes all 600 assets renders 600 list items in the summary (the diff itself is 0.5 ms); not expected to be slow, but not measured.
- **ejabberd is not timed** in a browser test (above); the numbers are the mock's.
- **One machine, Chromium only.** As in Phases 3 and 4. Safari (WebKit) is not measured.
