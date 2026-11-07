# Generated from docs/json-schema/chat-message.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, constr


class ChatContent(BaseModel):
    text: constr(min_length=1, max_length=8000)
    """
    Plain text; rendered without HTML (PLY-14)
    """


class ChatMessage(BaseModel):
    """
    A chat room message
    """

    type: Literal["chat"]
    schemaVersion: Literal[1]
    content: ChatContent
