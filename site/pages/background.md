# Background

War Rooms X1 (WRX1) is a browser-based tool for running chat-based wargames. An admin designs a game (its forces, roles, chat rooms, themes and objectives), publishes it, and players then log in as roles and talk in the rooms their role belongs to.

## Where it comes from

WRX1 combines two earlier projects:

- **Serge**, a wargaming platform with a rich domain model of forces, roles and channels;
- **War Rooms X**, which moved messaging onto XMPP, the open standard behind many chat systems.

WRX1 keeps Serge's way of describing a game and War Rooms X's XMPP transport, and fixes the problems that reviews of both found.

## What version 1 does

- **An admin backend** to design one wargame and provision it on the server in one step. Publishing is repeatable: it works out what changed and applies only that.
- **A player client** with a themed welcome page, a dockable workspace of chat rooms and a fixed column for announcements, the player's force and its objectives.
- **A mock backend** that runs entirely in the browser, for reviews and demos with no server at all.
- **A multi-client view** that shows two to four independent clients on one page, so a demo can show several players at once.
- **This site**, which explains the project and hosts a live build of every pull request.

Other kinds of room (structured forms, maps, requests for information), turns and exports are planned for later. Version 1 is built so they can be added without restructuring: every room has a type, and v1 registers just one, `chat`.

## Key decisions

These decisions shape everything else.

### The XMPP server is the only backend

All game data lives in the XMPP server: game metadata in publish-subscribe (PubSub) documents, and messages in multi-user chat (MUC) rooms with their archive. There is no app server and no database. The server is **ejabberd 26.09**, chosen after evaluating three servers against the same checks.

### Access is enforced by the server

Who can read and post where is set by standard XMPP access controls, configured when the admin publishes. There is no custom server code or bot. The admin is the server's own admin account, and admin rights come from the server, not from the client.

### One account per role

Each role is one XMPP account. Several people may log in to the same role at once, for example two officers sharing a desk; the server does not tell them apart.

### Forces, umpires and observers

A game has forces, and each force has roles. One force may be the **umpire** force, whose roles are members of every room. A role can be an **observer**, who reads its rooms but cannot post. Room participants can be listed by force, by role, or a mix of both.

### Rooms, themes and objectives

The admin designs rooms, and themes for the game, each room and each force: colours, a bundled font, a logo and an icon. The admin writes objectives for each force, which that force and the umpires can read. A themed welcome page is shown before login.

### Live changes

The admin may change a published game while players are online, and changes apply without anyone logging in again.

### Layouts stay in the browser

Players arrange rooms in a dockable workspace, which is saved in their browser. A new browser or device starts with the default layout.

### No turns in v1

There is no turn model yet, so permissions don't change during play. A reserved document keeps space for one.

### Offline and air-gapped

The client is a static build with every font, icon and library bundled, and makes no calls to the internet. It can be served next to the XMPP server, from a separate static host, or as plain files with the mock backend.

### A mock that behaves like the server

The mock backend implements the same XMPP-level interface as the real transport, and one contract-test suite runs against both. That is what makes a demo on the mock a fair picture of the real thing. The mock is shared by every tab of the same site, so separate windows can act as separate players.

### TypeScript throughout

All code is strict TypeScript, and the types for every stored document come from the same runtime schemas that validate them. The [data dictionary](./data-dictionary) is generated from those schemas.

## How it is built

WRX1 is built in four phases, each ending in a reviewed gate: foundations; contracts and transports; features; and acceptance. Work packages within a phase run in parallel, each on its own branch, and every pull request gets a live preview listed in the [PR index](./prs). The [blog](./blog/) reports progress, including work that hasn't yet passed its gate.
