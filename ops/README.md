# WRX1 operations: offline install, certificates, backup and restore

How to put WRX1 on an internal or air-gapped network (NFR-10, NFR-23), with certificates from an internal CA (NFR-2), and keep its data safe. The server settings themselves, and how the admin backend checks them, are in [`deploy/README.md`](../deploy/README.md).

Every script here is POSIX `sh` and prints `--help`. None prints, stores or sends a password.

| Script | Runs on | What it does |
| --- | --- | --- |
| `make-bundle.sh` | a connected machine with this repo | Packs the pinned ejabberd image, the built client, the config and these scripts into one `.tar.gz`, with checksums |
| `offline-install.sh` | the WRX1 host, no network needed | Checks and installs a bundle (first install or upgrade), starts ejabberd, creates the admin account, runs the checks |
| `check-deployment.sh` | the WRX1 host | Checks the running deployment from outside: certificate, TLS versions, headers, client, WebSocket, no admin pages |
| `backup.sh`, `restore.sh` | the WRX1 host | Online backup of everything on the server; restore onto the same or a new host |
| `ca/make-internal-ca.sh` | any machine with openssl, kept offline | A small internal CA, limited to your domain, if your organisation has none |
| `ca/issue-server-cert.sh` | the same | The server's key and certificate, or a signing request for your organisation's CA |
| `test/*.sh` | a development machine | The tests behind this guide (see Testing) |

## What the host needs

- Linux on x86-64 (the bundle's image is `linux/amd64`; `make-bundle.sh --platform linux/arm64` makes an ARM bundle, untested).
- Docker Engine with the Compose plugin (`docker compose version`; v2.20 or later for `--wait-timeout`). No special approval is needed to run it or the Erlang inside the ejabberd image (WP 0.4). A native ejabberd install is the alternative to containers (see the WP 0.4 table below).
- `sh`, `tar`, `gzip`, `sha256sum` (any Linux has them). `openssl` is optional: the checks use the one in the image if the host has none.
- One TCP port reachable by the players' browsers, 443 by default.
- A DNS name for the server, resolving to it on the players' network: this is also the XMPP domain (`WRX_DOMAIN`), since ejabberd serves its pages only under its own domain.
- Disk: about 200 MB for the image and client, plus the data (each archived message is a few hundred bytes; 30 rooms of 10,000 messages is about 150 MB) and backups.

## 1. Make a bundle (connected machine)

```sh
pnpm install && pnpm --filter @wrx/web build:server   # or pass --build below
sh ops/make-bundle.sh                                  # writes ops/out/wrx1-bundle-<version>.tar.gz
```

It prints the bundle's SHA-256. Carry the `.tar.gz` and its `.sha256` to the host by the approved route, and confirm the SHA-256 over a second channel (read it out on the phone, or sign it): `offline-install.sh` checks the file against the `.sha256` beside it, which only proves the two travelled together.

The bundle holds no secret: no password, no private key, no host's certificate. `make-bundle.sh` refuses to finish if a private key is inside.

## 2. Certificates (NFR-2)

Browsers must trust the server's certificate, and it must name `WRX_DOMAIN`.

**If your organisation has a CA,** make a key and a signing request on the host or an admin machine, and have the CA sign it for TLS server use:

```sh
sh ops/ca/issue-server-cert.sh --host wrx.exercise.internal --out tls --csr-only
# send tls/server.csr to the CA; put the certificate it returns at tls/server.crt
```

**If not,** make a small internal CA on a machine that stays offline, limited to your domain, and sign the server's certificate with it:

```sh
sh ops/ca/make-internal-ca.sh --out ca --name "Exercise CA" --permit exercise.internal
sh ops/ca/issue-server-cert.sh --host wrx.exercise.internal --out tls --ca-dir ca
```

`--permit` adds a name constraint, so a browser that trusts this CA trusts it for that domain only. Keep `ca/ca.key` offline and its passphrase apart from it. The server certificate lasts 397 days; `check-deployment.sh` warns 30 days before it ends.

**Trusting the CA in browsers.** Give each analyst machine `ca.crt` (the certificate only, never the key):

- **Windows (Chrome, Edge):** Group Policy, *Computer Configuration → Windows Settings → Security Settings → Public Key Policies → Trusted Root Certification Authorities → Import*; on one machine, `certutil -addstore -f Root ca.crt` as administrator.
- **macOS (Chrome, Edge, Safari):** a configuration profile with the certificate, or `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ca.crt`.
- **Linux (Chrome, Edge):** they read the user's NSS store: `certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "Exercise CA" -i ca.crt` (package `libnss3-tools`). For system tools: copy to `/usr/local/share/ca-certificates/exercise-ca.crt` and run `update-ca-certificates` (Debian, Ubuntu) or to `/etc/pki/ca-trust/source/anchors/` and `update-ca-trust` (RHEL, Fedora).
- **Firefox (any system):** an enterprise policy, `policies.json` with `{"policies": {"Certificates": {"ImportEnterpriseRoots": true}}}` to use the system store, or `{"Certificates": {"Install": ["/path/ca.crt"]}}`; by hand, *Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import*, tick "identify websites".

Then open `https://<domain>/` on that machine: no warning, and the padlock shows your CA. How the certificate reaches analyst browsers on the customer's network is an open question (WP 0.4).

## 3. Install (the host)

```sh
tar -xzf wrx1-bundle-<version>.tar.gz                       # unpacks wrx1-bundle-<version>/
cp wrx1-bundle-<version>/deploy/wrx1.env.example wrx1.env    # set WRX_DOMAIN, the port, the label
sudo sh wrx1-bundle-<version>/ops/offline-install.sh wrx1-bundle-<version>.tar.gz \
  --env wrx1.env --cert tls/server.crt --key tls/server.key --ca ca.crt
```

The install reads the `.tar.gz` itself, beside its `.sha256`. It:

1. checks the bundle against its `.sha256` and every file against `SHA256SUMS`;
2. loads the ejabberd image, checks its layers against the bundle's `MANIFEST` (the image pinned by digest when the bundle was made), and tags it `wrx1/ejabberd:<version>`;
3. checks the certificate: not expired, the key matches, it chains to `--ca`, it names `WRX_DOMAIN`;
4. installs into `/opt/wrx1` (`--home` to change): `compose.yaml`, `ejabberd.yml`, `wrx1.env`, `image.env`, `tls/` (the key readable only by ejabberd's uid 9000), `www/` (the client and its `config.json`), `ops/`;
5. starts ejabberd (`docker compose up -d --wait`, never pulling);
6. creates `admin@<domain>`, asking for its password (12 characters or more) or reading it from `--admin-password-file`. The password goes to ejabberd over a pipe, never on a command line, and is stored only as a SCRAM-SHA-256 hash;
7. runs `check-deployment.sh`, and prints the URL.

Players open `https://<domain>/`; the admin backend is `https://<domain>/#/admin`. Before the first publish, read the admin backend's server checks: they confirm the admin commands, room defaults and message archive (NFR-4).

## 4. Check

```sh
sudo sh /opt/wrx1/ops/check-deployment.sh
```

One line per check, exit 1 if any fails: the certificate verifies against `tls/ca.crt` and names the domain, and is not about to expire; TLS 1.0 and 1.1 are refused; the page has the Content-Security-Policy, `nosniff` and `no-referrer` headers; `config.json` names `/ws` and the domain; the WebSocket answers; `/api`, `/admin`, `/register` and `/upload` answer 404. Run it from an analyst's machine too, with `--connect <server>:443`, to see what the network lets through.

## 5. Upgrade, new certificate, admin password

Run `offline-install.sh` again with the new bundle and the same `--home`. It keeps `wrx1.env`, the certificates and all data, backs up first (`--no-backup` to skip), replaces the image, config, compose file, scripts and client, and restarts ejabberd (a few seconds; players reconnect by themselves). If ejabberd's version changed, the bundle must come from a commit whose R1 tests passed on that version (NFR-22).

- **New certificate:** the same command with `--cert`, `--key`, `--ca` (any bundle; the current one is fine).
- **Admin password:** the same command with `--reset-admin-password` (asked for, or `--admin-password-file`). Role passwords are the admin backend's job (credentials sheet).

**The admin login is also the umpire's.** The umpire plays in the White Force with the server's admin account, so wherever the umpire plays, that browser holds the login that can change or delete the whole game. Choose a long admin password (the install asks for at least 12 characters; use more), play the umpire on a machine only the umpire uses, not on a shared or projected screen, lock it when away, and log out at the end of a session. The server does not lock an account after failed logins, so the password's length is the protection against guessing on the exercise network.

## 6. Backup and restore

```sh
sudo sh /opt/wrx1/ops/backup.sh                 # /opt/wrx1/backups/wrx1-backup-<UTC time>.tar.gz
sudo sh /opt/wrx1/ops/restore.sh <backup.tar.gz>   # asks you to type RESTORE
```

**What is saved, while ejabberd runs:** ejabberd keeps WRX1's data in two stores, and the backup takes both. The SQLite database (SQLite's online backup, then an integrity check) holds the rooms with their settings, members and message archives, the PubSub nodes and their items: the game's documents, objectives, announcements and the theme's uploaded image assets, which are PubSub items too; and the admin's private storage (the encrypted observer vault and the publish marker). The Mnesia database (`ejabberdctl backup`) holds the accounts, with their passwords as SCRAM-SHA-256 hashes. The backup also keeps `wrx1.env`, `image.env`, `MANIFEST` and the CA certificate, to tell what it came from.

**Not saved:** the server's private key (keep it with your certificates), the admin password (never stored), and design drafts, which live in the admin's browser: export the design from the admin backend and keep the file with the backups.

The two stores are copied a second or so apart; an account created in that second may be in one and not the other. Back up when nothing is being provisioned. A backup holds the game's messages and password hashes (mode 600): keep it as you keep the game.

**Restore** replaces everything on the server with the backup's contents and restarts ejabberd (about a minute), after backing up the current state (`--no-backup` to skip). While it runs, the unpacked backup sits in a temporary directory readable by the host's other users (ejabberd's container user must read it), so restore on a host with no other users logged in, as the install expects. On a new host, install the same or a later bundle first, with the same `WRX_DOMAIN` (accounts are stored per domain), then restore. The admin password is the one in the backup.

Back up before and after each exercise, and before an upgrade (the install does that one); copy backups off the host. Test a restore before you need one: install a bundle on a spare machine and restore onto it (what `test/backup-restore.sh` does).

## 7. Logs, stopping, removing

```sh
cd /opt/wrx1
docker compose --env-file wrx1.env --env-file image.env logs --tail 200     # ejabberd's log
docker compose --env-file wrx1.env --env-file image.env stop | start
docker compose --env-file wrx1.env --env-file image.env down                # keeps the data volumes
docker compose --env-file wrx1.env --env-file image.env down -v             # deletes all data
```

## Testing (development machine)

Three tests in `ops/test/` exercise this guide end to end; each needs `pnpm install` and Docker. Give each a bundle, an env file whose `WRX_DOMAIN` resolves to this machine (a hosts entry), a certificate for it, its CA and an admin password file.

- **`offline-install-dind.sh`:** a Docker-in-Docker container started with `--network none` plays the air-gapped host. The test shows it has only loopback (no registry reachable, `docker pull` fails, no images), runs the bundle's own `offline-install.sh` inside it, installs again over it as an upgrade (backup taken, data kept), then reaches it through `docker exec` (no network) to run the deployment checks and the whole contract suite.
- **`backup-restore.sh`:** installs, publishes the sample game with a vault and posts messages, backs up, deletes the deployment and its volumes, installs again, restores, and checks that the vault unlocks with the same passphrase, the audit is clean (observers' voice read through their restored logins) and every account, room, message count, node and item matches.
- **`browser-check.ts`:** opens the installed client in Chromium, under the header policy: welcome page, admin login over `wss://` on the same origin, logout, no policy violation.

The contract suite, the admin-ops, publish and audit scenarios, and `pnpm test:deployment:ejabberd` all take `WRX_XMPP_WS`, `WRX_XMPP_DOMAIN`, `WRX_XMPP_CA` and `WRX_ADMIN_PASSWORD`, so they run against an installed deployment as well as the contract stack.

## The real-hardware run (NFR-23)

A container is not a host. Before the first deployment, the product owner (Ian) installs on a spare machine, following this checklist, and records the result in `plan/decisions/target-environment.md` (WP 0.4):

1. The host as it will be used: its OS, kernel, CPU, Docker version, disk, and the approval to run Docker and ejabberd (Erlang) on it.
2. A bundle made on a connected machine, carried by the approved route, its SHA-256 confirmed over a second channel.
3. `offline-install.sh` with the network physically off or blocked at the host's firewall: it must not try any address (watch with `ss -tnp` or the firewall log).
4. A certificate from the customer's CA, or the internal CA here, and the CA trusted on at least one analyst machine of each kind in use, by the customer's own means (Group Policy, profile, NSS, Firefox policy). No browser warning.
5. From analyst machines: `check-deployment.sh --connect <server>:443`; the welcome page; a publish from the admin backend with its server checks passing; a player and an observer logged in, the observer unable to post; the browsers in use (Chrome and Edge, NFR-13).
6. A backup, a restore onto a second machine, and a login there.
7. A reboot of the host: ejabberd comes back by itself (`restart: unless-stopped`).

## Decisions from WP 0.4

Answered by the product owner on Nov 1, 2026 (`plan/decisions/target-environment.md`), except the CA question. Each is a setting or a script option, so an answer changes configuration, not code.

| Question (WP 0.4) | Answer | What it changes |
| --- | --- | --- |
| 1. Which browsers, and do they allow SharedWorker, IndexedDB, Web Locks (D17)? | Chrome and Edge only (NFR-13; Firefox and Safari SHOULD). The mock, which needs those APIs, is not used on customer machines: demos run on our own laptops | Nothing for the deployment. The CSP header's `connect-src 'self'` relies on CSP Level 3 (`'self'` matches `wss:` on the same origin), which current Chrome and Edge have |
| 2. Is approval needed to run ejabberd (Erlang) on internal and air-gapped hosts? Containers or native? | No special approval. Either route is fine: containers are the primary route, a native install the alternative | Containers (this guide) are what is built and tested. Native: install ejabberd 26.09 from its packages or the official installer, use the same `deploy/ejabberd/ejabberd.yml` (domain, certificate and CA paths set for the host), and use `ejabberdctl` where this guide uses `docker compose exec ejabberd ejabberdctl`; `offline-install.sh`, `backup.sh` and `restore.sh` drive Docker and have no native mode yet; on a native host, back up the same two stores by hand (the SQLite database with its online backup, Mnesia with `ejabberdctl backup`), with the config and certificates. If only a vetted image is allowed, `make-bundle.sh` takes the image reference from `deploy/wrx1/compose.yaml`: pin the approved digest there (and in the contract stack, so CI tests it) |
| 3. Who verifies the air-gapped install on real hardware (NFR-23), and on what hardware? | The product owner (Ian), on a spare machine, with the checklist in "The real-hardware run" above | `linux/amd64` bundles by default. If the spare machine is ARM: `make-bundle.sh --platform linux/arm64`, and the R1 tests run on ARM first. Sizing: the spike's capacity figure (200 players, p95 678 ms) was on a laptop-class machine; the rate limit and disk estimate may need tuning to the hardware |
| 4. Is there an internal CA, and how are its certificates distributed to browsers (NFR-2)? | Not known yet, so every route stays supported: `issue-server-cert.sh --csr-only` for the customer's CA, or `make-internal-ca.sh` for our internal CA, made once or per install | With the customer's CA: no CA of ours, and the trust step is theirs. Without one: `make-internal-ca.sh --permit <domain>`, and the customer must still push `ca.crt` to browsers (Group Policy, profiles, Firefox policy); if they cannot, every analyst sees a warning, which is not acceptable for v1. Their certificate lifetime and key-size rules replace the 397 days and RSA 2048 defaults (`--days`; the key in `issue-server-cert.sh`) |
