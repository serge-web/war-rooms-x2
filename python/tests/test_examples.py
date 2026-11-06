"""The sample scripts (python/examples) run as the Scripts panel runs them, top-level await and
all, against the fake bridge over the demo game: each as the role it is for."""

from __future__ import annotations

import ast
import asyncio
import contextlib
import io
from pathlib import Path
from typing import Any

import pytest

import wrx.game

from .test_act import ActingBridge, as_white_cell

EXAMPLES = Path(__file__).parent.parent / "examples"


def run_example(name: str, bridge: ActingBridge, monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setattr(wrx.game, "default_bridge", lambda: bridge)
    source = (EXAMPLES / name).read_text(encoding="utf-8")
    code = compile(source, name, "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    out = io.StringIO()
    scope: dict[str, Any] = {"__name__": "__main__"}
    with contextlib.redirect_stdout(out):
        result = eval(code, scope)  # noqa: S307 - our own example, as the runner runs it
        if asyncio.iscoroutine(result):
            asyncio.run(result)
    return out.getvalue()


@pytest.mark.parametrize(
    "name", ["game_summary.py", "asset_report.py", "recent_messages.py", "turn_notice.py"]
)
def test_the_read_and_send_examples_run(name: str, monkeypatch: pytest.MonkeyPatch) -> None:
    if name == "asset_report.py":
        pytest.importorskip("pandas")
    output = run_example(name, ActingBridge(), monkeypatch)
    assert output.strip() != ""


def test_turn_notice_posts_to_blue_hq(monkeypatch: pytest.MonkeyPatch) -> None:
    bridge = ActingBridge()
    output = run_example("turn_notice.py", bridge, monkeypatch)
    sent = [request for op, request in bridge.calls if op == "sendMessage"]
    assert len(sent) == 1 and sent[0]["text"].startswith("Umpire notice: it is turn 1")
    assert "Posted to Blue HQ" in output


def test_the_admin_examples_write_the_draft(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("advance_blue.py", "resupply.py"):
        bridge = ActingBridge()
        output = run_example(name, bridge, monkeypatch)
        ops = [op for op, _ in bridge.calls]
        assert "readDraft" in ops, name
        assert output.strip() != "", name
    # Advance Blue moves Blue's assets and writes them.
    bridge = ActingBridge()
    run_example("advance_blue.py", bridge, monkeypatch)
    written = [request for op, request in bridge.calls if op == "writeDraft"]
    assert len(written) == 1


def test_propose_damage_posts_a_proposal_as_the_white_force(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bridge = as_white_cell(ActingBridge())
    output = run_example("propose_damage.py", bridge, monkeypatch)
    posted = [request for op, request in bridge.calls if op == "postProposal"]
    assert len(posted) == 1
    assert posted[0]["summary"].startswith("Tank Company hit by artillery")
    assert "Proposed to the admin" in output
    # As the admin it says so instead of proposing.
    with pytest.raises(SystemExit):
        run_example("propose_damage.py", ActingBridge(), monkeypatch)
