"""The read layer (Annex C PY-2): the game, its turn, forces, roles, rooms, messages, world state
and objectives, as the role the script runs as sees them.

Role-scoped (PD2): every method asks the bridge, and returns exactly what the bridge returns for
the role, validated against the protocol's models. The SDK never widens it: a room the role is
not in is refused by the bridge (`ForbiddenError` or `NotFoundError`), not hidden by the SDK.
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

    `Game()` uses the runner's bridge (in the browser, the worker's); pass a `Bridge` to use
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


def _checked(op: str, state: WorldState) -> WorldState:
    try:
        return check_world_state(state)
    except ValueError as error:
        raise ProtocolError(op, f"invalid world state: {error}") from None
