# WP 5.1 — Spike checks S15 (PubSub item timestamps) and S16 (WebSocket byte shaping)

**SRD ids:** §10 follow-up checks S15 and S16, §3 rule 14, R15, P7 (also PLY-53, D25, NFR-22, ARC-11) · **Depends on:** 1.2 (contract suite harness) · **Status:** done

## Goal

Answer the two follow-up checks from the Nov 3 revision on ejabberd 26.09, before the map and objectives work starts (P7):

- **S15.** Do PubSub items fetched with an items request, not only live events, carry a server timestamp that readers can order by? The answer sets how readers of `objectives:<forceId>` pick the newest of several authors' items (§3 rule 14). WP 5.8 depends on it.
- **S16.** Does an ejabberd byte-rate shaper throttle a client that sends large stanzas over the WebSocket listener? If so, adopt it in the reference config (R15), as long as 500 KB map-room messages still go through comfortably (PLY-53, D25).

## Acceptance

- **A runnable spike in `spike/s15-s16/`**, laid out like `spike/s14/`:
  - one compose file with the image pinned by the same digest as `deploy/ejabberd/compose.yaml`, its own compose projects (`wrx-s1516-<config>`) and loopback ports (35980 to 35982), so it runs beside other stacks;
  - configs, each `deploy/ejabberd/ejabberd.yml` with a header comment and at most one changed block:
    - `ref`, the reference config unchanged;
    - `tight`, the reference with a much lower `player` shaper, to show that the measured times follow the shaper and not the network or TLS;
    - `http`, the reference with a `shaper` option on the `ejabberd_http` listener, to record whether ejabberd accepts one there;
  - `up.sh`, `down.sh` and `run.ts`, which run every check against one config and write JSON lines to `results/`, and raw stanzas to `stanzas/`.
- **S15 checks**, on a node configured as the transport configures objectives nodes (whitelist, publishers, `itemreply` publisher), with two publishers, the admin (owner) and a second account with the `publisher` affiliation, each publishing items with ids of its own:
  - what an items reply holds for each item: attributes, any `<delay/>` or other time;
  - the order of a full items request, of `max_items` 1 and 2, of RSM pages, and of one item by id, after creating and re-publishing items in an order that tells creation order and edit order apart;
  - the same after a server restart;
  - what live events and the last-item replay on subscribe carry, for comparison;
  - whether the service offers anything else with a time (MAM on the PubSub service, XEP-0202 entity time);
  - `max_items` trimming with two publishers (S14 found it per publisher).
- **S16 checks** over `wss://`:
  - a player (shaped) sends single room messages of 64 KiB, 300 KB, 500 KB, 1 MB and 2 MB; time to the sender's reflected copy, and whether the receiver gets them;
  - the admin (unshaped) sends 500 KB and 2 MB;
  - under `tight`, the same player sizes, so the rate can be read from the slope;
  - two sessions of one player sending at once, to see whether the limit is per connection or per account;
  - whether a shaped sender's connection stays up and other stanzas wait behind a large one;
  - under `http`, whether ejabberd starts.
- **Decision records** `plan/decisions/S15.md` and `plan/decisions/S16.md`, each with the question, the method (the exact config and stanzas), the results, and the decision and its consequence.
- **SRD:** the outcomes in §10's follow-up checks table and the open-items checkbox; §3 rule 14 if the ordering rule changes; R15 if S16 passes.
- **Config:** if S16 passes and a change is needed, propose it for `deploy/wrx1` (the shared `deploy/ejabberd/ejabberd.yml`) and adopt it only if the contract suite, the R1 tests and the deployment checks still pass.
- `pnpm check` passes; the README chart marks `wp51` done.

## Owns

`spike/s15-s16/`, `plan/decisions/S15.md`, `plan/decisions/S16.md`, this brief.

## Consumes

The reference config and the contract suite, read only, and the real transport (`packages/transport-xmpp`) by relative import, as S14 does. `deploy/ejabberd/ejabberd.yml` changes only if S16 calls for it.

## Notes

- The records cover server configuration and rate-limit behaviour (DOC-2). Keep the spike ids, the stanza caps and admin-tooling rules off site pages and out of PR titles, as for S13 and S14.
- A shaper limits rate, not size: the S16 pass criterion is throttling, not refusal.
- No time estimate; stop once every check has a recorded result.

## Notes (done)

- **Spike:** `spike/s15-s16/`, configs `ref`, `tight` and `http` (`docker/make-configs.sh`), run `final-20261104` in `results/s15-s16-run.jsonl`. On `ref` the full contract suite (95 of 95), the R1 tests (20 of 20) and the deployment checks pass.
- **S15 fails** (`plan/decisions/S15.md`). Fetched items carry no time; the only server times a client sees are RSM cursors (creation times, opaque by XEP-0059) and the last-item replay's delay stamp (one item, on subscribe). ejabberd orders items by first publish, not last edit, so `max_items` 1 is not the newest edit. Recommended rule, now §3 rule 14: a new item with a fresh id per save, `max_items` 1 (trimmed per publisher), readers take the last item of a fetch or a later live event. For WP 5.8: the domain reader, the admin tooling's fixed objectives item id, and the mock (which orders newest first, moves re-published items and trims the node as a whole) change; S15-2, S15-7 and S15-8 move into the contract suite.
- **S16 passes** (`plan/decisions/S16.md`). The reference `player` shaper already throttles WebSocket senders at about 50 kB/s after a 300 kB burst, per connection; the admin is unshaped (500 KB in 0.14 s). ejabberd refuses a shaper on the HTTP listener. No config change, so `deploy/wrx1` is unchanged; R15 updated.
- **Mock divergence** found (S15): no change here, since this WP owns only the spike and the records; it is WP 5.8's to fix with the contract tests.
