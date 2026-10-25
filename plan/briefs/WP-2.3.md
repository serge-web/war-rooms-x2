# WP 2.3 — Publish and provisioning

**SRD ids:** ADM-10–17, ADM-25–26, NFR-4, NFR-6 · **Depends on:** 2.1, 2.2 · **Status:** done · **Security review required**

## Goal

Turn the draft into server state: a convergent publish with progress, live changes while players are online, reset, design export and import, and the credentials sheet.

## Acceptance

- **Diff** the draft against the live server: documents, accounts, rooms, affiliations and subscriptions. The plan lists only what changed (ADM-10).
- **Applying the plan:**
  - through `@wrx/admin-ops`, with progress per item and failures reported, never silently half-done;
  - re-running completes a partial publish (ADM-11);
  - grants are made before revokes (ADM-25);
  - publishing bumps `designVersion` whenever the design changed (§3 rule 8).
- **Affected online roles** are shown before applying, using presence (ADM-17, ADM-25).
- **Warnings:**
  - re-sync after a role moves or participants change (ADM-13);
  - deleting a role leaves its history attributed to the old JID (ADM-14);
  - destroying a room deletes its history, with the message count shown and a confirmation (ADM-40).
- **Reset the game,** with typed confirmation (ADM-15).
- **Export and import the design** as JSON. Passwords are never included (ADM-16).
- **Passwords:**
  - generated at random (NFR-6), except demo passwords on the mock;
  - a printable credentials sheet generated on demand and never stored (ADM-26);
  - password reset per role, which updates the vault (2.1).
- **Server checks** before publishing, where possible: MAM enabled and room defaults (NFR-4).
- Tests against the mock end to end, plus a publish-then-change scenario against ejabberd.

## Owns

The publish, reset, import/export and credentials parts of `packages/admin-ui/`.

## Consumes

`@wrx/admin-ops`, and 2.2's draft model.
