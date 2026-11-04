#!/bin/sh
# Start one S15-S16 stack and create its admin account (the reference operator bootstrap).
#   sh scripts/up.sh ref|tight|http
# Prints the WebSocket URL. If ejabberd does not become healthy, prints its log and exits 1.
set -eu
cfg="${1:?usage: up.sh ref|tight|http}"
case "$cfg" in
  ref) port=35980 ;;
  tight) port=35981 ;;
  http) port=35982 ;;
  *) echo "unknown config $cfg" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/../docker"
sh ./make-ca.sh >/dev/null
export S1516_CONFIG="$cfg" S1516_PORT="$port"
if ! docker compose up -d --wait --force-recreate; then
  echo "--- ejabberd did not become healthy (config $cfg); log follows ---" >&2
  docker compose logs --no-color --tail 300 >&2 || true
  exit 1
fi
docker compose exec -T ejabberd sh /home/ejabberd/bootstrap.sh
echo "S15-S16 $cfg ready: wss://localhost:$port/ws (CA: $(pwd)/tls-out/ca.crt)"
