# Generated from docs/json-schema/room.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, conint, constr


class Participant(BaseModel):
    """
    A room participant entry (§3 rule 4)
    """

    kind: Literal["force", "role"]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Force or role id
    """
    access: Literal["write", "read"]
    """
    Read-only entries join as MUC visitors
    """


class ThemeTokens(BaseModel):
    """
    Design tokens; an unset token inherits from the game theme, then the default
    """

    primary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    secondary: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    background: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    surface: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    text: constr(pattern=r"^#[0-9a-fA-F]{6}$") | None = None
    """
    Colour as #rrggbb
    """
    fontFamily: Literal["sans", "serif", "mono"] | None = None
    """
    Bundled font id
    """


class Theme(BaseModel):
    """
    Theme: tokens plus optional logo and icon assets
    """

    tokens: ThemeTokens
    logoAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an `assets:<id>` node
    """
    iconAssetId: (
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        | None
    ) = None
    """
    Id of an `assets:<id>` node
    """


class Room(BaseModel):
    """
    A channel: one MUC room plus this config
    """

    schemaVersion: Literal[1]
    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    Entity id: a lowercase GUID, generated at creation, never reused (SRD §3 rule 1)
    """
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    roomType: constr(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64)
    """
    Room type id from the registry (v1: chat and map)
    """
    participants: list[Participant]
    """
    Mixed force and role entries; White Force roles are added implicitly, and a role entry assigns a White Force observer the room (§3 rule 4)
    """
    config: dict[str, Any]
    """
    Type-specific config, validated by the room type (ARC-5)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """
    theme: Theme | None = None
    """
    Styles this room's panel and tab
    """
