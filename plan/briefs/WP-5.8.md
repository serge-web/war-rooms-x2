# WP 5.8 — White Force edits objectives

**SRD ids:** D21, §3 rule 14, PLY-35, R10 (also ADM-23, ADM-24, ADM-41, ARC-11, NFR-22, SC-5) · **Depends on:** 5.1 · **Blocks:** 5.7 · **Status:** in progress · **Security review required**

## Goal

The product owner's Nov 3 revision reverses WP 3.5's admin-only rule (SRD §14): the admin and White Force roles that are not observers edit every force's objectives during play, from the player client, and White Force observers read them. WP 5.1's check S15 set how (`plan/decisions/S15.md`, §3 rule 14 as rewritten): fetched items carry no time and ejabberd orders items by their first publish, so **each save publishes a new item with a fresh id** to a node that keeps one item per publisher (`max_items` 1), and readers show the newest by server order: the last item of a fetch, or a later live event, never the author's `updatedAt`.

## Acceptance

- **Publishing (D21, R10, ADM-24):**
  - `targetState` gives every White Force role that is not an observer the `publisher` affiliation on every `objectives:<forceId>` node, its own force's included. White Force observers and the force's own roles are `member`. The admin is the node's owner and publishes as such. `max_items` stays 1, which ejabberd applies per publisher.
  - The planner re-syncs the affiliations when a role moves force, joins or leaves the White Force, becomes or stops being an observer, or is deleted (the existing grant and revoke steps, ordered grants first).
  - When a role leaves the White Force or is deleted, its items are retracted from every objectives node, found by the item's `publisher`, after its publisher affiliation is gone (removals, after role deletions). Items of White Force observers (former editors) are kept: they are still White Force text. Items with no `publisher` reported are left alone.
  - The admin's draft objectives are compared with the admin's own item on the node (by `publisher`), not by item id. The same payload: nothing to do. Otherwise a new item with a fresh id, `admin-<hash of the payload>` (the planner stays pure; the draft stamps `updatedAt` on every edit, so each edit's payload, and so its id, is new). A force with no objectives in the draft gets no step: nothing in play is removed.
  - The purge step WP 3.5 added for objectives nodes goes: it would delete the White Force's edits. `AdminOps.purgeNode` stays (an owner operation in the interface).
- **Storage and readers (§3 rule 14, S15):**
  - `publishObjectives` publishes a new item each save, id `<loginName or admin>-<uuid>`, to the force's node. It is allowed for the admin and White Force non-observers (`canEditObjectives`), refused before sending for anyone else.
  - The domain reader (`latest` in `packages/domain/src/store.ts`) shows the last item it holds: fetched items in the server's order, then each live item event appended as it arrives. A retract removes the item, and the one before it shows. No ordering by `updatedAt`; F11's clock clamp goes with it.
  - `OBJECTIVES_ITEM_ID` and `OBJECTIVES_ADMIN_ITEM_ID` are retired; the store no longer drops items whose id is not `admin`.
- **Audit and repair (ADM-41):** new ids on every save are expected. The audit flags an item whose publisher may not hold one (a role outside the White Force, a deleted role) as `stray-items`, repaired by retracting it; the admin's own item differing from the draft is a `document` item, as before, repaired by publishing the draft as a new item.
- **The mock follows ejabberd (ARC-11):** `packages/mock-server/src/pubsub.ts` lists items oldest created first, keeps a re-published item in its place, answers `max` with the newest created, newest first, and trims per publisher with a retract notification. S15's checks S15-2, S15-7 and S15-8 move into the contract suite (`s15-item-order.ts`) over the transport interface, so both backends must pass them.
- **UI (PLY-35):** the force panel's editor (with its Markdown preview) is offered to the admin and White Force non-observers for every force; White Force observers read only. Edits reach the force's panel live. The admin's preview as a role offers what that role may do (an edit there publishes from the admin's account, as a post from the preview does).
- **Tests:** unit (store, target, planner, audit, mock pubsub, seed, column), contract (mock and ejabberd), the admin-ops, publish and audit scenarios on ejabberd, and e2e: SC-5 gains a step in which a White Force role that is not an observer amends Red's objectives too, and Red shows the newest; the observer test stays.
- **Docs:** SRD SC-5 and its "Traces to" line, the glossary's White Force line; security notes (`plan/reviews/phase-5-security-notes.md`); the release notes' objectives line; the data dictionary if a description changes.

## Owns

The objectives code paths in `packages/domain` (store reader, `publishObjectives`, `canEditObjectives`, documents, fixtures), `packages/admin-ops` (target, planner, audit), `packages/mock-server` (`pubsub.ts`, seed), `packages/contract-suite` (the new check and the fixture's objectives nodes), `packages/player-ui` (force panel, preview), the e2e tests above.

## Consumes

The transport interface (no change). WP 5.2 edits `store.ts`, the hooks and the mock server in parallel: changes here stay on the objectives paths.

## Notes

- **Security-critical.** It widens who may publish on a confidential node (R10). Reviewers check: no White Force observer and no role outside the White Force gets `publisher`; a role that leaves the White Force or is deleted loses `publisher` before its items are retracted; nothing a non-editor publishes can be shown (the server refuses it).
- A publisher can retract only its own items, and cannot overwrite another's (S14, contract S02), so one editor cannot remove another's text; the newest edit shows.
- "The admin too": the admin owns every objectives node, which already lets it publish; no extra affiliation is set.
