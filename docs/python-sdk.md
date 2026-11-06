# Python SDK (`wrx`)

The Python SDK of SRD Annex C, in [`python/`](../python). This is its read layer (WP 6.1): typed models of the game's documents (PY-1), and reading the game, its turn, forces, roles, rooms, messages, world state and objectives (PY-2), with pandas tables (PY-3). Acting and adjudicating (sending messages, proposing a world state) come in WP 6.4.

- **One SDK** (PD1) for umpire reconcilers, analysis and automated players.
- **Role-scoped** (PD2). A script reads as the role it runs as and sees exactly what its runner's bridge returns for that role. The SDK holds no access of its own: a room the role is not in is refused by the bridge (`ForbiddenError`), not hidden by the SDK.
- **Pure Python.** It needs pydantic 2.12, which the browser runner ships (Pyodide's pydantic 2.12.5). pandas is optional and imported only when a table is made.

## Example

```python
import wrx

game = wrx.Game()  # the runner's bridge; pass a wrx.Bridge to use another

context = await game.context()  # who the script runs as
turn = await game.turn()  # GameState: turn and phase, or None before the first publish
forces = await game.forces()
rooms = await game.rooms()  # the rooms the role is in

async for message in game.room(rooms[0]).messages(order="newest-first", limit=20):
    print(message.sentAt, message.sender.loginName, message.body.type)

state = await game.world_state()  # WorldState, or None
for asset in state.assets.values():
    print(asset.title, asset.lat, asset.lon, asset.health)

objectives = await game.objectives(forces[0])  # Objectives, or None

frame = wrx.to_frame(state)  # pandas, imported here, not by `import wrx`
```

Scripts run in an event loop (the browser runner's is the worker's), so every read is `await`ed.

## API

### `wrx.Game(bridge=None)`

The game as the script's role sees it. Without `bridge`, the runner's own (`wrx.PyodideBridge` in the browser runner); `RuntimeError` if there is none.

| Method | Returns | Operation |
| --- | --- | --- |
| `await context()` | `Context`: `isAdmin`, `roleId`, `forceId`, `protocolVersion`; read once, then kept | `readContext` |
| `await setup()` | `GameSetup`: name, description, briefing, theme | `readGameSetup` |
| `await turn()` | `GameState` (`turn`, `phase`), or `None` before the first publish | `readTurn` |
| `await forces()` | `list[Force]`, in order | `readForces` |
| `await roles()` | `list[Role]`, in order | `readRoles` |
| `await rooms()` | `list[Room]`: the rooms the role is in, in order | `readRooms` |
| `room(room)` | `RoomReader` for a `Room` or a room id; reads nothing yet | |
| `await map_room()` | the map room's `RoomReader`, or `None` if the role is not in it | `readRooms` |
| `await world_state()` | the latest published `WorldState`, or `None` | `readWorldState` |
| `await world_state_record()` | `ReadWorldStateResult`: the state with its `messageId` and `sentAt` | `readWorldState` |
| `world_states(order=...)` | async iterator of the map room's world-state messages from the admin: the turn history | `readRoomMessages` |
| `await objectives(force)` | a force's newest `Objectives` (by `Force` or id), or `None` | `readObjectives` |

### `RoomReader`

| Method | Returns |
| --- | --- |
| `messages(order="oldest-first", limit=None, page_size=100)` | async iterator of `RoomMessage`, a bridge call per page (`page_size` 1 to 500); `order` may be `"newest-first"`; `limit` stops after that many |
| `await history(**options)` | the same as a list |

A `RoomMessage` has `id` (the server's stanza id), `roomId`, `sentAt` (server time, timezone-aware), `sender` (`isAdmin`, `roleId`, `loginName`: from the stanza, never the body) and `body`: a `ChatMessage`, `TemplateMessage` or `WorldStateMessage`.

### Tables: `wrx.to_frame(source, kind=None)`

pandas is imported on the first call (PY-3). Columns keep the documents' field names.

| `source` | `kind` | One row per |
| --- | --- | --- |
| a `WorldState`, `WorldStateMessage` or `ReadWorldStateResult` | `None` or `"assets"` | asset, with `turn` |
| room messages | `None` or `"messages"` | message: `id`, `roomId`, `sentAt`, sender, `type`, `text`, `templateId`, `values`, `turn` |
| room messages | `"turns"` | world-state message: `turn`, `sentAt`, `messageId`, `assets` (the count) |
| room messages | `"assets"` | asset per world-state message, with `turn`, `messageId`, `sentAt` |

`wrx.frames` has the same as `messages_frame`, `turns_frame` and `assets_frame`.

### Models: `wrx.models`

pydantic v2 models generated from the JSON Schema export ([`docs/json-schema/`](json-schema), ARC-6), so the Python and TypeScript views of a document cannot drift (PY-1). They validate on construction (`WorldAsset` refuses `lat` 200) and round-trip with `model_dump(mode="json")`. Field names are the documents' own (`forceId`), as in the [data dictionary](data-dictionary.md).

- Documents: `GameSetup`, `GameState`, `Force`, `Role`, `Room`, `Participant`, `Objectives`, `Theme`; room configs `ChatRoomConfig`, `MapRoomConfig` (validate `room.config` with them).
- World state: `WorldState` (`turn`, `assets` keyed by GUID, at most 5,000), `WorldAsset`.
- Messages: `RoomMessage`, `MessageSender`, and the bodies `ChatMessage`, `TemplateMessage`, `WorldStateMessage` (named after their schema files).
- The protocol's: `Context`, the `Read…Request` and `Read…Result` models, `BridgeReply`.

One rule JSON Schema cannot state, so the models do not check it: each asset is keyed by its own `id` (§3 rule 16). `wrx.models.check_world_state(state)` checks it and `parse_world_state(data)` validates completely; the read layer checks every world state it returns.

### Errors

Every failed operation raises a `wrx.BridgeError`, with `op` and `message`, by the reply's code: `UnknownOperationError`, `InvalidRequestError`, `ForbiddenError` (the role may not, PD2), `NotFoundError`, `UnavailableError`, or `BridgeError` itself for `failed`. `ProtocolError` is the SDK's own: the bridge's reply was not JSON, not the protocol's shape, or carried invalid data.

## The bridge protocol

The SDK talks only to a `wrx.Bridge`: one method, `async call(op: str, payload: str) -> str`. The request goes as JSON text, and the reply comes back as JSON text, `{"ok": true, "value": …}` or `{"ok": false, "code": …, "error": …}`. Only strings cross. The browser runner (WP 6.2) answers on the page, checked against the role; a native runner will plug in the same way. A test plugs in a fake (`python/tests/conftest.py`).

The protocol is versioned and defined once, in zod, in [`packages/schemas/src/bridge.ts`](../packages/schemas/src/bridge.ts), imported as `@wrx/schemas/bridge`. It is exported as [`bridge-protocol.schema.json`](json-schema/bridge-protocol.schema.json), from which the Python models are generated. Version 1, the read layer:

| Operation | Request | Result (`value`) |
| --- | --- | --- |
| `readContext` | `{}` | `{protocolVersion, isAdmin, roleId, forceId}` |
| `readGameSetup` | `{}` | `{setup}` |
| `readTurn` | `{}` | `{state}`: a `game-state` document, or `null` |
| `readForces` | `{}` | `{forces}` |
| `readRoles` | `{}` | `{roles}` |
| `readRooms` | `{}` | `{rooms}`: the role's rooms |
| `readRoomMessages` | `{roomId, limit?, order?, cursor?}`: `limit` 1–500 (default 100), `order` `oldest-first` (default) or `newest-first`, `cursor` from the previous page | `{messages, cursor}`: `cursor` `null` on the last page |
| `readWorldState` | `{}` | `{state, messageId, sentAt}`, each `null` if none |
| `readObjectives` | `{forceId}` | `{objectives}`, or `null` |

Error codes: `unknown-op`, `invalid-request`, `forbidden`, `not-found`, `unavailable`, `failed`. Requests are strict (no other keys) and at most 10,000 characters. A page leaves out messages whose body fails validation, as clients do.

On the answering side, `parseBridgeCall(op, payload)` parses a call as untrusted input (or gives the error reply to send), `bridgeOk(op, value)` checks the result against its schema before replying, and `bridgeError(code, message)` builds an error reply.

## In the browser (WP 6.2)

The browser runner, `@wrx/py-runner` ([`packages/py-runner`](../packages/py-runner)), runs scripts for the admin and White Force roles that are not observers only (PD4) in Pyodide 314.0.7 (CPython 3.14), in a Web Worker:

- **The SDK** is this package: the build bundles `python/wrx/` into the worker, which writes it into Pyodide's file system, so `import wrx` and `wrx.Game()` work with no arguments. pydantic loads with the first script that names `wrx`; pandas when a script imports it or uses `to_frame`. Until WP 6.4 adds writes to the protocol, the admin's draft write is the runner's own module: `await wrx_draft.write_draft(state)`, applied only when the script finishes cleanly (PD9).
- **The bridge** answers protocol 1 on the page from the logged-in session, through one adapter ([`sdk-ops.ts`](../packages/py-runner/src/sdk-ops.ts)) that re-exports `@wrx/schemas/bridge` and adds the role table and `writeDraft`.
- **The sandbox.** Before any script runs, the worker removes the network, storage and messaging globals (`fetch`, `XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `BroadcastChannel`, `importScripts`, `postMessage` and more); `js` holds timers only; and the worker runs under the page's Content-Security-Policy, which refuses `eval`, `new Function` and `import()` from another origin. `apps/web/e2e/py-runner.spec.ts` probes it on every e2e run.
- **The files** are in the build at `py/` (`py/runner.js`, its worker, `py/pyodide/`): the core from the `pyodide` npm package and ten wheels from the Pyodide release, every one checked by sha256 against [`pyodide.lock.json`](../packages/py-runner/pyodide.lock.json). The build fetches the wheels once into `.cache/pyodide/` (CI caches it, keyed on the lock); an air-gapped build sets `WRX_PYODIDE_RELEASE` to an extracted release folder. No micropip: nothing else is installable. After a Pyodide upgrade or a change to the package sets, run `pnpm --filter @wrx/py-runner lock`.
- **Hosting.** The client's policy has `'wasm-unsafe-eval'` in `script-src` and `blob:` in `worker-src` for every role (PR3), never `'unsafe-eval'`, and the server must send `.wasm` as `application/wasm` (`deploy/README.md`).

## The Scripts panel (WP 6.3)

The admin, in the umpire's game view, and every White Force role that is not an observer have a **Scripts** tab in the strip along the bottom of the workspace (PD4, PY-6). Players, observers and the admin's preview of a role have none. Like the other panels it can be dragged beside the rooms or popped out into its own window. Opening it the first time loads the runner and starts Pyodide, which takes a few seconds; nothing of either loads before (PY-5).

- **Scripts** are listed on the left: **New script** starts one from a short example, and **Rename…**, **Duplicate** and **Delete…** (after a confirmation) act on the one open. Edits to the code and the time limit are kept until **Save** (or Ctrl+S); an unsaved script is marked in the list.
- **The editor** is a plain text area: Tab indents and Shift+Tab dedents the line or the selected lines by four spaces; to leave it from the keyboard, press Escape, then Tab. The caret's line and column are shown, to match a traceback's line numbers.
- **Run** runs what is in the editor, saved or not. Output appears as it is printed, with stderr told apart; then the status (finished, failed, stopped, or reached its time limit) and, for a failure, the Python traceback. **Stop** ends the run at once by terminating the worker, and so does the **time limit** (seconds, 30 by default, at most 600; PY-10). One script runs at a time.
- **The admin's draft.** An admin script fills the world-state draft with `await wrx_draft.write_draft(state)`. It lands only when the script finishes cleanly; a run that is stopped, times out or fails leaves the draft as it was (PD9). After a clean run that wrote it, the panel says how many assets differ from the published state and points to the map room, where "Publish world state…" shows the change summary first. Nothing is published by a script (PD7; publishing without review is WP 6.4's, per script, off by default). The script's state replaces the whole draft, including edits made by hand since the last publish.

```python
import wrx
import wrx_draft

game = wrx.Game()
state = await game.world_state()
for asset in state.assets.values():
    if asset.fuel < 50:
        state.assets[asset.id] = asset.model_copy(update={"fuel": 100})
await wrx_draft.write_draft(state)
```

### Where scripts are kept

Scripts are kept in the login's own XEP-0049 private storage, under one key (`wrx-scripts`), so they follow the login from game to game and from browser to browser, and everyone who uses a role's login shares them (PD5). Each script has its name, code, settings (the time limit, and `autoPublish`, reserved for WP 6.4 and always off) and the time it was last saved.

- **Size.** Everything a login keeps is at most 200,000 bytes as stored (XML-escaped UTF-8; `<`, `>` and `&` count four or five bytes). A save over it is refused with the sizes; export first, then shorten or delete scripts.
- **Two sessions of one login.** Every save carries the revision it was based on. If another session saved since, nothing is written and the panel says **Changed in another session**: **Reload** takes what is stored and drops this session's unsaved edits; **Keep my change** applies this session's change to what the other saved. The panel re-reads the scripts every 5 seconds while it is open: with no unsaved edits it takes another session's save at once; with unsaved edits it says so and lets you reload or keep editing. The check is a read just before the write, since XEP-0049 has no conditional write, so two saves within one round trip of each other still end last-writer-wins.

### Export and import

**Export all** saves one JSON file, `scripts-<date>.json`:

```json
{
  "format": "wrx-script-bundle",
  "version": 1,
  "exportedAt": "2026-11-06T10:00:00.000Z",
  "scripts": [{ "name": "Resupply", "code": "import wrx\n…", "settings": { "timeLimitSeconds": 30, "autoPublish": false } }]
}
```

A bundle keeps every script and its settings in one file, which `.py` files cannot. **Import…** reads bundles and `.py` files (a `.py` file is named after the file and gets the default time limit). Every file is validated first and a wrong one is refused with the reason; imported scripts are added as new scripts, with names made unique and `autoPublish` off whatever the file says. Importing never runs anything (PR1): check a script before you run it, since it runs with the login's rights.

## Regenerating and checking

| Command | Does |
| --- | --- |
| `pnpm check:python` | Creates `python/.venv` on first use (Python 3.12 or later; `PYTHON` picks the interpreter) and installs the pinned [`python/requirements-dev.txt`](../python/requirements-dev.txt); then checks that the JSON Schema export, the test fixtures and the generated models are current, and runs pytest |
| `pnpm json-schema` | Rewrites `docs/json-schema/` from the zod schemas |
| `pnpm python:models` | Regenerates `python/wrx/_models/` from `docs/json-schema/` (datamodel-code-generator, in the venv) |
| `pnpm python:fixtures` | Rewrites `python/tests/fixtures/demo-game.json`: the bridge's replies to the admin on the mock's demo seed |

After changing a schema in `packages/schemas`: `pnpm json-schema`, `pnpm dictionary`, `pnpm python:models`, and `pnpm python:fixtures` if the demo seed changed; commit them all. `check:python` is not part of `pnpm check`, so machines without Python still run that; CI runs both.
