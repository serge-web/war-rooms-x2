# Generated from docs/json-schema/chat-room-config.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, constr


class TemplateEntry(BaseModel):
    """
    Templates a force or role may use in a room (TD4, TPL-2)
    """

    kind: Literal["force", "role"]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Force or role GUID
    """
    templateIds: list[
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
    ]
    """
    Templates this force or role may use here; a role entry adds to its force’s
    """


class ChatRoomConfig(BaseModel):
    """
    Chat room config: free text and templates
    """

    schemaVersion: Literal[2]
    freeText: bool
    """
    Free text allowed beside templates (TD3)
    """
    templates: list[TemplateEntry]
    """
    Template entries per force or role (TD4)
    """
