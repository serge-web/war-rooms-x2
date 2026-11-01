# Phase 3 accessibility (WP 3.2: NFR-14, WCAG 2.2 AA)

The checks are in `apps/web/e2e/a11y.spec.ts`. They run with the rest of the app's e2e suite: in
Chromium in `build-e2e`, and in Firefox and WebKit in `e2e-browsers` (NFR-13). axe-core comes
from `@axe-core/playwright` 4.14.0, pinned exactly; it uses axe-core 4.14.0, released on
5 October 2026. The rules are WCAG 2.0, 2.1 and 2.2 at levels A and AA (`wcag2a`, `wcag2aa`,
`wcag21a`, `wcag21aa`, `wcag22aa`), colour contrast included.

## What is checked

- **axe, no violation allowed.** The test fails on any violation and lists every node. The
  screens:
  - the welcome page with its login form, a refused login, and the admin login;
  - the workspace with its chat panels and the out-of-game column, as Blue CO, as the umpire and
    as the White observer (read-only composers);
  - the objectives dialog;
  - every admin section: Game, Forces, Roles, Rooms, Themes and Access matrix;
  - Publish, the publish plan and its confirmation dialog;
  - the audit;
  - the multi-client view logged out, and with four panes (three players and the admin backend).

  All of them use the default theme, plus the demo game's primary colour, so this is also the
  contrast check of that theme as rendered. `@wrx/theme`'s unit test checks `DEFAULT_TOKENS`
  against `CONTRAST_PAIRS` as well.
- **Keyboard only.** Tab moves from the header through the workspace to the column, never back,
  and every stop has a visible focus indicator: an outline or a box shadow (WCAG 2.4.3 and
  2.4.7). A second test logs in, reaches a room tab, moves it to the other column with
  Alt+Shift+Arrow (the alternative to dragging), selects it, sends a message from its composer
  with Enter, and logs out, all from the keyboard. A third reorders roles in the admin editor
  with dnd-kit's keyboard sensor (Space, ArrowDown, Space), and then with the Move up button
  (the single-pointer alternative, WCAG 2.5.7). Each step waits for dnd-kit's live announcement,
  which is also what a screen reader hears.
- **Unread counts on room tabs.** A screen reader gets the count as the tab's accessible
  description: "Blue–Red negotiation, tab, 2 unread messages". The tab's name stays the room's
  name. The description goes when the room is read.

## Findings fixed

| Finding | Where | WCAG | Fix |
| --- | --- | --- | --- |
| A room tab's unread count was not exposed. The library names the tab with `aria-label`, which hides its content, and the badge's `aria-label` on a plain `span` is not read anyway. The gap was left by WP 2.5 | `workspace/tabs.tsx` | 1.3.1, 4.1.2 | The badge is `role="img"`, named "N unread messages". While it is shown it points the tab's `aria-describedby` at itself. That one attribute is the only change made to FlexLayout's DOM |
| Feeds held `role="separator"` day dividers. A feed may hold only articles (axe `aria-required-children`, critical) | `chat/message-list.tsx` | 1.3.1 | The divider is drawn as before but hidden from assistive technology. Its day starts the next article's name: "Today, Blue CO, 09:12" |
| FlexLayout's toolbar buttons (pop out, maximise, hidden tabs) were 17 px square (`target-size`) | `workspace/workspace.css` | 2.5.8 | At least 24 px square |
| The hidden-tabs button's visible text, a count, was not in its name "Hidden tabs" (`label-content-name-mismatch`) | `workspace/workspace-core.tsx` | 2.5.3 | The count is drawn by CSS, not as text. The name and the menu still say which tabs are hidden |
| The theme editor's "Use default" button was named "Use the default for Primary" (`label-content-name-mismatch`) | `admin-ui/themes/ThemeEditor.tsx` | 2.5.3 | Named "Use default for Primary" |

No contrast finding: the default theme passes axe on every screen.

## Findings that stay

- **The count is a description, not part of the name.** FlexLayout sets the tab's name and
  offers no description prop, so the count has to be a description. Screen readers read it when
  the tab is focused. A change while the tab is focused is not announced, because a description
  is not a live region. New messages in the room on show are announced through the chat panel's
  polite live region. Arrivals in hidden rooms are not announced, which keeps a busy game from
  talking over the player. Putting the count in the name would need FlexLayout to re-render the
  tab strip on every message, and it would change every tab's name in tests and for speech
  input.
- **The keyboard pass skips WebKit.** WebKit moves Tab between form fields only, as Safari does
  until the user turns on "Press Tab to highlight each item". axe still runs there. In Firefox
  the keyboard-only logout goes back from the composer with Shift+Tab, because Firefox does not
  wrap focus from the page's last stop to its first (`phase-3-browsers.md`).
- **Keyboard tab moves go between columns only.** Alt+Shift+Arrow moves a tab to the
  neighbouring tabset or splits it off at the edge. There is no keyboard way to reorder tabs
  inside a tabset, or to dock a tab into the bottom strip. Pop out, maximise and the hidden-tabs
  menu are reachable buttons.
- **Moving a workspace tab without dragging needs a keyboard (WCAG 2.5.7, open).** 2.5.7 asks for
  a single-pointer alternative to dragging, and the workspace offers only the keyboard move. A
  pointer user who cannot drag can pop a tab out, maximise it or reset the layout, but cannot
  move it to another column. This is an AA failure. It is not fixed here: it needs a tab menu
  ("Move left", "Move right", "Move to the strip") through FlexLayout's context-menu hooks,
  which is more than a targeted fix. The admin editor's lists meet 2.5.7 with their Move
  buttons.
- **Not scanned:** popout windows (the same panels in another window), FlexLayout's overflow and
  context menus while open, the credentials sheet's print view, and themes other than the
  default. A designer's theme is checked for contrast when it is saved (ADM-20), and only warns.
- **Automated checks find only part of WCAG.** No screen reader (NVDA, JAWS, VoiceOver,
  TalkBack) was available here, so names, order and announcements are checked as the
  accessibility tree computes them, not as heard. A manual pass with NVDA and VoiceOver before
  the first exercise is still owed. Reflow at 320 px (1.4.10) and 200% text (1.4.4) are not
  tested here: the narrow layout is FT-1's.
