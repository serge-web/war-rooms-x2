"""The `wrx` module in the browser runner: S17's small slice of the SDK (Annex C PD1, PY-2).

WP 6.1 brings the real SDK, with its typed models; it replaces this module. Every operation goes
through the page's bridge as an operation name and a JSON string, and comes back as JSON. The
page checks each call against the role the script runs as (PD2, PY-4); this module holds no
access of its own.
"""

import json

from _wrx_bridge import call as _call


_CONTEXT = "{}"  # set by the worker before each run


class BridgeError(Exception):
    """The page refused or failed an operation."""


async def _op(op, payload=None):
    reply = json.loads(await _call(op, json.dumps(payload)))
    if not reply["ok"]:
        raise BridgeError(reply["error"])
    return reply.get("value")


def context():
    """Where the script runs: its role and the room ids it may read (data, not access)."""
    return json.loads(_CONTEXT)


async def world_state():
    """The latest published world state of the game's map room (D25)."""
    return await _op("readWorldState")


async def room_messages(room_id):
    """A room's messages, oldest first, as the role sees them."""
    return await _op("readRoomMessages", {"roomId": room_id})


async def write_draft(state):
    """Admin only: the world-state draft, applied when the script finishes (PD7, PD9)."""
    return await _op("writeDraft", state)
