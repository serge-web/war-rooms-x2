"""The transport seam (Annex C PD3, PY-4): the SDK talks only to a `Bridge`.

A bridge takes an operation name and the request as JSON text, and returns the reply as JSON
text: `{"ok": true, "value": ...}` or `{"ok": false, "code": ..., "error": ...}`. The browser
runner's bridge (WP 6.2) answers on the page, from the logged-in session, checked against the
role; the native runner's will answer from its own XMPP connection. The SDK holds no access of
its own (PD2): it shows a script only what its bridge returns.
"""

from __future__ import annotations

import abc
import inspect
from collections.abc import Awaitable, Callable


class Bridge(abc.ABC):
    """Where the SDK's operations go. Implement `call` to plug in a runner, and `next_event` if
    it delivers events (protocol 2, WP 6.4)."""

    @abc.abstractmethod
    async def call(self, op: str, payload: str) -> str:
        """Sends one operation with its request as JSON text; returns the reply's JSON text."""

    async def next_event(self, timeout_ms: int | None = None) -> str | None:
        """The next event for the script's subscriptions, as JSON text; None if `timeout_ms`
        passes first. A bridge that delivers no events raises `NotImplementedError`."""
        raise NotImplementedError("this bridge delivers no events")


class PyodideBridge(Bridge):
    """The browser runner's bridge: the worker's `_wrx_bridge.call(op, payload)` (WP 6.2).

    Only strings cross: the worker never hands Python a proxy of a page object.
    """

    def __init__(
        self,
        call: Callable[[str, str], Awaitable[object]] | None = None,
        next_event: Callable[[int], Awaitable[object]] | None = None,
    ) -> None:
        if call is None:
            import _wrx_bridge  # type: ignore[import-not-found]

            call = _wrx_bridge.call
            next_event = getattr(_wrx_bridge, "next_event", None)
        self._call = call
        self._next_event = next_event

    async def call(self, op: str, payload: str) -> str:
        reply = self._call(op, payload)
        if inspect.isawaitable(reply):
            reply = await reply
        if not isinstance(reply, str):
            reply = str(reply)
        return reply

    async def next_event(self, timeout_ms: int | None = None) -> str | None:
        if self._next_event is None:
            raise NotImplementedError("this runner delivers no events")
        event = self._next_event(-1 if timeout_ms is None else timeout_ms)
        if inspect.isawaitable(event):
            event = await event
        return None if event is None else str(event)


def default_bridge() -> Bridge:
    """The bridge of the runner this script is in: today, only the browser runner's."""
    try:
        return PyodideBridge()
    except ImportError:
        raise RuntimeError(
            "No runner bridge here: pass a Bridge to wrx.Game, or run the script in a runner"
        ) from None
