# WP 1.1 — XMPP-level transport interface

**SRD ids:** ARC-1, ARC-12–14 · **Depends on:** 0.3, 0.8 · **Status:** to do · **Designated interface WP**

## Goal

The one TypeScript interface that both the real transport (1.3) and the mock (1.4) implement, frozen by an interface-only PR so that 1.2–1.6 can start in parallel.

## Scope

The interface is XMPP-level, not domain-level (ARC-12). It covers:

| Area | Operations and events |
| --- | --- |
| Connection | connect as a role, as `admin` or anonymously (D20); disconnect; status events (connecting, online, reconnecting, offline); forced-logout reasons from `policy-violation` and `conflict` (PLY-50); service discovery, which resolves the ready state (ARC-2) |
| MUC (XEP-0045) | join with nickname, returning own role and affiliation; leave; send groupchat; message and occupant-presence events; self-presence status codes 110 and 321 (PLY-51) |
| MAM (XEP-0313, 0059) | query a room backwards from the latest message by RSM id, returning items with `stanza-id`, sender occupant JID, server timestamp and body, plus `first`, `last` and `complete` |
| PubSub (XEP-0060) | get items, publish, retract, subscribe and unsubscribe, item events; owner operations: create, configure and delete node, get and set affiliations and subscriptions |
| Admin (XEP-0133, MUC owner) | add and delete user, change password, end user session; create, configure and destroy room; get and set room affiliations; set occupant role |
| Presence | own presence; who is online, as far as MUC presence shows it (ADM-17, PLY-13) |

## Decisions this WP makes

- **Error convention (ARC-14).** Proposed: every operation returns `Promise<Result<T, TransportError>>`, reusing the `Result` shape from `@wrx/schemas`. `TransportError` carries the XMPP defined condition (`not-allowed`, `forbidden`, `item-not-found`, `conflict`, …) or `timeout` or `disconnected`, plus optional text. Nothing throws for a server refusal.
- **Events (ARC-13).** Every subscription is `on…(callback) → unsubscribe`.
- **Payloads stay raw.** Bodies and items cross the interface as strings. Validation belongs to the domain layer (1.6), using `parseDocument`, so both implementations stay schema-agnostic.
- **Clock.** Timestamps are server-supplied, never `Date.now()` in the client, so the mock's controllable clock (ARC-7) works.

## Acceptance

- `packages/transport`: the interface, its types, and doc comments that cite the XEP section for each operation.
- A minimal scriptable fake transport for unit tests of 1.6 (NFR-15). It is a test double, not the mock, so ARC-10 does not apply to it.
- Type-level tests (`expectTypeOf`) for the `Result` and event shapes.
- An interface-only PR, merged before 1.2–1.6 start. Any later change is listed in the Phase 1 gate summary.

## Owns

`packages/transport/`

## Consumes

`@wrx/schemas` (`Result`, node names); WP 0.3's library decision.

## Notes

The spike's `spike/tests/provision/xmpp-admin.ts` and `admin-ops.ts` (serge-web/xmpp-spike) show which admin operations are actually needed, and the server quirks the adapter must hide, for example ejabberd's `accountjid` where XEP-0133 says `accountjids`.
