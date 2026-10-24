# WP 0.2 — Layout library evaluation, FlexLayout vs dockview (P3)

**SRD ids:** PLY-4–6, PLY-40–42, ARC-9 · **Depends on:** — · **Status:** to do

## Goal

Choose the dockable layout library by building the same small prototype with FlexLayout and with dockview.

## Acceptance

For each library, a Playwright test in the prototype shows:

1. Four independent workspaces on one page (D15), each with its own model, with no cross-talk when tabs are dragged in one.
2. A pop-out window from one workspace, which closes cleanly.
3. The PLY-40 default: rooms spread evenly over up to three tabset columns, one column per room when there are fewer than three.
4. PLY-41: a room added during play goes into the tabset with the fewest tabs, using only the public API.
5. Save and restore of a layout to JSON, then restore after a room has been removed and another added, without resetting the rest (D6, PLY-6).
6. A custom tab renderer that shows an unread count, with no DOM manipulation (PLY-11).
7. Keyboard operation of tab moves, or a documented gap (NFR-14).

A decision record, `plan/decisions/layout-library.md`, with the results table, bundle size, TypeScript quality, licence and maintenance status, and the choice.

## Owns

`spike/layout/`, `plan/decisions/layout-library.md`

## Consumes

Nothing.

## Notes

The prototype is throwaway. Only the decision and the test list carry into WP 2.5.
