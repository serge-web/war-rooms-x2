# Deploying WRX1: the reference deployment and its settings

Internal: this is the setup guide NFR-4 asks for. It names the server hardening, so it stays in the repository and off the public site (DOC-2); the site's deployment page is the short public version.

| Path | What |
| --- | --- |
| `ejabberd/ejabberd.yml` | The reference ejabberd config (NFR-22). One file for both stacks below |
| `ejabberd/compose.yaml` | The contract-suite stack: what CI and `pnpm stack:up` run every suite against, on `wss://localhost:35443/ws` with a throwaway test CA |
| `wrx1/compose.yaml` | The reference deployment (NFR-10): the same ejabberd and config, serving the built client and its WebSocket on one HTTPS origin |
| `wrx1/wrx1.env.example` | The deployment's settings: domain, port, label |
| `../ops/` | Bundle, offline install, certificates, checks, backup and restore. Its [README](../ops/README.md) is the operator's guide |

## One command, one origin

The reference deployment is one container: ejabberd 26.09, pinned by digest, with `ejabberd.yml`. It serves:

- `https://<domain>/`: the client (`apps/web` real-server build), with a `config.json` the install writes: `{"server": {"websocketUrl": "/ws", "domain": "<domain>"}}`;
- `wss://<domain>/ws`: XMPP over WebSocket, on the same origin (NFR-8, first mode).

Nothing else listens outside the container. ejabberd serves web pages only under its own domain (another `Host` gets 410), so the host name users type is the XMPP domain. On an installed host, `docker compose --env-file wrx1.env --env-file image.env up -d` in `WRX_HOME` is the one command; `ops/offline-install.sh` gets the host there.

## The server settings WRX1 relies on (NFR-4)

Every row is in `ejabberd/ejabberd.yml`, with its reason beside it. `tools/deploy/reference-config.test.ts` fails `pnpm test` if one of the starred rows changes, and `pnpm test:deployment:ejabberd` checks a running stack.

| Setting | Value | Why | How it is verified |
| --- | --- | --- | --- |
| Image* | `ejabberd/ecs:26.09@sha256:8ebff5b2…` in both compose files | NFR-22: no silent upgrade. An upgrade is adopted only after the R1 tests pass (`pnpm --filter @wrx/contract-suite test:ejabberd:r1`) | config test; the install checks the loaded image's layers against the bundle's MANIFEST |
| Listeners* | one `ejabberd_http` on 5443 with `tls: true`, TLS 1.2+ (`protocol_options`), handlers `/ws` and `/` only; one `ejabberd_c2s` on 127.0.0.1:5222, `starttls_required: true`, never published | NFR-2: `wss://` only. The c2s listener is not a way in: WebSocket sessions take their `shaper`, `access` and `max_stanza_size` from the first c2s listener, and an HTTP listener has no shaper option | config test; `check-deployment.sh` and the deployment suite try TLS 1.0 and 1.1 (refused) |
| Per-player rate limit* | `shaper: player` 50 kB/s, 300 kB burst; `c2s_shaper: none: admin, player: all` | NFR-22. Measured over `wss://`: a player's 1 MB takes 13.7 s, the admin's 0.2 s; with the c2s listener removed the player was not limited (0.3 s) | deployment suite, "per-player rate limit" |
| No REST, web admin, registration, upload* | no `/api`, `/admin` or upload handler; no `mod_register`, `mod_http_api`, `mod_adhoc_api`, `mod_http_upload`; `api_permissions` for `ejabberdctl` only | NFR-22, S4: the admin needs only XMPP (XEP-0133) | config test; those paths answer 404 |
| Passwords* | `auth_password_format: scram`, `auth_scram_hash: sha256` | NFR-22 | config test |
| Accounts | `auth_method: [internal, anonymous]`, `anonymous_protocol: sasl_anon` | D20, NFR-21: the welcome page reads `game-setup` anonymously. `internal` keeps accounts in Mnesia, so backups take Mnesia as well as SQLite | S10 in the contract suite; the backup and restore test |
| Storage | `default_db: sql`, SQLite in the `database` volume | S5: MAM over 10k messages | S05 in the contract suite |
| Room creation | `muc_create` and `pubsub_createnode`: admin only | Only the admin provisions | S04, S10 |
| Room defaults* | `members_only`, `moderated`, `persistent`, `mam` on; `public` off; visitors' private messages `nobody`; visitor status, nick change, voice requests and MUC/Sub off | NFR-3 and spike S1b. A room created before the admin tooling configures it (a part-way publish) is closed from the start | config test; the tooling sets and reads back every one on every room (below) |
| Room listing* | `max_rooms_discoitems: 100` (≥ the transport's page of 50) | Review F10: past this many rooms, a listing without paging shows only occupied rooms; the transport pages with RSM | config test; contract S04 lists 105 empty rooms |
| HTTP headers* | `Content-Security-Policy` (the client's own policy, `connect-src 'self'`, `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-cache`, `Cross-Origin-Opener-Policy: same-origin` | Security review F7; below | config test checks the policy equals `contentSecurityPolicy()` in `apps/web/vite.config.ts`; deployment suite; `ops/test/browser-check.ts` logs in with no violation |
| PubSub | stock `max_payload_size` (250,000 bytes); plugins `flat`, `pep` | S3: 100 KB assets fit | S03 |
| Container | uid 9000, `cap_drop: ALL`, `no-new-privileges`, `restart: unless-stopped`, `pull_policy: never` | Air-gapped: never reach for a registry | `docker inspect` |

### What the admin backend verifies at publish

The publish dialog runs `checkServer` (`packages/admin-ops/src/publish/prepare.ts`) before and after a publish, over XMPP with the admin's own login:

- **Admin commands:** the admin lists online users, rooms and nodes (XEP-0133, MUC and PubSub owner). A server without `mod_configure`, `mod_admin_extra` or the admin ACL fails here.
- **Room defaults:** every room on the service has the NFR-3 settings and the S1b side channels closed: members-only, moderated, non-anonymous, persistent, unlisted, archived; visitors' private messages to nobody; no visitor status text, nick changes or voice requests; no MUC/Sub. Before a publish a difference is a warning, since the publish reconfigures the room; after it, it is a failure to look into. Added for review F6: before, the side channels were written but never read back, so drift in them went unseen.
- **Message archive:** a MAM query on a game room answers, and archiving is on in its config (PLY-49).

The audit (#/admin, Audit) compares the same settings room by room and offers a repair; an open private-message or MUC/Sub channel is critical, visitor status or nick change high, voice requests medium.

What it cannot see over XMPP: the listeners, TLS versions, rate limit, HTTP headers and modules. `ops/check-deployment.sh` and `pnpm test:deployment:ejabberd` check those from outside.

## Content-Security-Policy (security review F7)

The built `index.html` carries a Content-Security-Policy `<meta>` tag (`contentSecurityPolicy` in `apps/web/vite.config.ts`), and `popout.html` carries its own. A host that can set response headers should also send the policy as a header, since a `<meta>` policy cannot carry `frame-ancestors` and does not cover the mock's SharedWorker script. The reference deployment does; another host should send:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' wss://xmpp.example.org; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

- **`connect-src`**: replace `wss://xmpp.example.org` with the `websocketUrl` from your `config.json`. If the WebSocket is a path on the same origin (`"/ws"` behind a reverse proxy, or the reference deployment), `'self'` covers it and the host can be left out. The built-in `<meta>` policy allows any `wss:` host (and plain `ws:` to this machine only), because `config.json` is read at run time and the build cannot know the host. The header narrows that to your server: a browser enforces both policies, so the stricter one wins.
- **`frame-ancestors`**: `'self'` lets the project site embed the demo in an iframe on the same origin. Use `'none'` if the client is never embedded, as the reference deployment does.
- **No `'unsafe-eval'` and no inline script.** zod runs without its `new Function` compiler (`@wrx/schemas/jitless`). `'unsafe-inline'` is needed for styles only: React style attributes, FlexLayout and popped-out windows use them.
- **Popouts** (`popout.html`) run no script of their own; the opener renders into them. Serve them with the same header. The reference deployment's `Cross-Origin-Opener-Policy: same-origin` keeps same-origin popouts working and cuts off cross-origin openers.

## Changing the config

1. Edit `ejabberd/ejabberd.yml` and say why beside the change.
2. `pnpm test` (the config test), then on a fresh stack: `pnpm stack:down && pnpm stack:up`, and `pnpm test:contract`, `pnpm test:admin-ops:ejabberd`, `pnpm test:publish:ejabberd`, `pnpm test:deployment:ejabberd`, and `pnpm test:audit:ejabberd` on a second fresh stack (CI does the same, `.github/workflows/contract-ejabberd.yml`).
3. For the reference deployment: `sh ops/make-bundle.sh`, then `ops/test/offline-install-dind.sh` and `ops/test/backup-restore.sh` (see `ops/README.md`, "Testing").
