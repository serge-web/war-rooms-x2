"""The act and adjudicate layers (Annex C PY-2, PD6, PD7; WP 6.4) against a fake bridge: sending,
the admin's draft, White Force proposals, and events kept alive by `run_forever`."""

from __future__ import annotations

import asyncio
import copy
import json
from typing import Any

import pytest

from wrx import Bridge, ForbiddenError, Game, PausedError, ProtocolError
from wrx.models import GameState, RoomMessage, WorldState

from .conftest import FORCE, ROLE, ROOM, FakeBridge, error, ok, run


class ActingBridge(FakeBridge):
    """The fixture's bridge, answering the act operations too, with a queue of events."""

    def __init__(self, data: dict[str, Any] | None = None, **options: Any) -> None:
        super().__init__(data, **options)
        self.events: asyncio.Queue[str] | None = None
        self.later: list[str] = []
        self.paused = False
        self.waits: list[int | None] = []

    async def call(self, op: str, payload: str) -> str:
        if op == "sendMessage":
            request = json.loads(payload)
            self.calls.append((op, request))
            if self.paused:
                return error("paused", "posting is paused")
            if request["roomId"] == ROOM["negotiation"]:
                return error("forbidden", "this role can only read this room")
            return ok({"stanzaId": f"s{len(self.calls)}"})
        if op == "sendTemplate":
            self.calls.append((op, json.loads(payload)))
            return ok({"stanzaId": "t1"})
        if op == "readDraft":
            self.calls.append((op, json.loads(payload)))
            return ok({"state": self.data["readWorldState"]["state"], "held": False})
        if op == "writeDraft":
            request = json.loads(payload)
            self.calls.append((op, request))
            return ok({"assets": len(request["state"]["assets"])})
        if op == "postProposal":
            self.calls.append((op, json.loads(payload)))
            return ok({"stanzaId": "p1"})
        if op in ("subscribeMessages", "subscribePhase"):
            self.calls.append((op, json.loads(payload)))
            return ok({})
        return await super().call(op, payload)

    async def next_event(self, timeout_ms: int | None = None) -> str | None:
        self.waits.append(timeout_ms)
        if self.events is None:
            self.events = asyncio.Queue()
            for event in self.later:
                self.events.put_nowait(event)
        try:
            if timeout_ms is None:
                return await self.events.get()
            return await asyncio.wait_for(self.events.get(), timeout_ms / 1000)
        except TimeoutError:
            return None


def as_white_cell(bridge: ActingBridge) -> ActingBridge:
    bridge.data["readContext"] = {
        "protocolVersion": 2,
        "isAdmin": False,
        "roleId": ROLE["white_cell"],
        "forceId": FORCE["white"],
    }
    return bridge


def chat_event(text: str, *, admin: bool = False, role: str | None = None) -> str:
    sender = (
        {"isAdmin": True, "roleId": None, "loginName": "admin"}
        if admin
        else {"isAdmin": False, "roleId": role, "loginName": "someone"}
    )
    return json.dumps(
        {
            "type": "message",
            "message": {
                "id": f"e-{text}",
                "roomId": ROOM["blue_hq"],
                "sentAt": "2026-11-06T10:00:00Z",
                "sender": sender,
                "body": {"type": "chat", "schemaVersion": 1, "content": {"text": text}},
            },
        }
    )


def test_sends_text_and_templates_as_the_role() -> None:
    bridge = ActingBridge()
    game = Game(bridge)
    assert run(game.send_message(ROOM["blue_hq"], "Received.")) == "s1"
    assert bridge.calls[-1] == ("sendMessage", {"roomId": ROOM["blue_hq"], "text": "Received."})
    template = "50000000-0000-4000-8000-000000000001"
    assert run(game.send_template(ROOM["blue_hq"], template, {"grid": "NV 1234"})) == "t1"
    with pytest.raises(ForbiddenError):
        run(game.send_message(ROOM["negotiation"], "x"))
    bridge.paused = True
    with pytest.raises(PausedError):
        run(game.send_message(ROOM["blue_hq"], "x"))


def test_reads_and_writes_the_draft_and_proposes() -> None:
    bridge = ActingBridge()
    game = Game(bridge)
    draft = run(game.read_draft())
    assert draft.held is False and isinstance(draft.state, WorldState)
    state = draft.state
    assert state is not None
    first = next(iter(state.assets.values()))
    state.assets[first.id] = first.model_copy(update={"fuel": 10})
    assert run(game.write_draft(state)) == len(state.assets)
    written = bridge.calls[-1][1]["state"]
    assert written["assets"][first.id]["fuel"] == 10
    # A dict is checked completely, the key rule too, before anything is sent.
    bad = copy.deepcopy(written)
    bad["assets"]["30000000-0000-4000-8000-0000000000ff"] = bad["assets"][first.id]
    sent = len(bridge.calls)
    with pytest.raises(ValueError):
        run(game.write_draft(bad))
    assert len(bridge.calls) == sent
    assert run(game.post_proposal(state, "Tanks refuelled.")) == "p1"
    assert bridge.calls[-1][1]["summary"] == "Tanks refuelled."


def test_on_message_reacts_to_others_and_leaves_its_own_out() -> None:
    bridge = as_white_cell(ActingBridge())
    bridge.later = [
        chat_event("mine", role=ROLE["white_cell"]),
        chat_event("hello", role="20000000-0000-4000-8000-000000000001"),
        chat_event("from the umpire", admin=True),
    ]
    game = Game(bridge)
    heard: list[str] = []

    @game.on_message(ROOM["blue_hq"])
    async def reply(message: RoomMessage) -> None:
        heard.append(message.body.content.text)  # type: ignore[union-attr]
        if len(heard) == 2:
            game.stop()

    run(game.run_forever())
    assert heard == ["hello", "from the umpire"]
    assert ("subscribeMessages", {"roomId": ROOM["blue_hq"]}) in bridge.calls


def test_on_phase_and_a_time_bound() -> None:
    bridge = ActingBridge()
    bridge.later = [
        json.dumps(
            {"type": "phase", "state": {"schemaVersion": 1, "turn": 2, "phase": "adjudication"}}
        )
    ]
    game = Game(bridge)
    phases: list[str] = []
    game.on_phase(lambda state: phases.append(f"{state.turn} {state.phase}"))
    run(game.run_forever(seconds=0.2))
    assert phases == ["2 adjudication"]
    assert ("subscribePhase", {}) in bridge.calls
    assert all(wait is not None and wait <= 200 for wait in bridge.waits)


def test_run_forever_needs_a_handler_and_refuses_a_bad_event() -> None:
    with pytest.raises(RuntimeError):
        run(Game(ActingBridge()).run_forever(seconds=0))
    bridge = ActingBridge()
    bridge.later = ['{"type": "teapot"}']
    game = Game(bridge)
    game.on_phase(lambda state: None)
    with pytest.raises(ProtocolError):
        run(game.run_forever(seconds=1))


def test_a_handler_that_raises_ends_the_run() -> None:
    bridge = ActingBridge()
    bridge.later = [chat_event("boom", admin=False, role=None)]
    game = Game(bridge)

    def fail(message: RoomMessage) -> None:
        raise RuntimeError("handler failed")

    game.on_message(ROOM["blue_hq"], fail)
    with pytest.raises(RuntimeError, match="handler failed"):
        run(game.run_forever(seconds=1))


class NoEvents(ActingBridge):
    async def next_event(self, timeout_ms: int | None = None) -> str | None:
        return await Bridge.next_event(self, timeout_ms)


def test_a_bridge_without_events_says_so() -> None:
    game = Game(NoEvents())
    game.on_phase(lambda state: None)
    with pytest.raises(NotImplementedError):
        run(game.run_forever(seconds=1))


def test_the_umpire_room_is_found_by_its_type() -> None:
    room = run(Game(FakeBridge()).umpire_room())
    assert room is not None and room.id == ROOM["umpire"]
    assert run(Game(FakeBridge(rooms={ROOM["map"]})).umpire_room()) is None


def test_an_event_state_is_a_game_state() -> None:
    assert GameState.model_validate({"schemaVersion": 1, "turn": 1, "phase": "planning"})
