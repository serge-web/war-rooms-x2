# WP 3.4 — v1 security review, release notes and v1 blog post

**SRD ids:** DOC-2, DOC-5, DOC-26, R13–R17 · **Depends on:** 3.1–3.3, 3.5 · **Status:** done except release (waits for WP 3.3 hardware check) · **Security review required**

## Goal

Close the v1 security work and write the release material. First fix the two WP 3.5 gaps the product owner asked for, then review all security-relevant code as it stands after WP 3.5, fix what the review finds, and draft the release notes and the v1 gate post. The real-hardware check (WP 3.3) is still with the product owner, so the release itself waits for it.

## Acceptance

- **Fix 1: finding the player's own role must not depend on node listing.** Since WP 3.5 the client finds its own role by login name among the role documents it lists (`SessionStore.ownRole`). If listing is refused, the player sees no rooms. Make finding the own role work without listing, for example a direct lookup the client can make from its login name alone (a per-login-name pointer item, or a node or item id derived from the login name), keeping GUID node names (§3 rule 1) and failing closed. Choose the design, record why in `phase-3-security-notes.md`, and test it on the mock and ejabberd, including the case where listing is refused.
- **Fix 2: the planner refuses a changed login name for a published role.** An imported design that changes a published role's login name must produce a planning error naming the role, the old and the new login names, and the remedy (delete the role and add a new one; ADM-5), never a new account plus a deleted one. Unit tests in the planner, and a publish scenario step on both backends.
- **Security review** (independent read of the code, not of the builders' notes alone): access, publish, audit and repair, the vault, the client's rendering of untrusted text, the CSP, the deployment in `deploy/wrx1` and `ops/`, and WP 3.5 using `phase-3-security-notes.md`. Weigh especially:
  - any code path that builds a JID from a role GUID, or keys access by login name where the design keys it by GUID;
  - the `retired` node granting or revealing anything;
  - the purge step and its order;
  - the umpire playing with the server-admin login: nothing in the game view runs admin commands without an explicit admin action;
  - F1–F14 still hold.
  Write `plan/reviews/v1-security-review.md` (internal, not on the site): findings rated, each fixed with tests or accepted with a reason. The product owner decides on accepting anything high or critical.
- **Release notes:** `RELEASE-NOTES.md` for v1 (features, supported browsers per WP 0.4, install route, known limits, the migration route N3). Nothing that DOC-2 keeps off the site.
- **v1 gate post:** `site/pages/blog/v1-release.md`, front matter `phase: 3`, `status: gate`, in the style of `phase-2-features.md`, linking Phase 3 intermediate posts if any (DOC-26), with a frozen snapshot if it shows the app (DOC-24). It must pass `pnpm check:site` and the deny-list. State that the real-hardware check is pending until it is done.
- **Gates:** `pnpm check`, build plus `check:bundle`, `CI=1 pnpm e2e`, `e2e:admin-ui`, `e2e:mock-host`, site build plus `check:site`, screenshots `--repeat`, and on an ejabberd stack the contract, admin-ops, publish, audit and deployment suites and the ejabberd Playwright project.

## Notes

The two fixes come first, as separate commits, so the review reads the fixed code.
