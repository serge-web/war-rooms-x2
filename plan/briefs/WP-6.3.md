# WP 6.3 — Script panel and private storage

**SRD ids:** Annex C PD4, PD5, PY-6, PY-7, PY-10 (also PD7, PD9, PY-11, PR1, PR2, ADM-45, ADM-46, NFR-14, PLY-8) · **Depends on:** 6.2 · **Status:** done

## Goal

The admin, in the game view, and each White Force role get a "Scripts" panel: a list of the account's scripts, an editor, Run and Stop with a time limit, and the run's output and errors (PY-6, PY-10). Scripts live in the account's own private storage, so they follow the account, and everyone using a role's login shares them (PD5, PY-7); they export and import as files.

## Acceptance

- **Who gets the panel (PD4, PY-6).** The admin's own game view and every White Force role that is not an observer. Never a player of another force, an observer role (of any force), the anonymous welcome page, or the admin's preview as a role. One rule, `scriptRoleOf(me)` in `@wrx/domain`, decides for the panel and for the runner's bridge.
- **The panel** is a workspace panel (`panel:scripts`, PLY-8): a tab in the strip along the bottom, which can be docked anywhere or popped out like the others. Its code is a lazy chunk; the runner loads with `loadRunner` (`@wrx/py-runner/load`) only when the panel is first shown, and Pyodide starts then (PY-5). `check:bundle` passes: no runner or Pyodide in a start-up chunk; the start-up chunk's growth (the tab and the lazy loader) is measured and recorded.
- **Scripts:** create, rename, duplicate, delete (after a confirmation); a code editor (a labelled monospace textarea: Tab indents, Shift+Tab dedents, Escape then Tab leaves it, so there is no keyboard trap); the caret's line and column; an unsaved-changes marker and Save (Ctrl+S).
- **Run and Stop (PY-10, PD9, S17).** Run runs the editor's text; while it runs the panel says so and Stop is offered; Stop and the time limit terminate the worker and leave the draft unchanged. Each script has a time limit in seconds (the runner's default 30 s, at most 10 minutes). Output shows as it is printed, stdout and stderr told apart, then the status (finished, failed, stopped, timed out) with the time, and a failure's Python traceback.
- **The admin's draft (PD7, PD9, ADM-45, ADM-46).** An admin script writes the world-state draft with `wrx_draft.write_draft`; after a clean run that wrote it, the panel says so and points to "Publish world state…" in the map room, whose change summary shows the change. The panel never publishes.
- **Private storage (PD5, PY-7).** One XEP-0049 key, `wrx-scripts`, per account, through the transport's existing `getPrivate`/`setPrivate` (the vault's and the publish marker's storage), which every account may use for itself. It holds `{format, version, revision, updatedAt, scripts: [{id, name, code, settings: {timeLimitSeconds, autoPublish}, updatedAt}]}`; `autoPublish` is reserved (always false, not acted on until 6.4). A size limit with a clear error (sizes and what to do).
- **Shared by a role's sessions (PD5).** A version check: each write carries the revision it was based on; a write whose base is no longer the stored revision is not made, and the panel says "changed in another session" with Reload and Keep mine. The panel re-reads every few seconds while shown, and takes another session's change at once when it has no unsaved edits.
- **Export and import (PY-7, PR1).** Export writes one JSON bundle of every script (name, code, settings). Import reads such a bundle or `.py` files, validates them, adds them as new scripts (names made unique, `autoPublish` off), and never runs them.
- **Accessibility (NFR-14).** Keyboard operable, every control labelled, live status for the run, axe clean on the panel, the editor, the output and the confirmations.
- **Tests:**
  - unit: the stored form, its parser and size, the operations, the version check over a fake private store, the export and import parsers; `scriptRoleOf`; the panel's state with a fake runner and store (create, rename, duplicate, delete, save, conflict, run, stop);
  - contract (`packages/contract-suite`, mock and ejabberd): a White Force account keeps its scripts key, another account cannot read it, two sessions of the account see each other's writes, and an over-size value is refused `too-large` before it is sent;
  - e2e on the mock (`apps/web/e2e/scripts.spec.ts`): the admin's script reads the world state and moves an asset, and the change summary shows it; a White Force script reads its rooms; Stop and the time limit; a player and an observer have no panel; export and import round trip; a reload keeps the scripts; two sessions of one role see each other's edits; axe.
- **Docs:** `docs/python-sdk.md` (using the panel), the site's umpire page if one fits, release notes; screenshots of the panel if the convention adds them for new UI.
- **Gates:** `pnpm check`, `pnpm check:python`, build and `check:bundle`, `CI=1 pnpm e2e`, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, the site build with `check:site` and `check:blog`, screenshots `--repeat`; on ejabberd the contract suite and the Playwright project, if Docker runs.

## Owns

`packages/player-ui/src/scripts/`, the panel's entry in `workspace/workspace.tsx`; `packages/domain/src/scripts.ts`; `getPrivate`/`setPrivate`'s size cap in both transports and the mock; the contract suite's private-storage checks; `packages/py-runner` (output streams, the time-limit constants, the role rule); `apps/web/e2e/scripts.spec.ts`; the `umpire-scripts` screenshot; `docs/python-sdk.md`, the site's turns-and-map section; the README chart's wp63.

## Consumes

`createRunner`, `loadRunner`, `RunOutcome` (WP 6.2); the bridge protocol (WP 6.1); `useAdminWorldDraft` and the map room's change summary (WP 5.6); the workspace's panels (WP 2.5); `AdminApi.getPrivate`/`setPrivate` (WP 1.2).

## Notes

- **Observer White Force roles get no panel.** PD4 names the White Force roles, but an observer role is read-only (§3, ADM-37): its login is handed out more widely, and 6.4's act layer would be refused to it anyway. Read-only analysis is the one thing it could do; that is left for later, when it can be asked for. The runner refuses an observer too, so the rule is the same in both places.
- **No panel in a preview as a role.** A preview reads through the admin's session, so a script there would run as the admin under the role's name; the preview shows what the role sees, but runs nothing.
- **Why one key.** XEP-0049 cannot list keys, so a key per script would need an index that two sessions could each rewrite; one key keeps every change a single write with one revision.

## Notes (done)

- **Where the code is.**
  - `@wrx/domain/scripts` (`packages/domain/src/scripts.ts`, a subpath export, not in the package index, so its zod schemas stay out of the start-up chunk): the stored form, edits, size, export bundle, import, `loadScripts`/`saveScripts`. `scriptRoleOf` is in `store.ts`, next to `canEditObjectives`, and in the index (a module of its own made the bundler split the start-up chunk in three).
  - `@wrx/player-ui` `scripts/`: `availability.tsx` (`useScriptRole`, `NoScriptsHere`), `lazy.tsx`, and the lazy chunk: `scripts-panel.tsx` (`ScriptsPanelView` over plain props, `ScriptsPanel` over the session), `use-script-library.ts`, `code-editor.tsx`, `runner-host.ts` (`loadPanelRunner`, `writeScriptDraft`). `workspace.tsx` adds `panel:scripts`; `AdminGameView` wraps its previews in `NoScriptsHere`.
  - `@wrx/py-runner`: output messages carry `stream`, `run()` takes `onOutput`; `DEFAULT_RUN_MS`/`MAX_RUN_MS` from `LIMITS.scriptRunDefaultSeconds` (30) and `scriptRunMaxSeconds` (600); `scriptRoleOf` is the domain's, so the runner refuses a White Force observer too.
  - Both transports' `setPrivate` refuse a value over `LIMITS.privateValueBytes` (200,000 bytes, escaped UTF-8) with `too-large`; the reference server would otherwise end the stream at 262,144 bytes.
- **Concurrency rule: a version check.** Each save re-reads the key and writes only if its revision is still the one the edit was based on, as revision + 1; otherwise "Changed in another session" with Reload (take theirs, drop unsaved edits) or Keep my change (apply the refused change to theirs). The panel re-reads every 5 s: with no unsaved edits it takes a newer store silently (a polite status), with unsaved edits it shows the notice once per revision. XEP-0049 has no conditional write, so two saves within one round trip still end last-writer-wins.
- **Export format: one JSON bundle** (`wrx-script-bundle`, version 1: name, code, settings), because it keeps the settings and every script in one file; import also takes `.py` files. Imports are new scripts with unique names and `autoPublish` off.
- **Sizes.** The start-up chunk grows by 1,009 bytes (1,011,774 → 1,012,783; the tab, the role rule and the lazy loader), still one chunk; the stylesheet by 3,143 bytes (the panel's styles load with the page so a popped-out panel has them). The panel's chunk is 26 kB; `py/runner.js` is unchanged at 141 kB.
- **Panel placement.** It starts in the strip along the bottom (260 px high) like the other panels; for room, drag it beside the rooms or pop it out. Confirmations (delete) and rename are inline, as the map editor's, so they work popped out.
- **Run state is the panel's.** The runner lives as long as the panel is mounted; closing the tab's content (or a layout reset that remounts it) disposes the worker and stops a run.
- **Gates** (Nov 6, 2026): `pnpm check` (1,727 unit tests), `pnpm check:python` (66 passed, 2 skipped), build and `check:bundle` (both builds), `CI=1 pnpm e2e` (mock-build all passed, scripts spec 7 tests; py-runner: one of WP 6.2's timing tests failed once in each of two full runs on a loaded machine, a different one each time, and the project passed alone with its own ports), `e2e:mock-host` (18), `e2e:admin-ui` (17), `e2e:theme` (4), the site build with `check:site` and `check:blog`, screenshots `--repeat` (32, identical). On ejabberd 26.09 (compose project `wrx-wp63-aa118`, port 35473, stopped after): the contract suite (105 passed, the new private-storage checks included) and the Playwright `ejabberd` project (17 passed, 1 skipped).

## Weak points

- **No conditional write.** The version check narrows lost updates to one round trip but cannot close it on XEP-0049.
- **A 5 s re-read** costs one private-storage read per open panel every 5 s, and another session's save shows up only then.
- **One key for all of a login's scripts**: 200,000 bytes in all, each save rewrites everything, and a large set costs that much on every save.
- **The editor is a textarea**: no syntax highlighting, no undo across the Tab and Shift+Tab edits.
- **The admin's script replaces the whole draft**, hand edits since the last publish included; the change summary shows what differs from the published state, not from the previous draft.
- **The panel was run on the mock only**; on ejabberd only its storage (the contract suite) ran, not the panel itself.
- **WP 6.2's runner timing tests** (a 3 s time limit that includes the worker's start; the canary port) failed once each under load, as noted above.
