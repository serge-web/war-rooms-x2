# WP 1.6 — Domain layer, session store, hooks and room-type registry

**SRD ids:** ARC-2–5, ARC-13, NFR-5 · **Depends on:** 1.1 · **Status:** to do · **Designated interface WP (room-type registry)**

## Goal

The per-pane layer that the admin and player UIs build on. It turns the XMPP-level transport into validated, live domain state, without knowing which backend is underneath.

## Acceptance

- `packages/domain`: a framework-agnostic session store, one per pane, with no module-level state (ARC-2, enforced by `wrx/no-module-mutable-state`). It provides:
  - an explicit ready state, after service discovery;
  - reference-counted subscriptions, `acquire(node) → release()`;
  - live documents for game, forces, roles, rooms, objectives, announcements and assets.
- Every payload is checked with `parseDocument` from `@wrx/schemas`. Invalid items are logged and ignored, never thrown (NFR-5).
- Messages per room (ARC-4): normalised, keyed by `stanza-id`, ordered by server timestamp, and merged idempotently from MAM pages and live stanzas. MAM paging uses RSM ids. Sender identity comes from the occupant JID, never from the body (§3 rule 3).
- Domain operations, for example `sendMessage`, `loadOlder`, `publishObjectives`, `watchRoom` and `postAnnouncement`. Each returns the `Result` convention from 1.1.
- Effective access (§3 rule 4): the expanded participant set per room, including umpire-force roles and observer status. This one function is shared by the admin matrix (ADM-9) and the player.
- The room-type registry (ARC-5): `type → {player component, icon, config schema, admin editor, message schema}`, with `chat` registered. Its config schema is empty in v1, and its message schema is `chatMessageBodySchema`. The player component and admin editor slots are typed now and filled by 2.6 and 2.2.
- `packages/hooks`: thin `useSyncExternalStore` wrappers returning `{data, status, error}` (ARC-3). Cleanup is verified under React StrictMode: no leaked subscriptions after a double mount.
- Unit tests against the 1.1 fake transport (NFR-15).

## Owns

`packages/domain/`, `packages/hooks/`

## Consumes

`packages/transport` (1.1), `@wrx/schemas` (0.8).

## Notes

The registry interface is frozen when this WP merges. 2.2 and 2.6 fill its slots, but do not change its shape without listing the change for the Phase 2 gate.
