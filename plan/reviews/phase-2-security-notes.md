# Phase 2 security review notes (internal)

For the tech-lead review of WP 2.1, 2.3 and 2.10 before the Phase 2 PR merges. Not for the public site (DOC-2).

## WP 2.1, admin operations (`packages/admin-ops`)

- **Vault scope.** The vault holds the password of every read-only role, observers and roles with a per-room read-only entry, because each needs its voice revoked through its own login.
- **Failing closed.** If revoking voice or the rejoin check fails, the role's membership of that room is removed (`rolledBack`). An observer can lose read access rather than keep voice.
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
