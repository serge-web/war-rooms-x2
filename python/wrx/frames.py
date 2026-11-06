"""Tabular helpers (Annex C PY-3): pandas DataFrames of messages, turns and assets.

pandas is imported only when one of these is called, never by `import wrx`, so a script that
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
            "wrx's tabular helpers need pandas: `pip install wrx[pandas]` "
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
    """One row per published world state (from `Game.world_states()`): its turn, when it was
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
    """One row per asset, with the state's `turn`. Given world-state messages, one row per asset
    per message, with `messageId` and `sentAt` too, for following assets across turns."""
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
    """A DataFrame of `source`: a world state (or its message) gives its assets; a list of room
    messages gives one row per message, or with `kind="turns"` or `kind="assets"`, the turns or
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
