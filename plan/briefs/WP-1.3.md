# WP 1.3 — Real transport

**SRD ids:** ARC-1, ARC-8 · **Depends on:** 1.1 · **Status:** to do

## Goal

The 1.1 interface implemented over the XMPP library chosen in 0.3, with every ejabberd-specific behaviour isolated in one server adapter.

## Acceptance

- `packages/transport-xmpp`, which passes the contract suite (1.2) on the reference ejabberd.
- The server adapter (ARC-8) holds the ejabberd specifics:
  - error mapping;
  - ad-hoc form field quirks;
  - stored-role behaviour (R13);
  - own-publish notifications, normalised (S6);
  - the S13 route chosen in 0.1.
- Reconnect with back-off and XEP-0198 stream resumption where the server offers it. On rejoin, the transport reports what the domain layer needs to fetch missed messages from MAM (PLY-2).
- Endpoints (WebSocket URL, XMPP domain, MUC and PubSub services) are passed in at connect time, never imported as constants (NFR-9).
- It works in the browser bundle and in Node, where the contract suite runs.

## Owns

`packages/transport-xmpp/`

## Consumes

`packages/transport` (1.1).
