# Phase 6 accessibility (WP 6.5: NFR-14, WCAG 2.2 AA, the Python API in the browser)

The method is Phase 3's (`phase-3-accessibility.md`): axe-core 4.14.0 through `@axe-core/playwright`, rules WCAG 2.0, 2.1 and 2.2 at A and AA, colour contrast included, no violation allowed, findings excluded only by rule and selector with a reason here (none are). Each scan attaches its result to the test report. Chromium only in this environment; WebKit runs in CI's browser job and was not run here.

## What is scanned

| Screen | Test |
| --- | --- |
| The Scripts panel, empty | `apps/web/e2e/scripts.spec.ts` (WP 6.3) |
| The panel after a run, with the editor, the output and the draft note | `scripts.spec.ts` (WP 6.3) |
| The panel with a failure and its Python traceback | `scripts.spec.ts` (WP 6.3) |
| The delete confirmation | `scripts.spec.ts` (WP 6.3) |
| The publish-without-review confirmation | `apps/web/e2e/scripts-act.spec.ts` (WP 6.4) |
| The proposal's load-into-draft confirmation with its change summary | `scripts-act.spec.ts` (WP 6.4); **`apps/web/e2e/scenarios/sc-12-umpire-runs-python.spec.ts`, both backends** (WP 6.5) |
| **The panel after a run started from the keyboard** | `apps/web/e2e/scripts-a11y.spec.ts` (WP 6.5) |
| **The publish-without-review confirmation opened from the keyboard** | `scripts-a11y.spec.ts` (WP 6.5) |
| **The umpire room with a proposal card, as the White Force** (the card only) | `scripts-a11y.spec.ts` (WP 6.5) |
| **The umpire room with a proposal card, as the admin** ("Load into draft…") | `scripts-a11y.spec.ts` (WP 6.5) |
| **The umpire room after loading a proposal, with its banner** | `scripts-a11y.spec.ts` (WP 6.5) |

Every scan passes with no violation.

## Keyboard (NFR-14)

`scripts-a11y.spec.ts` drives the panel and the umpire room with key presses only, after the login and the choice of the panel's tab (a FlexLayout tab, whose keyboard use is WP 2.5's test). Each step starts from a control the test focuses, as a keyboard user who has tabbed to it, and checks where focus goes.

1. **Create and rename.** "New script", Enter: a new script opens. "Rename…", Enter: the name field takes focus with the name selected; type, Enter: the script is renamed and focus is back on "Rename…". Again, then Escape: the form closes, focus on "Rename…".
2. **Edit.** In the editor, type the script; Tab indents and Shift+Tab dedents (focus stays); Ctrl+S saves (the unsaved mark goes); Escape, then Tab, leaves the editor (no keyboard trap, WCAG 2.1.2) for the next control.
3. **Run.** "Run", Enter: the status line, a polite live region, says the script finished and how long it took; the output is a labelled region.
4. **Delete.** "Delete…", Enter: the confirmation takes focus (its heading); Escape closes it, focus back on "Delete…"; Enter again, Tab to "Delete script", Enter: the script goes and focus moves to "New script", not to the page.
5. **Publish without review** (the admin). The box, Space: it stays clear and the confirmation takes focus; Escape closes it, the box still clear and focused; Space again, Tab to "Turn on", Enter: the box is ticked and focused. Space again turns it off without asking.
6. **A proposal.** In the umpire room, the card's "Load into draft…", Enter: the confirmation takes focus, with the change summary ("Tank Company: health 100% → 40%"); Escape closes it, focus back on the card's button; Enter, Tab to "Load into draft", Enter: the banner says the proposal is the draft, and focus is on the card's button, not the page.

## Findings fixed in WP 6.5

- **A1. Inline forms and confirmations lost focus when they closed** (found by the keyboard test; Medium for keyboard and screen-reader users). The rename form, the delete confirmation, the publish-without-review confirmation and the proposal's load confirmation took focus when they opened (as WP 6.3 and 6.4 built them), but when they closed, by Escape, Cancel or their action, the element holding focus went away and focus fell to the page's body. A keyboard user was back at the top of the page after every rename, and a screen reader announced nothing. Now each gives focus back to the control that opened it if it is still there ("Rename…", "Delete…", the box, the card's "Load into draft…"), else to the panel's first action ("New script", after the last script is deleted), and only when focus would otherwise be lost: the asset form's A1 fix of Phase 5, applied to the scripts and the umpire room. `packages/player-ui/src/scripts/scripts-panel.tsx` (`keepFocusOnClose`), `packages/player-ui/src/umpire/umpire-panel.tsx`; e2e above.

## Findings that stay

- **A2. The editor is a plain text area** (accepted, WP 6.3). No syntax highlighting, so structure is read from indentation alone; undo does not cross the editor's own Tab and Shift+Tab edits. For a screen reader it is a standard multi-line text field, which is its advantage. The caret's line and column are shown, to match a traceback.
- **A3. A run's output is not announced line by line.** The status line is a live region (running, finished, failed, stopped, timed out); the output region is not, so a long-running script's prints are found by moving into the region. Announcing every line would flood a screen reader. Recommendation: none for now; revisit if umpires using screen readers ask.
- **A4. A change while you read.** When another session of a shared login saves, the panel takes the new text within 5 s if there are no unsaved edits, with a polite status only (security review L3). A screen-reader user may not notice that the code changed under the caret. Recommendation: the same visible notice the security review recommends.
- **A5. The panel's tab in the bottom strip** is 260 px high by default; at 200% zoom the editor and output need scrolling. The panel can be dragged beside the rooms or popped out, as the docs say.
- **A6. Not run here:** WebKit (Safari) and any real screen reader. NFR-13 makes Safari a SHOULD; CI's browser job runs the same tests on WebKit.
