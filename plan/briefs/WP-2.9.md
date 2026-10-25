# WP 2.9 — Multi-client view, mock controls and seeds

**SRD ids:** PLY-16–22, PLY-34, ADM-30–31 · **Depends on:** 1.5, 2.5 · **Status:** done

## Goal

The demo surface: 2–4 independent clients on one page, mock controls, and the admin's preview as a role.

## Acceptance

- **Multi-client view:**
  - 2, 3 or 4 panes side by side or in a grid, each a full player client or the admin backend, with its own session, store and layout (PLY-16, PLY-17, D15);
  - pane headers show the role, force colour and backend, with quick login from the role list on the mock or a login form on a real server (PLY-18);
  - named presets save and restore the pane count and logins (PLY-19);
  - works against either backend.
- **Mock controls:**
  - reset to seed, and export or import the mock database (PLY-21);
  - seeds include message history, and an export can become a seed (PLY-34);
  - separate windows share one game (PLY-22, already in 1.5): show it in a test.
- **Admin preview as a role:**
  - a role selector in the game view shows exactly that role's rooms, layout, themes and objectives (ADM-30);
  - the admin may post in those rooms, but posts go from the admin account and are labelled as from the admin (ADM-31).
- Playwright scenarios for SC-7: a three-pane offline demo and a second window.

## Owns

The multi-client route and its package files; the admin preview parts of `packages/admin-ui/`.
