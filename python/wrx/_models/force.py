# Generated from docs/json-schema/force.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

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


class Force(BaseModel):
    """
    A side in the game
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
    colour: constr(pattern=r"^#[0-9a-fA-F]{6}$")
    """
    Colour for message authors; not a theme token (§3 rule 13)
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
    isUmpire: bool
    """
    The umpire flag: this is the White Force, which the admin plays in as umpire; exactly one force has it (ADM-4, D8)
    """
    order: conint(ge=0, le=9007199254740991)
    """
    Admin-set display order; ties sort by id (SRD §3 rule 7)
    """
    theme: Theme | None = None
    """
    Styles the force panel only (D19)
    """
