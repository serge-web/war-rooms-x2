"""What the SDK raises when an operation fails."""

from __future__ import annotations


class BridgeError(Exception):
    """The bridge refused or failed an operation. `code` is the protocol's error code."""

    code = "failed"

    def __init__(self, op: str, message: str) -> None:
        super().__init__(f"{op}: {message}")
        self.op = op
        self.message = message


class UnknownOperationError(BridgeError):
    """The bridge does not offer this operation (`unknown-op`)."""

    code = "unknown-op"


class InvalidRequestError(BridgeError):
    """The request failed the protocol's schema (`invalid-request`)."""

    code = "invalid-request"


class ForbiddenError(BridgeError):
    """The role may not do this (`forbidden`, PD2)."""

    code = "forbidden"


class NotFoundError(BridgeError):
    """No such room or force for this role (`not-found`)."""

    code = "not-found"


class UnavailableError(BridgeError):
    """Not loaded yet, or offline (`unavailable`)."""

    code = "unavailable"


class ProtocolError(BridgeError):
    """The bridge's reply broke the protocol: not JSON, the wrong shape, or invalid data.

    Raised by the SDK itself; the bridge never sends this code.
    """

    code = "protocol"


ERRORS: dict[str, type[BridgeError]] = {
    cls.code: cls
    for cls in (
        BridgeError,
        UnknownOperationError,
        InvalidRequestError,
        ForbiddenError,
        NotFoundError,
        UnavailableError,
    )
}
