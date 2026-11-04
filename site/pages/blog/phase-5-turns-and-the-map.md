---
title: 'Phase 5: turns and the map'
date: 2026-11-04
phase: 5
status: gate
---

# Phase 5: turns and the map

On November 3 the product owner moved two things into version 1: a turn model, and a map that shows the state of the world. Phase 5 built both, and with them the White Force's editing of objectives during play. The [turns and the map page](../turns-and-map) describes the features in full; this post is the summary at the gate.

There were no work-in-progress posts during Phase 5, so this post is the whole story of the phase.

## What changed in Phase 5

- **Turns.** A game runs in numbered turns, each a planning phase and then an adjudication phase. Only the admin moves it on, from the turn panel at the top of the out-of-game column or from the admin backend's header, after a confirmation. Every player's turn panel follows at once.
- **Adjudication.** While the umpires adjudicate, roles outside the White Force cannot post: their message entry pauses with a note that says why, and keeps anything already typed. The White Force keeps posting, so umpires can give rulings.
- **The map room.** Every game has one map room, and every role sees it: each force's units and platforms as standard military symbols on a map, with their details on selection, and a table of the same assets for the keyboard. A player who reloads sees the latest state at once.
- **The admin's world-state editor.** In the umpire's game view the admin adds, moves, edits and deletes assets. The edits are a draft kept in that browser, and the map says so. The admin publishes the draft with the next phase change, or at any time to set up the start or correct a mistake, after a summary of exactly what changes.
- **The world state travels with the design.** A design export carries it, so a game moves to another server with its map.
- **Objectives during play.** White Force roles that are not observers amend any force's objectives again, each edit its own, and every reader sees the newest.
- **Room discovery.** Rooms the admin adds during play appear for the players who can see them, without logging in again.
- **Layouts reset less.** A player's arrangement of rooms resets to the default, with a notice, only when a room is added or removed or a role's access to a room changes. Renaming and re-ordering, themes and text never reset it. The owner narrowed this during acceptance (below).

## How it was checked

A new user scenario, SC-11, runs on the in-browser mock and on a real ejabberd server. Blue and Red chat in turn 1 and see the starting map. The admin starts adjudication, and both players' message entries pause with the reason. The admin moves two Blue assets, damages a Red one and adds another, all from the keyboard-friendly form; the map says the edits are unpublished and held in this browser, and the players still see the old state. Starting turn 2 shows the summary of the four changes; once confirmed, both maps show turn 2 and the players can post again. Red reloads and sees the new map straight away. In turn 2 the admin corrects a misplaced Blue unit and publishes on its own, and both players see the correction with no phase change. The scenario where the admin changes the game during play (SC-6) now also renames and re-orders a room while players are online, and their layouts stay as they were.

A map of 600 assets, the size the requirements name, is measured on every run. It draws in under a second on first opening and in about a third of a second when a new state arrives; an edit in the admin's editor shows in under a tenth of a second. A world state is sent as one message of at most 500 KB, which holds about 1,700 typical assets, so 600 fit three times over. The map's libraries load only when the map is first needed.

Every new screen passes the automated WCAG 2.2 AA checks, including the turn change's confirmation with its summary. The editor was driven from the keyboard alone: add an asset, move one by its position, publish. That test found the asset form did not take focus when it opened, and lost it when it closed; both are fixed.

Before this gate, a reviewer read the phase's code again, independently of the people who wrote it. It found one problem rated high, in how a client finds the map's latest state when the map room holds many other messages: a player's modified client could make other players' maps come up empty after a reload. It is mitigated: the map now says the state is further back and finds it on request, and the admin can no longer be misled into publishing an empty map. What remains is with the product owner, with options. Smaller findings were fixed with tests, among them an export that could silently leave out the world state, or recorded with their reasons.

The plan for Phase 5 ran as drawn: eight work packages, none added or split. Acceptance also took on one change of rule from the owner, the narrower definition of a structural change.

## Decided during the phase

The product owner decided, on November 4:

- **The admin publishes the world state whenever they choose**, as well as with phase changes, so the starting state can be set up before play and mistakes fixed live.
- **The map room is fixed to every role**, not edited like other rooms. Per-force maps, for fog of war, are the planned route after version 1.
- **The design export carries the world state**, and an import makes it the admin's draft.
- **The White Force keeps posting during adjudication.**
- **A structural change is only a room added or removed, or a role's access to a room changing.** Re-ordering forces, roles or rooms no longer resets layouts, and moving a role between forces counts only if it changes what the role can see.
- **The certificate authority is chosen per install:** the organisation's own, or a small internal one.

## What is still open

- **The high-rated finding's remainder**, with the product owner.
- **The real-hardware install** of the reference deployment, which is with the product owner. Version 1's release waits only for it.
- **The base map's tile server** is each deployment's choice; without one the map shows the assets on a plain background.

## Next

Gate G5 is the product owner's review of this phase. After it, version 1 is complete but for the hardware install.
