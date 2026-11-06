---
title: 'Phase 6: the Python API'
date: 2026-11-06
phase: 6
status: gate
---

# Phase 6: the Python API

On November 5 the product owner asked for a Python API, so that scripts can take part in a game: umpire tools that work out the next world state, analysis of messages and turns, and later automated players. A spike, S17, showed the next day that Python can run inside the browser, offline and under the client's security policy. Phase 6 built the browser runner on it, for the umpire team only. The [umpires page](../umpires) and [scripting for umpires](../scripting) describe the features in full; this post is the summary at the gate.

There were no work-in-progress posts during Phase 6, so this post is the whole story of the phase.

## What changed in Phase 6

- **A Python SDK.** One package, `wrx`, with typed models generated from the same schemas the client uses, so the two cannot drift. A script reads the game as its role does (the turn, forces, roles, rooms and their messages, the world state and objectives) with pandas tables when wanted, sends messages, and reacts to new messages and turn changes.
- **Python in the browser.** The interpreter and its packages ship with the app and load only when an umpire first opens the Scripts panel; nobody else's page loads them. Scripts run in a locked-down background worker that reaches the game only through a narrow bridge, which checks every call against the role.
- **The Scripts panel.** The admin and the White Force's roles that are not observers have a Scripts tab: their scripts, kept with the login on the server, an editor, Run and Stop with a time limit, and the output and errors. Scripts export and import as files; importing never runs them.
- **The umpires room.** Every game has one, fixed like the map room, for the admin and the White Force only. White Force scripts post proposed world states there, and the admin loads one into the draft after a summary of what it changes.
- **The admin's scripts and the draft.** An admin script changes the world-state draft on top of the admin's hand edits, and only when it finishes cleanly. Nothing reaches players until the admin publishes, unless the admin turns on publishing without review for a particular script, after a warning; each such publish is recorded.

## How it was checked

A new user scenario, SC-12, runs on the in-browser mock and on a real ejabberd server. White Cell, a White Force role, runs a script that marks a Red tank company damaged and posts the result to the umpires room. The admin opens the proposal's card, reads the change summary and loads it into the draft. The admin moves a Blue unit by hand, then runs a script that refuels the tank company: the script's change lands on top, and the hand edit stays. The admin reviews the summary, which lists all three changes, and publishes. Blue's map, open throughout, updates without a reload, and Blue never sees a Scripts tab or the umpires room.

Performance is measured on every run. Python is ready about two seconds after the panel first opens; the first script that uses the SDK takes about a second more, and the first pandas table about three seconds more; after that, runs start at once. A script that reads a 600-asset world state, changes every asset and writes the draft takes under a tenth of a second. The app's start-up code grew by about 1% over the phase, for the umpires room and its proposals, which every umpire's client reads; the Python runner itself adds nothing to it.

Every new screen passes the automated WCAG 2.2 AA checks, including the umpires room and its proposal cards. The panel and the umpires room were driven from the keyboard alone: create, rename, edit, save, run and delete a script, turn publishing without review on and off, and load a proposal. That test found that the panel's inline forms and confirmations lost keyboard focus when they closed; all of them now give it back.

Before this gate, a reviewer read the phase's code again, adversarially, independently of the work packages that built it. Nothing was rated high. One finding of medium rating was fixed: a script could take a world state hidden behind many other map-room messages for an empty map, and publishing without review did not check for it. A smaller one was fixed too. Three medium findings about how far one script's mistakes can reach are with the product owner, with options and recommendations.

The plan for Phase 6 ran as drawn: five work packages after the spike, none added or split.

## Decided during the phase

The product owner decided, on November 6:

- **One security policy for every role's client**, including the setting Python needs, rather than a separate policy for the umpires.
- **Pull request previews carry Python only when the pull request changes it**, to keep the site small; the main site's demo always has it.
- **The app's start-up code may grow with new features**, as it did by about 1% here; the Python runner itself must stay out of it.

## What is still open

- **The three review findings** about runs sharing one Python session, a limit on how much a run may send, and what publishing without review includes, with the product owner.
- **A native runner**, for scripts and automated players that run without a browser tab, waits until automated players have been discussed.
- **The real-hardware install** of the reference deployment, with the product owner. Version 1's release waits only for it.

## Next

Gate G6 is the product owner's review of this phase.
