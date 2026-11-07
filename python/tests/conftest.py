"""A fake bridge over the demo game (tests/fixtures/demo-game.json, generated from the mock's
demo seed by packages/mock-server/scripts/python-fixtures.ts), answering as the protocol says a runner does."""

from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from typing import Any

import pytest

from wrx import Bridge

FIXTURE = Path(__file__).parent / "fixtures" / "demo-game.json"

ROOM = {
    "blue_hq": "30000000-0000-4000-8000-000000000001",
    "red_hq": "30000000-0000-4000-8000-000000000002",
    "negotiation": "30000000-0000-4000-8000-000000000003",
    "blue_reports": "30000000-0000-4000-8000-000000000004",
    "map": "30000000-0000-4000-8000-000000000005",
    "umpire": "30000000-0000-4000-8000-000000000006",
}
FORCE = {
    "blue": "10000000-0000-4000-8000-000000000001",
    "red": "10000000-0000-4000-8000-000000000002",
    "white": "10000000-0000-4000-8000-000000000003",
}
ROLE = {"white_cell": "20000000-0000-4000-8000-000000000005"}


def demo() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def ok(value: Any) -> str:
    return json.dumps({"ok": True, "value": value})


def error(code: str, message: str) -> str:
    return json.dumps({"ok": False, "code": code, "error": message})


class FakeBridge(Bridge):
    """Answers each operation from the fixture, for the admin unless `rooms` narrows it.

    `calls` records every (op, request) it was sent. `override` replaces an operation's reply
    text, to test what the SDK does with a bad bridge.
    """

    def __init__(
        self,
        data: dict[str, Any] | None = None,
        *,
        rooms: set[str] | None = None,
        objectives: set[str] | None = None,
        override: dict[str, str] | None = None,
    ) -> None:
        self.data = data if data is not None else demo()
        self.rooms = rooms
        self.objectives = objectives
        self.override = override or {}
        self.calls: list[tuple[str, Any]] = []

    async def call(self, op: str, payload: str) -> str:
        await asyncio.sleep(0)
        request = json.loads(payload)
        self.calls.append((op, request))
        if op in self.override:
            return self.override[op]
        if op == "readRooms":
            rooms = self.data["readRooms"]["rooms"]
            if self.rooms is not None:
                rooms = [r for r in rooms if r["id"] in self.rooms]
            return ok({"rooms": rooms})
        if op == "readRoomMessages":
            return self._messages(request)
        if op == "readObjectives":
            force = request["forceId"]
            if self.objectives is not None and force not in self.objectives:
                return error("forbidden", "the role may not read these objectives")
            entry = self.data["objectives"].get(force, {"objectives": None})
            return ok(entry)
        if op in self.data:
            return ok(self.data[op])
        return error("unknown-op", "not an operation")

    def _messages(self, request: dict[str, Any]) -> str:
        room = request["roomId"]
        if self.rooms is not None and room not in self.rooms:
            return error("forbidden", "the role is not in this room")
        if room not in self.data["messages"]:
            return error("not-found", "no such room")
        messages = copy.deepcopy(self.data["messages"][room])
        if request.get("order", "oldest-first") == "newest-first":
            messages.reverse()
        start = int(request.get("cursor", "0"))
        limit = request.get("limit", 100)
        page = messages[start : start + limit]
        end = start + len(page)
        return ok({"messages": page, "cursor": str(end) if end < len(messages) else None})


def run(coro: Any) -> Any:
    return asyncio.run(coro)


@pytest.fixture
def data() -> dict[str, Any]:
    return demo()
