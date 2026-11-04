# Background

War Rooms X1 (WRX1) is a browser-based tool for running chat-based wargames. An admin designs a game (its forces, roles, chat rooms, themes and objectives), publishes it, and players then log in as roles and talk in the rooms their role belongs to.

## Where it comes from

WRX1 combines two earlier projects:

- **Serge**, a wargaming platform with a rich domain model of forces, roles and channels;
- **War Rooms X**, which moved messaging onto XMPP, the open standard behind many chat systems.

WRX1 keeps Serge's way of describing a game and War Rooms X's XMPP transport, and fixes the problems that reviews of both found.

## What version 1 does

- **An admin backend** to design one wargame and provision it on the server in one step. Publishing is repeatable: it works out what changed and applies only that.
- **A player client** with a themed welcome page, a dockable workspace of chat rooms and a column with the current turn and phase, announcements, the player's force and its objectives. In a narrow window or multi-client pane the column becomes a tab of its own. Each room's message entry can be collapsed to a slim bar for players who only read, so the messages get the space; each room remembers it, and observers, who cannot post, start with it collapsed. During adjudication the message entry of every role outside the White Force is paused, with a note saying why; anything already typed is kept for the next turn.
- **A mock backend** that runs entirely in the browser, for reviews and demos with no server at all.
- **A multi-client view** that shows two to four independent clients on one page, so a demo can show several players at once.
- **This site**, which explains the project and hosts a live build of every pull request.

Other kinds of room (structured forms, maps, requests for information) and exports are planned for later. Version 1 is built so they can be added without restructuring: every room has a type, and v1 registers just one, `chat`.

## Key decisions

These decisions shape everything else.

### The XMPP server is the only backend

All game data lives in the XMPP server: game metadata in publish-subscribe (PubSub) documents, and messages in multi-user chat (MUC) rooms with their archive. There is no app server and no database. The server is **ejabberd 26.09**, chosen after evaluating three servers against the same checks.

### Access is enforced by the server

Who can read and post where is set by standard XMPP access controls, configured when the admin publishes. There is no custom server code or bot. The admin is the server's own admin account, and admin rights come from the server, not from the client.

### One account per role

Each role is one XMPP account. Several people may log in to the same role at once, for example two officers sharing a desk; the server does not tell them apart.

### Forces, umpires and observers

A game has forces, and each force has roles. One force is the **White Force**, which carries the umpire flag. The admin is its **umpire**: the same login that designs the game plays it, sees every room and can post in each. A role can be an **observer**, who reads its rooms but cannot post. White Force roles that are not observers can post in every room; a White Force observer reads the rooms it is assigned, or every room when it has none. Room participants can be listed by force, by role, or a mix of both.

### Rooms, themes and objectives

The admin designs rooms, and themes for the game, each room and each force: colours, a bundled font, a logo and an icon. The admin writes objectives for each force, which that force and the White Force can read. During play the umpire, and White Force roles that are not observers, can amend them. A themed welcome page is shown before login.

### Live changes

The admin may change a published game while players are online, and changes apply without anyone logging in again.

### Layouts stay in the browser

Players arrange rooms in a dockable workspace, which is saved in their browser. A new browser or device starts with the default layout. The layout survives theme and text edits, but when the admin adds, removes or moves forces, roles or rooms, or changes who is in a room, every player's layout goes back to the default, and they are told.

### Turns, moved on by the admin

A game runs in numbered turns, each a planning phase and then an adjudication phase. Only the admin moves the game on, from the turn panel at the top of the column in the game view or from the admin backend's header, and confirms each change first. Every player's turn panel updates at once.

While the umpires adjudicate, roles outside the White Force cannot post: their message entry is paused, with a note saying why, and anything they had typed is kept until the next turn's planning. The White Force and the admin keep posting. This is a rule the app applies, not the server: a modified client could still post during adjudication, which is accepted in version 1.

### The map, edited by the admin

Every game has one map room, which every role sees. It shows the world state: each force's units and platforms, drawn as standard military symbols, with their position, state, health and fuel. Only the admin changes it. In the umpire's game view the admin adds assets (with a form, or by clicking the map), drags them to new positions, edits any of their details in a form that previews the symbol, and deletes them.

Edits build up as a draft, kept only in the admin's browser until published: the map says so while there are unpublished edits, because clearing that browser's data or changing device loses them. The admin publishes the draft with the next phase change, or at any time with "Publish world state", for example to set up the starting position before play or to correct a mistake. Either way, the admin first sees a summary of what changes (assets added, removed, and changed with the fields that changed) and confirms. Every publish sends the whole world state as one message, and every player's map updates at once. A design export carries the world state too, so a game can be set up again on another server with its map; importing it makes it the admin's draft, which players see only once it is published.

### Offline and air-gapped

The client is a static build with every font, icon and library bundled, and makes no calls to the internet. It can be served next to the XMPP server, from a separate static host, or as plain files with the mock backend.

### A mock that behaves like the server

The mock backend implements the same XMPP-level interface as the real transport, and one contract-test suite runs against both. That is what makes a demo on the mock a fair picture of the real thing. The mock is shared by every tab of the same site, so separate windows can act as separate players.

### TypeScript throughout

All code is strict TypeScript, and the types for every stored document come from the same runtime schemas that validate them. The [data dictionary](./data-dictionary) is generated from those schemas.

## How it is built

WRX1 is built in four phases, each ending in a reviewed gate: foundations; contracts and transports; features; and acceptance. Work packages within a phase run in parallel, each on its own branch, and every pull request gets a live preview listed in the [PR index](./prs). The [blog](./blog/) reports progress, including work that hasn't yet passed its gate.
