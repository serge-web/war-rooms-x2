# WP 2.7 — Out-of-game column

**SRD ids:** PLY-15, PLY-25, PLY-35–39, ADM-23–24, ADM-29 · **Depends on:** 2.5, 2.1 · **Status:** done

## Goal

The fixed right-hand column: a game time slot, the admin's announcements, and the force panel with objectives.

## Acceptance

- **The column** has a fixed width and sits outside the workspace. Top to bottom: a reserved game-time area (empty in v1), the admin panel, the force panel (PLY-36).
- **Admin panel:**
  - announcements oldest first, with the newest briefly highlighted (PLY-37, PLY-38);
  - for the admin, a text box for posting (ADM-29).
- **Force panel:**
  - force theme, logo, role name and the force's objectives in Markdown (PLY-25);
  - umpires choose any force and edit its objectives with a preview, publishing through the store with one item per author (PLY-35, §3 rule 14);
  - the admin writes objectives in the editor (ADM-23), and they reach players live (ADM-24).
- **Umpires** see and post in every room (PLY-15); this comes from `effectiveAccess`, so check it end to end.
- Playwright: an umpire edits objectives and the force's player sees the change live.

## Owns

`packages/player-ui/` out-of-game column files.
