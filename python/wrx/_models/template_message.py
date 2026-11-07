# Generated from docs/json-schema/template-message.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, constr


class TemplateContent(BaseModel):
    templateId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The template used
    """
    values: dict[
        constr(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$"),
        constr(max_length=8000) | float | bool,
    ] = Field(..., max_length=100)
    """
    Field values by field name; pickers hold GUIDs, never names (TPL-8)
    """


class TemplateMessage(BaseModel):
    """
    A templated message
    """

    type: Literal["template"]
    schemaVersion: Literal[1]
    content: TemplateContent
