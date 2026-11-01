# v1 security review (WP 3.4, internal)

Not for the public site (DOC-2). An independent read of the code as it stands after WP 3.5 and the two WP 3.4 fixes, on branch `claude/gracious-thompson-aowbqs` from `cd0ac23`. The builders' notes (`phase-2-security-notes.md`, `phase-3-security-notes.md`) were used to find the code, not as evidence: each claim below was checked in the code and, where it matters, by a test that runs on both backends.

## Scope

- **Access:** `@wrx/domain` `effectiveAccess`, the store (`SessionStore`: own role, documents, rooms, senders), `@wrx/admin-ops` `targetState`.
- **Publish:** the planner (`publish/plan.ts`), the executor, `preparePublish`, the admin UI's publish controller and section.
- **Audit and repair:** `audit/diff.ts`, `run.ts`, `repair.ts`.
- **The vault:** `vault.ts` (KDF, envelope, passphrase check, demo flag), its users in the admin UI.
- **Untrusted text in the client:** the Markdown sanitiser (`@wrx/ui` `renderMarkdown`, also the admin preview), chat (plain text), author labels, assets (`<img>` only).
- **The CSP:** `apps/web/vite.config.ts` (meta policy) and the reference header in `deploy/ejabberd/ejabberd.yml`.
- **The deployment:** `deploy/wrx1`, `deploy/ejabberd/ejabberd.yml`, `ops/` (install, bundle, CA, backup, restore, checks).
- **WP 3.5:** GUID ids and login names, `retired`, objectives by the admin only and the purge, migration.

## The two fixes made first

- **Fix 1 (medium): the own role depended on node listing.** Since WP 3.5 the client found its role only among role documents it had listed, so a refused listing left a player with no role and no rooms (WP 3.5 notes). Fixed by the `directory` node (`phase-3-security-notes.md`, "fix 1"): one whitelist item read by every role, naming each role's GUID by login name and every force, role and room GUID. The directory is a pointer; a role document is the own role only if it carries the session's login name. Node names stay GUID-only. Tests: `store.test.ts` (six cases, listing refused), the publish scenario step 1 on the mock and ejabberd.
- **Fix 2 (medium): a changed login name of a published role was planned as a new account plus a deleted one.** Now a `login-name-changed` planning error, with no step; the executor refuses any plan with errors. Tests: `plan.test.ts`, `execute.test.ts`, the publish scenario step 2b on both backends.

## Findings

| Id | Rating | Finding | Status |
| --- | --- | --- | --- |
| V1 | medium | The own role found only through node listing (WP 3.5) | Fixed (fix 1) |
| V2 | medium | The audit audited a design the planner refuses, so its repairs could still rename an account (create the new, offer the old for deletion) | Fixed |
| V3 | medium | A role of a new GUID could take a published role's login name, or a deleted role's from the server's records; the old messages then showed as the new role's, and the planner's safety-net `retired` record of a live login name blocked the draft for good | Fixed |
| V4 | low | No operator guidance that the umpire plays with the server-admin login; restore unpacks the backup readable by other host users | Fixed (documented) |
| V5 | medium | No limit on failed logins: the admin password can be guessed online over the exercise network | Accepted for v1 by the product owner (Nov 1, 2026); revisit after v1 |
| V6 | low | The admin's game view joining a room whose MUC room is gone creates it (locked) | Accepted (carried from WP 2.11) |
| V7 | low | `retired` keeps 1000 items; past that ejabberd drops records and publish never converges | Accepted |
| V8 | low | An anonymous session learns the number of rooms (RSM count) and of game nodes; now also that `directory` exists | Accepted (R17, ADM-42) |
| V9 | info | Login names may look like GUIDs | Accepted |
| V10 | info | Stale doc comment on `publishObjectives` (Phase 2 rule) | Fixed (with V4) |

No finding is rated high or critical, so nothing waits on the product owner's acceptance; V5 is listed for the owner because the alternative is a deployment trade-off.

### V2 (medium): the audit could do what the planner refuses. Fixed.

`diffAudit` derives most items from `targetState(design)` and some from `planPublish`. After fix 2 the planner refused a renamed login, but the audit, given the same design, still reported `account-missing` for the new login (repair: create the account, not destructive) and the old account as stray (repair: delete the role, behind a tick). Repairing both is the rename by create and delete that fix 2 forbids, and loses the old account's password and its history's link to a live role. Fix: `runAudit` runs the planner's `loginNameChanges` on the server's published design first and returns `invalid` with the planner's message. Test: the audit scenario "1b" on the mock and ejabberd (a renamed and a reissued design are both refused; the published design still audits clean).

### V3 (medium): login names reused across GUIDs. Fixed.

`withRetiredRecords` adds a `retired` record for every published role the design no longer has, by GUID. A design that keeps a published login name on a new GUID (a draft started afresh in another browser, or a version 1 file converted again, since conversion issues new GUIDs) was planned as: the account kept (its login name is still in the design), the old role node deleted, and a `retired` record published holding the login name the live role uses. Effects: the old role's messages resolved to the new role document, which may have another name and force (attribution, §3 rules 1 and 6); and the next plan merged the record into the draft, where `checkDesign` refuses a role using a retired login name, so the draft could not be published again short of a reset. The same check also missed a design role taking a login name that only the server's `retired` records hold (they are merged into the draft only after that plan). Fix: `loginNameChanges` also returns `login-name-reused` when a design role holds the login name of a published role or a server `retired` role record with another GUID, naming the holder and the remedy (a new login name; or import the published design's export, or reset). Tests: `plan.test.ts` "a published or deleted role's login name is not reused" (fails on the old planner), the audit scenario "1b".

### V4 (low): operator notes. Fixed (documentation).

- The umpire's login is the server admin (D8). The game view runs no admin command by itself (checked below), but the browser it runs in holds a login that can change or delete the game. `ops/README.md` now says to play the umpire on a machine only the umpire uses, with a long admin password, and to log out after a session.
- `restore.sh` makes the unpacked backup (password hashes, messages) world-readable in its temporary directory for the length of the restore, because ejabberd's container user must read it and the container runs with every capability dropped. The guide now says to restore on a host with no other users logged in. Changing it needs a capability or a uid mapping on the restore container; not worth the risk to a tested path for v1.

### V5 (medium): online guessing of passwords. Accepted for v1 by the product owner.

Owner decision (Nov 1, 2026): accepted for v1 on the grounds below (closed network, random role passwords, 12-character admin minimum); revisit after v1.

`mod_fail2ban` is not loaded (the spike removed it), and nothing else limits failed logins, so anyone on the exercise network can try admin passwords as fast as SCRAM allows. Why accepted for v1: role passwords are random, about 79 bits, so guessing them is not practical; the admin password is chosen by the operator with a 12-character minimum (`offline-install.sh`), and the guide now asks for more; the network is closed. Why not fixed here: ejabberd bans by source address, and in the reference deployment that address is not reliable. With Docker's userland proxy (its default for some setups) every browser arrives from one address, so one player mistyping a password 20 times would lock everyone out of the exercise for the ban's length. Recommendation: decide with the real-hardware check (WP 3.3), once the host's networking is known; if each browser's address reaches ejabberd, enable `mod_fail2ban` with loopback allowed and a short ban.

### V6 (low): the umpire's game view can create a missing room. Accepted.

Unchanged from WP 2.11: the store joins the rooms its documents name, and for the admin, XEP-0045 creates a room that does not exist. On ejabberd 26.09 the new room takes the reference config's `default_room_options` (members-only, moderated, not public, side channels closed) and stays locked until configured, the audit reports it and the next publish configures it. It needs drift or a part-way publish first.

### V7 (low): `retired` overflow. Accepted.

`RETIRED_MAX_ITEMS` is 1000, ejabberd's default `max_items_node`. A game that deleted more than 1000 published forces and roles would lose the oldest records from the server (the draft keeps them, so their login names stay blocked in the editor), and every publish would publish them again. Not a realistic v1 game.

### V8 (low): what anonymous sessions can count. Accepted.

Anonymous sessions list node names (R17, ADM-42) and get an RSM count of rooms (WP 3.3 F10 note). Names carry GUIDs only, so they learn how many forces, roles, rooms and assets exist, not their names. The new `directory` node is one fixed name and adds only its existence; its item is whitelist (every role, not anonymous). Login names are never in a node name: a name derived from them (even a hash) would let anyone outside the game confirm a guessed login name, which is why fix 1 does not use one.

### V9 (info): GUID-shaped login names. Accepted.

`loginNameSchema` is a slug, and a GUID is a valid slug, so a role could have another entity's GUID as its login name. Nothing confuses the two: every map that holds login names (accounts, affiliations, authors, the credentials book) is separate from those keyed by GUID, and no code tries one as the other.

## What was checked and holds

### GUIDs, login names and JIDs

- **No JID is built from a role GUID.** Every JID construction outside tests was read: `AdminOps.roleJid` (login name, guarded by `isReservedLoginName`), the mock's seed (`jidOf` maps GUID to login name once; its fallback is never hit, since it is called with the design's own roles), `transport-xmpp` (the typed username), the domain's `roomJid` (room GUID). In `@wrx/admin-ops` a "role id" is a login name from `targetState` down; the admin UI hands the credentials book and per-role resets the login name (`PublishSection`, "keyed by login name"), and marks roles published by login name (`markRolesPublished`).
- **Access is keyed by GUID where the design keys it by GUID.** `effectiveAccess` works on GUIDs; `targetState` maps each cell's role GUID to its login name once; the store's `me()` uses `roomsForRole(matrix, role.id)`; the planner's `knownAccess` maps a login name back to the published GUID through the published documents. Message authors are resolved by the occupant JID's localpart on the session's own domain (`toSender`), never the body; `admin` is the umpire only on this domain.
- **Fix 1 keeps both rules.** The directory maps login name to GUID only for finding a document; the own role is still the document carrying the session's login name, and access still comes from the role's GUID in the matrix.

### `retired`

- Grants nothing: `targetState` never reads it (the node's own affiliations are every role `member`, admin owner), `effectiveAccess` takes forces, roles and rooms only, and the store reads it in `authors()` only. Test: `target.test.ts`, `store.test.ts` "never reads `retired` for access", `plan.test.ts` "never lets a retired record grant access".
- Reveals nothing new: a record holds a name and colour every role could already read, and a login name. The store ignores a record whose item id is not its own id, and an `admin` login name in a record is skipped, so a record cannot take the umpire's label.
- Published in the documents group, before the removals, so a deleted role's record is on the server before its account goes (publish scenario step 3 on both backends). Never purged or deleted by publish.

### The purge and its order

- `purgeStep` is planned only for `objectives:<force>` nodes holding an item the design does not, in the documents group: after the nodes group has set `max_items` to 1 and after the access group has set every White Force role to `member`, then the admin's item is published again in the same group. The executor runs steps in plan order. So a former editor can neither republish between the purge and the republish, nor see stale text. The audit's `repairRank` puts every purge before every publish. The purge is destructive in `risk` and not confirmed; what it removes is text nobody may publish, and the admin's own item is put back next. Tests: `plan.test.ts` "takes the White Force editor's publisher affiliation, then purges, then republishes", publish scenario step 2 and the audit scenario on both backends, contract S02.
- One gap, low and accepted: an audit repair of only the `stray-items` item, without the `node-access` item that takes a White Force role's `publisher` affiliation, purges while the role can still publish. The re-audit shows the remaining `node-access` item, which is critical, and repairing both runs them in the right order.

### The umpire and the server-admin login

- The game view (`@wrx/player-ui`, `@wrx/domain`'s `SessionStore`, `@wrx/hooks`) imports nothing from `@wrx/admin-ops` or `@wrx/admin-ui` (checked by grep); only `apps/web/src/seams/AdminApp.tsx` does, loaded lazily for `#/admin`. The store calls no `session.admin` operation, and no MUC moderation (kick, voice, affiliation, room config). What the admin's store sends: joins and leaves, MAM reads, PubSub reads and subscriptions, chat it types, and objectives and announcements it publishes on an explicit action. `publishObjectives` is refused for every role before sending (`canEditObjectives` is the admin's only), and the server refuses it anyway. Opening `#/admin` constructs `AdminOps` but runs nothing until the admin plans, audits or unlocks.
- With fix 1 the admin's store also reads `directory`, which it owns; nothing changes in what it may do.

### Publish and audit

- **F3** holds: only accounts the server does not list are created; an existing account gets `account-exists` and keeps its password; `create-account` fails `exists` rather than resetting.
- **F9** holds: `executePlan` refuses the whole plan before any step if a confirmation is missing, worked out from the action (`stepConfirmation`); a plan with errors is now refused the same way (fix 2). `repairItems` works out destructiveness from the actions.
- **F1** holds: `readOnlyIn` takes the membership away before the vault check and the login, and fails closed per room (`ops.test.ts` "R-B: write to read fails closed", the admin-ops scenario on both backends).
- **F4** holds: login names that look like anonymous sessions are refused in the schema, `checkDesign`, the draft and `AdminOps`.
- **F5** holds, as WP 3.5's stricter rule: no role publishes objectives; White observers read only their assigned rooms, else all.
- **F6** and **F10** hold: side channels are written and read back; room listings page with RSM.
- Reset (`planReset`) deletes only game nodes (`isGameNodeName`: singletons, `<prefix>:<slug>`), never `templates` or anything below it; `readState` filters the same way, so the planner never sees, and never deletes, a reserved node.
- The planner trusts only documents whose id matches their node, and a pending publish marker makes it re-check read-only members rather than trust stale documents.

### The vault

- Unchanged since Phase 2 except F12: PBKDF2-SHA-256 600,000 iterations (bounded 100k–10M on unlock), AES-GCM with a fresh IV and the header as additional data, non-extractable key, NFC passphrases of 12 or more characters with the strength estimate. `demo: true`, which skips the estimate, is passed only by the test that regenerates the published demo vault; the admin UI's only `demo: true` is a credentials-book entry on the mock, unrelated. The idle lock (15 minutes) and the lock on disposal hold (`controller.test.ts`). F14's per-key private storage holds (contract suite on both backends).
- Residual, as before: unlocking is not rate-limited beyond the KDF's cost, and an unlocked tab holds the passwords until the idle lock.

### Untrusted text in the client

- One `dangerouslySetInnerHTML` for game text, in `MarkdownView`, fed by `renderMarkdown`: raw HTML escaped by the renderer before DOMPurify, images dropped, forms, media, SVG and MathML forbidden, `class`, `id`, `name`, `style` and `srcset` stripped, links kept only for absolute `http:`, `https:` and `mailto:` and opened with `noopener noreferrer nofollow`; a private DOMPurify instance per call. The admin preview uses the same function (**F8** holds). Chat, names, announcements and the `deleted` marker are React text. Assets are shown only through `<img>` with a `data:` URL; SVG is sanitised on upload.
- Every document is schema-checked on read (ARC-6) and a per-entity document must name its own node; the new `directory` document is validated the same way, and an invalid one is ignored.

### The CSP and the deployment

- **F7** holds: the build's meta policy has no `unsafe-eval` and no inline script; the reference deployment sends the narrowed header (`connect-src 'self'`, `frame-ancestors 'none'`, `nosniff`, `no-referrer`, `Cross-Origin-Opener-Policy`). `check-deployment.sh` checks the headers. **F13** holds: `config.json` refuses plain `ws:` except to loopback.
- `deploy/wrx1`: one published port, TLS 1.2 or later; the c2s listener only on the container's loopback with STARTTLS; no HTTP API, web admin or registration; only the admin creates rooms and nodes; capabilities dropped and `no-new-privileges`; the image pinned by digest and checked against the bundle's manifest; the admin password never on a command line or in the environment (it is briefly an argument of `ejabberdctl` inside the container, visible to root on the host, as WP 3.3 recorded). Backups are mode 600 and not encrypted (an operator's choice of storage). See V4 and V5.
- The real-hardware run (WP 3.3) and the choice of certificates are still with the product owner; nothing here depends on them except V5's recommendation.

### Migration (WP 3.5)

- A version 1 design file is converted with new GUIDs and its role ids as login names, re-checked, and a file with a `password` is still refused. A published slug-id game moves only by export, import, reset and publish (N3). Publishing a converted file onto the old server without the reset is not refused: the planner does not read `roles:<slug>` documents as published roles (their ids are not GUIDs), so it keeps the accounts, deletes the slug nodes and destroys the slug rooms behind their ticks, with their history. That is the reset route by another name, with the same confirmations; the import's warning says to reset. V3 applies once a game has been published with GUIDs: converting the same file again and publishing it over that game is refused.
- The mock's version 1 database is not migrated (reset to the seed with a notice); saved layouts fall back to the default once.

## Tests run for this review

Unit: `pnpm test` (every package). Both backends: the publish scenario (steps 1, 2b), the audit scenario (1b), the admin-ops scenario and the contract suite on the mock and on ejabberd 26.09, the deployment suite on ejabberd. The gate results are in the WP 3.4 report.
