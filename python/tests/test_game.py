"""The read layer (PY-2) against a fake bridge: what it reads, how it pages, and that it shows
only what the bridge returns for the role (PD2)."""

from __future__ import annotations

import copy
import sys
import types
from typing import Any

import pytest

import wrx
from wrx import ForbiddenError, Game, NotFoundError, ProtocolError, PyodideBridge
from wrx.models import ChatMessage, Force, WorldState, WorldStateMessage

from .conftest import FORCE, ROLE, ROOM, FakeBridge, ok, run

BLUE_HQ_TEXTS = [
    "Morning all. Orders for the crossing are out.",
    "The exercise clock starts at 09:00.",
    "Understood. Recce team moving to the bridge.",
]


async def collect(game: Game, room: str, **options: Any) -> list[Any]:
    return [m async for m in game.room(room).messages(**options)]


def texts(messages: list[Any]) -> list[str]:
    return [m.body.content.text for m in messages]


def test_reads_the_game_as_the_admin() -> None:
    game = Game(FakeBridge())

    async def read() -> None:
        context = await game.context()
        assert context.isAdmin and context.roleId is None
        assert (await game.setup()).name == "Exercise Northern Gate"
        turn = await game.turn()
        assert turn is not None and (turn.turn, turn.phase) == (1, "planning")
        assert [f.name for f in await game.forces()] == ["Blue", "Red", "White"]
        assert len(await game.roles()) == 5
        rooms = await game.rooms()
        assert [r.name for r in rooms] == [
            "Blue HQ",
            "Red HQ",
            "Blue–Red negotiation",
            "Blue Reports",
            "Map",
            "Umpires",
        ]
        state = await game.world_state()
        assert isinstance(state, WorldState) and len(state.assets) == 6
        record = await game.world_state_record()
        assert record.messageId == "demo-world-1" and record.sentAt is not None
        objectives = await game.objectives(FORCE["blue"])
        assert objectives is not None and objectives.forceId == FORCE["blue"]
        assert await game.objectives(FORCE["white"]) is None

    run(read())


def test_the_context_is_read_once() -> None:
    bridge = FakeBridge()
    game = Game(bridge)
    run(game.context())
    run(game.context())
    assert [op for op, _ in bridge.calls] == ["readContext"]


def test_a_bridge_of_another_protocol_version_is_refused() -> None:
    context = {"protocolVersion": 1, "isAdmin": True, "roleId": None, "forceId": None}
    with pytest.raises(ProtocolError):
        run(Game(FakeBridge(override={"readContext": ok(context)})).context())


def test_objectives_take_a_force_or_its_id() -> None:
    bridge = FakeBridge()
    game = Game(bridge)
    blue = run(game.forces())[0]
    assert isinstance(blue, Force)
    assert run(game.objectives(blue)) == run(game.objectives(blue.id))


def test_messages_oldest_first_across_pages() -> None:
    bridge = FakeBridge()
    game = Game(bridge)
    messages = run(collect(game, ROOM["blue_hq"], page_size=2))
    assert texts(messages) == BLUE_HQ_TEXTS
    assert all(isinstance(m.body, ChatMessage) for m in messages)
    assert [m.sender.loginName for m in messages] == ["blue-co", "admin", "blue-co"]
    assert messages[1].sender.isAdmin
    pages = [request for op, request in bridge.calls if op == "readRoomMessages"]
    assert pages == [
        {"roomId": ROOM["blue_hq"], "limit": 2, "order": "oldest-first"},
        {"roomId": ROOM["blue_hq"], "limit": 2, "order": "oldest-first", "cursor": "2"},
    ]


def test_messages_newest_first_with_a_limit() -> None:
    bridge = FakeBridge()
    messages = run(collect(Game(bridge), ROOM["blue_hq"], order="newest-first", limit=2))
    assert texts(messages) == BLUE_HQ_TEXTS[::-1][:2]
    assert len([op for op, _ in bridge.calls if op == "readRoomMessages"]) == 1
    assert run(collect(Game(bridge), ROOM["blue_hq"], limit=0)) == []


def test_history_collects_the_messages() -> None:
    history = run(Game(FakeBridge()).room(ROOM["blue_hq"]).history(page_size=1))
    assert texts(history) == BLUE_HQ_TEXTS
    assert run(Game(FakeBridge()).room(ROOM["blue_reports"]).history()) == []


def test_bad_paging_options_are_refused_before_any_call() -> None:
    bridge = FakeBridge()
    with pytest.raises(ValueError):
        run(collect(Game(bridge), ROOM["blue_hq"], page_size=501))
    with pytest.raises(ValueError):
        run(collect(Game(bridge), ROOM["blue_hq"], limit=-1))
    assert bridge.calls == []


def test_the_turn_history_is_the_admins_world_states() -> None:
    async def read() -> list[Any]:
        return [m async for m in Game(FakeBridge()).world_states()]

    (message,) = run(read())
    assert isinstance(message.body, WorldStateMessage)
    assert message.body.content.turn == 1


def white_cell(**options: Any) -> FakeBridge:
    """The bridge as White Cell sees it: fewer rooms; the blue room refused."""
    data = copy.deepcopy(FakeBridge().data)
    data["readContext"] = {
        "protocolVersion": 2,
        "isAdmin": False,
        "roleId": ROLE["white_cell"],
        "forceId": FORCE["white"],
    }
    return FakeBridge(data, rooms={ROOM["negotiation"], ROOM["map"]}, **options)


def test_a_role_sees_only_what_its_bridge_returns() -> None:
    game = Game(white_cell(objectives={FORCE["red"]}))

    async def read() -> None:
        context = await game.context()
        assert not context.isAdmin and context.roleId == ROLE["white_cell"]
        assert {r.id for r in await game.rooms()} == {ROOM["negotiation"], ROOM["map"]}
        assert (await game.map_room()) is not None
        assert len(await collect(game, ROOM["negotiation"])) == 2
        with pytest.raises(ForbiddenError):
            await collect(game, ROOM["blue_hq"])
        with pytest.raises(ForbiddenError):
            await game.objectives(FORCE["blue"])
        assert (await game.objectives(FORCE["red"])) is not None

    run(read())


def test_a_role_without_the_map_room_has_no_turn_history() -> None:
    bridge = FakeBridge(rooms={ROOM["blue_hq"]})

    async def read() -> list[Any]:
        game = Game(bridge)
        assert await game.map_room() is None
        return [m async for m in game.world_states()]

    assert run(read()) == []


def test_an_unknown_room_is_not_found() -> None:
    with pytest.raises(NotFoundError):
        run(collect(Game(FakeBridge()), "00000000-0000-4000-8000-000000000000"))


def test_a_world_state_with_a_misplaced_asset_is_a_protocol_error() -> None:
    bridge = FakeBridge()
    record = copy.deepcopy(bridge.data["readWorldState"])
    key = next(iter(record["state"]["assets"]))
    asset = record["state"]["assets"].pop(key)
    record["state"]["assets"]["00000000-0000-4000-8000-0000000000aa"] = asset
    bridge.override["readWorldState"] = ok(record)
    with pytest.raises(ProtocolError, match="invalid world state"):
        run(Game(bridge).world_state())


def test_a_bridge_that_returns_bad_data_is_a_protocol_error() -> None:
    bridge = FakeBridge()
    record = copy.deepcopy(bridge.data["readWorldState"])
    next(iter(record["state"]["assets"].values()))["lat"] = 200
    bridge.override["readWorldState"] = ok(record)
    with pytest.raises(ProtocolError, match="lat"):
        run(Game(bridge).world_state())


def test_a_page_from_another_room_or_a_repeated_cursor_is_a_protocol_error() -> None:
    bridge = FakeBridge()
    page = copy.deepcopy(bridge.data["messages"][ROOM["red_hq"]])
    bridge.override["readRoomMessages"] = ok({"messages": page, "cursor": None})
    with pytest.raises(ProtocolError, match="another room"):
        run(collect(Game(bridge), ROOM["blue_hq"]))
    own = copy.deepcopy(bridge.data["messages"][ROOM["blue_hq"]][:1])
    bridge.override["readRoomMessages"] = ok({"messages": own, "cursor": "again"})
    with pytest.raises(ProtocolError, match="twice"):
        run(collect(Game(bridge), ROOM["blue_hq"]))


def test_the_pyodide_bridge_wraps_the_workers_call(monkeypatch: pytest.MonkeyPatch) -> None:
    sent: list[tuple[str, str]] = []
    fake = FakeBridge()

    async def call(op: str, payload: str) -> str:
        sent.append((op, payload))
        return await fake.call(op, payload)

    monkeypatch.setitem(sys.modules, "_wrx_bridge", types.SimpleNamespace(call=call))
    game = wrx.Game()
    assert isinstance(game.bridge, PyodideBridge)
    assert run(game.turn()) is not None
    assert sent == [("readTurn", "{}")]


def test_without_a_runner_game_says_so(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delitem(sys.modules, "_wrx_bridge", raising=False)
    with pytest.raises(RuntimeError, match="No runner bridge"):
        wrx.Game()
