# WP 1.3 — Real transport

**SRD ids:** ARC-1, ARC-8 · **Depends on:** 1.1 · **Status:** to do

## Goal

The 1.1 interface implemented over StanzaJS 12.22.1, the library chosen in 0.3 (`plan/decisions/xmpp-library.md`), with every ejabberd-specific behaviour isolated in one server adapter.

## Acceptance

- `packages/transport-xmpp`, which passes the contract suite (1.2) on the reference ejabberd.
- The server adapter (ARC-8) holds the ejabberd specifics:
  - error mapping;
  - ad-hoc form field quirks;
  - stored-role behaviour (R13);
  - own-publish notifications, normalised (S6);
  - the S13 route chosen in 0.1.
- Reconnect with back-off and XEP-0198 stream resumption where the server offers it. On rejoin, the transport reports what the domain layer needs to fetch missed messages from MAM (PLY-2).
- StanzaJS rules from 0.3:
  - Pin `stanza` exactly, and declare `events` as a dependency (StanzaJS imports it without declaring it).
  - Import `stanza` only inside this package; a lint rule enforces it.
  - Treat the session as ready only after `<enabled/>` arrives, not at `session:started`.
  - Always call `sendIQ<IQ>`, because the default reply type echoes the request.
  - Give retracts and JSON items their own types.
  - Keep Node globals out of browser type-checking.
- Two ejabberd quirks in the adapter: `<text/>` comes before the error condition, and `get-online-users-num` answers in a field named `onlineusersnum`.
- A Playwright check that the production bundle loads with no page errors, which catches a missing polyfill.
- Endpoints (WebSocket URL, XMPP domain, MUC and PubSub services) are passed in at connect time, never imported as constants (NFR-9).
- It works in the browser bundle and in Node, where the contract suite runs.

## Owns

`packages/transport-xmpp/`

## Consumes

`packages/transport` (1.1).
