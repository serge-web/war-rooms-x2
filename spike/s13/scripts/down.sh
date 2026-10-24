#!/bin/sh
# Stop the S13 stack and delete its volumes (all test state).
set -eu
cd "$(dirname "$0")/../docker"
docker compose down -v
