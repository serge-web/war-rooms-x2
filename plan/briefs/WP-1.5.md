# WP 1.5 — Mock hosting

**SRD ids:** D17, ARC-7, DOC-10, DOC-17 · **Depends on:** 1.4 · **Status:** to do

## Goal

One mock server shared by every tab and window of a deployment, surviving reloads, and isolated from other deployments on the same origin.

## Acceptance

- `packages/mock-host`:
  - Hosts the 1.4 server in a SharedWorker where available.
  - Otherwise uses one leader tab elected through the Web Locks API, relaying events over BroadcastChannel.
  - Re-elects a leader when the current one closes.
  - Persists to IndexedDB.
- Every IndexedDB, SharedWorker, BroadcastChannel, Web Lock and localStorage name is prefixed with the deployment's base path (DOC-10).
- A schema change migrates stored mock data, or else resets to the seed with a notice. The app never fails to load (DOC-17).
- Playwright tests:
  - two tabs act as two players;
  - the leader tab closes mid-conversation and messages keep flowing (R7);
  - two deployments under different base paths don't see each other's data;
  - reset to seed works.

## Owns

`packages/mock-host/`

## Consumes

`packages/mock-server` (1.4).

## Notes

WP 0.4's answer on whether analyst browsers allow SharedWorker, IndexedDB and Web Locks can change the fallback order. If 0.4 hasn't answered when this WP starts, build both paths and test each.
