# S17 spike: Pyodide in a Web Worker, offline, under the client's Content-Security-Policy

**Internal.** Decision record: [`plan/decisions/S17.md`](../../plan/decisions/S17.md). SRD Annex C (PD1–PD9, PY-1–PY-12, PR1–PR5).

The question: can the Python API's browser runner (Annex C, PD3) run Pyodide in a dedicated worker, served only from the build (NFR-7), under the client's policy, with a bridge that offers only the SDK's operations? This folder answers it with a page of its own and a Playwright spec that measures and asserts each part. Nothing here is in the app: `apps/web` and its build are untouched, so `check:bundle` does not change.

## What is here

| Path | What |
| --- | --- |
| `index.html`, `src/main.ts` | The page: the demo game on the in-tab mock server (`packages/mock-server`), an admin and a White Cell session (`packages/domain` store), an umpire room added for the White Force (PD8 is not in v1), the admin's draft and its change summary (`diffWorldStates` from `packages/domain/src/world-draft.ts`). Driven through `window.s17`. |
| `src/worker.ts` | The worker: loads Pyodide from `dist/pyodide/`, registers `_wrx_bridge`, then the lockdown (below). |
| `src/wrx.py` | The SDK slice the spike needs: `world_state`, `room_messages`, `write_draft`, `post_proposal`. |
| `src/bridge.ts` | The bridge on the page: the four operations, per role (admin: read, write the draft; White Force: read, post a proposal), every payload validated (`worldStateSchema`, the 500 KB cap). Draft writes are held per run. |
| `src/runner.ts` | Starts the worker (from its URL, or from a `blob:` wrapper), runs a script, stops it by terminating the worker, applies the draft only when a run finishes well (PD9). |
| `scripts/packages.ts`, `scripts/fetch-packages.ts` | What is shipped: the core from npm `pyodide`, and the wheels of numpy, pandas, pydantic and their dependencies from the release, fetched once at build time with their sha256 checked against the lock file. |
| `vite.config.ts` | The page's own build; copies the core and the wheels to `dist/pyodide/`, with the lock file trimmed to what is shipped. |
| `scripts/serve.ts` | Serves `dist/` under a policy named by the path (`/p/wasm/`, `/p/app/`, `/p/wasm-meta/` …), each the app's own (`contentSecurityPolicy` in `apps/web/vite.config.ts`) with one change; the reference deployment's other headers; a canary server on the next port, on another origin, that counts every request. |
| `scripts/sizes.ts` | Raw, gzip and brotli sizes of every shipped file. |
| `scripts/gen-models.sh`, `models/` | Python models generated from `docs/json-schema` with datamodel-code-generator. |
| `tests/s17.spec.ts`, `tests/probes.py` | The spec, and the Python that probes what a script can reach. |
| `results/` | What the last run measured; the decision record quotes it. |

## Run it

Node 22 and the root workspace installed (`pnpm install` at the root). This folder has its own dependencies (`pyodide`, `vite`, `zod`), installed here only and kept out of the workspace:

```sh
cd spike/s17-pyodide
pnpm install --ignore-workspace
NODE_USE_ENV_PROXY=1 node scripts/fetch-packages.ts      # once: 10 wheels into .cache/wheels (sha256 checked)
#   or, air-gapped: node scripts/fetch-packages.ts /path/to/extracted/pyodide-314.0.7
pnpm build                                               # dist/, with dist/pyodide/
node scripts/sizes.ts [/path/to/extracted/full/release]  # results/sizes.json
CI=1 pnpm test                                           # the spec, Chromium; results/*.json
pnpm typecheck
```

`S17_PORT` moves the server (default 5027; the canary takes the next port), `S17_SAMPLES` sets the timing samples (default 5), and `S17_BROWSERS=chromium,webkit` adds WebKit where it is installed (it is not in the dev container, and the spike never installs browsers). The root lint and Prettier ignore `spike/`.

## The worker's lockdown

After Pyodide and the requested packages have loaded, and before any script runs, the worker:

- gives Pyodide a `js` module (`jsglobals`) holding only `setTimeout` and `clearTimeout`, never the global scope;
- deletes, from the global scope and every prototype above it, `fetch`, `XMLHttpRequest`, `WebSocket`, `WebTransport`, `EventSource`, `importScripts`, `indexedDB`, `caches`, `BroadcastChannel`, `Worker`, `postMessage`, `MessageChannel` and the like, and `navigator.storage`, `navigator.locks`;
- puts back a `fetch` that only GETs files under its own `pyodide/` folder, so a script that imports a shipped package still loads it (PY-3), and nothing else;
- keeps a private `postMessage` for the bridge.

The lockdown cannot stop `eval`, `Function` or `import()`: only the worker's own Content-Security-Policy can. A worker gets its policy from the response that serves its script, not from the page's `<meta>` tag, unless it is created from a `blob:` URL, which inherits the page's policy. See the decision record.
