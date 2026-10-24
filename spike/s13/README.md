# S13 spike: offline observer voice revocation, and the WebSocket message size limit

**Internal.** Security-sensitive (DOC-2): not for the public site. Decision record: [`plan/decisions/S13.md`](../../plan/decisions/S13.md).

WP 0.1. Two questions, tested against local throwaway copies of the WRX1 reference ejabberd (26.09, pinned by digest):

1. **ADM-37 / S13.** Can the admin, using only documented admin features over XMPP, make an observer account a `visitor` on its first join, without the observer's password and without REST?
2. **R15 / PLY-53.** What is the largest room message the WebSocket listener accepts, with and without `max_stanza_size`, and what happens just over it?

## Run it

Needs Docker and Node 22. This folder is outside the pnpm workspace and has its own lockfile, so install with `--ignore-workspace` (otherwise pnpm installs the root workspace instead):

```sh
cd spike/s13
pnpm install --frozen-lockfile --ignore-workspace
sh scripts/up.sh        # three ejabberd servers, compose project wrx-s13, fresh volumes
pnpm test               # all checks, about 5 minutes (R15 sends a few multi-MiB messages)
pnpm test:s13           # options 1-4 and the no-REST guard only, about 1 minute
pnpm test:r15           # size measurements only
pnpm typecheck
sh scripts/down.sh      # stop and delete the volumes
```

The tests run serially. `opt4-other-settings` restarts the reference server once.

## Stacks (`docker/compose.yaml`)

| Service | Config | WebSocket | Purpose |
|---|---|---|---|
| `ejabberd` | `ejabberd.yml`: the reference deployment (xmpp-spike commit 4992530) | `ws://localhost:15280/ws` | Options 1, 2, 4; R15 default |
| `ejabberd-wscap` | reference, with c2s `max_stanza_size: 65536` | `ws://localhost:15281/ws` | R15 with a lower cap |
| `ejabberd-adhocapi` | reference, plus `mod_adhoc_api` limited to five room commands | `ws://localhost:15282/ws` | Option 3 |
| (none) | `ejabberd-httpcap.yml`: `max_stanza_size` on the HTTP listeners | - | R15: ejabberd refuses this config. Started once with `docker run -d`, then removed |

None of them serves `/api` or `/admin` (`tests/no-rest.test.ts`).

## Tests

| File | What it shows |
|---|---|
| `tests/opt1-muc-admin-role.test.ts` | Option 1. XEP-0045 role change to `visitor` for an observer who is not in the room, by bare JID, full JID, nick, and JID with affiliation. Also the R-B case (joined before, now offline). Ends with a labelled **baseline** of today's password route, to show the harness detects a stored visitor |
| `tests/opt2-members-by-default.test.ts` | Option 2. `members_by_default=false` in a moderated, members-only room |
| `tests/opt3-adhoc-api.test.ts` | Option 3. `set_room_affiliation`, `change_room_option`, `get_room_options`, `get_room_affiliations` over XMPP ad-hoc |
| `tests/opt4-other-settings.test.ts` | Option 4. An open moderated room with `members_by_default=false` (4a), and the same with a room password (4b). Covers reconnect, server restart, MAM, and who else can join |
| `tests/r15-stanza-cap.test.ts` | R15. Probes at the configured cap + 1 byte, a 2 MiB message from a shaped player (raw and through StanzaJS), and an unshaped admin search doubling from 2 MiB to 64 MiB. Also the `httpcap` config probe |
| `tests/no-rest.test.ts` | NFR-22. `/api` and `/admin` return 404 on every stack |

`src/fixture.ts` holds the verification join that every option is judged by. A poster and the observer join the room, which has no admin in it. Each sends one raw groupchat message, and the test records:

- the observer's role and affiliation;
- the error stanza each sender gets;
- whether the other occupant received the message.

The login ledger (`src/harness.ts`) shows whether the observer ever logged in before that first join.

**Credentials.** The admin creates each test account with XEP-0133 `add-user`, so the test process knows the passwords. They are used only for the account's own login in the verification join, as the player would log in at the browser, and in the labelled baseline. Admin operations under test get only the observer's bare JID.

## Evidence

- `stanzas/*.xml`: the raw stanzas in both directions for each result. SASL payloads are removed and long bodies elided. The file names start with the option (`opt1-…`, `opt4a-…`, `r15-…`).
- `results/s13-run.jsonl`: the observations from the final clean run, copied from `results/observations.jsonl`, which each run appends to and git ignores.

## Lint

The root `pnpm lint` reaches this folder. CI does not install this folder's dependencies, so `eslint.config.js` here uses the recommended rules without type information. Types are checked by `pnpm typecheck` in this folder.
