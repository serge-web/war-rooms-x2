# WP 3.1 — End-to-end scenarios SC-1 to SC-9

**SRD ids:** NFR-17, §12 (SC-1–SC-9), PLY-2, PLY-28–30, ADM-13, ADM-25 · **Depends on:** Phase 2 · **Status:** done

## Goal

Each of the nine user scenarios in SRD §12 runs as a Playwright test, on the mock in every CI run and on ejabberd in the contract workflow. A scenario that the app cannot complete is a defect to fix, not a test to weaken.

## Acceptance

- **One spec per scenario** in `apps/web/e2e/scenarios/`, named after it, following its steps and asserting its outcome. Where an existing spec already covers part of a scenario, it is reused or moved, not duplicated.
- **Both backends.** The same scenario code runs on the mock build and on the real-server build against ejabberd (the `ejabberd` Playwright project). A step that only one backend can do, such as SC-1's export from mock and import into the server, or SC-7 offline, says so in the test.
- **The hard steps are real:**
  - SC-3's dropped connection: the network goes away for a while (`context.setOffline`) while another role posts, and the messages arrive once, in order.
  - SC-4's modified client: a raw send from the observer's session is refused by the server and nobody sees it.
  - SC-6: a role moved between forces while online, red access before blue is revoked, and a deleted online role notified and logged out.
  - SC-8: two sessions of one role.
- **SC-9** is shown by the contract suite running against both backends in CI; the test documents where that happens, rather than re-implementing it.
- **Stable.** Every new spec passes `--repeat-each=5` under parallel load on the mock, and at least three runs on ejabberd.
- **Traceability.** Each spec lists the SRD ids it covers, so the trace check picks them up.

## Owns

`apps/web/e2e/scenarios/`, the ejabberd e2e wiring, and fixes to defects the scenarios find (in any package, kept minimal).

## Notes

- **How the two backends are driven.** `apps/web/e2e/scenarios/backend.ts` gives every scenario a `backend` fixture. On ejabberd each scenario starts from the server reset and the demo game published from Node through the real admin tooling, with the demo's known passwords (test set-up only; the admin UI on a real server issues random ones, as SC-1 shows). One game per server, so the ejabberd project runs one worker.
- **SC-3's drop on ejabberd.** Chromium's offline emulation stops new requests but leaves an open WebSocket up, so the scenario also cuts a TCP relay between Red's browser and the server (`link.ts`). The client sees the connection close at once; a silent loss would be found by the 60 s keep-alive instead. On the mock, which runs in the browser, the tab drops its own mock connections (`MockHost.setNetworkOnline`).
- **SC-6 on ejabberd** starts with the admin importing the published design: a real server's draft lives in the browser that made it, and the admin backend cannot rebuild it from the server. A deleted online role is told "Your login was removed" rather than "Your role was deleted", as the account goes before its documents; either satisfies PLY-29.
- **Defects found and fixed:** a room lost during play closed without a notice (PLY-30); Publish stayed enabled while a re-plan read the server, and the confirmation was then silently ignored; the mock's admin could not start a design from nothing (SC-1).
