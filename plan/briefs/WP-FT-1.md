# FT-1 — Out-of-game column as a tab in narrow clients

**SRD ids:** PLY-36, PLY-8, PLY-16 · **Depends on:** 2.5, 2.7, 2.9 · **Status:** done

## Goal

Raised by the product owner from the multi-client view: in a narrow client, the out-of-game column takes too much room. Below a width breakpoint, it becomes a workspace tab like the rooms.

## Acceptance

- **Breakpoint:** about 400 px, to be tuned. It is measured on the client's own width (a container query or ResizeObserver), not the screen's, so each multi-client pane switches on its own width. Above it, the fixed column returns.
- **The tab:**
  - has its own styling that marks it as special, for example the game's accent colour and an icon;
  - cannot be closed;
  - keeps its content and state when it switches between column and tab.
- **Announcements stay noticeable:** a new announcement shows an unread badge on the tab while the tab is hidden.
- **Layouts:** a saved layout and the switch do not fight. The tab is not saved as a room, and switching back and forth does not disturb the room tabs.
- **SRD:** PLY-36 is relaxed to match, and the backlog line is removed.
- **Tests:** component tests and e2e tests, including multi-client panes of different widths, and screenshots of both forms.

## Owns

The out-of-game column and the workspace module's handling of the special tab.
