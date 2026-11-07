# Generated from docs/json-schema/map-room-config.schema.json by tools/python/generate_models.py
# (datamodel-code-generator). Do not edit: run `pnpm python:models`.

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, confloat, conint


class LatLon(BaseModel):
    """
    A point, WGS 84 decimal degrees
    """

    lat: confloat(ge=-90.0, le=90.0)
    lon: confloat(ge=-180.0, le=180.0)


class MapRoomConfig(BaseModel):
    """
    Map room config: the opening view
    """

    schemaVersion: Literal[1]
    centre: LatLon | None = None
    """
    Where the map opens; unset, it fits the assets
    """
    zoom: conint(ge=0, le=22) | None = None
    """
    The zoom it opens at; unset, it fits the assets
    """
