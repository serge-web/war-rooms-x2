# WP 2.1 — Admin operations

**SRD ids:** ADM-35–40, ADM-12, NFR-3 · **Depends on:** 1.3, 1.6, 0.1 · **Status:** done · **Security review required**

## Goal

One framework-free module, `packages/admin-ops`, through which every admin change to the server passes, applying rules R-A to R-F. Its job is to make the server's access control match the game design exactly.

## Acceptance

- `AdminOps` over a `@wrx/transport` `Session` logged in as `admin`. Operations:
  - create and configure rooms and nodes to NFR-3: members-only, moderated, non-anonymous, persistent, unlisted; whitelist and publishers, except `game-setup`, the game theme's assets (§3 rule 15) and `announcements` (PLY-37);
  - grant and revoke room and node access; move a role between forces; delete a role; destroy a room;
  - create, delete and change the password of accounts.
- **The rules:**
  - R-A: revoking read access removes the affiliation **and** every subscription of every full JID of the account (ADM-36).
  - R-B and R-C: game rooms are always moderated, and observer voice is re-applied after any affiliation change (ADM-37).
  - R-D: a move grants new access before revoking old (ADM-38).
  - R-E: deletion removes affiliations and subscriptions, then the account; `item-not-found` counts as deleted (ADM-39).
  - R-F: destroying a room reports its message count first (ADM-40).
- **Objectives nodes** keep one item per author (§3 rule 14), with `max_items` sized for the admin plus every umpire role.
- **Nodes are always created before publishing,** because ejabberd auto-creates a missing node with an open config.
- **The observer-password vault (ADM-37,** chosen because WP 0.1's offline check failed):
  - passwords are encrypted in the browser with WebCrypto (AES-GCM, PBKDF2 or Argon2-class key derivation from a passphrase), and only ciphertext is stored, through `AdminApi.setPrivate`;
  - to make an observer read-only, the tooling logs in as the observer with the vault password, joins, and has the admin revoke its voice. Making the observer a member and revoking voice run back to back, before the room is published to the observer;
  - the vault is updated when a password is reset (ADM-26) and when a role is deleted (ADM-39). A lost passphrase means resetting the observers' passwords.
- **Tests:**
  - unit tests against `FakeSession` for ordering and rules;
  - an integration test of the whole module against the mock (`@wrx/mock-server`);
  - one against ejabberd, in the contract CI job's stack: provision the sample design, then check each rule by its effect (C01-style).

## Owns

`packages/admin-ops/`

## Consumes

`@wrx/transport`, `@wrx/schemas`, `@wrx/domain` (`effectiveAccess`), `plan/decisions/S13.md` (internal).

## Notes

This is security-critical. A tech lead reviews it before the Phase 2 PR merges. Nothing from this WP goes on the public site (DOC-2).
