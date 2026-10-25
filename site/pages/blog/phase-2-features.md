---
title: 'Phase 2: a game you can design, publish and play'
date: 2026-10-25
phase: 2
status: gate
---

# Phase 2: a game you can design, publish and play

Phase 1 built the plumbing. Phase 2 put screens on it. The demo on the home page is now a working game. An admin designs it, publishes it to the server and runs it as the umpire. Players log in and talk in rooms arranged however they like.

## What there is now

- **The design editor.** The admin builds the game: forces, roles, rooms and who may read or write in each, plus themes and each force's objectives. A live table shows every role's access to every room before anything is published.
- **Publishing.** One button turns the design into accounts, rooms and documents on the server. The plan shows what will change, grouped and collapsed, and steps that remove things need a tick. Publishing again changes only what differs.
- **Audit and repair.** A check compares the live server with the design and offers repairs, so a step that went wrong does not leave access quietly broken.
- **The player's screen.** A welcome page and login, then a workspace of dockable room tabs that each player arranges and the browser remembers. On the right, a column holds announcements from the admin and the player's force panel with its objectives.
- **Chat.** Messages are grouped by sender with date dividers, long histories load as you scroll, and unread counts show on the tabs. Message text is always shown as plain text.
- **The umpire.** The admin plays as umpire in the White Force: it sees and writes in every room and can amend any force's objectives live. White Force observers can read but never post.
- **The multi-client view.** Two to four players side by side in one window, each with their own login, so one person can demonstrate a whole game. The demo database can be reset, exported and imported.

## How it was checked

Every feature has browser tests that run on each change, and anything that touches access is also tested against a real ejabberd server. Before this gate, a reviewer read the access and publishing code. That review found problems, including a case where changing a role to read only could leave it able to post if a later step failed. All of them are fixed and covered by tests. The screenshots on each pull request are checked to come out identical on a second run, so a change in a picture means a change in the app.

## Limits

- Only Chromium is tested. Firefox and Safari come in Phase 3, along with performance at scale and a full accessibility audit.
- In narrow panes, such as the multi-client view on a small screen, the out-of-game column takes too much room. It will become a tab of its own when space is short.
- Unread counts start again at each login.

## Next

Phase 3 runs the full end-to-end scenarios on both backends, measures performance and accessibility, installs the reference deployment on real hardware, and ends with the v1 release.
