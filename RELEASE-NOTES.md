# War Rooms X1: release notes

## v1 (release candidate, not yet released)

The product owner's Nov 3, 2026 revision moved a turn model and a map room into v1. Phase 5 built them (gate G5, Nov 4, 2026), so v1 now waits for one check: installing the reference deployment on the real hardware (WP 3.3, NFR-23), which is with the product owner. The install is a deployment step and is not expected to change the code. This page will give the release date once the check is done. Message templates (Phase 4, SRD Annex A) are in this build too, described under "Message templates".

### What v1 does

War Rooms X1 is a browser client for running a wargame over an XMPP server (ejabberd), with no server code of its own.

**For the admin**

- **Design editor.** The game's forces, roles and rooms, who may read or write in each room, themes for the game, forces and rooms, each force's objectives, the welcome page and briefing. An access table shows every role's access to every room before anything is published.
- **Login names.** Each role has a display name and a login name, its account on the server. A login name can be changed until the role is first published; after that it is fixed, and publishing a design that changes it, or gives it to a different role, is refused with the reason and what to do instead. To change a published role's login name, delete the role and add a new one.
- **Publishing.** One action turns the design into accounts, rooms and documents on the server. The plan shows every change beforehand, grouped by kind, and anything that removes something must be ticked. Publishing again changes only what differs; a publish that stops part-way is completed by running it again.
- **Audit and repair.** Compares the live server with the design, rates each difference, and repairs what it can with the same steps a publish uses.
- **Credentials.** Role passwords are generated randomly and listed on a credentials sheet for the admin's session, to print or hand out; they are never stored in the design or exported, and a role's password can be reset from the sheet.
- **Import and export** of the design as one JSON file, without passwords. Files from before entity ids became GUIDs are converted on import.
- **Reset** deletes the game from the server after the game's name is typed; its confirmation offers to discard the world-state draft this browser holds for the game, so it does not apply to the next one.
- **Turns.** The game runs in numbered turns, each a planning then an adjudication phase. Only the admin moves it on, from the turn panel in the game view or the admin backend's header, after a confirmation.
- **The world state.** In the umpire's game view the admin adds, moves (by dragging, or in the form from the keyboard), edits and deletes the map's assets. Edits are a draft held only in that browser, with a banner saying so and a warning if the game was reset since the draft began. The admin publishes the draft with a phase change or at any time with "Publish world state", after a summary of what changes. Each publish sends the whole state as one message of at most 500 KB (about 1,700 typical assets).
- **Objectives** are written by the admin for each force, and during play the admin and White Force roles that are not observers amend any force's objectives from the player client, with a preview; the force sees each edit live, and the newest edit is what it reads. Each force reads its own, and every White Force role reads all of them; White Force observers only read. A role that leaves the White Force, or is deleted, has its edits removed by the next publish.

**For players**

- **Welcome page and login**, then a workspace of room tabs that each player docks, splits and pops out, remembered per browser and per design version.
- **Chat** with messages grouped by sender, date dividers, history that loads as you scroll, unread counts on tabs, and reconnection that fills any gap. Message text is always plain text. Each room's message entry collapses to a slim bar for players who only read, keeping any draft; each room remembers it, and observers start with it collapsed.
- **The out-of-game column**: the turn panel with the turn and phase, announcements from the admin and the player's force panel with its objectives. In narrow windows it becomes a tab of its own.
- **Adjudication.** While the umpires adjudicate, roles outside the White Force cannot post: their message entry pauses with a note, keeping any draft. This is applied by the client, not the server.
- **The map room.** Every game has one, which every role sees: the latest world state from the admin, each asset a MIL-STD-2525/APP-6 symbol over a base map, with its details on selection and a table of every asset for keyboard use. A reload finds the newest state in the room's history; posts from anyone but the admin are ignored.
- **Layouts** reset to the default, with a notice, only on a structural change: a room added or removed, or an existing role's access to a room changing. Renaming, re-ordering, themes, text and roles added or removed keep them.
- **Observers** read their rooms but never post. White Force observers see the rooms assigned to them, or every room when none is.
- **The umpire** is the admin, playing in the White Force: it reads and writes in every room, reads and amends every force's objectives and posts announcements.

**For demonstrations**

- **The mock server** runs the whole game in the browser with no XMPP server, with a demo game, and can be reset, exported and imported.
- **The multi-client view** shows two to four players side by side in one window, each with their own login.

### Message templates (Phase 4)

Rooms can take structured messages: the admin builds forms in the design editor, offers them per room to forces and roles, and players send them as cards. Every client checks each message against its template; a template locks once a published room offers it, and changes go through a copy. See the site's message templates page.

### Supported browsers

Decided in WP 0.4, and on Nov 3, 2026 for Firefox:

| Browser | Support |
| --- | --- |
| Current Google Chrome | Supported (SHALL): every test runs on its engine (Chromium) |
| Current Microsoft Edge | Supported (SHALL): same engine as Chrome |
| Firefox | Not supported (product owner, Nov 3, 2026) |
| Current Safari | Best effort (SHOULD): the tests run on its engine (WebKit) and failures are fixed or recorded |

Known browser issues are under "Known limits".

### Installing

The reference deployment is one container: the official ejabberd 26.09 image, pinned by digest, serving the built client and its secure WebSocket on one HTTPS address. It needs no internet access on the host.

1. On a connected machine, `ops/make-bundle.sh` packs the image, the client, the configuration and the scripts into one bundle with checksums.
2. Get a server certificate from the organisation's CA, or make a small internal CA with `ops/ca/make-internal-ca.sh` and issue one with `ops/ca/issue-server-cert.sh`. Browsers must trust the CA.
3. On the host, `ops/offline-install.sh` checks the bundle, installs it, starts the server, creates the admin account and runs the deployment checks. Running it again with a newer bundle upgrades, after a backup.
4. `ops/backup.sh` and `ops/restore.sh` save and restore everything on the server while it runs.

**The Python runner in the build (after v1; SRD Annex C, WP 6.2).** Builds from Phase 6 on carry the browser runner for Python scripts in `py/` (about 23 MB: Pyodide and the packages the SDK uses), loaded only when a script runs; the script panel that uses it is not in this build yet. For it, the client's Content-Security-Policy, for every role, adds `'wasm-unsafe-eval'` to `script-src` and `blob:` to `worker-src` (`eval` stays refused), and a server must send `.wasm` as `application/wasm`. The reference configuration does both; another host updates its header and MIME types as `deploy/README.md` gives them.

The full guide, with the checklist for the first install on real hardware, is `ops/README.md`. The real-hardware run is still to be done, and the certificate authority is chosen per install: the organisation's own CA or a small internal one, whichever suits each site's security model (product owner, Nov 4, 2026).

### Moving a game from an earlier build

Entity ids became GUIDs and roles gained a separate login name late in Phase 3. A server published by an earlier build is not changed in place. To move a game:

1. export the design from the admin backend;
2. import it: ids are converted to GUIDs, and each role keeps its old id as its login name, so players log in as before;
3. reset the server from the admin backend;
4. publish.

Room history on that server is lost. No game has yet been run for real, so nothing of value is expected to be there. A design file from an earlier build is converted the same way whenever it is imported.

In the browser, the mock's stored demo game from an earlier build is replaced by the demo seed, with a notice, and each player's saved layout falls back to the default once.

### Known limits

- **Pending check:** the real-hardware install (WP 3.3), above.
- **Safari:** dragging room tabs with the mouse is unverified in a real Safari (the automated WebKit tests cannot drag them); moving a tab with the keyboard works.
- **Unread counts** start again at each login.
- **One game per server.**
- **One account per role:** players sharing a role share its login.
- **The world-state draft** is held only in the admin's browser (in its local storage, readable by anyone with that browser profile until it is published or discarded) and is not tied to the admin login; two admin tabs editing it at once overwrite each other's edits. Server-side drafts are post-v1.
- **The map's base tiles** come from a tile server the deployment names, which learns which area each player looks at; without one the map has no background. The demo uses OpenStreetMap's tiles.
- **Adjudication is advisory:** a modified client can still post during it.
- **Map-room flooding:** a modified player client can post enough messages to the map room to hide the latest world state from players who reload; they click "Look further back" to find it, and the next publish ends it. The admin cannot be led into wiping the map.
- **Not in v1** (the design keeps each cheap to add later): structured form rooms, image and asset pickers in templates, fog of war (per-force maps), world-state snapshots and deltas, a game clock, request-for-information workflows, admin-defined default layouts, layouts stored on the server, message export and replay, and an umpire's merged view of every room.
- **Operating the server:** the umpire plays with the server's admin account, so play it on a machine only the umpire uses; `ops/README.md` says what else to look after.
