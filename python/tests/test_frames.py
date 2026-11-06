"""The tabular helpers (PY-3): pandas DataFrames, and pandas only when they are used."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

import wrx
from wrx import Game

from .conftest import ROOM, FakeBridge, run

ROOT = Path(__file__).resolve().parents[1]


def test_import_wrx_does_not_import_pandas() -> None:
    code = (
        "import sys, wrx, wrx.models, wrx.protocol\n"
        "assert 'pandas' not in sys.modules, 'pandas imported'\n"
        "assert 'numpy' not in sys.modules, 'numpy imported'\n"
    )
    subprocess.run([sys.executable, "-c", code], cwd=ROOT, check=True)


pd = pytest.importorskip("pandas")


def messages() -> list[Any]:
    async def read() -> list[Any]:
        game = Game(FakeBridge())
        out = []
        for room in await game.rooms():
            out += await game.room(room).history()
        return out

    return run(read())


def test_messages_frame() -> None:
    frame = wrx.to_frame(messages())
    assert len(frame) == 8
    assert list(frame.columns[:4]) == ["id", "roomId", "sentAt", "senderLogin"]
    assert str(frame["sentAt"].dtype).startswith("datetime64")
    assert frame["sentAt"].dt.tz is not None
    blue = frame[frame["roomId"] == ROOM["blue_hq"]]
    assert blue["text"].tolist()[0] == "Morning all. Orders for the crossing are out."
    world = frame[frame["type"] == "world-state"]
    assert world["turn"].tolist() == [1]
    assert world["text"].isna().all()


def test_assets_frame_from_a_world_state() -> None:
    state = run(Game(FakeBridge()).world_state())
    frame = wrx.to_frame(state)
    assert len(frame) == 6
    assert list(frame.columns) == ["turn", "id", "forceId", "title", "category", "sidc", "lat",
                                   "lon", "state", "health", "fuel"]
    assert set(frame["turn"]) == {1}
    assert frame["lat"].between(-90, 90).all()
    record = run(Game(FakeBridge()).world_state_record())
    assert wrx.to_frame(record).equals(frame)


def test_turns_and_assets_across_world_state_messages() -> None:
    async def read() -> list[Any]:
        return [m async for m in Game(FakeBridge()).world_states()]

    history = run(read())
    turns = wrx.to_frame(history, kind="turns")
    assert turns[["turn", "messageId", "assets"]].to_dict("records") == [
        {"turn": 1, "messageId": "demo-world-1", "assets": 6}
    ]
    assets = wrx.to_frame(messages(), kind="assets")
    assert len(assets) == 6
    assert set(assets["messageId"]) == {"demo-world-1"}


def test_to_frame_refuses_what_it_cannot_tabulate() -> None:
    with pytest.raises(TypeError):
        wrx.to_frame([1, 2])
    state = run(Game(FakeBridge()).world_state())
    with pytest.raises(ValueError):
        wrx.to_frame(state, kind="turns")
    assert len(wrx.to_frame([])) == 0
