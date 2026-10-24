# WP 1.4 — Mock server core

**SRD ids:** ARC-7, D14, NFR-21 · **Depends on:** 1.1 · **Status:** to do

## Goal

An in-browser XMPP-level server that behaves like ejabberd for everything the contract suite covers, and nothing more (ARC-10).

## Acceptance

- `packages/mock-server`: a pure, framework-free state machine, with no browser APIs, so 1.5 can host it anywhere. It implements:
  - accounts, with password and anonymous login (NFR-21);
  - MUC: members-only, moderated, non-anonymous rooms, affiliations, stored roles and voice (R1), and the self-presence codes;
  - PubSub: whitelist, open and publishers models, items, subscriptions and events;
  - MAM with RSM;
  - presence;
  - the admin operations.
- Error conditions and event ordering identical to ejabberd's, as defined by the contract suite (ARC-11).
- A `MockTransport` implementing the 1.1 interface, with each session connected to the shared server.
- The contract suite passes against the mock, as a second CI job beside ejabberd. A divergence fails the build (§11 step 4).
- Seeds: load a design file (`designFileSchema` from 0.8) plus optional message history (PLY-34), and export the mock's current state.
- Test controls: a controllable clock, and injected latency, reordering and disconnects (§11, limits of the guarantee).

## Owns

`packages/mock-server/`

## Consumes

`packages/transport` (1.1), `packages/contract-suite` (1.2), `@wrx/schemas`.

## Notes

The mock should be written test-first from the suite. An interaction the suite doesn't cover is left out and reported to 1.2, not added on spec (ARC-10).
