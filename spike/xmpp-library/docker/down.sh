#!/bin/sh
# Stop the reference ejabberd and remove its containers and volume.
set -eu
cd "$(dirname "$0")"
docker compose -f compose.yaml down -v --remove-orphans
