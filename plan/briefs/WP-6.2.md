# WP 6.2 — Browser runner and packaging

**SRD ids:** Annex C PD3, PD4, PD9, PY-4, PY-5, PY-10, PR1, PR3 (also NFR-7, NFR-10) · **Depends on:** S17, 6.1 · **Status:** done

## Goal

Productionise spike S17's runner: Pyodide in a locked-down module worker behind a bridge that offers only the SDK's operations, packaged into the app's build from checksummed files, loaded only when asked for, under one client policy for every role (PR3, decided Nov 6, 2026). No UI: the script panel is WP 6.3.

## Acceptance

- **Runner package** `packages/py-runner` (`@wrx/py-runner`):
  - The worker (from `spike/s17-pyodide/src/worker.ts`): Pyodide from the build's own folder; the lockdown always on, applied after Pyodide and its packages load and before any script; `js` is a frozen object holding timers only; `fetch` is put back as a GET under the Pyodide folder only.
  - The worker is always created from a one-line `blob:` module that `import()`s the real worker, so it runs under the page's policy whether the policy is a header or a `<meta>` tag (S17 item 5).
  - The bridge on the page offers only the SDK's operations, parses every worker message against a schema, checks each call against the role (PD4: admin and White Force only; `writeDraft` admin only) and validates payloads (world-state schema and the 500 KB cap, PLY-53).
  - Run, Stop and a time limit; Stop and the limit terminate the worker. Draft writes are held per run and applied only when it finishes cleanly (PD9, PY-10).
  - A programmatic API, `createRunner({ role, store, draft })`, used only by the test harness here; 6.3 adds the panel.
- **Protocol seam.** The SDK operations live in one adapter module (`packages/py-runner/src/sdk-ops.ts`). It started in S17's shape so the two WPs could run in parallel; once 6.1 merged, it became a re-export of 6.1's protocol (`@wrx/schemas/bridge`) plus the runner's role table and `writeDraft`; nothing else in the runner names an operation.
- **Lazy, and the main bundle does not grow (PY-5).** The runner is its own build, emitted at `py/runner.js` with its worker beside it; nothing in the app imports it, so the main bundle is byte-for-byte the same as before for the same sources. `check:bundle` gains an explicit assertion that no chunk the page loads at start-up holds the runner or Pyodide.
- **Packaging (PY-5, NFR-7).** A build step takes the Pyodide core from npm (`pyodide@314.0.7`) and the wheels the SDK needs (the pydantic set and the numpy/pandas set) from the release (jsDelivr's mirror, or an extracted release folder for an air-gapped build), checks every file's sha256 against a committed lock, emits a lock trimmed to what is shipped, and copies it all to `py/pyodide/` in the build output. No micropip. The files are cached under `.cache/pyodide/` (git-ignored); CI caches that folder with `actions/cache`, keyed on the lock. The e2e, server and site builds include them.
- **Policy (PR3).** The client policy for every role gains `'wasm-unsafe-eval'` in `script-src` and `blob:` in `worker-src`; everything else as now; `'unsafe-eval'` stays absent and a test asserts it. Updated together: `apps/web/vite.config.ts` and `app.test.ts`, the shell e2e test, the deployment test, `ops/test/browser-check.ts`, and `deploy/ejabberd/ejabberd.yml` with `.wasm` as `application/wasm` (and `.whl`, `.zip` as `application/zip`), checked by `tools/deploy/reference-config.test.ts`. `popout.html` keeps `script-src 'none'`: it runs no script, so it needs neither.
- **Regression tests.** A Playwright spec against the real app build (`apps/web/e2e/py-runner.spec.ts`, Chromium; WebKit advisory per the CI convention) ports S17's sandbox probes (fetch, XHR, WebSocket, IndexedDB and IDBFS, BroadcastChannel, caches, importScripts, `new Function` → `import()` of another origin with a canary, the object walk) under the policy as a header and as a `<meta>` tag only, plus a round trip on the mock (a tiny inline script reads the world state and writes the draft) and a Stop and a time limit that leave the draft unchanged.
- **Docs.** The deployment notes for the new policy and the `.wasm` type in `docs/` and the site's deployment page; release notes.
- **Gates:** `pnpm check`; build and `check:bundle`; `CI=1 pnpm e2e`; `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`; site build with `check:site` and `check:blog`; screenshots `--repeat`; the ejabberd deployment tests where Docker runs.

## Owns

`packages/py-runner/`; `apps/web/vite.config.ts`, `apps/web/src/app.test.ts`, `apps/web/e2e/py-runner*`, `apps/web/e2e/shell.spec.ts` (policy assertions); `tools/check-bundle.ts`; `ops/test/browser-check.ts`; `deploy/ejabberd/ejabberd.yml`, `deploy/README.md`, `tools/deploy/reference-config.test.ts`, `packages/contract-suite/deployment/deployment.ejabberd.test.ts` (policy and types); the CI workflows' cache steps; `docs/` and `site/pages/` deployment notes; `RELEASE-NOTES.md`; the README chart's wp62.

## Consumes

`@wrx/domain` (`SessionStore`, `worldStateSize`), `@wrx/schemas` (`worldStateSchema`), the mock server for the harness. Not edited here: `packages/schemas`, `python/` (WP 6.1).

## Notes

- **The SDK in the worker** was S17's stub at first; with 6.1 merged, the worker carries the real `python/wrx/`.
- **White Force proposals** (`postProposal`) are not offered: they need the umpire room and a proposal message type (PD8, PY-8), which are 6.4's.

## Notes (done)

- **API** (`@wrx/py-runner`): `createRunner({ role: 'admin' | 'white-force', store, draft?, mapRoomId?, baseUrl?, packages?, startTimeoutMs?, defaultTimeoutMs? })` → `{ role, running, start(), run(code, { timeoutMs }), stop(), calls(), rejected(), dispose() }`. The role is checked against the store's session (`scriptRoleOf`): the admin needs `identity.isAdmin`, the White Force `me.isUmpire` with a role; anyone else is refused (PD4). The admin must pass a `draft` (`{ apply(state) }`), the White Force must not. `run` starts the worker if needed; Stop and the time limit terminate it and the next run starts a new one. `loadRunner(base)` (`@wrx/py-runner/load`) is what 6.3's panel imports: a dynamic `import()` of `py/runner.js` by URL.
- **Protocol 1 on the page.** Every read operation, scoped to the session: `readRooms` is the role's rooms (`me().rooms`); `readRoomMessages` refuses other rooms (`not-found`), pages the whole archive in with `loadOlder`, leaves out unreadable entries and bodies that fail `roomMessageSchema`, and pages with an opaque cursor (`o:<id>`/`n:<id>`, the order and the last id given); `readObjectives` refuses unknown forces; PubSub reads acquire the node until loaded (20 s limit, then `unavailable`). Every result goes through `bridgeOk`.
- **The draft write** stays the runner's until 6.4: op `writeDraft` (admin only, 1,000,000 characters, world-state schema and the 500 KB cap, `invalid-request` otherwise), reached from Python through `wrx_draft.write_draft(state)` (a `WorldState` model or a dict). The last valid write of a run is applied when the run finishes well.
- **The SDK in Pyodide 3.14.** `python/wrx/**/*.py` is bundled into the worker (Vite `import.meta.glob`, 68 kB with the worker) and written into `/home/pyodide/wrx/`. pydantic loads on the first run whose code names `wrx`; pandas when the code imports it or uses `to_frame`/`wrx.frames`. The e2e round trip runs `Game().context()`, `setup()`, `turn()`, `forces()`, `rooms()`, room messages one per page, newest first, `world_state()`, `objectives()` and `to_frame`.
- **Packaging.** `packages/py-runner/pyodide.lock.json` (generated by `pnpm --filter @wrx/py-runner lock`, checked by `packaging.test.ts`): core sha256s and the release lock trimmed to 10 packages. The app's Vite plugin (`pyRunnerPlugin`, `closeBundle`) builds the runner into `py/` and copies the core and wheels into `py/pyodide/`, after checking every digest; wheels come from `.cache/pyodide/<version>/` (or `WRX_PYODIDE_CACHE`), fetched from jsDelivr's mirror of the release when missing, or from `WRX_PYODIDE_RELEASE`. CI caches `.cache/pyodide` with `actions/cache`, keyed on the lock, in the build-e2e, browsers, site-build and contract jobs.
- **Sizes.** The start-up chunk is unchanged by this WP (byte-identical before and after for the same sources; the 160 B between the pre-merge and post-merge builds are 6.1's schema metadata). Lazy: `py/runner.js` 141 kB (41 kB gzip; its own zod and schemas), the worker 68 kB (14 kB gzip), `py/pyodide/` 23.1 MB in 15 files.
- **Policy.** `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; …` for both builds and the reference header. `popout.html` keeps `script-src 'none'`. `ops/check-deployment.sh` checks the new directives and the `.wasm` type; `ops/test/browser-check.ts` runs a script in the runner on the installed server (its login label was stale: fixed).
- **Tests.** `apps/web/e2e/py-runner.spec.ts` (project `py-runner`, its own server `e2e/py-runner/serve.ts` on the mock port + 6, a canary on + 7): the app page under its own `<meta>` policy loads the runner and runs the SDK; offline numpy/pandas/pydantic under header and `<meta>`; S17's probes under header and `<meta>` (every probe blocked, canary untouched) and a no-policy control (`new Function` reaches the canary); the round trip; role and payload refusals; Stop, the time limit and a failure leaving the draft unchanged.
- **Gates** (Nov 6, 2026): `pnpm check` (1,693 unit tests), build and `check:bundle` for both builds, `CI=1 pnpm e2e` (106 passed, 17 skipped: the ejabberd project without a stack), `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, the site build with `check:site`, `check:blog` and the site e2e, screenshots `--repeat`, `check:python`. On ejabberd 26.09 (a separate compose project): the deployment tests with and without the served client (`.wasm` as `application/wasm`, the new header) and `ops/test/browser-check.ts`, which ran a Python script in the runner. The site preview's app (nested base, `<meta>` policy only) ran the SDK with `eval` refused; `tools/site/lib/serve.ts` gained the `.mjs`, `.wasm`, `.zip` and `.whl` types GitHub Pages already sends.

## Weak points

- **One browser.** The runner spec ran in Chromium only here; WebKit runs it in CI as advisory (Safari's `wasm-unsafe-eval` and `blob:` worker policy inheritance are untested). Firefox is unsupported.
- **The sandbox is a deny-list plus the policy.** The probes are S17's sample, not a proof; a new browser global would need adding to the lockdown. The guarantees are the worker's policy (no eval, no foreign `import()`) and the bridge's validation.
- **Pages size.** Every site build, PR preview and blog snapshot now carries `py/` (23 MB). At 3.4% of the Pages limit today this is fine, but twenty previews and snapshots would add about 460 MB; trimming `py/` from previews is an option if the size report warns. Blog snapshots build in their own checkout and do not use the wheel cache.
- **The draft write is the runner's**, not the protocol's, until 6.4: `wrx_draft` is a stopgap module, and its op name may change.
- **Package loading by text match.** pydantic loads when a script's text names `wrx`, pandas when it imports pandas or names `to_frame`/`wrx.frames`; a script that reaches them another way (e.g. `importlib`) fails with a clear `ModuleNotFoundError`.
- **`readRoomMessages` pages the whole archive in** for oldest-first reads (bounded at 1,000 store pages): fine for v1's room sizes, slow for a very long room on a real server.
- **The runner bundle duplicates zod and the schemas** (141 kB) because it is its own build; that keeps the main bundle byte-identical but costs one extra download when the panel opens.
- **`dev` mode has no runner**: `py/` is made by `vite build` only.
