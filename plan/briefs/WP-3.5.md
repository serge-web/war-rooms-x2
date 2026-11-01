# WP 3.5 — GUID ids, login names, and objectives by the admin only

**SRD ids:** §3 rules 1, 6 and 14, D21, ADM-5, ADM-14, ADM-16, ADM-26, ADM-42, PLY-1, PLY-35, R10 · **Depends on:** Phase 2 (G2) · **Blocks:** 3.4 · **Status:** to do · **Security review required**

## Goal

Build the v1 provisions from the product owner's Nov 1 revision (SRD §14). Entity ids become GUIDs, with a separate readable login name for each role and a last-name record for deleted forces and roles. Objectives become admin-only: every White Force role reads them, and only the admin edits. Existing designs and the mock seed migrate. Design and options: `plan/decisions/annex-a-b-implementation.md`, section 1.

It can land as two or three PRs, in this order: objectives (small, security), then ids and login names, then the migration of fixtures, seed and tests.

## Acceptance

- **Objectives (D21, §3 rule 14, PLY-35, R10):**
  - Publish targets (`packages/admin-ops/src/target.ts`) give White Force roles read only: no publisher affiliations except the admin. `objectivesMaxItems` is 1.
  - On a server that has White Force editors' items, publish removes their publisher affiliations first, then purges every item but the admin's (`admin`), then publishes the admin's item. The purge is a new AdminOps step, with contract tests on the mock and on ejabberd (owner purge, and that a former publisher can no longer publish).
  - The store shows the admin's item only; `canEditObjectives` is true for the admin alone. The F11 rule that a live notification beats a fetched copy still holds, with its store tests.
  - The game view keeps the admin's editor; no other role sees an editor, White Force non-observers included. The preview-as-role view shows read only.
  - Audit and repair (ADM-41) flags, and repairs, extra objectives publishers and stray items.
  - SC-5 passes unchanged (the admin amends Red's objectives).
- **GUID ids (§3 rule 1):**
  - An `idSchema` for lowercase UUIDs in `@wrx/schemas`, used for force, role, room and asset ids and in `nodeName` and `parseNodeName`. `slugSchema` stays for room types and login names.
  - New ids from `crypto.randomUUID()`, with a `getRandomValues` fallback, tested without a secure context.
  - The admin editor no longer derives ids from names.
- **Login names (§3 table, rule 6, ADM-5, ADM-26, PLY-1):**
  - `roles:<guid>` gains `loginName`, the XMPP account name. The rules that applied to role ids move to it: slug-shaped, not reserved, not anonymous-shaped (`isReservedRoleId`), unique in the design.
  - A login name is editable until the role is first published, then fixed (unless the owner decides otherwise, merge record N2). A login name held by a `retired` record cannot be given to another role.
  - Login form, credentials sheet, quick login and the access matrix use login names. Authors resolve by login name.
- **Deleted entities (§3 table, rule 1, ADM-14):**
  - A `retired` node, whitelist read for every role, publish by the admin. One item per deleted force or role, written before the entity is removed (ADM-39 order). The schema and data dictionary include it (DOC-3).
  - A deleted role's old messages show its last name, marked deleted, in the chat panel.
  - Effective access never reads `retired`.
- **Reserved `templates` name:** in a reserved list in `packages/schemas/src/nodes.ts`. Publish, audit and the mock leave it alone.
- **ADM-42:** the node-name warning says names now carry only GUIDs.
- **Migration:**
  - `designFileSchema` version 2. Import of version 1 converts every id and reference and keeps each role id as its login name (ADM-16), with a round-trip test over every id-holding field. The admin's stored draft migrates the same way.
  - The seed and demo use fixed GUIDs and today's ids as login names.
  - The mock state format is bumped; old browser state resets to the seed with a notice (DOC-17).
  - Saved layouts fall back to the default once (PLY-5); multi-client presets keep working.
- **Tests:**
  - Unit, contract (mock and ejabberd), publish, admin-ops and audit suites pass.
  - SC-1 to SC-9 pass on both backends, with their headers unchanged.
  - Screenshots are regenerated; the data dictionary is regenerated (`pnpm dictionary`).

## Owns

`packages/schemas`, the id and objectives parts of `packages/domain`, `packages/admin-ops` (targets, publish, audit), `packages/admin-ui` (draft, editor, import), the seed and state format in `packages/mock-server`, and the parts of `packages/player-ui`, `apps/web/e2e` and `packages/contract-suite` the change touches.

## Consumes

The transport interface (1.1); a purge operation, if added to `AdminApi`, is an interface change and is listed for the gate.

## Notes

- **Security-critical.** It changes who may publish objectives, and the account name every room affiliation uses. A tech-lead review checks that no White Force role keeps a publisher affiliation, and that no retired role or force regains access.
- No in-place migration of a provisioned server: export, import, reset, publish. Room history is lost; the owner is asked to confirm (merge record N3).
- Site: the data dictionary changes with the schemas. Blog posts that mention slugs are history and stay as written.
