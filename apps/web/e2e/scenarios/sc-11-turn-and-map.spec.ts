// SC-11 Admin runs a turn and updates the map (SRD §12). Traces to: ADM-43–46, PLY-55–59, D7, D25.
//
// Planned: WP 5.7 implements this scenario on the mock and ejabberd, once turns (WP 5.4), the
// map room (WP 5.5) and the world-state editor (WP 5.6) exist. Until then it is marked fixme, so
// it is listed as not yet built rather than passing. Steps, from the SRD:
// 1. In turn 1 planning, players chat and view the map room showing the initial world state.
// 2. The admin advances to adjudication; the turn panel updates for everyone, and Blue's and
//    Red's composers are disabled with an explanation.
// 3. The admin moves two Blue assets, reduces a Red asset's health and adds a new Red asset. The
//    map shows unpublished edits, held in this browser.
// 4. The admin advances to turn 2 planning, reviews the change summary, and confirms.
// 5. Blue's and Red's maps update to the new world state; composers re-enable.
// 6. A Red player reloads; the map room loads the latest world state from MAM.
// 7. During turn 2 planning, the admin moves a misplaced Blue asset and uses "Publish world
//    state"; after the change summary, every player sees the correction without a phase change.
import { test } from '@playwright/test'

test.fixme('SC-11: the admin runs a turn and the world state reaches every player (WP 5.7)', () => {
  // Built in WP 5.7.
})
