# Phase 2 security review notes (internal)

For the tech-lead review of WP 2.1, 2.3 and 2.10 before the Phase 2 PR merges. Not for the public site (DOC-2).

## WP 2.1, admin operations (`packages/admin-ops`)

- **Vault scope.** The vault holds the password of every read-only role, observers and roles with a per-room read-only entry, because each needs its voice revoked through its own login.
- **Failing closed.** Making a role read-only first takes its membership away in every target room where it is a member, before the vault check and the role's login. Then, room by room, membership and voice revocation run back to back. If revoking voice or the rejoin check fails, the role's membership of that room is removed (`rolledBack`), and the other rooms are still handled. Every failure is reported (`failures`). An observer can lose read access rather than keep voice. Fixed after the G2 review (F1): before, a refused login, a missing vault password or a failure in an earlier room left a writer voiced.
  - Cost: a read-only role that is already a member (a re-check, or an audit repair) has its online sessions ejected from those rooms (status 321) and has to rejoin.
- **Grant-to-revoke window.** The role session is opened and the admin joins before membership is granted, so the window is one join plus one `setRole` round trip. Another online session of the same observer that joins inside that window gets voice. The role's presence briefly shows in the room.
- **Read to write without a vault password** uses an affiliation round trip (none, then member), which ejects that role's online sessions with 321.
- **The `from` hint is required for read-to-write;** without it a stored visitor role stays. The 2.10 audit must catch a missing hint.
- **Vault crypto:**
  - PBKDF2-SHA-256, 600,000 iterations by default, bounded between 100k and 10M on unlock;
  - AES-GCM with a fresh IV per save, and the envelope header bound as additional data;
  - the key is non-extractable;
  - passphrases are NFC-normalised, with at least 12 characters;
  - plaintext passwords stay in JS memory until `lock()`.
- **Concurrent vault edits:** a re-read before each write catches most, but a read-then-write race remains between two admin tabs.
- **Order of password writes:**
  - `setPassword` writes the vault first, then the server, and restores the vault if the server refuses;
  - `createAccount` with `readOnly` creates the account first, then the vault entry, and deletes the account if the vault write fails.
- **Guards:**
  - the `admin` account and other reserved ids are refused by every role operation;
  - node names must parse;
  - destructive account operations refuse while a stored vault is locked.
- **ejabberd quirk:** `getRoomConfig` on a missing room creates the room, so existence is checked by listing rooms first. The mock answers `item-not-found` instead, a known divergence with no contract test yet.

## WP 2.3, publish and provisioning (`packages/admin-ops/src/publish`, `packages/admin-ui/src/publish`)

- **Passwords:**
  - `CredentialsBook` is never persisted, and throws if anything serialises it. Passwords stay in JS memory for the admin's session.
  - Disposal locks the vault and clears the book when the connection or store changes, or `AdminApp` unmounts.
  - Generated passwords are 16 characters from an unambiguous alphabet, about 79 bits, using WebCrypto with rejection sampling.
- **Demo passwords** are issued only when the connection is `kind: 'mock'`. `apps/web` sets it from `backendId === 'mock'` (`apps/web/src/seams/AdminApp.tsx`); check that a real server can never reach that path.
- **The vault passphrase** lives only in the dialog's state. Iterations are the 600k default unless a test sets them.
- **The publish marker** is in localStorage, keyed by server. It holds only `{designVersion, startedAt}`, and an unreadable value makes the planner re-check rather than skip.
- **Password resets:**
  - the planner can schedule a reset when a role becomes read-only and the vault lacks its password, behind a confirmation tick (current sessions stay logged in, PLY-31);
  - an account that already exists has its password set silently, with a note on the step.
- **Destructive scope:**
  - MUC rooms not in the draft are destroyed (D11: one game per server), always behind a message count and a tick;
  - roles inferred from stray affiliations are deleted;
  - anonymous subscriptions on open nodes are deliberately ignored.
- **Import** is schema-checked, refuses passwords, and is capped at 20 MB.

## Fixed during integration

- **`transport-xmpp`:** XEP-0049 private storage worked for only one key per session, because StanzaJS resolves every element defined on the same path to the last one. Every key is now in one JSON object inside one element.
  - It reads, then updates, then writes, so two sessions writing at the same moment can lose an update. The vault re-reads before writing.
  - A new contract test (two keys kept apart) fails on the old code and passes on ejabberd and the mock.

## G2 security review resolutions

The G2 review's findings (internal), and what was done about each. Regression tests are named in each entry; each failed before its fix.

- **F1 (high), a write-to-read conversion failed open. Fixed.** `readOnlyIn` takes the role's membership away in every target room where it is a member before the vault check and the login, then grants and revokes voice room by room. It carries on after a room fails, and reports every failure (`AdminOpsError.failures`, plus a `failed` progress event each). `applyRoomAccess` likewise runs every change and reports every failure. The 2.10 repair order (room config before voice) is unchanged. Tests: `ops.test.ts` "R-B: write to read fails closed"; the integration scenario "a writer made read-only fails closed when the vault has no password for it" runs on the mock and ejabberd. Remaining: if taking the membership away is itself refused, the role keeps it; that failure is reported, and the audit catches it.
