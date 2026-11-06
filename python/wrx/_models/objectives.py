# Generated from docs/json-schema/objectives.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import AwareDatetime, BaseModel, constr


class Objectives(BaseModel):
    """
    A force's objectives; confidential to that force, the White Force and the admin
    """

    schemaVersion: Literal[1]
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Id of the force these objectives belong to
    """
    markdown: constr(max_length=50000)
    """
    Objectives as Markdown
    """
    updatedAt: AwareDatetime
    """
    When the admin wrote this version, by the admin's clock; display only. The node holds one item, the admin's, replaced on each edit; a live notification replaces the copy fetched at login, whatever this says (§3 rule 14)
    """
