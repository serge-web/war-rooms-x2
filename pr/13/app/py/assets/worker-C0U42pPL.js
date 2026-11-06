const e=/* #__PURE__ */ Object.assign({"../../../python/wrx/__init__.py":`"""wrx: the Python SDK for War Rooms X (SRD Annex C, PD1).

One SDK for umpire reconcilers, analysis and automated players. It is role-scoped (PD2): a
script reads as the role it runs as, through its runner's bridge, and sees only what that role
may see. This is the read layer (PY-2): \`Game\` and its rooms; typed models in \`wrx.models\`
(PY-1); pandas helpers in \`wrx.frames\`, imported only when used (PY-3).

    import wrx

    game = wrx.Game()                      # the runner's bridge
    turn = await game.turn()
    async for message in game.room(room_id).messages():
        ...
    frame = wrx.to_frame(await game.world_state())
"""

from __future__ import annotations

from typing import Any

from . import models
from .bridge import Bridge, PyodideBridge
from .errors import (
    BridgeError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    ProtocolError,
    UnavailableError,
    UnknownOperationError,
)
from .game import Game, RoomReader
from .protocol import PROTOCOL_VERSION

__version__ = "0.1.0"

__all__ = [
    "PROTOCOL_VERSION",
    "Bridge",
    "BridgeError",
    "ForbiddenError",
    "Game",
    "InvalidRequestError",
    "NotFoundError",
    "ProtocolError",
    "PyodideBridge",
    "RoomReader",
    "UnavailableError",
    "UnknownOperationError",
    "models",
    "to_frame",
]


def to_frame(source: Any, kind: Any = None) -> Any:
    """\`wrx.frames.to_frame\`: imports pandas on first use, not with \`import wrx\` (PY-3)."""
    from .frames import to_frame as frame

    return frame(source, kind)
`,"../../../python/wrx/_models/__init__.py":`"""Models generated from docs/json-schema (PY-1). Do not edit: run \`pnpm python:models\`.

Import them from \`wrx.models\`, which names the public ones.
"""

__all__ = [
    "bridge_protocol",
    "chat_message",
    "chat_room_config",
    "force",
    "game_setup",
    "game_state",
    "map_room_config",
    "objectives",
    "role",
    "room",
    "template_message",
    "world_asset",
    "world_state_message",
]
`,"../../../python/wrx/_models/bridge_protocol.py":`# Generated from docs/json-schema/bridge-protocol.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Any, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    RootModel,
    confloat,
    conint,
    constr,
)


class BridgeOp(
    RootModel[
        Literal[
            "readContext",
            "readGameSetup",
            "readTurn",
            "readForces",
            "readRoles",
            "readRooms",
            "readRoomMessages",
            "readWorldState",
            "readObjectives",
        ]
    ]
):
    root: Literal[
        "readContext",
        "readGameSetup",
        "readTurn",
        "readForces",
        "readRoles",
        "readRooms",
        "readRoomMessages",
        "readWorldState",
        "readObjectives",
    ]
    """
    A bridge operation (protocol 1)
    """


class EmptyRequest(BaseModel):
    """
    No parameters: \`{}\`
    """

    model_config = ConfigDict(
        extra="forbid",
    )


class ReadRoomMessagesRequest(BaseModel):
    """
    One page of a room's messages, as the role sees them
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    roomId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    A room the role is in
    """
    limit: conint(ge=1, le=500) | None = 100
    """
    Most messages in this page
    """
    order: Literal["oldest-first", "newest-first"] | None = "oldest-first"
    """
    The page order, and the direction \`cursor\` continues in
    """
    cursor: constr(min_length=1, max_length=512) | None = None
    """
    The previous page's \`cursor\`, to continue; unset, start at the first message
    """


class ReadObjectivesRequest(BaseModel):
    """
    A force's objectives, if the role may read them (§3 rule 14)
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The force whose objectives to read
    """


class Context(BaseModel):
    """
    Who the script runs as: data, not access; the bridge enforces access (PD2, PY-4)
    """

    protocolVersion: Literal[1]
    """
    The protocol version the bridge speaks
    """
    isAdmin: bool
    """
    The script runs as the game admin
    """
    roleId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    )
    """
    The role the script runs as (PD2); null for the admin, who has no role
    """
    forceId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    )
    """
    The role's force; null for the admin
    """


class ThemeTokens(BaseModel):
    """
    Design tokens; an unset token inherits from the game theme, then the default
    """

    primary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    secondary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    background: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    surface: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    text: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    fontFamily: Literal["sans", "serif", "mono"] | None = None
    """
    Bundled font id
    """


class GameState(BaseModel):
    """
    The current turn and phase
    """

    schemaVersion: Literal[1]
    turn: conint(ge=1, le=10000)
    """
    The turn number, from 1
    """
    phase: Literal["planning", "adjudication"]
    """
    Each turn has a planning phase, then an adjudication phase (D7)
    """


class Role(BaseModel):
    """
    A player position; one XMPP account
    """

    schemaVersion: Literal[1]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Role id, a GUID
    """
    loginName: constr(
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64
    )
    """
    Login name: the role's XMPP account name, readable, fixed once published (§3 rule 1, ADM-5)
    """
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Id of the role's force
    """
    isObserver: bool
    """
    Observers read but never post, in all their rooms (D8)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """


class Participant(BaseModel):
    """
    A room participant entry (§3 rule 4)
    """

    kind: Literal["force", "role"]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Force or role id
    """
    access: Literal["write", "read"]
    """
    Read-only entries join as MUC visitors
    """


class MessageSender(BaseModel):
    """
    Who sent a message, from the stanza, never from the body (§3 rule 3)
    """

    isAdmin: bool
    """
    Sent from the admin's real JID
    """
    roleId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    )
    """
    The role whose account sent it; null for the admin or an unknown account
    """
    loginName: (
        constr(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64)
        | None
    )
    """
    The sender's account name (\`admin\` for the admin); null if unknown
    """


class ChatContent(BaseModel):
    text: constr(min_length=1, max_length=8000)
    """
    Plain text; rendered without HTML (PLY-14)
    """


class TemplateContent(BaseModel):
    templateId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The template used
    """
    values: dict[
        constr(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$"),
        constr(max_length=8000) | float | bool,
    ] = Field(..., max_length=100)
    """
    Field values by field name; pickers hold GUIDs, never names (TPL-8)
    """


class WorldAsset(BaseModel):
    """
    A unit or platform on the map, with the fixed fields of v1 (§3 rule 17)
    """

    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The asset GUID; also its key in \`assets\` (§3 rules 1, 16)
    """
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The force that owns the asset
    """
    title: constr(min_length=1, max_length=120)
    """
    Display name, e.g. "1st Armoured Squadron"
    """
    category: constr(min_length=1, max_length=60)
    """
    What kind of asset it is, e.g. "armour" or "frigate"
    """
    sidc: constr(
        pattern=r"^(?:[SGWIOE][PUAFNSHGWMDLJK*-][A-Z*-][APCDXF*-][A-Z0-9*-]{8}[A-Z*-]{3}|[0-9]{20}|[0-9]{30})$"
    )
    """
    MIL-STD-2525/APP-6 symbol identification code (SIDC): 15 letter-based characters (2525C, APP-6 B/C) or 20 or 30 digits (2525D/E, APP-6 D)
    """
    lat: confloat(ge=-90.0, le=90.0)
    """
    Latitude, WGS 84 decimal degrees
    """
    lon: confloat(ge=-180.0, le=180.0)
    """
    Longitude, WGS 84 decimal degrees
    """
    state: constr(min_length=1, max_length=60)
    """
    Its condition in words, e.g. "operational" or "damaged"
    """
    health: confloat(ge=0.0, le=100.0)
    """
    Health, 0 (destroyed) to 100 (full)
    """
    fuel: confloat(ge=0.0, le=100.0)
    """
    Fuel, 0 (empty) to 100 (full)
    """


class Objectives(BaseModel):
    """
    A force's objectives; confidential to that force, the White Force and the admin
    """

    schemaVersion: Literal[1]
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Id of the force these objectives belong to
    """
    markdown: constr(max_length=50000)
    """
    Objectives as Markdown
    """
    updatedAt: AwareDatetime
    """
    When the admin wrote this version, by the admin's clock; display only. The node holds one item, the admin's, replaced on each edit; a live notification replaces the copy fetched at login, whatever this says (§3 rule 14)
    """


class BridgeOkReply(BaseModel):
    """
    A successful reply
    """

    ok: Literal[True]
    value: Any
    """
    The operation's result
    """


class BridgeErrorCode(
    RootModel[
        Literal[
            "unknown-op",
            "invalid-request",
            "forbidden",
            "not-found",
            "unavailable",
            "failed",
        ]
    ]
):
    root: Literal[
        "unknown-op",
        "invalid-request",
        "forbidden",
        "not-found",
        "unavailable",
        "failed",
    ]
    """
    \`unknown-op\`: not an operation of this protocol; \`invalid-request\`: the request failed its schema; \`forbidden\`: the role may not do it (PD2); \`not-found\`: no such room or force for this role; \`unavailable\`: not loaded yet or offline; \`failed\`: anything else
    """


class BridgeRequests(BaseModel):
    """
    Each operation's request, by operation name
    """

    readContext: EmptyRequest
    readGameSetup: EmptyRequest
    readTurn: EmptyRequest
    readForces: EmptyRequest
    readRoles: EmptyRequest
    readRooms: EmptyRequest
    readRoomMessages: ReadRoomMessagesRequest
    readWorldState: EmptyRequest
    readObjectives: ReadObjectivesRequest


class Theme(BaseModel):
    """
    Theme: tokens plus optional logo and icon assets
    """

    tokens: ThemeTokens
    logoAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """
    iconAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """


class ReadTurnResult(BaseModel):
    """
    The current turn and phase (D7)
    """

    state: GameState | None
    """
    The turn and phase; null before the first publish
    """


class Force(BaseModel):
    """
    A side in the game
    """

    schemaVersion: Literal[1]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1)
    """
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    colour: constr(pattern=r"^#[0-9a-fA-F]{6}$")
    """
    Colour for message authors; not a theme token (§3 rule 13)
    """
    iconAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """
    isUmpire: bool
    """
    The umpire flag: this is the White Force, which the admin plays in as umpire; exactly one force has it (ADM-4, D8)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """
    theme: Theme | None = None
    """
    Styles the force panel only (D19)
    """


class ReadRolesResult(BaseModel):
    """
    The game's roles
    """

    roles: list[Role]
    """
    The roles the role can read, in order
    """


class Room(BaseModel):
    """
    A channel: one MUC room plus this config
    """

    schemaVersion: Literal[1]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1)
    """
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    roomType: constr(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64)
    """
    Room type id from the registry (v1: chat and map)
    """
    participants: list[Participant]
    """
    Mixed force and role entries; White Force roles are added implicitly, and a role entry assigns a White Force observer the room (§3 rule 4)
    """
    config: dict[str, Any]
    """
    Type-specific config, validated by the room type (ARC-5)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """
    theme: Theme | None = None
    """
    Styles this room's panel and tab
    """


class ChatMessage(BaseModel):
    """
    A chat room message
    """

    type: Literal["chat"]
    schemaVersion: Literal[1]
    content: ChatContent


class TemplateMessage(BaseModel):
    """
    A templated message
    """

    type: Literal["template"]
    schemaVersion: Literal[1]
    content: TemplateContent


class WorldState(BaseModel):
    """
    The full world state: every asset with its position and status (D25)
    """

    turn: conint(ge=1, le=10000)
    """
    The turn this state belongs to
    """
    assets: dict[
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        ),
        WorldAsset,
    ] = Field(..., max_length=5000)
    """
    Every asset, keyed by its GUID; each key is its asset’s \`id\` (JSON Schema cannot say so: zod and the Python SDK check it)
    """


class ReadWorldStateResult(BaseModel):
    """
    The latest published world state
    """

    state: WorldState | None
    """
    The latest world state from the admin in the map room (D25); null if none
    """
    messageId: constr(min_length=1, max_length=256) | None
    """
    The stanza id of the message that carried it
    """
    sentAt: AwareDatetime | None
    """
    When the admin posted it, server time
    """


class ReadObjectivesResult(BaseModel):
    """
    A force's objectives
    """

    objectives: Objectives | None
    """
    The force's newest objectives (§3 rule 14); null if none
    """


class BridgeErrorReply(BaseModel):
    """
    A refused or failed operation
    """

    ok: Literal[False]
    code: BridgeErrorCode
    error: constr(max_length=2000)
    """
    What went wrong, for the script
    """


class GameSetup(BaseModel):
    """
    Game properties and the game theme
    """

    schemaVersion: Literal[1]
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    description: constr(max_length=1000)
    """
    Short description
    """
    briefing: constr(max_length=20000)
    """
    Public Markdown briefing for the welcome page (PLY-46–48)
    """
    designVersion: conint(ge=1, le=9007199254740991)
    """
    Incremented by a publish that changes the structure: a room added or removed, or the effective access to a room of a role in both designs (§3 rule 8); keys saved layouts (PLY-5)
    """
    theme: Theme
    roomTypeDefaults: dict[
        constr(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64),
        dict[str, Any],
    ]
    """
    Default config per room type, validated by that type (ARC-5)
    """


class ReadForcesResult(BaseModel):
    """
    The game's forces
    """

    forces: list[Force]
    """
    The forces the role can read, in order
    """


class ReadRoomsResult(BaseModel):
    """
    The role's rooms
    """

    rooms: list[Room]
    """
    The rooms the role is in, in order
    """


class WorldStateMessage(BaseModel):
    """
    A world-state message in the map room, posted by the admin only
    """

    type: Literal["world-state"]
    schemaVersion: Literal[1]
    content: WorldState


class BridgeReply(RootModel[BridgeOkReply | BridgeErrorReply]):
    root: BridgeOkReply | BridgeErrorReply
    """
    Every reply, as JSON text
    """


class ReadGameSetupResult(BaseModel):
    """
    The game setup document
    """

    setup: GameSetup


class RoomMessage(BaseModel):
    """
    A message in a room, with its sender and server time
    """

    id: constr(min_length=1, max_length=256)
    """
    The server's stanza id; unique within the room
    """
    roomId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The room it was posted in
    """
    sentAt: AwareDatetime
    """
    Server time
    """
    sender: MessageSender
    body: ChatMessage | TemplateMessage | WorldStateMessage
    """
    The body; messages whose body fails validation are left out, as clients do
    """


class ReadRoomMessagesResult(BaseModel):
    """
    One page of a room's messages
    """

    messages: list[RoomMessage]
    """
    This page, in the requested order
    """
    cursor: constr(min_length=1, max_length=512) | None
    """
    Pass it back for the next page; null when there are no more
    """


class BridgeResults(BaseModel):
    """
    Each operation's result, the \`value\` of its reply, by operation name
    """

    readContext: Context
    readGameSetup: ReadGameSetupResult
    readTurn: ReadTurnResult
    readForces: ReadForcesResult
    readRoles: ReadRolesResult
    readRooms: ReadRoomsResult
    readRoomMessages: ReadRoomMessagesResult
    readWorldState: ReadWorldStateResult
    readObjectives: ReadObjectivesResult


class BridgeProtocol(BaseModel):
    """
    The bridge protocol between the Python SDK and its runner, version 1: a catalogue of its parts, not a message
    """

    protocolVersion: Literal[1]
    op: BridgeOp
    requests: BridgeRequests
    results: BridgeResults
    reply: BridgeReply
`,"../../../python/wrx/_models/chat_message.py":`# Generated from docs/json-schema/chat-message.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, constr


class ChatContent(BaseModel):
    text: constr(min_length=1, max_length=8000)
    """
    Plain text; rendered without HTML (PLY-14)
    """


class ChatMessage(BaseModel):
    """
    A chat room message
    """

    type: Literal["chat"]
    schemaVersion: Literal[1]
    content: ChatContent
`,"../../../python/wrx/_models/chat_room_config.py":`# Generated from docs/json-schema/chat-room-config.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, constr


class TemplateEntry(BaseModel):
    """
    Templates a force or role may use in a room (TD4, TPL-2)
    """

    kind: Literal["force", "role"]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Force or role GUID
    """
    templateIds: list[
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
    ]
    """
    Templates this force or role may use here; a role entry adds to its force’s
    """


class ChatRoomConfig(BaseModel):
    """
    Chat room config: free text and templates
    """

    schemaVersion: Literal[2]
    freeText: bool
    """
    Free text allowed beside templates (TD3)
    """
    templates: list[TemplateEntry]
    """
    Template entries per force or role (TD4)
    """
`,"../../../python/wrx/_models/force.py":`# Generated from docs/json-schema/force.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, conint, constr


class ThemeTokens(BaseModel):
    """
    Design tokens; an unset token inherits from the game theme, then the default
    """

    primary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    secondary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    background: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    surface: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    text: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    fontFamily: Literal["sans", "serif", "mono"] | None = None
    """
    Bundled font id
    """


class Theme(BaseModel):
    """
    Theme: tokens plus optional logo and icon assets
    """

    tokens: ThemeTokens
    logoAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """
    iconAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """


class Force(BaseModel):
    """
    A side in the game
    """

    schemaVersion: Literal[1]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1)
    """
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    colour: constr(pattern=r"^#[0-9a-fA-F]{6}$")
    """
    Colour for message authors; not a theme token (§3 rule 13)
    """
    iconAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """
    isUmpire: bool
    """
    The umpire flag: this is the White Force, which the admin plays in as umpire; exactly one force has it (ADM-4, D8)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """
    theme: Theme | None = None
    """
    Styles the force panel only (D19)
    """
`,"../../../python/wrx/_models/game_setup.py":`# Generated from docs/json-schema/game-setup.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, conint, constr


class ThemeTokens(BaseModel):
    """
    Design tokens; an unset token inherits from the game theme, then the default
    """

    primary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    secondary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    background: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    surface: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    text: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    fontFamily: Literal["sans", "serif", "mono"] | None = None
    """
    Bundled font id
    """


class Theme(BaseModel):
    """
    Theme: tokens plus optional logo and icon assets
    """

    tokens: ThemeTokens
    logoAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """
    iconAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """


class GameSetup(BaseModel):
    """
    Game properties and the game theme
    """

    schemaVersion: Literal[1]
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    description: constr(max_length=1000)
    """
    Short description
    """
    briefing: constr(max_length=20000)
    """
    Public Markdown briefing for the welcome page (PLY-46–48)
    """
    designVersion: conint(ge=1, le=9007199254740991)
    """
    Incremented by a publish that changes the structure: a room added or removed, or the effective access to a room of a role in both designs (§3 rule 8); keys saved layouts (PLY-5)
    """
    theme: Theme
    roomTypeDefaults: dict[
        constr(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64),
        dict[str, Any],
    ]
    """
    Default config per room type, validated by that type (ARC-5)
    """
`,"../../../python/wrx/_models/game_state.py":`# Generated from docs/json-schema/game-state.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, conint


class GameState(BaseModel):
    """
    The current turn and phase
    """

    schemaVersion: Literal[1]
    turn: conint(ge=1, le=10000)
    """
    The turn number, from 1
    """
    phase: Literal["planning", "adjudication"]
    """
    Each turn has a planning phase, then an adjudication phase (D7)
    """
`,"../../../python/wrx/_models/map_room_config.py":`# Generated from docs/json-schema/map-room-config.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, confloat, conint


class LatLon(BaseModel):
    """
    A point, WGS 84 decimal degrees
    """

    lat: confloat(ge=-90.0, le=90.0)
    lon: confloat(ge=-180.0, le=180.0)


class MapRoomConfig(BaseModel):
    """
    Map room config: the opening view
    """

    schemaVersion: Literal[1]
    centre: LatLon | None = None
    """
    Where the map opens; unset, it fits the assets
    """
    zoom: conint(ge=0, le=22) | None = None
    """
    The zoom it opens at; unset, it fits the assets
    """
`,"../../../python/wrx/_models/objectives.py":`# Generated from docs/json-schema/objectives.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, BaseModel, constr


class Objectives(BaseModel):
    """
    A force's objectives; confidential to that force, the White Force and the admin
    """

    schemaVersion: Literal[1]
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Id of the force these objectives belong to
    """
    markdown: constr(max_length=50000)
    """
    Objectives as Markdown
    """
    updatedAt: AwareDatetime
    """
    When the admin wrote this version, by the admin's clock; display only. The node holds one item, the admin's, replaced on each edit; a live notification replaces the copy fetched at login, whatever this says (§3 rule 14)
    """
`,"../../../python/wrx/_models/role.py":`# Generated from docs/json-schema/role.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, conint, constr


class Role(BaseModel):
    """
    A player position; one XMPP account
    """

    schemaVersion: Literal[1]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Role id, a GUID
    """
    loginName: constr(
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64
    )
    """
    Login name: the role's XMPP account name, readable, fixed once published (§3 rule 1, ADM-5)
    """
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Id of the role's force
    """
    isObserver: bool
    """
    Observers read but never post, in all their rooms (D8)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """
`,"../../../python/wrx/_models/room.py":`# Generated from docs/json-schema/room.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, conint, constr


class Participant(BaseModel):
    """
    A room participant entry (§3 rule 4)
    """

    kind: Literal["force", "role"]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Force or role id
    """
    access: Literal["write", "read"]
    """
    Read-only entries join as MUC visitors
    """


class ThemeTokens(BaseModel):
    """
    Design tokens; an unset token inherits from the game theme, then the default
    """

    primary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    secondary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    background: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    surface: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    text: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    fontFamily: Literal["sans", "serif", "mono"] | None = None
    """
    Bundled font id
    """


class Theme(BaseModel):
    """
    Theme: tokens plus optional logo and icon assets
    """

    tokens: ThemeTokens
    logoAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """
    iconAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an \`assets:<id>\` node
    """


class Room(BaseModel):
    """
    A channel: one MUC room plus this config
    """

    schemaVersion: Literal[1]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1)
    """
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    roomType: constr(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64)
    """
    Room type id from the registry (v1: chat and map)
    """
    participants: list[Participant]
    """
    Mixed force and role entries; White Force roles are added implicitly, and a role entry assigns a White Force observer the room (§3 rule 4)
    """
    config: dict[str, Any]
    """
    Type-specific config, validated by the room type (ARC-5)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """
    theme: Theme | None = None
    """
    Styles this room's panel and tab
    """
`,"../../../python/wrx/_models/template_message.py":`# Generated from docs/json-schema/template-message.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, constr


class TemplateContent(BaseModel):
    templateId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The template used
    """
    values: dict[
        constr(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$"),
        constr(max_length=8000) | float | bool,
    ] = Field(..., max_length=100)
    """
    Field values by field name; pickers hold GUIDs, never names (TPL-8)
    """


class TemplateMessage(BaseModel):
    """
    A templated message
    """

    type: Literal["template"]
    schemaVersion: Literal[1]
    content: TemplateContent
`,"../../../python/wrx/_models/world_asset.py":`# Generated from docs/json-schema/world-asset.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from pydantic import BaseModel, confloat, constr


class WorldAsset(BaseModel):
    """
    A unit or platform on the map, with the fixed fields of v1 (§3 rule 17)
    """

    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The asset GUID; also its key in \`assets\` (§3 rules 1, 16)
    """
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The force that owns the asset
    """
    title: constr(min_length=1, max_length=120)
    """
    Display name, e.g. "1st Armoured Squadron"
    """
    category: constr(min_length=1, max_length=60)
    """
    What kind of asset it is, e.g. "armour" or "frigate"
    """
    sidc: constr(
        pattern=r"^(?:[SGWIOE][PUAFNSHGWMDLJK*-][A-Z*-][APCDXF*-][A-Z0-9*-]{8}[A-Z*-]{3}|[0-9]{20}|[0-9]{30})$"
    )
    """
    MIL-STD-2525/APP-6 symbol identification code (SIDC): 15 letter-based characters (2525C, APP-6 B/C) or 20 or 30 digits (2525D/E, APP-6 D)
    """
    lat: confloat(ge=-90.0, le=90.0)
    """
    Latitude, WGS 84 decimal degrees
    """
    lon: confloat(ge=-180.0, le=180.0)
    """
    Longitude, WGS 84 decimal degrees
    """
    state: constr(min_length=1, max_length=60)
    """
    Its condition in words, e.g. "operational" or "damaged"
    """
    health: confloat(ge=0.0, le=100.0)
    """
    Health, 0 (destroyed) to 100 (full)
    """
    fuel: confloat(ge=0.0, le=100.0)
    """
    Fuel, 0 (empty) to 100 (full)
    """
`,"../../../python/wrx/_models/world_state_message.py":`# Generated from docs/json-schema/world-state-message.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run \`pnpm python:models\`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, confloat, conint, constr


class WorldAsset(BaseModel):
    """
    A unit or platform on the map, with the fixed fields of v1 (§3 rule 17)
    """

    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The asset GUID; also its key in \`assets\` (§3 rules 1, 16)
    """
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The force that owns the asset
    """
    title: constr(min_length=1, max_length=120)
    """
    Display name, e.g. "1st Armoured Squadron"
    """
    category: constr(min_length=1, max_length=60)
    """
    What kind of asset it is, e.g. "armour" or "frigate"
    """
    sidc: constr(
        pattern=r"^(?:[SGWIOE][PUAFNSHGWMDLJK*-][A-Z*-][APCDXF*-][A-Z0-9*-]{8}[A-Z*-]{3}|[0-9]{20}|[0-9]{30})$"
    )
    """
    MIL-STD-2525/APP-6 symbol identification code (SIDC): 15 letter-based characters (2525C, APP-6 B/C) or 20 or 30 digits (2525D/E, APP-6 D)
    """
    lat: confloat(ge=-90.0, le=90.0)
    """
    Latitude, WGS 84 decimal degrees
    """
    lon: confloat(ge=-180.0, le=180.0)
    """
    Longitude, WGS 84 decimal degrees
    """
    state: constr(min_length=1, max_length=60)
    """
    Its condition in words, e.g. "operational" or "damaged"
    """
    health: confloat(ge=0.0, le=100.0)
    """
    Health, 0 (destroyed) to 100 (full)
    """
    fuel: confloat(ge=0.0, le=100.0)
    """
    Fuel, 0 (empty) to 100 (full)
    """


class WorldState(BaseModel):
    """
    The full world state: every asset with its position and status (D25)
    """

    turn: conint(ge=1, le=10000)
    """
    The turn this state belongs to
    """
    assets: dict[
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        ),
        WorldAsset,
    ] = Field(..., max_length=5000)
    """
    Every asset, keyed by its GUID; each key is its asset’s \`id\` (JSON Schema cannot say so: zod and the Python SDK check it)
    """


class WorldStateMessage(BaseModel):
    """
    A world-state message in the map room, posted by the admin only
    """

    type: Literal["world-state"]
    schemaVersion: Literal[1]
    content: WorldState
`,"../../../python/wrx/bridge.py":`"""The transport seam (Annex C PD3, PY-4): the SDK talks only to a \`Bridge\`.

A bridge takes an operation name and the request as JSON text, and returns the reply as JSON
text: \`{"ok": true, "value": ...}\` or \`{"ok": false, "code": ..., "error": ...}\`. The browser
runner's bridge (WP 6.2) answers on the page, from the logged-in session, checked against the
role; the native runner's will answer from its own XMPP connection. The SDK holds no access of
its own (PD2): it shows a script only what its bridge returns.
"""

from __future__ import annotations

import abc
import inspect
from collections.abc import Awaitable, Callable


class Bridge(abc.ABC):
    """Where the SDK's operations go. Implement \`call\` to plug in a runner."""

    @abc.abstractmethod
    async def call(self, op: str, payload: str) -> str:
        """Sends one operation with its request as JSON text; returns the reply's JSON text."""


class PyodideBridge(Bridge):
    """The browser runner's bridge: the worker's \`_wrx_bridge.call(op, payload)\` (WP 6.2).

    Only strings cross: the worker never hands Python a proxy of a page object.
    """

    def __init__(self, call: Callable[[str, str], Awaitable[object]] | None = None) -> None:
        if call is None:
            from _wrx_bridge import call as worker_call  # type: ignore[import-not-found]

            call = worker_call
        self._call = call

    async def call(self, op: str, payload: str) -> str:
        reply = self._call(op, payload)
        if inspect.isawaitable(reply):
            reply = await reply
        if not isinstance(reply, str):
            reply = str(reply)
        return reply


def default_bridge() -> Bridge:
    """The bridge of the runner this script is in: today, only the browser runner's."""
    try:
        return PyodideBridge()
    except ImportError:
        raise RuntimeError(
            "No runner bridge here: pass a Bridge to wrx.Game, or run the script in a runner"
        ) from None
`,"../../../python/wrx/errors.py":`"""What the SDK raises when an operation fails."""

from __future__ import annotations


class BridgeError(Exception):
    """The bridge refused or failed an operation. \`code\` is the protocol's error code."""

    code = "failed"

    def __init__(self, op: str, message: str) -> None:
        super().__init__(f"{op}: {message}")
        self.op = op
        self.message = message


class UnknownOperationError(BridgeError):
    """The bridge does not offer this operation (\`unknown-op\`)."""

    code = "unknown-op"


class InvalidRequestError(BridgeError):
    """The request failed the protocol's schema (\`invalid-request\`)."""

    code = "invalid-request"


class ForbiddenError(BridgeError):
    """The role may not do this (\`forbidden\`, PD2)."""

    code = "forbidden"


class NotFoundError(BridgeError):
    """No such room or force for this role (\`not-found\`)."""

    code = "not-found"


class UnavailableError(BridgeError):
    """Not loaded yet, or offline (\`unavailable\`)."""

    code = "unavailable"


class ProtocolError(BridgeError):
    """The bridge's reply broke the protocol: not JSON, the wrong shape, or invalid data.

    Raised by the SDK itself; the bridge never sends this code.
    """

    code = "protocol"


ERRORS: dict[str, type[BridgeError]] = {
    cls.code: cls
    for cls in (
        BridgeError,
        UnknownOperationError,
        InvalidRequestError,
        ForbiddenError,
        NotFoundError,
        UnavailableError,
    )
}
`,"../../../python/wrx/frames.py":`"""Tabular helpers (Annex C PY-3): pandas DataFrames of messages, turns and assets.

pandas is imported only when one of these is called, never by \`import wrx\`, so a script that
does not use them does not pay for it (in the browser runner, pandas is a separate download).
Columns keep the documents' field names.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import TYPE_CHECKING, Any, Literal

from .models import (
    ChatMessage,
    ReadWorldStateResult,
    RoomMessage,
    TemplateMessage,
    WorldState,
    WorldStateMessage,
)

if TYPE_CHECKING:
    import pandas

ASSET_COLUMNS = [
    "id",
    "forceId",
    "title",
    "category",
    "sidc",
    "lat",
    "lon",
    "state",
    "health",
    "fuel",
]
MESSAGE_COLUMNS = [
    "id",
    "roomId",
    "sentAt",
    "senderLogin",
    "senderRoleId",
    "senderIsAdmin",
    "type",
    "text",
    "templateId",
    "values",
    "turn",
]
TURN_COLUMNS = ["turn", "sentAt", "messageId", "assets"]


def _pandas() -> Any:
    try:
        import pandas
    except ImportError as error:
        raise ImportError(
            "wrx's tabular helpers need pandas: \`pip install wrx[pandas]\` "
            "(the browser runner ships it)"
        ) from error
    return pandas


def messages_frame(messages: Iterable[RoomMessage]) -> pandas.DataFrame:
    """One row per message: who sent it and when, its type, and its chat text, template values
    or world-state turn."""
    rows = []
    for m in messages:
        body = m.body
        rows.append(
            {
                "id": m.id,
                "roomId": m.roomId,
                "sentAt": m.sentAt,
                "senderLogin": m.sender.loginName,
                "senderRoleId": m.sender.roleId,
                "senderIsAdmin": m.sender.isAdmin,
                "type": body.type,
                "text": body.content.text if isinstance(body, ChatMessage) else None,
                "templateId": (
                    body.content.templateId if isinstance(body, TemplateMessage) else None
                ),
                "values": (
                    dict(body.content.values) if isinstance(body, TemplateMessage) else None
                ),
                "turn": body.content.turn if isinstance(body, WorldStateMessage) else None,
            }
        )
    pd = _pandas()
    frame = pd.DataFrame(rows, columns=MESSAGE_COLUMNS)
    frame["sentAt"] = pd.to_datetime(frame["sentAt"], utc=True)
    return frame


def _world_state_messages(messages: Iterable[RoomMessage]) -> list[RoomMessage]:
    return [m for m in messages if isinstance(m.body, WorldStateMessage)]


def turns_frame(messages: Iterable[RoomMessage]) -> pandas.DataFrame:
    """One row per published world state (from \`Game.world_states()\`): its turn, when it was
    posted, and how many assets it held. Other messages are skipped."""
    rows = [
        {
            "turn": m.body.content.turn,
            "sentAt": m.sentAt,
            "messageId": m.id,
            "assets": len(m.body.content.assets),
        }
        for m in _world_state_messages(messages)
        if isinstance(m.body, WorldStateMessage)
    ]
    pd = _pandas()
    frame = pd.DataFrame(rows, columns=TURN_COLUMNS)
    frame["sentAt"] = pd.to_datetime(frame["sentAt"], utc=True)
    return frame


def assets_frame(
    source: WorldState | WorldStateMessage | ReadWorldStateResult | Iterable[RoomMessage],
) -> pandas.DataFrame:
    """One row per asset, with the state's \`turn\`. Given world-state messages, one row per asset
    per message, with \`messageId\` and \`sentAt\` too, for following assets across turns."""
    pd = _pandas()
    if isinstance(source, ReadWorldStateResult):
        source = source.state if source.state is not None else WorldState(turn=1, assets={})
    if isinstance(source, WorldStateMessage):
        source = source.content
    if isinstance(source, WorldState):
        rows = [{"turn": source.turn, **a.model_dump()} for a in source.assets.values()]
        return pd.DataFrame(rows, columns=["turn", *ASSET_COLUMNS])
    rows = []
    for m in _world_state_messages(source):
        assert isinstance(m.body, WorldStateMessage)
        state = m.body.content
        for asset in state.assets.values():
            rows.append(
                {"turn": state.turn, "messageId": m.id, "sentAt": m.sentAt, **asset.model_dump()}
            )
    frame = pd.DataFrame(rows, columns=["turn", "messageId", "sentAt", *ASSET_COLUMNS])
    frame["sentAt"] = pd.to_datetime(frame["sentAt"], utc=True)
    return frame


Kind = Literal["messages", "turns", "assets"]


def to_frame(source: Any, kind: Kind | None = None) -> pandas.DataFrame:
    """A DataFrame of \`source\`: a world state (or its message) gives its assets; a list of room
    messages gives one row per message, or with \`kind="turns"\` or \`kind="assets"\`, the turns or
    assets of the world-state messages among them."""
    if isinstance(source, (WorldState, WorldStateMessage, ReadWorldStateResult)):
        if kind not in (None, "assets"):
            raise ValueError(f"a world state gives assets, not {kind}")
        return assets_frame(source)
    if isinstance(source, RoomMessage):
        source = [source]
    messages = list(source)
    if not all(isinstance(m, RoomMessage) for m in messages):
        raise TypeError("to_frame takes a world state or room messages")
    if kind in (None, "messages"):
        return messages_frame(messages)
    if kind == "turns":
        return turns_frame(messages)
    if kind == "assets":
        return assets_frame(messages)
    raise ValueError(f"unknown kind: {kind}")
`,"../../../python/wrx/game.py":`"""The read layer (Annex C PY-2): the game, its turn, forces, roles, rooms, messages, world state
and objectives, as the role the script runs as sees them.

Role-scoped (PD2): every method asks the bridge, and returns exactly what the bridge returns for
the role, validated against the protocol's models. The SDK never widens it: a room the role is
not in is refused by the bridge (\`ForbiddenError\` or \`NotFoundError\`), not hidden by the SDK.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Literal, cast

from . import protocol
from .bridge import Bridge, default_bridge
from .errors import ProtocolError
from .models import (
    Context,
    Force,
    GameSetup,
    GameState,
    Objectives,
    ReadForcesResult,
    ReadGameSetupResult,
    ReadObjectivesRequest,
    ReadObjectivesResult,
    ReadRolesResult,
    ReadRoomMessagesRequest,
    ReadRoomMessagesResult,
    ReadRoomsResult,
    ReadTurnResult,
    ReadWorldStateResult,
    Role,
    Room,
    RoomMessage,
    WorldState,
    WorldStateMessage,
    check_world_state,
)

Order = Literal["oldest-first", "newest-first"]

MAP_ROOM_TYPE = "map"
PAGE_MAX = 500


class Game:
    """The game as the script's role sees it, read through a bridge.

    \`Game()\` uses the runner's bridge (in the browser, the worker's); pass a \`Bridge\` to use
    another, such as a test's fake.
    """

    def __init__(self, bridge: Bridge | None = None) -> None:
        self._bridge = bridge if bridge is not None else default_bridge()
        self._context: Context | None = None

    @property
    def bridge(self) -> Bridge:
        return self._bridge

    async def context(self) -> Context:
        """Who the script runs as: the admin, or a role and its force. Read once, then kept."""
        if self._context is None:
            context = cast(Context, await protocol.call(self._bridge, "readContext"))
            if context.protocolVersion != protocol.PROTOCOL_VERSION:
                raise ProtocolError("readContext", "the bridge speaks another protocol version")
            self._context = context
        return self._context

    async def setup(self) -> GameSetup:
        """The game setup: name, description, briefing and theme."""
        result = cast(ReadGameSetupResult, await protocol.call(self._bridge, "readGameSetup"))
        return result.setup

    async def turn(self) -> GameState | None:
        """The current turn and phase; None before the game's first publish."""
        result = cast(ReadTurnResult, await protocol.call(self._bridge, "readTurn"))
        return result.state

    async def forces(self) -> list[Force]:
        """The forces the role can read, in order."""
        result = cast(ReadForcesResult, await protocol.call(self._bridge, "readForces"))
        return result.forces

    async def roles(self) -> list[Role]:
        """The roles the role can read, in order."""
        result = cast(ReadRolesResult, await protocol.call(self._bridge, "readRoles"))
        return result.roles

    async def rooms(self) -> list[Room]:
        """The rooms the role is in, in order."""
        result = cast(ReadRoomsResult, await protocol.call(self._bridge, "readRooms"))
        return result.rooms

    def room(self, room: Room | str) -> RoomReader:
        """A room's messages, by its document or its id. Nothing is read until you iterate."""
        return RoomReader(self._bridge, room.id if isinstance(room, Room) else room)

    async def map_room(self) -> RoomReader | None:
        """The game's map room (§3 rule 18), if the role is in it."""
        for room in await self.rooms():
            if room.roomType == MAP_ROOM_TYPE:
                return self.room(room)
        return None

    async def world_state(self) -> WorldState | None:
        """The latest world state the admin published in the map room (D25); None if none."""
        return (await self.world_state_record()).state

    async def world_state_record(self) -> ReadWorldStateResult:
        """The latest world state with the id and server time of the message that carried it."""
        result = cast(ReadWorldStateResult, await protocol.call(self._bridge, "readWorldState"))
        if result.state is not None:
            _checked("readWorldState", result.state)
        return result

    async def world_states(self, *, order: Order = "oldest-first") -> AsyncIterator[RoomMessage]:
        """Every world state the admin published, as the map room's world-state messages: the
        game's turn history. Empty if the role is not in the map room."""
        room = await self.map_room()
        if room is None:
            return
        async for message in room.messages(order=order):
            if isinstance(message.body, WorldStateMessage) and message.sender.isAdmin:
                yield message

    async def objectives(self, force: Force | str) -> Objectives | None:
        """A force's newest objectives, if the role may read them (§3 rule 14); None if none."""
        force_id = force.id if isinstance(force, Force) else force
        result = cast(
            ReadObjectivesResult,
            await protocol.call(
                self._bridge, "readObjectives", ReadObjectivesRequest(forceId=force_id)
            ),
        )
        return result.objectives


class RoomReader:
    """One room's messages, read a page at a time through the bridge."""

    def __init__(self, bridge: Bridge, room_id: str) -> None:
        self._bridge = bridge
        self.id = room_id

    def __repr__(self) -> str:
        return f"RoomReader({self.id!r})"

    async def messages(
        self,
        *,
        order: Order = "oldest-first",
        limit: int | None = None,
        page_size: int = 100,
    ) -> AsyncIterator[RoomMessage]:
        """The room's messages as the role sees them, \`async for\` over pages.

        \`order\` is oldest first (the default) or newest first; \`limit\` stops after that many;
        \`page_size\` (1 to 500) is how many each bridge call asks for.
        """
        if not 1 <= page_size <= PAGE_MAX:
            raise ValueError(f"page_size must be 1 to {PAGE_MAX}")
        if limit is not None and limit < 0:
            raise ValueError("limit must not be negative")
        left = limit
        cursor: str | None = None
        seen: set[str] = set()
        while left is None or left > 0:
            size = page_size if left is None else min(page_size, left)
            request = ReadRoomMessagesRequest(roomId=self.id, limit=size, order=order, cursor=cursor)
            page = cast(
                ReadRoomMessagesResult,
                await protocol.call(self._bridge, "readRoomMessages", request),
            )
            if len(page.messages) > size:
                raise ProtocolError("readRoomMessages", "a page longer than asked for")
            for message in page.messages:
                if message.roomId != self.id:
                    raise ProtocolError("readRoomMessages", "a message from another room")
                if isinstance(message.body, WorldStateMessage):
                    _checked("readRoomMessages", message.body.content)
                yield message
            if left is not None:
                left -= len(page.messages)
            if page.cursor is None or not page.messages:
                return
            if page.cursor in seen:
                raise ProtocolError("readRoomMessages", "a cursor came back twice")
            seen.add(page.cursor)
            cursor = page.cursor

    async def history(self, **options: object) -> list[RoomMessage]:
        """All of \`messages(...)\` as a list; takes the same options."""
        return [message async for message in self.messages(**options)]  # type: ignore[arg-type]


def _checked(op: str, state: WorldState) -> WorldState:
    try:
        return check_world_state(state)
    except ValueError as error:
        raise ProtocolError(op, f"invalid world state: {error}") from None
`,"../../../python/wrx/models.py":`"""The SDK's typed models (Annex C PY-1), generated from the JSON Schema export (ARC-6).

The classes come from \`wrx._models\`, generated by \`tools/python/generate_models.py\` from
\`docs/json-schema/\`, so the Python and TypeScript views of a document cannot drift. The read
layer returns the bridge protocol's classes (\`wrx._models.bridge_protocol\`), which hold every
document it reads; each document's own module (\`wrx._models.force\`, ...) generates the same
model, and a test checks that they agree.

Field names are the documents' own (\`forceId\`, \`sentAt\`), as in the data dictionary.

Message bodies are named after their schema files: \`ChatMessage\`, \`TemplateMessage\` and
\`WorldStateMessage\` are bodies; a \`RoomMessage\` carries one with its sender and server time.

One rule JSON Schema cannot state, so the generated models do not check it: each asset in a
world state is keyed by its own \`id\` (§3 rule 16). \`check_world_state\` checks it, and the read
layer applies it to every world state it returns; use \`parse_world_state\` to validate one
yourself.
"""

from __future__ import annotations

from typing import Any

from ._models.bridge_protocol import (
    BridgeErrorReply,
    BridgeOkReply,
    BridgeProtocol,
    BridgeReply,
    ChatContent,
    ChatMessage,
    Context,
    EmptyRequest,
    Force,
    GameSetup,
    GameState,
    MessageSender,
    Objectives,
    Participant,
    ReadForcesResult,
    ReadGameSetupResult,
    ReadObjectivesRequest,
    ReadObjectivesResult,
    ReadRolesResult,
    ReadRoomMessagesRequest,
    ReadRoomMessagesResult,
    ReadRoomsResult,
    ReadTurnResult,
    ReadWorldStateResult,
    Role,
    Room,
    RoomMessage,
    TemplateContent,
    TemplateMessage,
    Theme,
    ThemeTokens,
    WorldAsset,
    WorldState,
    WorldStateMessage,
)
from ._models.chat_room_config import ChatRoomConfig, TemplateEntry
from ._models.map_room_config import LatLon, MapRoomConfig

__all__ = [
    "BridgeErrorReply",
    "BridgeOkReply",
    "BridgeProtocol",
    "BridgeReply",
    "ChatContent",
    "ChatMessage",
    "ChatRoomConfig",
    "Context",
    "EmptyRequest",
    "Force",
    "GameSetup",
    "GameState",
    "LatLon",
    "MapRoomConfig",
    "MessageSender",
    "Objectives",
    "Participant",
    "ReadForcesResult",
    "ReadGameSetupResult",
    "ReadObjectivesRequest",
    "ReadObjectivesResult",
    "ReadRolesResult",
    "ReadRoomMessagesRequest",
    "ReadRoomMessagesResult",
    "ReadRoomsResult",
    "ReadTurnResult",
    "ReadWorldStateResult",
    "Role",
    "Room",
    "RoomMessage",
    "TemplateContent",
    "TemplateEntry",
    "TemplateMessage",
    "Theme",
    "ThemeTokens",
    "WorldAsset",
    "WorldState",
    "WorldStateMessage",
    "check_world_state",
    "parse_world_state",
]


def check_world_state(state: WorldState) -> WorldState:
    """Checks what the generated model cannot: each asset is keyed by its own \`id\`.

    Raises \`ValueError\` naming the first key that is not. The 5,000-asset cap is in the model
    (\`maxProperties\` in the schema).
    """
    for key, asset in state.assets.items():
        if asset.id != key:
            raise ValueError(f"assets.{key}: keyed by {key} but its id is {asset.id}")
    return state


def parse_world_state(data: Any) -> WorldState:
    """Validates a world state (a dict, or JSON text) completely: the model and the key rule."""
    if isinstance(data, (str, bytes)):
        state = WorldState.model_validate_json(data)
    else:
        state = WorldState.model_validate(data)
    return check_world_state(state)
`,"../../../python/wrx/protocol.py":`"""The bridge protocol, version 1 (WP 6.1): operation names and their request and result models.

The protocol is defined once, in zod (\`packages/schemas/src/bridge.ts\`, \`@wrx/schemas/bridge\`),
and exported as \`docs/json-schema/bridge-protocol.schema.json\`; the models here are generated
from that file. \`OPERATIONS\` is the one hand-written part, and \`tests/test_protocol.py\` checks
it against the generated catalogue (\`BridgeProtocol\`): the same operations, version and models.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from .bridge import Bridge
from .errors import ERRORS, BridgeError, ProtocolError
from .models import (
    BridgeErrorReply,
    BridgeReply,
    Context,
    EmptyRequest,
    ReadForcesResult,
    ReadGameSetupResult,
    ReadObjectivesRequest,
    ReadObjectivesResult,
    ReadRolesResult,
    ReadRoomMessagesRequest,
    ReadRoomMessagesResult,
    ReadRoomsResult,
    ReadTurnResult,
    ReadWorldStateResult,
)

PROTOCOL_VERSION = 1


@dataclass(frozen=True)
class Operation:
    request: type[BaseModel]
    result: type[BaseModel]


OPERATIONS: dict[str, Operation] = {
    "readContext": Operation(EmptyRequest, Context),
    "readGameSetup": Operation(EmptyRequest, ReadGameSetupResult),
    "readTurn": Operation(EmptyRequest, ReadTurnResult),
    "readForces": Operation(EmptyRequest, ReadForcesResult),
    "readRoles": Operation(EmptyRequest, ReadRolesResult),
    "readRooms": Operation(EmptyRequest, ReadRoomsResult),
    "readRoomMessages": Operation(ReadRoomMessagesRequest, ReadRoomMessagesResult),
    "readWorldState": Operation(EmptyRequest, ReadWorldStateResult),
    "readObjectives": Operation(ReadObjectivesRequest, ReadObjectivesResult),
}


async def call(bridge: Bridge, op: str, request: BaseModel | None = None) -> BaseModel:
    """Sends one operation and returns its validated result.

    Raises the \`BridgeError\` subclass for the reply's error code, or \`ProtocolError\` when the
    reply is not the protocol's (not JSON, the wrong envelope, or a result that fails its model).
    """
    operation = OPERATIONS.get(op)
    if operation is None:
        raise ValueError(f"not an operation of protocol {PROTOCOL_VERSION}: {op}")
    if request is None and operation.request is EmptyRequest:
        request = EmptyRequest()
    if not isinstance(request, operation.request):
        raise TypeError(f"{op} takes a {operation.request.__name__}")
    text = await bridge.call(op, request.model_dump_json(exclude_none=True))
    try:
        reply = BridgeReply.model_validate_json(text).root
    except ValidationError as error:
        raise ProtocolError(op, f"not a reply: {_first(error)}") from None
    if isinstance(reply, BridgeErrorReply):
        raise ERRORS.get(reply.code.root, BridgeError)(op, reply.error)
    try:
        return operation.result.model_validate(reply.value)
    except ValidationError as error:
        raise ProtocolError(op, f"invalid result: {_first(error)}") from None


def _first(error: ValidationError) -> str:
    issue = error.errors()[0]
    where = ".".join(str(part) for part in issue["loc"])
    return f"{where}: {issue['msg']}" if where else issue["msg"]

`}),t=`/home/pyodide/`,n=Object.freeze([`pydantic`]),r=/\bto_frame\b|\bwrx\.frames\b|\bfrom\s+wrx\s+import\b[^\n]*\bframes\b/,i=/\bwrx(?:_draft)?\b/;function a(n){let r=n.FS,i=Object.entries(e).map(([e,t])=>[e.slice(e.indexOf(`/python/`)+8),t]);if(!i.some(([e])=>e===`wrx/__init__.py`))throw Error(`the SDK is missing`);for(let[e,n]of i)r.mkdirTree(t+e.slice(0,e.lastIndexOf(`/`))),r.writeFile(t+e,n);r.writeFile(`${t}wrx_draft.py`,`"""The browser runner's draft write (WP 6.2), until the SDK's act layer (WP 6.4) replaces it.

Admin only: the world-state draft, held on the page and applied only when the script finishes
cleanly; a run that is stopped, times out or fails leaves the draft as it was (PD7, PD9). The
page checks the state against the world-state schema and the 500 KB cap (PLY-53).

    import wrx, wrx_draft
    state = await wrx.Game().world_state()
    ...
    await wrx_draft.write_draft(state)
"""

import json

from _wrx_bridge import call as _call
from wrx.errors import ERRORS, BridgeError


async def write_draft(state):
    """Writes the draft: a \`wrx.models.WorldState\`, or the same as a plain dict."""
    if hasattr(state, "model_dump"):
        state = state.model_dump(mode="json", exclude_none=True)
    reply = json.loads(await _call("writeDraft", json.dumps(state)))
    if not reply["ok"]:
        raise ERRORS.get(reply.get("code", "failed"), BridgeError)("writeDraft", reply["error"])
    return reply["value"]
`)}const o=performance.now(),s=self.postMessage.bind(self),c=self.fetch.bind(self);function l(e){return(e?._module)?.HEAPU8?.byteLength??0}function u(e){return(t,n)=>{let r=new URL(t instanceof Request?t.url:String(t),e),i=(n?.method??(t instanceof Request?t.method:`GET`)).toUpperCase();return!r.href.startsWith(e)||i!==`GET`||r.search!==``?Promise.reject(/* @__PURE__ */ TypeError(`fetch refused by the script sandbox: ${r.href}`)):c(r.href,{integrity:n?.integrity??``,credentials:`same-origin`})}}const d=Object.freeze([`fetch`,`XMLHttpRequest`,`WebSocket`,`WebSocketStream`,`WebTransport`,`EventSource`,`importScripts`,`indexedDB`,`caches`,`cookieStore`,`BroadcastChannel`,`Worker`,`SharedWorker`,`postMessage`,`MessageChannel`,`FileSystemHandle`,`StorageManager`,`Notification`,`webkitRequestFileSystem`,`webkitResolveLocalFileSystemURL`]),f=Object.freeze([`storage`,`locks`,`serviceWorker`,`usb`,`serial`,`hid`]);function p(e,t){for(let n=e;n!==null;n=Object.getPrototypeOf(n)){let e=Object.getOwnPropertyDescriptor(n,t);e!==void 0&&(e.configurable===!0?Reflect.deleteProperty(n,t):e.writable===!0&&Reflect.set(n,t,void 0))}}function m(e){for(let e of d)p(self,e);for(let e of f)p(navigator,e);Object.defineProperty(self,"fetch",{value:u(e),configurable:!1})}function h(){return Object.freeze(Object.assign(Object.create(null),{setTimeout:(e,t)=>setTimeout(e,t),clearTimeout:e=>{clearTimeout(e)}}))}function g(){let e,t=1,c=/* @__PURE__ */ new Map,u=0,d=!1;function f(e,t){d&&s({kind:`output`,runId:u,stream:e,text:t.slice(0,1e5)})}async function p(n){if(e!==void 0)throw Error(`already initialised`);let{loadPyodide:r}=await import(
/* @vite-ignore */
`${n.indexURL}pyodide.mjs`),i=await r({indexURL:n.indexURL,jsglobals:h(),lockFileURL:`${n.indexURL}pyodide-lock.json`,packageBaseUrl:n.indexURL,stdout:e=>{f(`stdout`,e)},stderr:e=>{f(`stderr`,e)}});e=i;let d=performance.now();n.packages.length>0&&await i.loadPackage([...n.packages],{messageCallback:()=>void 0});let p=performance.now();i.registerJsModule(`_wrx_bridge`,{call:(e,n)=>new Promise(r=>{let i=t++;c.set(i,r),s({kind:`call`,runId:u,callId:i,op:String(e),payload:String(n)})})}),a(i),m(n.indexURL),s({kind:`ready`,timings:{loadPyodide:d-o,loadPackages:p-d,wasmMemory:l(e)}})}async function g(t){let a=e;if(a===void 0||d)return;d=!0,u=t.runId;let o=performance.now(),c=a.toPy({__name__:`__main__`});try{await a.loadPackagesFromImports(t.code,{messageCallback:()=>void 0});let u=[...i.test(t.code)?n:[],...r.test(t.code)?[`pandas`]:[]];u.length>0&&await a.loadPackage(u,{messageCallback:()=>void 0});let d=performance.now()-o;s({kind:`started`,runId:t.runId}),await a.runPythonAsync(t.code,{globals:c}),s({kind:`done`,runId:t.runId,ok:!0,ms:performance.now()-o,importsMs:d,wasmMemory:l(e)})}catch(n){s({kind:`done`,runId:t.runId,ok:!1,error:String(n).slice(-4e3),ms:performance.now()-o,wasmMemory:l(e)})}finally{d=!1,c.destroy()}}self.addEventListener(`message`,e=>{let t=e.data;t.kind===`init`?p(t).catch(e=>{s({kind:`init-failed`,error:String(e).slice(-4e3)})}):t.kind===`run`?g(t):(c.get(t.callId)?.(t.result),c.delete(t.callId))}),s({kind:`hello`})}g();