"""The SDK's three layers (Annex C PY-2), as the role the script runs as sees them.

- Read: the game, its turn, forces, roles, rooms, messages, world state and objectives.
- Act (WP 6.4): send text and templated messages; react to new messages and phase changes with
  `on_message` and `on_phase`, kept alive by `run_forever`.
- Adjudicate (WP 6.4): the admin reads and writes the world-state draft; a White Force role
  proposes a world state to the admin in the umpire room.

Role-scoped (PD2): every method asks the bridge, and returns exactly what the bridge returns for
the role, validated against the protocol's models. The SDK never widens it: a room the role is
not in is refused by the bridge (`ForbiddenError` or `NotFoundError`), not hidden by the SDK.
"""

from __future__ import annotations

import inspect
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from typing import Any, Literal, cast

from pydantic import ValidationError

from . import protocol
from .bridge import Bridge, default_bridge
from .errors import ProtocolError
from .models import (
    BridgeEvent,
    Context,
    MessageEvent,
    PostProposalRequest,
    ReadDraftResult,
    SendMessageRequest,
    SendTemplateRequest,
    SentResult,
    SubscribeMessagesRequest,
    WriteDraftRequest,
    WriteDraftResult,
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
    parse_world_state,
)

Order = Literal["oldest-first", "newest-first"]

MAP_ROOM_TYPE = "map"
UMPIRE_ROOM_TYPE = "umpire"
PAGE_MAX = 500

MessageHandler = Callable[[RoomMessage], Awaitable[None] | None]
PhaseHandler = Callable[[GameState], Awaitable[None] | None]


class Game:
    """The game as the script's role sees it, read through a bridge.

    `Game()` uses the runner's bridge (in the browser, the worker's); pass a `Bridge` to use
    another, such as a test's fake.
    """

    def __init__(self, bridge: Bridge | None = None) -> None:
        self._bridge = bridge if bridge is not None else default_bridge()
        self._context: Context | None = None
        self._message_handlers: dict[str, list[tuple[MessageHandler, bool]]] = {}
        self._phase_handlers: list[PhaseHandler] = []
        self._stopping = False

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

    async def umpire_room(self) -> RoomReader | None:
        """The game's umpire room (PD8): the admin and the White Force only; None for others."""
        for room in await self.rooms():
            if room.roomType == UMPIRE_ROOM_TYPE:
                return self.room(room)
        return None

    # ---- Act (PY-2) -----------------------------------------------------------------------------

    async def send_message(self, room: Room | RoomReader | str, text: str) -> str:
        """Posts chat text to a room the role can write in, as the role; returns its stanza id.

        Refused like the composer: a room the role only reads (`ForbiddenError`), and, for a role
        outside the White Force, while the game is in adjudication (`PausedError`, PLY-56).
        """
        request = SendMessageRequest(roomId=_room_id(room), text=text)
        result = cast(SentResult, await protocol.call(self._bridge, "sendMessage", request))
        return result.stanzaId

    async def send_template(
        self,
        room: Room | RoomReader | str,
        template_id: str,
        values: Mapping[str, str | float | bool],
    ) -> str:
        """Posts a templated message (TPL-3), checked as the composer checks it; its stanza id."""
        request = SendTemplateRequest(
            roomId=_room_id(room), templateId=template_id, values=dict(values)
        )
        result = cast(SentResult, await protocol.call(self._bridge, "sendTemplate", request))
        return result.stanzaId

    # ---- Adjudicate (PD6, PD7) ------------------------------------------------------------------

    async def read_draft(self) -> ReadDraftResult:
        """The admin's world-state draft as it is now (`held`), or the published state.

        Admin only. Write your changes on top of it: `write_draft` applies only what you changed
        from the state you read, so the admin's hand edits survive.
        """
        result = cast(ReadDraftResult, await protocol.call(self._bridge, "readDraft"))
        if result.state is not None:
            _checked("readDraft", result.state)
        return result

    async def draft(self) -> WorldState | None:
        """The state of `read_draft()`: the draft, or the published state; None if neither."""
        return (await self.read_draft()).state

    async def write_draft(self, state: WorldState | Mapping[str, Any]) -> int:
        """Writes the admin's world-state draft (PD7); returns the number of assets.

        Admin only. Held until the script finishes: a run that is stopped, times out or fails
        leaves the draft as it was (PD9). The change from what the script read (`read_draft`, or
        else the published state) is applied on top of the draft as it is then. The page checks
        the world-state schema and the 500 KB cap (PLY-53).
        """
        request = WriteDraftRequest(state=_state(state))
        result = cast(WriteDraftResult, await protocol.call(self._bridge, "writeDraft", request))
        return result.assets

    async def post_proposal(self, state: WorldState | Mapping[str, Any], summary: str) -> str:
        """Proposes a world state to the admin in the umpire room (PD6, PY-8); its stanza id.

        White Force roles that are not observers only; allowed in adjudication. `summary` says
        what it changes, in words. The page checks the state and the 500 KB cap first (PLY-53).
        """
        request = PostProposalRequest(state=_state(state), summary=summary)
        result = cast(SentResult, await protocol.call(self._bridge, "postProposal", request))
        return result.stanzaId

    # ---- Events (PY-2) --------------------------------------------------------------------------

    def on_message(
        self,
        room: Room | RoomReader | str,
        handler: MessageHandler | None = None,
        *,
        include_own: bool = False,
    ) -> Any:
        """Calls `handler(message)` for each new message in `room` while `run_forever` runs.

        Messages posted under the script's own login are left out unless `include_own`, so a
        handler that replies does not answer itself. A handler may be `async`. Usable as a
        decorator: `@game.on_message(room)`.
        """
        room_id = _room_id(room)

        def register(fn: MessageHandler) -> MessageHandler:
            self._message_handlers.setdefault(room_id, []).append((fn, include_own))
            return fn

        return register if handler is None else register(handler)

    def on_phase(self, handler: PhaseHandler | None = None) -> Any:
        """Calls `handler(state)` when the turn or phase changes, while `run_forever` runs."""

        def register(fn: PhaseHandler) -> PhaseHandler:
            self._phase_handlers.append(fn)
            return fn

        return register if handler is None else register(handler)

    def stop(self) -> None:
        """Ends `run_forever` after the handler that calls it returns: the run then finishes."""
        self._stopping = True

    async def run_forever(self, seconds: float | None = None) -> None:
        """Subscribes the handlers and delivers events to them until stopped.

        The run stays alive while this waits. It returns after `seconds`, if given, or when a
        handler calls `stop()`; the script then finishes cleanly (an admin's draft write lands).
        Otherwise the run's time limit or Stop ends it, which counts as not finishing (PD9). A
        handler that raises ends it with that error.
        """
        if not self._message_handlers and not self._phase_handlers:
            raise RuntimeError("no handlers: call on_message or on_phase first")
        if seconds is not None and seconds < 0:
            raise ValueError("seconds must not be negative")
        for room_id in self._message_handlers:
            await protocol.call(
                self._bridge, "subscribeMessages", SubscribeMessagesRequest(roomId=room_id)
            )
        if self._phase_handlers:
            await protocol.call(self._bridge, "subscribePhase")
        context = await self.context()
        deadline = None if seconds is None else time.monotonic() + seconds
        self._stopping = False
        while not self._stopping:
            wait_ms: int | None = None
            if deadline is not None:
                left = deadline - time.monotonic()
                if left <= 0:
                    return
                wait_ms = max(1, int(left * 1000))
            text = await self._bridge.next_event(wait_ms)
            if text is None:
                continue
            try:
                event = BridgeEvent.model_validate_json(text).root
            except ValidationError as error:
                raise ProtocolError("event", f"not an event: {error.errors()[0]['msg']}") from None
            if isinstance(event, MessageEvent):
                message = event.message
                if isinstance(message.body, WorldStateMessage):
                    _checked("event", message.body.content)
                own = _is_own(message, context)
                for handler, include_own in self._message_handlers.get(message.roomId, []):
                    if own and not include_own:
                        continue
                    await _call_handler(handler, message)
            else:
                for phase_handler in self._phase_handlers:
                    await _call_handler(phase_handler, event.state)

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
        """The room's messages as the role sees them, `async for` over pages.

        `order` is oldest first (the default) or newest first; `limit` stops after that many;
        `page_size` (1 to 500) is how many each bridge call asks for.
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
        """All of `messages(...)` as a list; takes the same options."""
        return [message async for message in self.messages(**options)]  # type: ignore[arg-type]


def _room_id(room: Room | RoomReader | str) -> str:
    return room.id if isinstance(room, (Room, RoomReader)) else room


def _state(state: WorldState | Mapping[str, Any]) -> WorldState:
    """A world state from a model or a dict, checked completely (the key rule too)."""
    if isinstance(state, WorldState):
        return check_world_state(state)
    return parse_world_state(dict(state))


def _is_own(message: RoomMessage, context: Context) -> bool:
    """Posted under the script's own login: the admin's, or the role's (any of its sessions)."""
    if context.isAdmin:
        return message.sender.isAdmin
    return not message.sender.isAdmin and message.sender.roleId == context.roleId


async def _call_handler(handler: Callable[[Any], Any], value: Any) -> None:
    result = handler(value)
    if inspect.isawaitable(result):
        await result


def _checked(op: str, state: WorldState) -> WorldState:
    try:
        return check_world_state(state)
    except ValueError as error:
        raise ProtocolError(op, f"invalid world state: {error}") from None
