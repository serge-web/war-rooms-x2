#!/bin/sh
# Stop S14 stacks and delete their volumes. No argument: all of them (v0, v1, v2, v1p, v2p).
#   sh scripts/down.sh            all
#   sh scripts/down.sh v1         one
set -eu
cd "$(dirname "$0")/../docker"
[ "$#" -gt 0 ] || set -- v0 v1 v2 v1p v2p
for db in "$@"; do
  S14_DB="$db" S14_CONFIG="$db" docker compose down -v --remove-orphans
done
