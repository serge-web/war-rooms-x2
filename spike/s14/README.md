# S14 spike: collection-level PubSub access control (XEP-0248) on ejabberd 26.09

**Internal.** Security-sensitive (DOC-2): not for the public site. Decision record: [`plan/decisions/S14.md`](../../plan/decisions/S14.md). Brief: [`plan/briefs/WP-S14.md`](../../plan/briefs/WP-S14.md).

Question (SRD Annex B): can PubSub access be set once on a collection node and apply to every leaf in it, using standard controls only (D2)? And does one collection subscription deliver live from 600+ leaves? The answer picks the force-asset node layout: a node per asset, or two nodes per force.

## Run it

Needs Docker and Node 22, and the root workspace installed (`pnpm install` at the repo root). The spike has no dependencies of its own: it imports the real transport (`packages/transport-xmpp`) and the contract suite's types and helpers by relative path, so its checks run through the same code as the contract suite and can move into `packages/contract-suite` unchanged (ARC-10). From the repo root:

```sh
node spike/s14/scripts/run.ts v0   # about 5 minutes: start V0, run every check, the full
                                   # contract suite and the R1 tests, then the start-up checks
node spike/s14/scripts/run.ts v1   # start V1; records that it does not start
node spike/s14/scripts/run.ts v2   # the same for V2
sh spike/s14/scripts/down.sh       # stop every S14 stack and delete the volumes
```

`node spike/s14/scripts/run.ts` starts its stack with `scripts/up.sh` and leaves it running. To run one test file against a running stack:

```sh
sh spike/s14/scripts/up.sh v0
cd spike/s14
NODE_EXTRA_CA_CERTS=$PWD/docker/tls-out/ca.crt S14_CONFIG=v0 S14_SCALE=600 \
  ../../node_modules/.bin/vitest run --config vitest.config.ts tests/server/collections.test.ts
```

Type check: `pnpm typecheck` in this folder (root `tsc` over this folder's `tsconfig.json`). The root lint and Prettier ignore `spike/`.

## Stacks (`docker/compose.yaml`)

One compose file; each config is its own compose project (`wrx-s14-<db>`) on its own loopback port, so they run beside each other and beside other stacks. Same image and digest as `deploy/ejabberd/compose.yaml`, same TLS-only WebSocket listener, a throwaway test CA (`docker/make-ca.sh`, output in `docker/tls-out/`, git-ignored).

| Config | File | `mod_pubsub` | Port | Starts? |
|---|---|---|---|---|
| V0 | `ejabberd-v0.yml` | the reference: default node tree, `plugins: [flat, pep]` | 35970 | yes |
| V1 | `ejabberd-v1.yml` | `nodetree: dag`, `plugins: [flat, dag, pep]` | 35971 | **no** |
| V2 | `ejabberd-v2.yml` | `nodetree: dag`, `plugins: [dag, pep]` | 35972 | **no** |
| probe | `ejabberd-v1p.yml` | V1 without `nodetree: dag` | 35973 | yes, `dag` dropped |
| probe | `ejabberd-v2p.yml` | V2 without `nodetree: dag` | 35974 | yes, `dag` dropped |

Each file is `deploy/ejabberd/ejabberd.yml` with a header comment and, except V0, a changed `mod_pubsub` block; `tests/startup/configs.test.ts` checks that.

`scripts/up.sh v1 --db v0` starts the V1 config on V0's volume (S14-9).

## Tests

| File | Checks |
|---|---|
| `tests/server/collections.test.ts` | S14-1 feature discovery; S14-2 create and nest; S14-3 access inheritance (no access config, empty whitelist); S14-4 direct read and subscribe by an outsider; S14-6 late leaves; S14-7 revocation |
| `tests/server/scale.test.ts` | S14-5 one collection subscription over 600 and 1,200 leaves; the same counts as plain leaves with access and subscription set on each; S14-10 one node per force with 600 assets (publish rate, delivery, RSM paging, `max_items`) |
| `tests/server/overwrite.test.ts` | S14-8 a second publisher overwriting the first's item |
| `tests/startup/configs.test.ts` | S14-0 the configs and the image digest; S14-9 start-up of V1, V2 and the probes on fresh volumes |
| `tests/startup/migrate.test.ts` | S14-9 V0's database started under V1, then under V0 again |

The full contract suite and the R1 tests (S01, S01b, C01) run from `scripts/run.ts` with `packages/contract-suite/scripts/run-ejabberd.ts`, pointed at the spike's stack (`WRX_XMPP_WS`, `WRX_XMPP_CA`).

Each check sends literal stanzas through the contract suite's `RawAccess` (`src/pubsub.ts`), records what came back, and asserts **the behaviour ejabberd 26.09 showed**: the S14 pass or fail is a field of the observation, not the test outcome. A test going red therefore means the server's behaviour changed, and S14 should be re-run. On a server that has collections (`expectCollections`, any config but V0) the tests assert the S14 pass criteria instead.

## Evidence

- `results/s14-run.jsonl`: the observations of the final clean run, copied from `results/observations.jsonl`, which each run appends to and git ignores. One line per observation: `run`, `config`, `db`, `check`, `name`, `pass` where the check has a criterion, and the data.
- `stanzas/<config>-*.xml`: the raw stanzas in both directions for each check. Run tokens are replaced by `RUN`; SASL payloads are removed.
