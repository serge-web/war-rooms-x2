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

The table above is the runner as WP 6.5 shipped it, with one interpreter for a panel's runs ("before"). The owner's decision on the security review's M1 changed that; the next section is the runner since.

## A fresh interpreter for every run (security review M1, Nov 6, 2026)

Every run now gets a new worker, so a new interpreter: the runner terminates a run's worker when the run ends, however it ends. Two measures keep the cost down, both on by default and both measured on and off: **prewarm** starts the next worker in the background as soon as a run ends, and **preimport** has each worker import the SDK (pydantic) after its lockdown and before it says it is ready. A run's **start** below is the page's time from asking for the run to its script starting (`RunOutcome.startMs`): waiting for a ready worker, plus loading the shipped packages the script imports; the **run** is the worker's time for the run (`ms`), which includes Python's imports. The first output comes at about start + run for these one-line scripts (`import wrx; print(...)`).

| Measure | Before (one interpreter) | After: prewarm and preimport (the default) | After: neither |
| --- | --: | --: | --: |
| Worker ready, cold | 2.0 s | 3.0 s (`loadPyodide` 2.1 s, the SDK's import 0.95 s) | 2.3 s |
| First SDK run after ready: start, run | about 0, 0.90 s | 10 ms, 12 ms | 0.42 s, 0.95 s |
| The next SDK run, asked for at once: start, run | about 0, 2.5 ms | 2.8 s, 5 ms | as below: nothing starts before the run asks |
| The next SDK run, a few seconds later: start, run | about 0, 2.5 ms | 1.6 ms, 5 ms | 2.5 s, 1.07 s |
| A pandas run (not the first): start, run | about 0, about 10 ms | 0.73 s, 3.4 s | not measured (the worker's 2.3 s more) |
| Memory between runs | grows (90 MB once pandas ran) | 36 MB, a fresh worker | none until a run asks |

The first numbers (`after`) are from the spec's run on Nov 6, 2026 (`py-runner-perf.spec.ts`, "start-up"; measured again in both full e2e runs of this change, below). The two full e2e runs of this change (`CI=1 pnpm e2e`, the spec beside the suite's other workers, so a busier machine) gave: cold ready 3.5 and 4.0 s; a run a few seconds after the last started in 2.5 and 3.4 ms; one asked for at once waited 3.39 and 3.46 s; a pandas run took 3.8 and 3.7 s; with neither measure, the next run waited 2.95 and 3.91 s and ran in 1.2 s. With prewarm alone (no preimport), a run a few seconds after the last started in 0.27 s and ran in 0.97 s: the worker was ready, but the run imported pydantic itself, so preimport is what makes paused runs as fast as before.

What it means for the umpire:

- **Runs a few seconds apart** (the usual case in adjudication: read the output, edit, run again) start as fast as before, about 2 ms, because the next worker is ready by then.
- **A run asked for straight after another** waits for its fresh worker, about 2.8 s (cold Pyodide start, then the SDK's import). That is the cost M1's fix accepts: about 3 s before such a run's first output.
- **Every run that makes a pandas table** pays pandas' import, about 3.4 s, each time, not only the first: preimport stops at the SDK, since pandas would add 3 s and about 55 MB to every worker, used or not. The 600-asset script below now imports pandas before its clock starts, so its numbers are still the script's.
- **Memory** no longer accumulates: each worker starts at about 36 MB (30 MB plus the SDK), and a pandas run's 90 MB goes when that run ends. There is never more than one worker: the old one is terminated before the next starts, so the peak is unchanged.
- **The cold start is 1 s later** because the first worker imports the SDK before it is ready, but the first script then starts at once, so the panel's first output comes no later than before (3.0 s against 2.0 + 0.9 s).

Safety of the two measures: prewarm only starts a worker the same way as the first one (the lockdown applies before `ready`, before any script); preimport runs the runner's own `import wrx` after the lockdown, with no script code, and its output is not sent to any run. The background start's failure is not shown until the next run, which then starts again and reports the error itself. A worker started in the background but not used holds about 36 MB until the panel closes.

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

Since every run has a fresh interpreter (M1, above), each such run adds pandas' import (about 3.4 s of run time, if it makes a table); the SDK is already imported by its worker. The test now imports pandas before `t0`, so the steps above are still the script's own; the run as the runner times it is then about 3.5 s, of which 0.75 s loading the packages and the rest Python importing pandas. Not measured: applying the write to the admin's draft and the change summary in the panel (the panel's `applyWorldChanges` and `diffWorldStates`, which Phase 5 measured at 0.5 ms for the diff at 600 assets).

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

WebAssembly memory only grows, so before M1's fix a session that once used pandas kept 90 MB until Stop or the panel closing ended the worker. Since every run has a fresh worker (Nov 6, 2026), memory goes back to about 36 MB (with the SDK imported) after each run. The page's own heap is not changed by the runner beyond its 150 kB chunk and the bridge's per-run state. One worker per open Scripts panel: two popped-out panels in two windows would hold two.

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
| A PR preview that touches Python, and a blog snapshot of a post about Python (`python: true`) | about 33.6 MB | carries `py/` |
| Any other blog snapshot (owner decision, Nov 6, 2026) | about 10.2 MB | `WRX_PY_RUNNER=off`, the stub runner, as a preview |

The site's checks warn at 70% of the limit. Before WP 6.4's rule every preview carried `py/`, so twenty open previews and snapshots would have been about 670 MB (65%). Now a preview costs 10 MB unless it changes Python. Blog snapshots are the remaining growth: each gate's snapshot built after Phase 6 carries `py/`, about 34 MB each, so the snapshots of G6 and of the next few gates are what will approach the warning. Recommendation (for later, not needed now): build snapshots with `WRX_PY_RUNNER=off` unless the post is about Python, as previews are. **Decided by the owner (Nov 6, 2026) and built:** a post declares it with `python: true` in its front matter (default off); `tools/site/snapshot.ts` builds every other snapshot with `WRX_PY_RUNNER=off`. A snapshot of a commit from before WP 6.4, which does not know the variable, still carries `py/` if it has one.

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

**Could it move to a lazy chunk?** (Looked at before the owner's decision below.) Most of it cannot: the message schemas, the design's rules and the store are what every client uses to read the umpire room and the design, at start. The candidate was the admin's half of the umpire panel (2.2 kB), which only the admin's game view uses. Moved behind `React.lazy` in this WP, it did leave the start-up chunk, but Rollup then split the start-up code into three chunks (`index` 795 kB, a 216 kB chunk of the domain, schemas and zod, and React's 9 kB), because the new dynamic chunk shares those modules with the entry and with the other lazy chunks. The three together were 1,020,469 bytes: 1.6 kB saved for two more requests at start and a different chunk layout for every later change to reason about. Not kept. WP 6.3 met the same effect with the role rule. A stable chunk layout chosen on purpose (`manualChunks` for the vendor and schema code) would let such code move out together, if it is ever wanted.

**Accepted by the owner (Nov 6, 2026).** The product owner accepted the main bundle's growth from Phase 6: new features are expected to grow it, so the 6.4 code is not to be moved to a lazy chunk. What PY-5 guards is kept by `check:bundle`'s existing assertion: no start-up chunk holds the runner or Pyodide, and the runner and Pyodide add nothing to it. The 10.6 kB Phase 6 added is the umpire room, the proposal message and the Scripts tab, which are part of the game the clients read (§3 rule 19).

## Weak points

- **Loopback only.** No network time is in these numbers; a first start over a real link adds the downloads above. A fresh worker per run fetches nothing again (the browser's cache serves the files), but a browser that evicts its cache would refetch 13 MB per run.
- **The fresh-worker cost is one machine's.** A slower machine pays more for each run that follows another at once (the cold Pyodide start is CPU-bound), and every pandas run pays pandas' import.
- **The mock only.** Throughput on ejabberd is not measured; SC-12 runs there as a correctness test and passes; its Python start-up is not timed on its own.
- **One machine, Chromium only.** WebKit's Pyodide start-up is not measured; Safari is a SHOULD (NFR-13).
- **Not measured:** a script in a very long room (`readRoomMessages` oldest-first pages the whole archive in, WP 6.2's weak point), and the panel's own costs after a run (the change summary at 600 changed assets).
