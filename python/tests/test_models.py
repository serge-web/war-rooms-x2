"""The generated models (PY-1): they refuse bad data, round-trip, and every module agrees."""

from __future__ import annotations

import importlib
import json
import pkgutil
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from wrx import _models, models
from wrx._models import bridge_protocol
from wrx.models import (
    ChatMessage,
    Force,
    GameSetup,
    Objectives,
    Role,
    Room,
    RoomMessage,
    TemplateMessage,
    WorldAsset,
    WorldState,
    WorldStateMessage,
    check_world_state,
    parse_world_state,
)

from .conftest import FORCE, ROOM


def world(data: dict[str, Any]) -> dict[str, Any]:
    return data["readWorldState"]["state"]


def first_asset(state: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    key = next(iter(state["assets"]))
    return key, state["assets"][key]


def test_the_asset_model_has_its_name() -> None:
    # S17 found it called `Assets`, after the field it came from.
    assert WorldState.model_fields["assets"].annotation is not None
    assert "WorldAsset" in repr(WorldState.model_fields["assets"].annotation)
    assert not hasattr(bridge_protocol, "Assets")


def test_a_world_state_validates_and_round_trips(data: dict[str, Any]) -> None:
    state = parse_world_state(world(data))
    assert state.turn == 1
    assert len(state.assets) == 6
    assert json.loads(state.model_dump_json()) == world(data)
    assert parse_world_state(state.model_dump_json()) == state
    body = WorldStateMessage(type="world-state", schemaVersion=1, content=state)
    assert WorldStateMessage.model_validate_json(body.model_dump_json()) == body


def test_a_latitude_of_200_is_refused_where_it_is(data: dict[str, Any]) -> None:
    state = world(data)
    key, asset = first_asset(state)
    asset["lat"] = 200
    with pytest.raises(ValidationError) as caught:
        WorldState.model_validate(state)
    (issue,) = caught.value.errors()
    assert issue["loc"] == ("assets", key, "lat")
    assert issue["type"] == "less_than_equal"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("lon", -181),
        ("health", 101),
        ("fuel", -1),
        ("sidc", "SFGPUCI"),
        ("forceId", "blue"),
        ("title", ""),
        ("category", "x" * 61),
    ],
)
def test_asset_fields_are_checked(data: dict[str, Any], field: str, value: Any) -> None:
    _, asset = first_asset(world(data))
    WorldAsset.model_validate(asset)
    with pytest.raises(ValidationError):
        WorldAsset.model_validate({**asset, field: value})


def test_a_missing_field_is_refused(data: dict[str, Any]) -> None:
    _, asset = first_asset(world(data))
    del asset["fuel"]
    with pytest.raises(ValidationError):
        WorldAsset.model_validate(asset)


def test_keys_are_guids_and_each_is_its_assets_id(data: dict[str, Any]) -> None:
    state = world(data)
    key, asset = first_asset(state)
    with pytest.raises(ValidationError):
        WorldState.model_validate({**state, "assets": {"not-a-guid": asset}})
    other = "00000000-0000-4000-8000-0000000000ff"
    swapped = {**state, "assets": {other: asset}}
    # The model cannot say so (JSON Schema has no such rule); the SDK's check does.
    WorldState.model_validate(swapped)
    with pytest.raises(ValueError, match=f"assets.{other}"):
        parse_world_state(swapped)
    with pytest.raises(ValueError):
        check_world_state(WorldState.model_validate(swapped))
    assert key in parse_world_state(state).assets


def test_at_most_5000_assets(data: dict[str, Any]) -> None:
    _, asset = first_asset(world(data))

    def many(n: int) -> dict[str, Any]:
        assets = {}
        for i in range(n):
            guid = f"00000000-0000-4000-8000-{i:012x}"
            assets[guid] = {**asset, "id": guid}
        return {"turn": 1, "assets": assets}

    assert len(parse_world_state(many(5000)).assets) == 5000
    with pytest.raises(ValidationError):
        WorldState.model_validate(many(5001))


def test_the_turn_is_bounded(data: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        WorldState.model_validate({**world(data), "turn": 0})


def test_message_bodies(data: dict[str, Any]) -> None:
    chat = {"type": "chat", "schemaVersion": 1, "content": {"text": "Hi"}}
    assert ChatMessage.model_validate(chat).content.text == "Hi"
    with pytest.raises(ValidationError):
        ChatMessage.model_validate({**chat, "content": {"text": ""}})
    with pytest.raises(ValidationError):
        ChatMessage.model_validate({**chat, "content": {"text": "x" * 8001}})
    template = {
        "type": "template",
        "schemaVersion": 1,
        "content": {"templateId": "50000000-0000-4000-8000-000000000001", "values": {"a": 1}},
    }
    assert TemplateMessage.model_validate(template).content.values == {"a": 1}
    bad_name = {**template, "content": {**template["content"], "values": {"1a": 1}}}
    with pytest.raises(ValidationError):
        TemplateMessage.model_validate(bad_name)
    too_many = {f"f{i}": i for i in range(101)}
    with pytest.raises(ValidationError):
        TemplateMessage.model_validate(
            {**template, "content": {**template["content"], "values": too_many}}
        )


def test_room_messages_pick_their_body_type(data: dict[str, Any]) -> None:
    (state,) = data["messages"][ROOM["map"]]
    message = RoomMessage.model_validate(state)
    assert isinstance(message.body, WorldStateMessage)
    chat = RoomMessage.model_validate(data["messages"][ROOM["blue_hq"]][0])
    assert isinstance(chat.body, ChatMessage)
    assert chat.sentAt.tzinfo is not None
    assert RoomMessage.model_validate_json(chat.model_dump_json()) == chat


def test_documents_validate(data: dict[str, Any]) -> None:
    forces = [Force.model_validate(f) for f in data["readForces"]["forces"]]
    assert [f.id for f in forces] == [FORCE["blue"], FORCE["red"], FORCE["white"]]
    assert [f.isUmpire for f in forces] == [False, False, True]
    for role in data["readRoles"]["roles"]:
        Role.model_validate(role)
    for room in data["readRooms"]["rooms"]:
        Room.model_validate(room)
    GameSetup.model_validate(data["readGameSetup"]["setup"])
    objectives = data["objectives"][FORCE["blue"]]["objectives"]
    Objectives.model_validate(objectives)
    with pytest.raises(ValidationError):
        Objectives.model_validate({**objectives, "updatedAt": "yesterday"})
    with pytest.raises(ValidationError):
        Force.model_validate({**data["readForces"]["forces"][0], "colour": "blue"})


def _roots() -> list[tuple[str, type[BaseModel]]]:
    roots = []
    for info in pkgutil.iter_modules(_models.__path__):
        if info.name == "bridge_protocol":
            continue
        module = importlib.import_module(f"wrx._models.{info.name}")
        name = "".join(p[:1].upper() + p[1:] for p in info.name.split("_"))
        roots.append((name, getattr(module, name)))
    return roots


@pytest.mark.parametrize(("name", "root"), _roots())
def test_each_document_module_agrees_with_the_protocols(name: str, root: type[BaseModel]) -> None:
    """A document generated on its own and inside the protocol are the same model."""
    if not hasattr(bridge_protocol, name):
        pytest.skip(f"{name} is not part of the protocol")
    assert root.model_json_schema() == getattr(bridge_protocol, name).model_json_schema()


def test_the_public_models_are_the_protocols() -> None:
    for name in models.__all__:
        value = getattr(models, name)
        if isinstance(value, type) and hasattr(bridge_protocol, name):
            assert value is getattr(bridge_protocol, name)
