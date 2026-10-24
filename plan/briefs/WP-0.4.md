# WP 0.4 — Target environment questions (P2)

**SRD ids:** D12, D17, NFR-23 · **Depends on:** — · **Status:** to do (Doc, with the customer)

## Goal

Get the customer's answers that could change the build, before Phase 2.

## Questions

1. Which browsers and versions do analysts use? Do they allow SharedWorker, IndexedDB and Web Locks (D17)?
2. Is approval needed to run ejabberd (Erlang) on internal and air-gapped hosts, and who gives it?
3. Who verifies the air-gapped install on real hardware (NFR-23), and on what hardware?
4. Is there an internal CA, and how are its certificates distributed to browsers (NFR-2)?

## Acceptance

Answers recorded in `plan/decisions/target-environment.md`, with any SRD change they cause.

## Owns

`plan/decisions/target-environment.md`
