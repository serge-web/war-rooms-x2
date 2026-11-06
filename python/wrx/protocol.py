"""The bridge protocol, version 1 (WP 6.1): operation names and their request and result models.

The protocol is defined once, in zod (`packages/schemas/src/bridge.ts`, `@wrx/schemas/bridge`),
and exported as `docs/json-schema/bridge-protocol.schema.json`; the models here are generated
from that file. `OPERATIONS` is the one hand-written part, and `tests/test_protocol.py` checks
it against the generated catalogue (`BridgeProtocol`): the same operations, version and models.
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from .bridge import Bridge
from .errors import ERRORS, BridgeError, ProtocolError
from .models import (
    BridgeErrorReply,
    BridgeReply,
    Context,
    EmptyRequest,
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
)

PROTOCOL_VERSION = 1


@dataclass(frozen=True)
class Operation:
    request: type[BaseModel]
    result: type[BaseModel]


OPERATIONS: dict[str, Operation] = {
    "readContext": Operation(EmptyRequest, Context),
    "readGameSetup": Operation(EmptyRequest, ReadGameSetupResult),
    "readTurn": Operation(EmptyRequest, ReadTurnResult),
    "readForces": Operation(EmptyRequest, ReadForcesResult),
    "readRoles": Operation(EmptyRequest, ReadRolesResult),
    "readRooms": Operation(EmptyRequest, ReadRoomsResult),
    "readRoomMessages": Operation(ReadRoomMessagesRequest, ReadRoomMessagesResult),
    "readWorldState": Operation(EmptyRequest, ReadWorldStateResult),
    "readObjectives": Operation(ReadObjectivesRequest, ReadObjectivesResult),
}


async def call(bridge: Bridge, op: str, request: BaseModel | None = None) -> BaseModel:
    """Sends one operation and returns its validated result.

    Raises the `BridgeError` subclass for the reply's error code, or `ProtocolError` when the
    reply is not the protocol's (not JSON, the wrong envelope, or a result that fails its model).
    """
    operation = OPERATIONS.get(op)
    if operation is None:
        raise ValueError(f"not an operation of protocol {PROTOCOL_VERSION}: {op}")
    if request is None and operation.request is EmptyRequest:
        request = EmptyRequest()
    if not isinstance(request, operation.request):
        raise TypeError(f"{op} takes a {operation.request.__name__}")
    text = await bridge.call(op, request.model_dump_json(exclude_none=True))
    try:
        reply = BridgeReply.model_validate_json(text).root
    except ValidationError as error:
        raise ProtocolError(op, f"not a reply: {_first(error)}") from None
    if isinstance(reply, BridgeErrorReply):
        raise ERRORS.get(reply.code.root, BridgeError)(op, reply.error)
    try:
        return operation.result.model_validate(reply.value)
    except ValidationError as error:
        raise ProtocolError(op, f"invalid result: {_first(error)}") from None


def _first(error: ValidationError) -> str:
    issue = error.errors()[0]
    where = ".".join(str(part) for part in issue["loc"])
    return f"{where}: {issue['msg']}" if where else issue["msg"]

