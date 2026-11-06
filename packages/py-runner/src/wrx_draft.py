"""The browser runner's draft write (WP 6.2), until the SDK's act layer (WP 6.4) replaces it.

Admin only: the world-state draft, held on the page and applied only when the script finishes
cleanly; a run that is stopped, times out or fails leaves the draft as it was (PD7, PD9). The
page checks the state against the world-state schema and the 500 KB cap (PLY-53).

    import wrx, wrx_draft
    state = await wrx.Game().world_state()
    ...
    await wrx_draft.write_draft(state)
"""

import json

from _wrx_bridge import call as _call
from wrx.errors import ERRORS, BridgeError


async def write_draft(state):
    """Writes the draft: a `wrx.models.WorldState`, or the same as a plain dict."""
    if hasattr(state, "model_dump"):
        state = state.model_dump(mode="json", exclude_none=True)
    reply = json.loads(await _call("writeDraft", json.dumps(state)))
    if not reply["ok"]:
        raise ERRORS.get(reply.get("code", "failed"), BridgeError)("writeDraft", reply["error"])
    return reply["value"]
