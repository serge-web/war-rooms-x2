# Generated from docs/json-schema/game-setup.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, conint, constr


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


class GameSetup(BaseModel):
    """
    Game properties and the game theme
    """

    schemaVersion: Literal[1]
    name: constr(min_length=1, max_length=120)
    """
    Display name
    """
    description: constr(max_length=1000)
    """
    Short description
    """
    briefing: constr(max_length=20000)
    """
    Public Markdown briefing for the welcome page (PLY-46–48)
    """
    designVersion: conint(ge=1, le=9007199254740991)
    """
    Incremented by a publish that changes the structure: a room added or removed, or the effective access to a room of a role in both designs (§3 rule 8); keys saved layouts (PLY-5)
    """
    theme: Theme
    roomTypeDefaults: dict[
        constr(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", min_length=1, max_length=64),
        dict[str, Any],
    ]
    """
    Default config per room type, validated by that type (ARC-5)
    """
