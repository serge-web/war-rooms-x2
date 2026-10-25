# WP 2.2 — Admin design editor and screen layout

**SRD ids:** ADM-1–9, ADM-27–28 · **Depends on:** 1.6 · **Status:** to do

## Goal

The admin backend's design editor: game, forces, roles and rooms edited as a local draft, with the live effective-access matrix.

## Acceptance

- `packages/admin-ui`, following `plan/decisions/ui-stack.md`.
- A left menu of sections (game, forces, roles, rooms, themes), each a list with an edit form (ADM-27). The themes section is an empty slot that 2.8 fills.
- A header toggle between the admin backend and the game view (ADM-28). The game view is a placeholder route until 2.4 and 2.9.
- **The draft** is a `DesignFile` (`@wrx/schemas`), checked live with `checkDesign`. Errors block publishing; warnings show. It is kept in browser storage, keyed by server, until published (2.3).
- **Editing:**
  - Game properties (ADM-3).
  - Forces: name, colour, icon, umpire flag, warning on more than one umpire force (ADM-4).
  - Roles: name, login id, observer flag, move between forces (ADM-5). Passwords are not handled here; 2.3 does.
  - Rooms: name, room type from the registry, mixed force and role participants with read or write access (ADM-6). Type-specific settings come from the registry's admin editor slot (ADM-7).
  - Ids are generated slugs and never reused (§3 rule 1).
- **Reordering** by drag and drop, with keyboard alternatives (ADM-8, dnd-kit).
- **The effective-access matrix,** rooms × roles, write / read / none, from `effectiveAccess` via `useDesignAccess` (ADM-9).
- **Login:** the admin backend is reachable only after logging in as `admin`. Authorisation rests on the server (ADM-1); the client only hides the route.
- Presentational components are split from hooks (NFR-18), with stories in Storybook once 2.4 adds it.
- Playwright scenarios tagged `@screenshot` against the mock, using the seed from `@wrx/mock-server`.

## Owns

`packages/admin-ui/` (the editor parts), and its admin route in `apps/web`.

## Consumes

`@wrx/domain`, `@wrx/hooks`, `@wrx/schemas`, and `packages/ui` once 2.4 provides it. Until then, keep local components that are easy to swap.
