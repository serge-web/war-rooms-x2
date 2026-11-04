#!/bin/sh
# Start one S14 stack and create its admin account (the reference operator bootstrap).
#   sh scripts/up.sh v0|v1|v2            the config of that name, on its own volume
#   sh scripts/up.sh v1 --db v0          V0's database volume restarted under the V1 config (S14-9)
# Prints the WebSocket URL. If ejabberd does not become healthy, prints its log and exits 1.
set -eu
cfg="${1:?usage: up.sh v0|v1|v2|v1p|v2p [--db NAME]}"
db="$cfg"
if [ "${2:-}" = "--db" ]; then db="${3:?--db needs a name}"; fi
case "$db" in
  v0) port=35970 ;;
  v1) port=35971 ;;
  v2) port=35972 ;;
  v1p) port=35973 ;;
  v2p) port=35974 ;;
  *) echo "unknown db $db" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/../docker"
sh ./make-ca.sh >/dev/null
export S14_CONFIG="$cfg" S14_DB="$db" S14_PORT="$port"
if ! docker compose up -d --wait --force-recreate; then
  echo "--- ejabberd did not become healthy (config $cfg, db $db); log follows ---" >&2
  docker compose logs --no-color --tail 300 >&2 || true
  exit 1
fi
docker compose exec -T ejabberd sh /home/ejabberd/bootstrap.sh
echo "S14 $cfg (db $db) ready: wss://localhost:$port/ws (CA: $(pwd)/tls-out/ca.crt)"
