# WP 2.11 — White Force and the admin as umpire

**SRD ids:** §3 rules 4 and 14, D8, D21, ADM-4, PLY-15, PLY-35, SC-5 · **Depends on:** 2.7, 2.10 · **Status:** done · **Security review required**

## Goal

Build the access model the product owner confirmed at gate G2. The force with the umpire flag is the White Force, and the admin login is its umpire. White Force roles that are not observers write in every room. White Force observers are read only: one with rooms assigned sees only those rooms, otherwise every room (security review finding F5).

## Acceptance

- **Access (`effectiveAccess`, `@wrx/domain`):**
  - White Force non-observers have write access to every room.
  - A White Force observer has read access to the rooms whose participant list names it in a role entry, or to every room when none does. A force entry naming White does not count as an assignment.
  - Observer status always wins.
  - The admin matrix (ADM-9) explains each case.
- **Objectives:**
  - Publisher affiliations for the admin and White non-observers only; read for White observers (§3 rule 14).
  - The player client offers editing to the admin and White non-observers only (PLY-35).
- **The admin as umpire:**
  - An admin login in the game view is the umpire: it sees and posts in every room and edits objectives. Its messages show the White Force colour and the name "Umpire" (or the admin's display name; pick one and say why).
  - The preview-as-role selector (ADM-30, ADM-31) stays.
  - Separate umpire role accounts are not needed. The demo seed drops `umpire-1` for the admin, keeps or adds a White observer, and renames the Umpire force to White.
- **Editor:**
  - Exactly one force carries the umpire flag; new designs start with a White Force (ADM-4).
  - Validation warns if there is none.
- **Publish and audit:** publish targets (`packages/admin-ops/src/target.ts`) and the audit (2.10) follow the new rules, tested on the mock and on ejabberd (publish, admin-ops, audit, contract).
- **Tests:**
  - Unit tests for every precedence case, including a White observer with and without assigned rooms.
  - Updated e2e tests, screenshots and multi-client presets that used `umpire-1`.
  - SC-5 played as the admin.

## Owns

Access rules in `packages/domain`, `packages/admin-ops` targets, the seed in `packages/mock-server`, and the parts of `packages/admin-ui` and `packages/player-ui` they touch.

## Notes

Security-critical. Reviewed together with the G2 fixes. Critical point to weigh: the umpire now plays with the server-admin login, so a stolen umpire session holds admin rights. The SRD accepts this by design (the admin is the sole controller), but the review should confirm that nothing in the game view runs admin commands without an explicit admin action.
