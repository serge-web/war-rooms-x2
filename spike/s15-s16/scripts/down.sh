#!/bin/sh
# Stop S15-S16 stacks and delete their volumes (never the image). No argument: all of them.
#   sh scripts/down.sh            ref, tight and http
#   sh scripts/down.sh tight      one
set -eu
cd "$(dirname "$0")/../docker"
[ "$#" -gt 0 ] || set -- ref tight http
for cfg in "$@"; do
  S1516_CONFIG="$cfg" docker compose down -v --remove-orphans
done
