# Phase 5 performance (WP 5.7: NFR-11 for the map room, PLY-53)

Measured on 4 November 2026 against the mock-only build (`pnpm build`, `vite preview`), in headless Chromium from Playwright 1.63, on the development container (the same kind of machine as `phase-3-performance.md` and `phase-4-performance.md`, which explain how a time-to-frame is taken). Every number below is printed by a test on every CI run, so each run records its own:

- `apps/web/e2e/perf.spec.ts`, "NFR-11: a world state of 600 assets renders on the map in under 1 s" (WP 5.5) and "the admin edits and publishes a 600-asset world state" (WP 5.7);
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
| Map tab's first render, chunk preloaded: click to the frame with all 600 symbols, MAM search included | 853 ms (this run); 730–900 ms in WP 5.5's runs | 1,000 ms |
| A new 600-asset state from the admin, every symbol replaced: send to the frame showing it, on a player's map | 322 ms (this run); 140–400 ms in WP 5.5's runs | 1,000 ms |
| Admin: an edit saved from the asset form to the frame showing the draft's banner | 66 ms | 100 ms (typing-class response) |
| Admin: "Publish world state…" to the change summary on screen | 34 ms | 1,000 ms |
| Admin: the summary's "Publish world state" to the published state on the admin's map | 50 ms | 1,000 ms |

The guards are 3 × the target (the edit 6 ×), as for the other budgets.

**What "published and shown" measures.** The admin's map shows the just-published state at once, from the draft storage's memory of it (WP 5.6's "no flash back"), so this is the send and the local switch, not the server's echo. The echo's cost for a reader is the live row above, 140–400 ms through the mock.

**Publishing on ejabberd.** Not timed by a test here. Spike check S16 (WP 5.1, `plan/decisions/S16.md`) measured the admin's 2 MB message in 0.5 s over the reference deployment's WebSocket; the admin is not slowed by the per-player byte limit, so a 170 KB state goes through at once. SC-11 publishes on ejabberd (seven assets); it is a correctness test, not a timing one.

## Bundle (NFR-7)

`pnpm build` then `pnpm check:bundle`: every asset reference is relative. The map is lazily loaded and does not weigh on the first paint:

| Chunk | Size | gzip | Loaded |
| --- | --: | --: | --- |
| `index` (the app) | 1,008 kB | 295 kB | at start |
| `symbols` (milsymbol) | 862 kB | 197 kB | with the map (fetched while idle after login, `MapPreload`) or the asset form's symbol preview |
| `leaflet-map` (Leaflet and the map view) | 154 kB | 45 kB | with the map |
| `AdminApp` | 630 kB | 193 kB | the admin backend only |

Neither Leaflet nor milsymbol is in the `index` chunk (searched). The symbol preview in the asset form shares the `symbols` chunk with the map, so the editor adds no second copy.

## Weak points

- **The map tab's first open has little margin** at 600 assets: 853 ms here against 1 s, and over it under a loaded runner (1,140 ms in WP 5.5's full parallel suite). Leaflet places one `<img>` per asset. If the target machines are slower than this container, a canvas renderer or clustering is the next step. Not changed in this WP.
- **The change summary at scale is not measured.** The timed summary lists one change. A draft that changes all 600 assets renders 600 list items in the summary (the diff itself is 0.5 ms); not expected to be slow, but not measured.
- **ejabberd is not timed** in a browser test (above); the numbers are the mock's.
- **One machine, Chromium only.** As in Phases 3 and 4. Safari (WebKit) is not measured.
