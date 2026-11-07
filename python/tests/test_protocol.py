"""The SDK's operation table is the protocol's (generated from bridge-protocol.schema.json, which
`pnpm check:json-schema` keeps equal to `@wrx/schemas/bridge`), and replies are checked."""

from __future__ import annotations

import json
import typing

import pytest

from wrx import (
    BridgeError,
    ForbiddenError,
    InvalidRequestError,
    NotFoundError,
    PausedError,
    ProtocolError,
    UnavailableError,
    UnknownOperationError,
    protocol,
)
from wrx.errors import ERRORS
from wrx.models import BridgeProtocol, ReadRoomMessagesRequest

from .conftest import ROOM, FakeBridge, error, ok, run


def literal_values(model: type, field: str) -> tuple[object, ...]:
    annotation = model.model_fields[field].annotation  # type: ignore[attr-defined]
    if hasattr(annotation, "model_fields"):  # a RootModel around the Literal
        annotation = annotation.model_fields["root"].annotation
    return typing.get_args(annotation)


def test_the_operations_and_version_are_the_protocols() -> None:
    assert literal_values(BridgeProtocol, "protocolVersion") == (protocol.PROTOCOL_VERSION,)
    ops = literal_values(BridgeProtocol, "op")
    assert list(protocol.OPERATIONS) == list(ops)


def test_each_operation_has_the_protocols_request_and_result_models() -> None:
    requests = BridgeProtocol.model_fields["requests"].annotation
    results = BridgeProtocol.model_fields["results"].annotation
    assert requests is not None and results is not None
    for op, operation in protocol.OPERATIONS.items():
        assert requests.model_fields[op].annotation is operation.request, op
        assert results.model_fields[op].annotation is operation.result, op


def test_the_error_codes_are_the_protocols() -> None:
    reply = BridgeProtocol.model_fields["reply"].annotation
    assert reply is not None
    error_reply = typing.get_args(reply.model_fields["root"].annotation)[1]
    codes = literal_values(error_reply, "code")
    assert set(ERRORS) == set(codes)


def test_a_request_goes_as_compact_json_without_unset_fields() -> None:
    bridge = FakeBridge()
    run(protocol.call(bridge, "readRoomMessages", ReadRoomMessagesRequest(roomId=ROOM["blue_hq"])))
    run(protocol.call(bridge, "readForces"))
    assert bridge.calls == [
        ("readRoomMessages", {"roomId": ROOM["blue_hq"], "limit": 100, "order": "oldest-first"}),
        ("readForces", {}),
    ]


def test_the_sdk_refuses_to_send_what_is_not_an_operation() -> None:
    with pytest.raises(ValueError):
        run(protocol.call(FakeBridge(), "publishWorldState"))
    with pytest.raises(TypeError):
        run(protocol.call(FakeBridge(), "readObjectives"))


@pytest.mark.parametrize(
    ("code", "cls"),
    [
        ("unknown-op", UnknownOperationError),
        ("invalid-request", InvalidRequestError),
        ("forbidden", ForbiddenError),
        ("not-found", NotFoundError),
        ("unavailable", UnavailableError),
        ("paused", PausedError),
        ("failed", BridgeError),
    ],
)
def test_an_error_reply_raises_its_class(code: str, cls: type[BridgeError]) -> None:
    bridge = FakeBridge(override={"readTurn": error(code, "no")})
    with pytest.raises(cls) as caught:
        run(protocol.call(bridge, "readTurn"))
    assert type(caught.value) is cls
    assert caught.value.op == "readTurn"
    assert caught.value.message == "no"


@pytest.mark.parametrize(
    "reply",
    [
        "not json",
        "{}",
        json.dumps({"ok": False, "code": "teapot", "error": "x"}),
        ok({"state": {"schemaVersion": 1, "turn": 0, "phase": "planning"}}),
        ok({"forces": []}),
    ],
)
def test_a_reply_that_breaks_the_protocol_is_a_protocol_error(reply: str) -> None:
    bridge = FakeBridge(override={"readTurn": reply})
    with pytest.raises(ProtocolError):
        run(protocol.call(bridge, "readTurn"))
