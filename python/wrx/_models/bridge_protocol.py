# Generated from docs/json-schema/bridge-protocol.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

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
            "sendMessage",
            "sendTemplate",
            "readDraft",
            "writeDraft",
            "postProposal",
            "subscribeMessages",
            "subscribePhase",
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
        "sendMessage",
        "sendTemplate",
        "readDraft",
        "writeDraft",
        "postProposal",
        "subscribeMessages",
        "subscribePhase",
    ]
    """
    A bridge operation (protocol 2)
    """


class EmptyRequest(BaseModel):
    """
    No parameters: `{}`
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
    The page order, and the direction `cursor` continues in
    """
    cursor: constr(min_length=1, max_length=512) | None = None
    """
    The previous page's `cursor`, to continue; unset, start at the first message
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


class SendMessageRequest(BaseModel):
    """
    A chat message, sent as the role (PD2)
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    roomId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    A room the role can write in
    """
    text: constr(min_length=1, max_length=8000)
    """
    Plain text (PLY-14)
    """


class SendTemplateRequest(BaseModel):
    """
    A templated message (TPL-3), checked as the composer checks it before it is sent (TPL-6)
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    roomId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    A room the role can write in that offers the template
    """
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
    The asset GUID; also its key in `assets` (§3 rules 1, 16)
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
    Every asset, keyed by its GUID; each key is its asset’s `id` (JSON Schema cannot say so: zod and the Python SDK check it)
    """


class PostProposalRequest(BaseModel):
    """
    A world state proposed to the admin in the umpire room (PD6, PY-8)
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    state: WorldState
    """
    The proposed world state, in full (D25)
    """
    summary: constr(min_length=1, max_length=2000)
    """
    What the proposal changes, in words, for the admin; plain text
    """


class SubscribeMessagesRequest(BaseModel):
    """
    Events for each new message in the room, while the run lasts
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


class Context(BaseModel):
    """
    Who the script runs as: data, not access; the bridge enforces access (PD2, PY-4)
    """

    protocolVersion: Literal[2]
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
    The sender's account name (`admin` for the admin); null if unknown
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


class WorldStateMessage(BaseModel):
    """
    A world-state message in the map room, posted by the admin only
    """

    type: Literal["world-state"]
    schemaVersion: Literal[1]
    content: WorldState


class WorldProposalContent(BaseModel):
    """
    A proposed world state and its summary
    """

    state: WorldState
    """
    The proposed world state, in full (D25)
    """
    summary: constr(min_length=1, max_length=2000)
    """
    What the proposal changes, in words, for the admin; plain text
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


class SentResult(BaseModel):
    """
    A message sent
    """

    stanzaId: constr(min_length=1, max_length=256)
    """
    The server's stanza id of the message sent
    """


class ReadDraftResult(BaseModel):
    """
    The admin's world-state draft (ADM-45)
    """

    state: WorldState | None
    """
    The admin's world-state draft as it is now; with no draft held, the published state; null if neither
    """
    held: bool
    """
    A draft is held (unpublished edits); false: `state` is the published one
    """


class WriteDraftResult(BaseModel):
    """
    The draft write is held until the run finishes cleanly (PD9)
    """

    assets: conint(ge=0, le=9007199254740991)
    """
    Assets in the state written
    """


class SubscribedResult(BaseModel):
    """
    Subscribed until the run ends
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
            "paused",
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
        "paused",
        "failed",
    ]
    """
    `unknown-op`: not an operation of this protocol; `invalid-request`: the request failed its schema; `forbidden`: the role may not do it (PD2); `not-found`: no such room or force for this role; `unavailable`: not loaded yet or offline; `paused`: posting is paused for the role during adjudication (PLY-56); `failed`: anything else
    """


class PhaseEvent(BaseModel):
    """
    The turn state, when its turn or phase changes
    """

    type: Literal["phase"]
    state: GameState


class WriteDraftRequest(BaseModel):
    """
    The admin's world-state draft (PD7): applied when the run finishes cleanly (PD9), as the change from what the script read, on top of the draft as it is then
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    state: WorldState
    """
    The world state the script wants in the draft: the draft it read (`readDraft`) or the published state, changed
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
    Id of an `assets:<id>` node
    """
    iconAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an `assets:<id>` node
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
    Id of an `assets:<id>` node
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


class WorldProposalMessage(BaseModel):
    """
    A White Force proposal in the umpire room (PY-8)
    """

    type: Literal["world-proposal"]
    schemaVersion: Literal[1]
    content: WorldProposalContent


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
    sendMessage: SendMessageRequest
    sendTemplate: SendTemplateRequest
    readDraft: EmptyRequest
    writeDraft: WriteDraftRequest
    postProposal: PostProposalRequest
    subscribeMessages: SubscribeMessagesRequest
    subscribePhase: EmptyRequest


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
    body: ChatMessage | TemplateMessage | WorldStateMessage | WorldProposalMessage
    """
    The body; messages whose body fails validation are left out, as clients do
    """


class BridgeReply(RootModel[BridgeOkReply | BridgeErrorReply]):
    root: BridgeOkReply | BridgeErrorReply
    """
    Every reply, as JSON text
    """


class MessageEvent(BaseModel):
    """
    A new message in a subscribed room
    """

    type: Literal["message"]
    message: RoomMessage


class ReadGameSetupResult(BaseModel):
    """
    The game setup document
    """

    setup: GameSetup


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


class BridgeEvent(RootModel[MessageEvent | PhaseEvent]):
    root: MessageEvent | PhaseEvent
    """
    An event for a subscribed script
    """


class BridgeResults(BaseModel):
    """
    Each operation's result, the `value` of its reply, by operation name
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
    sendMessage: SentResult
    sendTemplate: SentResult
    readDraft: ReadDraftResult
    writeDraft: WriteDraftResult
    postProposal: SentResult
    subscribeMessages: SubscribedResult
    subscribePhase: SubscribedResult


class BridgeProtocol(BaseModel):
    """
    The bridge protocol between the Python SDK and its runner, version 2: a catalogue of its parts, not a message
    """

    protocolVersion: Literal[2]
    op: BridgeOp
    requests: BridgeRequests
    results: BridgeResults
    reply: BridgeReply
    event: BridgeEvent
