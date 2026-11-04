# S15 and S16 spike checks: PubSub item timestamps, and WebSocket byte shaping, on ejabberd 26.09

**Internal.** Server configuration and rate-limit behaviour (DOC-2): not for the public site. Decision records: [`plan/decisions/S15.md`](../../plan/decisions/S15.md) and [`plan/decisions/S16.md`](../../plan/decisions/S16.md). Brief: [`plan/briefs/WP-5.1.md`](../../plan/briefs/WP-5.1.md).

- **S15.** Do PubSub items fetched with an items request carry a server timestamp a reader can order by, and is the server's item order reliable? Decides how readers of objectives pick the newest of several authors' items (SRD §3 rule 14, WP 5.8).
- **S16.** Does an ejabberd byte-rate shaper throttle a client sending large stanzas over the WebSocket listener (R15)?

## Run it

Needs Docker and Node 22, and the root workspace installed (`pnpm install` at the repo root). Like `spike/s14/`, this folder has no dependencies of its own: it imports the real transport (`packages/transport-xmpp`), the contract suite's types and helpers, and `spike/s14/src/pubsub.ts` (raw PubSub stanzas) by relative path, so its checks can move into `packages/contract-suite` unchanged (ARC-10). From the repo root:

```sh
node spike/s15-s16/scripts/run.ts ref     # about 5 minutes: start ref; S15, S15-6 (restarts the
                                          # server once), S16; the full contract suite, the R1 tests
                                          # and the deployment checks; then the start-up checks
node spike/s15-s16/scripts/run.ts tight   # about 1 minute: start tight; S16 only
sh spike/s15-s16/scripts/down.sh          # stop every stack of this spike and delete its volumes
```

To run one test file against a running stack:

```sh
sh spike/s15-s16/scripts/up.sh ref
cd spike/s15-s16
NODE_EXTRA_CA_CERTS=$PWD/docker/tls-out/ca.crt S1516_CONFIG=ref \
  ../../node_modules/.bin/vitest run --config vitest.config.ts tests/server/s15.test.ts
```

Type check: `pnpm typecheck` in this folder. The root lint and Prettier ignore `spike/`.

## Stacks (`docker/compose.yaml`)

Each config is its own compose project (`wrx-s1516-<config>`) on its own loopback port, so they run beside each other and beside other stacks. Same image and digest as `deploy/ejabberd/compose.yaml`, same TLS-only WebSocket listener, a throwaway test CA (`docker/make-ca.sh`, output in `docker/tls-out/`, git-ignored).

| Config | File | Change from `deploy/ejabberd/ejabberd.yml` | Port | Starts? |
|---|---|---|---|---|
| `ref` | `ejabberd-ref.yml` | none | 35980 | yes |
| `tight` | `ejabberd-tight.yml` | `shaper: player` at 20 kB/s with a 20 kB burst (reference: 50 kB/s, 300 kB) | 35981 | yes |
| `http` | `ejabberd-http.yml` | `shaper: c2s_shaper` on the `ejabberd_http` listener | 35982 | **no** |

`docker/make-configs.sh` writes the three files from the reference; re-run it after the reference changes. `tests/startup/configs.test.ts` fails if they drift.

## Tests

| File | Checks |
|---|---|
| `tests/server/s15.test.ts` | S15-1 what a fetched item holds; S15-2 the order of a full fetch, `max_items` 1 and 2, RSM pages and a fetch by id, with the stored creation and modification times; S15-3 80 items back to back and concurrent, against publish and notification order; S15-4 live events and the last-item replay; S15-5 other time sources (MAM on PubSub, entity time, node metadata); S15-7 `max_items` 1 with two publishers; S15-8 the recommended rule, a new item per edit |
| `tests/server/s15-restart.test.ts` | S15-6 the same reads before and after a server restart |
| `tests/server/s16.test.ts` | S16-1 a shaped player's single large messages; S16-2 the admin's; S16-3 two sessions of one player at once |
| `tests/startup/configs.test.ts` | S16-0 the configs and the image digest |
| `tests/startup/http-shaper.test.ts` | S16-4 start-up of the `http` config |

As in S14, each test asserts **the behaviour ejabberd 26.09 showed**, and the S15 or S16 pass or fail is a field of the observation. A test going red means the server's behaviour changed, and the checks should be re-run and the records revisited.

S15-2 reads the server's SQLite file with the image's `sqlite3 -readonly` (`src/docker.ts`), as evidence of what the order rests on. Everything else goes over XMPP.

## Evidence

- `results/s15-s16-run.jsonl`: the observations of the final clean run (`final-20261104`), copied from `results/observations.jsonl`, which each run appends to and git ignores. One line per observation: `run`, `config`, `check`, `name`, `pass` where the check has a criterion, and the data.
- `stanzas/<config>-*.xml`: the stanzas in both directions for each check. Run tokens are replaced by `RUN`, SASL payloads removed and long bodies shortened.
