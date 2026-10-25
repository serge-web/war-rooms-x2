# WP 2.10 — Audit and repair; node-name warning

**SRD ids:** ADM-41, ADM-42 · **Depends on:** 2.3 · **Status:** done · **Security review required**

## Goal

A check of the live server against the design, with fixes, so a missed step in the admin tooling does not silently leave access wrong (R14).

## Acceptance

- **Audit** through `@wrx/admin-ops`:
  - room moderation and configuration;
  - observer voice, checked through the vault login, because no admin command shows the stored role (WP 0.1);
  - orphaned affiliations and subscriptions, including per full JID;
  - node access models and publish models;
  - accounts with no role, and roles with no account.
- **A report** of each difference, with a one-click repair through `@wrx/admin-ops`. Repairs are idempotent.
- **A warning** in the editor that anonymous users can list node names (ADM-42).
- **Tests:** drift is injected on the mock and against ejabberd (an unmoderated room, a leftover subscription, a missing voice revocation), and each is detected and repaired.

## Owns

The audit parts of `packages/admin-ui/` and `packages/admin-ops/`.

## Notes

Security-critical; reviewed with 2.1 and 2.3. Keep it off the public site (DOC-2).
