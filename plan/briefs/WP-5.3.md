# WP 5.3 — Design and publishing changes

**SRD ids:** §3 rules 4, 8 and 15; D6, PLY-5, PLY-30, PLY-40, PLY-42, PLY-60, ADM-9, R24, R28 (retires PLY-6 and PLY-41) · **Depends on:** 5.2 · **Blocks:** 5.7 · **Status:** done

## Goal

The Nov 3 revision's changes to publishing and to the player's workspace (SRD §14, Nov 3 and Nov 4 notes): the design version moves only on structural changes, and a structural change resets every online player's layout to the default with a notice, instead of the in-place room reconciliation of WP 2.5; the client finds rooms through the `directory` node alone; and the admin is warned that room names are visible to every role and shown rule 4's two deliberate consequences in the access matrix.

## Acceptance

- **`designVersion` only on structural changes (§3 rule 8):**
  - `targetState` gives the design's structure: forces (id, order, White Force flag), roles (id, force, order, observer flag) and rooms (id, order, participants). The planner compares it with the published documents' structure.
  - A structural change publishes `game-setup` with the next version. Anything else (themes, names, descriptions, the briefing, objectives, templates, room configs) publishes what changed and, when the game setup itself changed, `game-setup` at the version it has. A publish with no game-setup change and no structural change leaves `game-setup` alone.
  - The publish marker is written for every publish that runs steps, at the version the publish leaves, and counts as pending while its version is not below the published one, so an unfinished publish that kept the version is still re-checked.
  - The plan says whether it is structural; the publish view says whether the version moves (and players' layouts reset) or stays.
  - Unit tests in the target and the planner for each kind of change; the publish scenario's versions follow on both backends.
- **Layout reset (PLY-5, PLY-30, PLY-42, R28):**
  - When `designVersion` changes during a session, the workspace resets to the PLY-40 default for the role's current rooms, saves it under the new key, and says so in a toast.
  - Whenever the role's set of rooms changes (rooms gained or lost while a publish is under way, or without a version change), the layout is rebuilt as the default too; the closed-room toast (PLY-30) still names lost rooms. Renamed rooms are relabelled in place.
  - A saved layout whose rooms are not exactly the role's rooms is not restored: the default is used.
  - The in-place reconciliation (`reconcile`, `reconcilePlan`) and the fewest-tabs placement (`addToFewest`, `pickFewest`) go, with their tests. Panels and the narrow-client tab (FT-1) are still put back and taken away in place. A closed popout docks back into the first column.
  - The collapsed composer (PLY-54): a reset returns every room to its default state, keeps what was typed, and the state set after the reset is saved under the new key.
  - Unit tests (model, workspace) and e2e (workspace, SC-6).
- **Read access (§3 rule 15):** `rooms:*`, `game-state` and `directory` are readable by every role and publishable only by the admin, in `targetState`, the mock seed, the audit and its repair; tests in each, and on ejabberd in the publish and audit scenarios.
- **Room discovery (PLY-60):** the store no longer lists nodes. It reads `directory`, subscribes to it, reads every `rooms:<id>` (and `forces:*`, `roles:*`) it names and filters to the role's rooms by rule 4. A room created during a session appears without re-login when the new directory arrives; a removed one goes. A role whose directory is missing sees nothing (fails closed). Tests in the store (unit), the mock, and the publish scenario on ejabberd (a player online through a publish that adds a room).
- **Admin warnings:**
  - the rooms section warns that every role can read every room's name (R24), and the name field repeats it;
  - the access matrix (ADM-9) highlights the two rule 4 consequences, in the cells and in a list above the table: a White Force observer limited to the rooms whose role entries name it, and a per-room `access: read` entry (force or role) that does not apply to a White Force role that is not an observer.
- **SC-6 spec:** step 4 checks the reset with its notice (the Red rooms and the new room in the default columns), the header's "until then" note goes, and the test title's ids match SRD §12's "Traces to" line.
- **Gates:** `pnpm check`, build plus `check:bundle`, `CI=1 pnpm e2e`, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, site build plus `check:site`, screenshots `--repeat`, and on ejabberd the contract, admin-ops, publish and audit suites and the ejabberd Playwright project.

## Owns

`packages/admin-ops` (target, planner, marker, execute; the publish scenario's version numbers and its discovery check), `packages/domain/src/store.ts` (discovery) and its fixtures, `packages/player-ui/src/workspace`, `packages/admin-ui` (access section, rooms section, publish view's version line), `apps/web/e2e/workspace.spec.ts` and `apps/web/e2e/scenarios/sc-6-change-during-play.spec.ts`.

## Consumes

The transport interface (no change). WP 5.2's `game-state` and map room, unchanged. WPs 5.4 (turn panel, composers, admin phase control) and 5.5 (map room panel) run in parallel: their files are left alone, and shared edits (seed, fixtures, e2e counts) are kept to the minimum.

## Notes

- **What counts as structural.** Rule 8 names adding, removing or moving forces, roles or rooms, and changing room participants. "Moving" is read as a role changing force and any change of order (the default layout follows room order). The observer flag and the White Force flag are counted too: they change rooms' effective participants (rule 4) and so the rooms a role sees. Room type and config changes are not.
- **Resets during a publish.** Access is granted, then revoked, then documents and `game-setup` are published last, so a player whose rooms change sees the layout rebuilt as each room comes or goes, and then once more, with the notice, when the version arrives. Each rebuild keeps the room panels mounted, so drafts survive.

## Notes (done)

- **Structure** is `designStructure` in `packages/admin-ops/src/target.ts`, carried as `TargetState.structure`; the planner compares it with the published documents' and sets `PublishPlan.structural`. A text-only change to `game-setup` republishes it at the version it has; drift repairs (a missing turn state, an account, an affiliation) no longer move the version. The publish scenario's versions fell from 6 and 7 to 4 and 5 accordingly.
- **The marker** is written for every publish that runs steps, at `designVersion ?? publishedVersion`, and is pending while not below the published version. A marker whose clear failed after a publish that kept the version now makes the next plan re-check read-only members and republish `game-setup` once.
- **Store.** `listNodes` is no longer called; `refresh()` reconciles and retries failed nodes. The test harness serves a directory derived from its documents unless a test sets one, and `publishDirectory()` notifies a new one.
- **Workspace.** `reconcile`, `reconcilePlan`, `addToFewest` and `pickFewest` are gone; `fitsRooms` and `syncTabs` replace them. `WorkspaceCore` takes `resetKey` (the design version) and `onReset`; `Workspace` shows the "Layout reset" toast. Popped-out rooms are saved under `detached` even without state, so a saved layout with a popout still fits its rooms after a reload.
- **Admin.** `accessHighlights` (in `@wrx/domain`) gives the rule 4 consequences; the access section marks the cells and lists them. The rooms section and its name field carry the R24 warning; the publish view says whether layouts reset.
- **E2E outside the two named specs:** `column.spec.ts` (an objectives-only publish is now one step) and SC-10 (deleting a role resets the layout, so the negotiation tab is selected again after the notice).
