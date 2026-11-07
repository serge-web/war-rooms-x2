"""wrx: the Python SDK for War Rooms X (SRD Annex C, PD1).

One SDK for umpire reconcilers, analysis and automated players. It is role-scoped (PD2): a
script reads as the role it runs as, through its runner's bridge, and sees only what that role
may see. `Game` offers the three layers (PY-2): read (the game, its rooms, messages and world
state), act (send messages, react to messages and phase changes) and adjudicate (the admin's
world-state draft, White Force proposals); typed models in `wrx.models` (PY-1); pandas helpers
in `wrx.frames`, imported only when used (PY-3).

    import wrx

    game = wrx.Game()                      # the runner's bridge
    turn = await game.turn()
    async for message in game.room(room_id).messages():
        ...
    frame = wrx.to_frame(await game.world_state())
    await game.send_message(room_id, "Received.")
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
    PausedError,
    ProtocolError,
    UnavailableError,
    UnknownOperationError,
)
from .game import Game, RoomReader
from .protocol import PROTOCOL_VERSION

__version__ = "0.2.0"

__all__ = [
    "PROTOCOL_VERSION",
    "Bridge",
    "BridgeError",
    "ForbiddenError",
    "Game",
    "InvalidRequestError",
    "NotFoundError",
    "PausedError",
    "ProtocolError",
    "PyodideBridge",
    "RoomReader",
    "UnavailableError",
    "UnknownOperationError",
    "models",
    "to_frame",
]


def to_frame(source: Any, kind: Any = None) -> Any:
    """`wrx.frames.to_frame`: imports pandas on first use, not with `import wrx` (PY-3)."""
    from .frames import to_frame as frame

    return frame(source, kind)
