# Phase 6 performance (WP 6.5: the Python runner, SRD Annex C PR4, PY-3, PY-5; NFR-7)

Measured on 6 November 2026 against the mock-only build (`pnpm build`), in headless Chromium from Playwright 1.63, on the development container (the same kind of machine as the earlier phases' reviews), served from loopback by the runner's e2e server (`e2e/py-runner/serve.ts`) under the app's policy as a header. Every number below is printed by a test on every CI run, so each run records its own:

- `apps/web/e2e/py-runner-perf.spec.ts` (new in WP 6.5): start-up, the first SDK and pandas runs, a script over 600 assets, event and send throughput, many calls at once, and the interpreter's memory;
- `apps/web/e2e/scenarios/sc-12-umpire-runs-python.spec.ts`: the scenario on both backends (a correctness test, timed only as a whole);
- `tools/check-bundle.ts` and `tools/site/size-report.ts`: the bundle and the site's size.

Loopback means no network time: on a real network the first start also downloads the files below once (then the browser's cache serves them). S17 (`plan/decisions/S17.md`) measured the spike; the numbers here are the shipped runner's.

## Start-up (PR4)

| Measure | This run | S17 | Notes |
| --- | --: | --: | --- |
| Worker ready, cold (a fresh page's first worker) | 2.0 s | 1.8 s | `loadPyodide` 1.98 s of it: the interpreter and the standard library |
| Worker ready, warm (after Stop; files from the cache) | 2.1 s | 1.8 s | The same: compiling and starting the interpreter dominates, not fetching |
| First run that imports `wrx` (pydantic loads) | 0.90 s, of which loading the package 0.34 s | n/a | Importing pydantic and the SDK's generated models is the rest |
| The second such run | 2.5 ms | about 10 ms | Nothing to load |
| First run with pandas (`wrx.to_frame` of the world state) | 3.0 s, of which loading the packages 0.66 s | 3.2 s | numpy and pandas import inside the run |
| After Stop, the first SDK run again | 1.0 s | | A new interpreter loads pydantic again |

So the umpire waits about 3 s from first opening the panel to the first script's output, and 3 s more the first time a script makes a table. Later runs start at once. PR4's judgement stands: fine for adjudication and analysis, not for interactive use.

Two runs of the spec in this WP gave 1.95 and 2.00 s cold, 1.79 and 2.06 s warm, 0.87 and 0.90 s for the first SDK run, 3.31 and 3.03 s for the first pandas run.

## A script over 600 assets (PR4, NFR-11)

The Phase 5 scale fixture's 600-asset world state (`scaleWorldState(demoDesign(), 600)`, 166,773 characters as JSON), published by the admin on the test page. The admin's script, with Python warm (the SDK and pandas already imported):

| Step | Time |
| --- | --: |
| `await game.world_state()`: the bridge's read, the JSON across, pydantic's validation of 600 assets | 34 ms |
| Change every asset (health and latitude) | 13 ms |
| `wrx.to_frame(state)`: 600 rows | 9 ms |
| `await game.write_draft(state)`: pydantic's dump, the JSON across, the page's schema and 500 KB checks | 23 ms |
| **The script, end to end** | **79 ms** |
| The run, as the runner times it | 85 ms |

The first run of such a script in a session adds the start-up above (pydantic 0.9 s, pandas 3 s if it makes a table). Not measured: applying the write to the admin's draft and the change summary in the panel (the panel's `applyWorldChanges` and `diffWorldStates`, which Phase 5 measured at 0.5 ms for the diff at 600 assets).

## Events, sends and calls (PY-2)

| Measure | Value |
| --- | --: |
| A player posts 200 messages in Blue HQ, one after another (the mock, in the page) | 56 ms |
| A White Force `on_message` handler sees all 200: first to last | 78 ms (about 2,500 events a second) |
| Events dropped (the worker's queue holds 1,000) | 0 |
| 100 `send_message` calls in a loop, each awaited | 88 ms |
| 1,000 `game.turn()` calls at once (`asyncio.gather`) | 200 ms, all answered |

On the mock everything runs in the tab, so these are the client's own costs: the bridge, the worker's messages and Python. On a real server each send is a round trip, and the server's per-login byte shaping applies to every role (Phase 5). Nothing in the runner bounds how many calls a run makes or has in flight (security review M2, L2).

## Memory

The interpreter's WebAssembly memory, as the worker reports it:

| When | Memory |
| --- | --: |
| Worker ready | 30 MB |
| After the SDK's runs and 1,000 calls (White Force) | 36 MB |
| After pandas | 90 MB |
| After the 600-asset script with pandas | 90 MB |

WebAssembly memory only grows, so a session that once used pandas keeps 90 MB until Stop or the panel closing ends the worker. The page's own heap is not changed by the runner beyond its 150 kB chunk and the bridge's per-run state. One worker per open Scripts panel: two popped-out panels in two windows would hold two.

## What the browser downloads (NFR-7, PY-5)

Only when a Scripts panel is first shown; nothing of it for any other role or before (`check:bundle` asserts no start-up chunk holds the runner or Pyodide).

| Files | Size | gzip | When |
| --- | --: | --: | --- |
| `py/runner.js` and its worker | 238 kB | 63 kB | the panel's first show |
| Pyodide core: `pyodide.asm.wasm`, `python_stdlib.zip`, the loaders | 13.4 MB | 6.4 MB | the panel's first show |
| pydantic and its dependencies (5 wheels) | 1.84 MB | 1.83 MB | the first run that names `wrx` |
| numpy, pandas and their dependencies (5 wheels) | 7.89 MB | 7.69 MB | the first run that uses pandas |
| **All of `py/`** | **23.4 MB** | about 16 MB | |

Wheels are already compressed, so a server's gzip or brotli saves little on them; the core compresses by half. On a 10 Mbit/s link the first start adds about 5 s for the core, and the first pandas run about 6 s more.

## Pages and previews (DOC-14)

| Build | Size | Note |
| --- | --: | --- |
| `apps/web/dist` (the app, with `py/`) | 26.8 MB | `py/` is 23.4 MB of it |
| The site (`site:build`, with the app at `app/`) | 33.6 MB, 3.4% of the 1 GB Pages limit | `size-report.ts`, no previews or snapshots locally |
| A PR preview that touches no Python (`WRX_PY_RUNNER=off`, WP 6.4) | about 10.2 MB | the stub `py/runner.js` only |
| A PR preview that touches Python, and every blog snapshot | about 33.6 MB | carries `py/` |

The site's checks warn at 70% of the limit. Before WP 6.4's rule every preview carried `py/`, so twenty open previews and snapshots would have been about 670 MB (65%). Now a preview costs 10 MB unless it changes Python. Blog snapshots are the remaining growth: each gate's snapshot built after Phase 6 carries `py/`, about 34 MB each, so the snapshots of G6 and of the next few gates are what will approach the warning. Recommendation (for later, not needed now): build snapshots with `WRX_PY_RUNNER=off` unless the post is about Python, as previews are.

## The main bundle across Phase 6 (PY-5: "the main bundle SHALL NOT grow")

The start-up chunk (`assets/index-*.js`), the one chunk the page loads at start, for the same build settings:

| After | Bytes | Change | What |
| --- | --: | --: | --- |
| WP 6.1 | 1,011,774 | +160 | The schemas' export metadata (`.meta`) |
| WP 6.2 | 1,011,774 | 0 | The runner is its own build in `py/`; byte-identical |
| WP 6.3 | 1,012,783 | +1,009 | The Scripts tab, the role rule (`scriptRoleOf`) and the lazy loader |
| WP 6.4 | 1,022,038 | +9,255 | Below |
| WP 6.5 | 1,022,221 | +183 | The focus fixes (accessibility A1) and the proposal's sender check (security L1) |
| **Phase 6** | | **+10,607 (1.05%)** | gzip 298.9 kB |

**What grew in WP 6.4**, attributed from the two builds' source maps (`vite build --sourcemap`, bytes of minified output by source file):

| Source | Bytes | What |
| --- | --: | --- |
| `player-ui/src/umpire/umpire-panel.tsx` | 2,203 | The admin's umpire room: the card's "Load into draft…" and its confirmation |
| `domain/src/store.ts` | 1,729 | `sendProposal`, accepting proposals on receipt, the quiet send option |
| `schemas/src/umpire.ts` | 1,178 | The umpire room's config and the `world-proposal` message schema |
| `schemas/src/design.ts`, `catalogue.ts`, `fixtures.ts` | 1,740 | The umpire room in the design (one per game, fixed participants), the catalogue entry, the demo design's room |
| `player-ui/src/chat/message-list.tsx`, `chat-panel.tsx` | 1,013 | The proposal card in the chat panel |
| `domain/src/world-draft.ts` | 711 | `applyWorldChanges`: a script's change on top of the draft |
| `domain/src/registry.ts`, `map/world-draft.tsx`, the rest | 681 | The umpire room type, the draft's `replace` |

**Can it move to a lazy chunk?** Most of it cannot: the message schemas, the design's rules and the store are what every client uses to read the umpire room and the design, at start. The candidate was the admin's half of the umpire panel (2.2 kB), which only the admin's game view uses. Moved behind `React.lazy` in this WP, it did leave the start-up chunk, but Rollup then split the start-up code into three chunks (`index` 795 kB, a 216 kB chunk of the domain, schemas and zod, and React's 9 kB), because the new dynamic chunk shares those modules with the entry and with the other lazy chunks. The three together were 1,020,469 bytes: 1.6 kB saved for two more requests at start and a different chunk layout for every later change to reason about. Not kept. WP 6.3 met the same effect with the role rule. The right fix, if PY-5 is read strictly, is a stable chunk layout chosen on purpose (`manualChunks` for the vendor and schema code), which would let the umpire panel, the proposal card and the map's editor move out together; that is a build change for its own WP, not this one.

**Against PY-5.** The runner and Pyodide add nothing to the start-up chunk (6.2's assertion in `check:bundle`). The 10.6 kB that Phase 6 added is the umpire room and the proposal message, which are part of the game every client reads (§3 rule 19), not the runner; read that way, PY-5 holds. Read strictly ("SHALL NOT grow" by any byte), it does not, and the owner may want SRD PY-5 worded as "the runner and Pyodide SHALL NOT be in the main bundle" (gate post, "For the owner").

## Weak points

- **Loopback only.** No network time is in these numbers; a first start over a real link adds the downloads above.
- **The mock only.** Throughput on ejabberd is not measured; SC-12 runs there as a correctness test and passes; its Python start-up is not timed on its own.
- **One machine, Chromium only.** WebKit's Pyodide start-up is not measured; Safari is a SHOULD (NFR-13).
- **Not measured:** a script in a very long room (`readRoomMessages` oldest-first pages the whole archive in, WP 6.2's weak point), and the panel's own costs after a run (the change summary at 600 changed assets).
