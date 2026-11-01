# WP 3.1 — End-to-end scenarios SC-1 to SC-9

**SRD ids:** NFR-17, §12 (SC-1–SC-9), PLY-2, PLY-28–30, ADM-13, ADM-25 · **Depends on:** Phase 2 · **Status:** to do

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
