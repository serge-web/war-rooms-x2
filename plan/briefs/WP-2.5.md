# WP 2.5 — Workspace

**SRD ids:** PLY-4–6, PLY-8, PLY-40–42, ARC-9 · **Depends on:** 0.2, 2.4 · **Status:** to do · **Designated interface WP (workspace module)**

## Goal

The dockable workspace: one tab per visible room, saved per server, role and design version, and reconciled live as rooms come and go.

## Acceptance

- **A workspace module** wrapping FlexLayout; nothing else imports the library (ARC-9).
- **Default layout:** up to three columns, rooms spread evenly, one column per room when there are fewer than three (PLY-40).
- **Rooms added in play** go to the tabset with the fewest tabs (PLY-41).
- **Saved layouts:**
  - kept in browser storage, keyed by server, role and `designVersion`, under the mock-host namespace for mock deployments (PLY-5, DOC-10);
  - restored on login;
  - reconciled against the current rooms without a reset (PLY-6).
- **Reset layout** control (PLY-42).
- **Non-room panels** (game info, online roles) are dockable (PLY-8).
- **Lessons from WP 0.2 (`layout-library.md`):**
  - tab ids are prefixed per workspace instance, and the prefix is stripped on save;
  - pop-outs are docked back when closed and on restore;
  - focus is managed after keyboard moves (Alt+Shift+Arrow);
  - typed wrappers stand in for FlexLayout's `any`.
- **The tab renderer** takes an unread-count slot (PLY-11), filled by 2.6.
- Unit tests of the layout model in Node; Playwright tests of the scenarios from 0.2.

## Owns

The workspace module in `packages/player-ui/`.
