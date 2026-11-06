# Generated from docs/json-schema/umpire-room-config.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class UmpireRoomConfig(BaseModel):
    """
    Umpire room config: nothing to set
    """

    model_config = ConfigDict(
        extra="forbid",
    )
    schemaVersion: Literal[1]
