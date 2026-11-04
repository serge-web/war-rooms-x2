# WP 5.4 — Turns: phase control, the turn panel, composers paused in adjudication

**SRD ids:** D7, ADM-43, PLY-55, PLY-56, R27 (also PLY-36, PLY-54, PLY-12, PLY-33, NFR-14) · **Depends on:** 5.2 · **Blocks:** 5.6 · **Status:** done

## Goal

The game moves through numbered turns, each a planning phase then an adjudication phase, and only the admin moves it on (D7, ADM-43). Every role sees the turn and phase at the top of the out-of-game column, live (PLY-55, PLY-36). During adjudication the composers of roles outside the White Force are disabled with an explanation; the White Force's non-observers and the admin keep posting (PLY-56, §14 Nov 3 and Nov 4). The rule is advisory: it lives in the client and the store, and the server does not enforce it (R27).

## Acceptance

- **Turn rules (`@wrx/domain`, `turns.ts`, pure):**
  - `nextGameState(state)`: planning goes to adjudication in the same turn; adjudication goes to planning of the next turn. At the last turn (`LIMITS.turnMax`) adjudication has no next.
  - `postingPaused(me, state)`: true during adjudication for a session outside the White Force. The admin (the umpire) and White Force roles are never paused; White Force observers stay read-only as before (PLY-12).
  - `phaseLabel(phase)`: the words the UI shows.
- **Phase control (ADM-43), the store:** `advancePhase({from})` for the admin only, refused for any role before anything is sent. It publishes `nextGameState(from)` to `game-state`, item `current`, as the planner does. `from` is the state the admin confirmed advancing from: if `game-state` holds anything else (another admin tab advanced it first) it is refused as `stale` and nothing is sent; with no turn state yet it is `not-found`. It resolves with `{from, to}`.
  - **The hook for WP 5.6:** `AdvancePhaseOptions` is an object so WP 5.6 can add "publish this world state with the change" (`worldState?: {roomId, state}`, sent with `sendWorldState` before `game-state` moves) without changing callers. The confirm dialog takes extra content (`confirmDetails`) for its change summary.
- **Advisory send guard (PLY-56, R27):** `sendMessage` and `sendTemplateMessage` refuse with the new code `paused` while `postingPaused` holds for the store's own session, before anything is sent, and keep the text or values as any refusal does (PLY-33). The server still accepts such a post from a modified client (R27).
- **Hooks:** `usePostingPaused()` reads `useMe()` and `useGameState()`, so the admin's preview as a role (ADM-30) shows that role's paused composers.
- **Turn panel (PLY-55, PLY-36):** replaces the reserved "Game time" area at the top of the out-of-game column, so it shows in the wide column and in the narrow-window tab (FT-1) alike.
  - "Turn N" and the phase, from `game-state`, updating live and announced politely; a line saying what the phase means for this role (in adjudication: posting is paused for you, or only the White Force posts). Before a first publish: "No turn yet"; a read error says so.
  - For the admin's own view only (not a preview, not a player): a button to start the next phase ("Start adjudication", "Start turn N+1"), behind a confirm dialog that names the change and what players will see. A refusal is shown in the panel; a stale state says the turn has moved on.
- **Admin backend:** the same control, compact, in the backend's header (an optional `headerItems` slot on `AdminApp`), so the admin can move the turn without switching to the game view.
- **Composers (PLY-56, PLY-54, Annex A):** the chat panel's composer is disabled with "The game is in adjudication…" for a paused role, after the existing read-only reasons (observer, read-only, not joined). It works with the collapsible composer (the collapsed bar says posting is paused) and with templated rooms (the template form is disabled the same way). A draft, form values or a refused post survive the change and are sendable again at the next planning phase: the composer stays mounted, and its text is kept read-only while paused.
- **Tests:**
  - unit: turn rules; the store's `advancePhase` (admin only, stale, not-found, last turn, the item published) and the send guard (paused, White Force and admin not paused, text kept); the turn panel core and wired (live, admin control and confirm, stale refusal); the chat panel paused with free text and templates, draft kept, collapsed note.
  - e2e on both backends (`scenarios/turns.spec.ts`, mock-build and ejabberd projects): the umpire advances to adjudication; Blue's turn panel updates, its composer is disabled with the explanation and its draft kept; White Cell still posts; axe on the turn panel and on the disabled composer; the narrow-window tab shows the turn panel; the admin advances to turn 2 planning and Blue's draft sends. The existing column test checks the turn panel in place of the reserved area.
  - screenshot: the player's column in adjudication.
- **Docs:** `site/pages/background.md` (the column, the composer and the "No turns in v1" decision).
- **Gates:** `pnpm check`, build plus `check:bundle`, `CI=1 pnpm e2e`, `e2e:mock-host`, `e2e:admin-ui`, `e2e:theme`, site build plus `check:site`, screenshots `--repeat`, and on ejabberd the contract and publish suites and the ejabberd Playwright project.

## Owns

`packages/domain/src/turns.ts` and its tests, the store's `advancePhase` and send guard, `usePostingPaused`, `packages/player-ui/src/column/turn-panel.tsx`, the chat panel's paused composer, `apps/web/e2e/scenarios/turns.spec.ts`, the column screenshot.

## Consumes

`gameStateSchema`, `INITIAL_GAME_STATE`, `SINGLETON_NODES.gameState`, the store's `gameState()` and `useGameState()` (WP 5.2), the provisioning of `game-state` (admin-ops, mock seed: unchanged). WPs 5.3 and 5.5 run in parallel: no changes to admin-ops, the mock seed, the map panel or the publish section.

## Notes

- **Advisory, as D7 and R27 say.** Nothing on the server changes: `game-state` is already readable by every role and published by the admin only (WP 5.2). A modified client still posts in adjudication; the SRD accepts it (R27, §8 backlog: server-enforced phase permissions).
- **Who is paused** is "outside the White Force" (PLY-56, confirmed Nov 4). White Force observers were already read-only (PLY-12); their explanation stays the observer one.
- **No double advance.** Two admin tabs that confirm the same change: the second is refused as stale once the first change has reached it. Two confirmations at the same instant can still both publish (no compare-and-set on PubSub); the result is one phase further than meant, which the admin sees at once and can live with in v1.
- **The admin's preview** shows the role's paused composer, since a preview shows exactly what the role sees (ADM-30); the advance control is not offered there.

## Notes (done)

- **The hook for WP 5.6.** `SessionStore.advancePhase(options: AdvancePhaseOptions)` in `packages/domain/src/store.ts`: 5.6 adds an optional `worldState` to `AdvancePhaseOptions` and sends it with `sendWorldState` where the comment marks it, before `game-state` is published, refusing the phase change if the world state is refused. The UI side is `TurnPanelCore`'s `confirmDetails` slot (the confirmation's body, for the change summary), passed through `TurnPanel`; the confirm button already waits on `onAdvance`, so a longer publish shows as busy.
- **New error codes.** `DomainErrorCode` gains `paused` (a post refused in adjudication) and `stale` (a phase change from a state the game has left). The switches over it in `player-ui` say each in words.
- **A missing `game-state` node** reads as "No turn yet", not as an error: it is what a server holds before the first publish.
- **The admin backend's control** sits in its header through a new optional `headerItems` slot on `AdminApp`; the app's admin seam passes `<TurnPanel variant="bar" />`.
- **Found by axe:** a disabled template form whose fields overflow could not be scrolled from the keyboard, since its fields cannot take focus. The form's fieldset now takes focus while disabled (`templates/theme.tsx`), with a focus ring. Observers did not meet it before, because their composers start collapsed.
- **Not built:** a server-side check (R27, accepted); a separate announcement of the phase change (the turn panel's status is a polite live region instead).
