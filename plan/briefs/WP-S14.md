# WP S14 — Spike: collection-level access control on ejabberd

**SRD ids:** Annex B (AD2, AD3, spike S14), TPL-10 · **Depends on:** 1.2 (contract suite harness) · **Status:** to do · **After v1:** it does not gate v1 and can run at any time

## Goal

Find out whether access set once on a PubSub collection node (XEP-0248) applies to every leaf in it on ejabberd 26.09, using standard controls only (D2), and whether one collection subscription delivers live from 600+ leaves. The answer decides the node layout for force assets (Annex B): a node per asset, or two nodes per force. Plan and options: `plan/decisions/annex-a-b-implementation.md`, section 3.

## Acceptance

- **A runnable spike in `spike/s14/`**, laid out like `spike/s13/`:
  - Compose files using the same ejabberd image, pinned by the same digest as `deploy/ejabberd/compose.yaml`.
  - Three `mod_pubsub` configs:
    - V0, the reference config;
    - V1, `nodetree: dag` with `plugins: [flat, dag, pep]`;
    - V2, `nodetree: dag` with `plugins: [dag, pep]`.
    Each is otherwise identical to `deploy/ejabberd/ejabberd.yml`.
  - `up.sh` and `down.sh`, and a test script that runs every check against one config and writes JSON lines to `results/`.
- **Checks S14-1 to S14-10**, each with its setup, the exact stanzas, the result and pass or fail, as specified in the decision record above:
  - feature discovery;
  - creating and nesting collections;
  - access inheritance, for leaves with no access config and with an empty whitelist;
  - direct read and subscribe refused for a user outside the collection whitelist;
  - one collection subscription with 600 and 1,200 leaves: creation time, every notification delivered once, p95 latency, server memory;
  - leaves added after subscribing;
  - revocation (affiliation and subscription);
  - one publisher overwriting another's item;
  - no regressions: the v1 contract suite and the R1 tests under V1 and V2, and a V0 database started under V1;
  - fallback numbers for one node per force holding 600 items.
- **Contract style:** checks are written so that, if the layout is adopted, they move into `packages/contract-suite` unchanged and the mock can be held to them (ARC-10).
- **Decision record** `plan/decisions/S14.md`:
  - pass or fail per check and per config;
  - the stanzas used;
  - the chosen layout, by the decision rule: a node per asset only if S14-2 to S14-7 pass and S14-9 shows no regression, otherwise two nodes per force;
  - the answer to who can overwrite an asset item (S14-8).

## Owns

`spike/s14/`, `plan/decisions/S14.md`

## Consumes

The reference config `deploy/ejabberd/ejabberd.yml` and the contract suite, read only. The spike does not change the reference deployment; adopting a config change is a later WP (B2) with its own review.

## Notes

- ejabberd's documentation calls the `dag` plugin experimental. Treat a pass with care: the R1 tests must still pass under the changed node tree before any adoption (NFR-22).
- The record is security-sensitive (access control, DOC-2) and stays off the site, as S13's does. Keep the spike id out of site pages and PR titles.
- No time estimate; stop once every check has a recorded result.
