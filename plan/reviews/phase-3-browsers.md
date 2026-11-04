# Phase 3 browsers (WP 3.2: NFR-13)

NFR-13 since WP 0.4 (`plan/decisions/target-environment.md`): current Chrome and Edge SHALL be
supported, and Firefox and Safari SHOULD be. Chrome and Edge are both Chromium, so `build-e2e`'s
Chromium run of the whole app e2e suite is the required check. `e2e-browsers` runs the same
suite in Firefox and in WebKit (for Safari). Both jobs are advisory (`continue-on-error`, and
"(advisory)" in their names): their failures show on the run but do not fail it. Locally only
Chromium is installed, so Firefox and WebKit run in CI only, and everything below was read from
CI's logs, traces and page snapshots (PR #7, head `275ed4f`: Firefox 3 failed, 57 passed;
WebKit 8 failed, 49 passed).

## Fixed

All three are in the tests, not the app.

- **The multi-client view's force panel (Firefox and WebKit, `multi.spec.ts`, also SC-7).**
  `paneForce` decided between the out-of-game column and its tab as soon as either showed. While
  the game loads, a narrow pane still shows the column, because the tab needs a mounted
  workspace to hold it; once the workspace mounts the column moves into the tab, closed. The
  Firefox trace shows the check running in that gap: no tab yet (the count query found none, so
  the tab was never clicked), and then `selectOption` waiting 30 s on a select inside the closed
  tab. Chromium is fast enough to mount the workspace first. `paneForce` now waits for the
  pane's room tabs, and retries until the force panel is on screen.
- **Keyboard-only logout (Firefox, `a11y.spec.ts`).** The test reached the header's Log out by
  pressing Tab forward from the composer, which relies on focus wrapping from the page's last
  stop to its first. Chromium wraps; Firefox moves focus into its own controls and stays there
  (the reading-order test in the same file shows Firefox reaching the end of the page). The test
  now goes back with Shift+Tab, which is as much a keyboard path. The keyboard pass still skips
  WebKit (`phase-3-accessibility.md`).
- **"ResizeObserver loop completed with undelivered notifications" (WebKit, `chat.spec.ts`,
  SC-3).** WebKit raises it as a page error when an observer's callback changes the layout it
  observes: the shell switching the column's form, the chat list following its rows. The spec
  delivers the rest in the next frame, so nothing is lost, and Chromium and Firefox do not
  report it. The error watchers skip that message only (`apps/web/e2e/notices.ts`).

## Open

- **A popped-out room shows no messages in Firefox (`workspace.spec.ts`, "a popped-out tab
  docks back").** In the popout window the message list shows "Start of the room's history."
  but its feed is empty, so the rows are there and the virtualiser (TanStack Virtual) renders
  none of them. The same room in the main window, and the popout in Chromium and WebKit, are
  fine. The likely cause is the virtualiser measuring its scroll element in the popout window
  before Firefox has laid it out, and Firefox not then delivering that window's ResizeObserver
  callbacks. Not fixed: it needs a Firefox to debug in, which this environment does not have.
  Workaround for a Firefox user: dock the tab back, or maximise it instead of popping it out.
- **Dragging tabs in WebKit (`workspace.spec.ts` three tests, SC-2, SC-5).** Every test that
  drags a workspace tab with the mouse fails in WebKit only: the tab does not land where it was
  dropped (SC-2: below Blue HQ it ends up beside it; the others: the layout does not change).
  FlexLayout 0.11 uses HTML5 drag and drop, and Playwright's mouse does not drive HTML5 drag
  and drop in its Linux WebKit the way it does in Chromium and Firefox, where the same tests
  pass. The keyboard move (Alt+Shift+Arrow) passes in WebKit. Not checked in a real Safari, so
  this is recorded as unverified rather than as an app bug. In SC-2 every step before the drag
  passed in WebKit.

## How to re-check

The jobs run on every push. To see the failures: the job's log, and the
`playwright-report-firefox` or `playwright-report-webkit` artifact (traces and page snapshots).
