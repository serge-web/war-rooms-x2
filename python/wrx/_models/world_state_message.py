# Generated from docs/json-schema/world-state-message.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, confloat, conint, constr


class WorldAsset(BaseModel):
    """
    A unit or platform on the map, with the fixed fields of v1 (§3 rule 17)
    """

    id: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The asset GUID; also its key in `assets` (§3 rules 1, 16)
    """
    forceId: constr(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    """
    The force that owns the asset
    """
    title: constr(min_length=1, max_length=120)
    """
    Display name, e.g. "1st Armoured Squadron"
    """
    category: constr(min_length=1, max_length=60)
    """
    What kind of asset it is, e.g. "armour" or "frigate"
    """
    sidc: constr(
        pattern=r"^(?:[SGWIOE][PUAFNSHGWMDLJK*-][A-Z*-][APCDXF*-][A-Z0-9*-]{8}[A-Z*-]{3}|[0-9]{20}|[0-9]{30})$"
    )
    """
    MIL-STD-2525/APP-6 symbol identification code (SIDC): 15 letter-based characters (2525C, APP-6 B/C) or 20 or 30 digits (2525D/E, APP-6 D)
    """
    lat: confloat(ge=-90.0, le=90.0)
    """
    Latitude, WGS 84 decimal degrees
    """
    lon: confloat(ge=-180.0, le=180.0)
    """
    Longitude, WGS 84 decimal degrees
    """
    state: constr(min_length=1, max_length=60)
    """
    Its condition in words, e.g. "operational" or "damaged"
    """
    health: confloat(ge=0.0, le=100.0)
    """
    Health, 0 (destroyed) to 100 (full)
    """
    fuel: confloat(ge=0.0, le=100.0)
    """
    Fuel, 0 (empty) to 100 (full)
    """


class WorldState(BaseModel):
    """
    The full world state: every asset with its position and status (D25)
    """

    turn: conint(ge=1, le=10000)
    """
    The turn this state belongs to
    """
    assets: dict[
        constr(
            pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        ),
        WorldAsset,
    ] = Field(..., max_length=5000)
    """
    Every asset, keyed by its GUID; each key is its asset’s `id` (JSON Schema cannot say so: zod and the Python SDK check it)
    """


class WorldStateMessage(BaseModel):
    """
    A world-state message in the map room, posted by the admin only
    """

    type: Literal["world-state"]
    schemaVersion: Literal[1]
    content: WorldState
