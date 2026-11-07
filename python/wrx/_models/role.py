# Generated from docs/json-schema/role.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, conint, constr


class Role(BaseModel):
    """
    A player position; one XMPP account
    """

    schemaVersion: Literal[1]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Role id, a GUID
    """
    loginName: constr(
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64
    )
    """
    Login name: the role's XMPP account name, readable, fixed once published (§3 rule 1, ADM-5)
    """
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Id of the role's force
    """
    isObserver: bool
    """
    Observers read but never post, in all their rooms (D8)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """
