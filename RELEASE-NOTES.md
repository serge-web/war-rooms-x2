# War Rooms X1: release notes

## v1 (release candidate, not yet released)

The product owner's Nov 3, 2026 revision moved a turn model and a map room into v1, so v1 now waits for Phase 5 (turns and the map) as well as one check: installing the reference deployment on the real hardware (WP 3.3, NFR-23), which is with the product owner. The install is a deployment step and is not expected to change the code. This page will give the release date once the check is done.

### What v1 does

War Rooms X1 is a browser client for running a wargame over an XMPP server (ejabberd), with no server code of its own.

**For the admin**

- **Design editor.** The game's forces, roles and rooms, who may read or write in each room, themes for the game, forces and rooms, each force's objectives, the welcome page and briefing. An access table shows every role's access to every room before anything is published.
- **Login names.** Each role has a display name and a login name, its account on the server. A login name can be changed until the role is first published; after that it is fixed, and publishing a design that changes it, or gives it to a different role, is refused with the reason and what to do instead. To change a published role's login name, delete the role and add a new one.
- **Publishing.** One action turns the design into accounts, rooms and documents on the server. The plan shows every change beforehand, grouped by kind, and anything that removes something must be ticked. Publishing again changes only what differs; a publish that stops part-way is completed by running it again.
- **Audit and repair.** Compares the live server with the design, rates each difference, and repairs what it can with the same steps a publish uses.
- **Credentials.** Role passwords are generated randomly and listed on a credentials sheet for the admin's session, to print or hand out; they are never stored in the design or exported, and a role's password can be reset from the sheet.
- **Import and export** of the design as one JSON file, without passwords. Files from before entity ids became GUIDs are converted on import.
- **Objectives** are written by the admin for each force, and during play the admin and White Force roles that are not observers amend any force's objectives from the player client, with a preview; the force sees each edit live, and the newest edit is what it reads. Each force reads its own, and every White Force role reads all of them; White Force observers only read. A role that leaves the White Force, or is deleted, has its edits removed by the next publish.

**For players**

- **Welcome page and login**, then a workspace of room tabs that each player docks, splits and pops out, remembered per browser and per design version.
- **Chat** with messages grouped by sender, date dividers, history that loads as you scroll, unread counts on tabs, and reconnection that fills any gap. Message text is always plain text. Each room's message entry collapses to a slim bar for players who only read, keeping any draft; each room remembers it, and observers start with it collapsed.
- **The out-of-game column**: announcements from the admin and the player's force panel with its objectives. In narrow windows it becomes a tab of its own.
- **Observers** read their rooms but never post. White Force observers see the rooms assigned to them, or every room when none is.
- **The umpire** is the admin, playing in the White Force: it reads and writes in every room, reads and amends every force's objectives and posts announcements.

**For demonstrations**

- **The mock server** runs the whole game in the browser with no XMPP server, with a demo game, and can be reset, exported and imported.
- **The multi-client view** shows two to four players side by side in one window, each with their own login.

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
- **Not in v1** (the design keeps each cheap to add later): structured form rooms and message templates, a game clock, request-for-information workflows, admin-defined default layouts, layouts stored on the server, message export and replay, and an umpire's merged view of every room.
- **Operating the server:** the umpire plays with the server's admin account, so play it on a machine only the umpire uses; `ops/README.md` says what else to look after.
