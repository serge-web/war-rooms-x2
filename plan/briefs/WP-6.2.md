# WP 6.2 — Browser runner and packaging

**SRD ids:** Annex C PD3, PD4, PD9, PY-4, PY-5, PY-10, PR1, PR3 (also NFR-7, NFR-10) · **Depends on:** S17, 6.1 (the protocol, merged later) · **Status:** in progress

## Goal

Productionise spike S17's runner: Pyodide in a locked-down module worker behind a bridge that offers only the SDK's operations, packaged into the app's build from checksummed files, loaded only when asked for, under one client policy for every role (PR3, decided Nov 6, 2026). No UI: the script panel is WP 6.3.

## Acceptance

- **Runner package** `packages/py-runner` (`@wrx/py-runner`):
  - The worker (from `spike/s17-pyodide/src/worker.ts`): Pyodide from the build's own folder; the lockdown always on, applied after Pyodide and its packages load and before any script; `js` is a frozen object holding timers only; `fetch` is put back as a GET under the Pyodide folder only.
  - The worker is always created from a one-line `blob:` module that `import()`s the real worker, so it runs under the page's policy whether the policy is a header or a `<meta>` tag (S17 item 5).
  - The bridge on the page offers only the SDK's operations, parses every worker message against a schema, checks each call against the role (PD4: admin and White Force only; `writeDraft` admin only) and validates payloads (world-state schema and the 500 KB cap, PLY-53).
  - Run, Stop and a time limit; Stop and the limit terminate the worker. Draft writes are held per run and applied only when it finishes cleanly (PD9, PY-10).
  - A programmatic API, `createRunner({ role, store, draft })`, used only by the test harness here; 6.3 adds the panel.
- **Protocol seam.** The SDK operations' names, request shapes and role table live in one adapter module (`packages/py-runner/src/sdk-ops.ts`), in S17's shape. When 6.1's shared protocol module is merged, this file is replaced by a re-export of it; nothing else in the runner names an operation.
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

- **The SDK in the worker is a stub.** `wrx.py` is S17's small module (world state, room messages, write the draft). 6.1 brings the real SDK and its models; it replaces `wrx.py` and the adapter.
- **White Force proposals** (`postProposal`) are not offered: they need the umpire room and a proposal message type (PD8, PY-8), which are 6.4's.
