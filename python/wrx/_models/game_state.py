# Generated from docs/json-schema/game-state.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, conint


class GameState(BaseModel):
    """
    The current turn and phase
    """

    schemaVersion: Literal[1]
    turn: conint(ge=1, le=10000)
    """
    The turn number, from 1
    """
    phase: Literal["planning", "adjudication"]
    """
    Each turn has a planning phase, then an adjudication phase (D7)
    """
