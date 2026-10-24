#!/bin/sh
# Start the reference ejabberd (compose project wrx-xmpplib, wss://localhost:25443/ws) and create the admin.
set -eu
cd "$(dirname "$0")"
sh ./make-ca.sh
docker compose -f compose.yaml up -d --wait
docker compose -f compose.yaml exec -T ejabberd sh /home/ejabberd/bootstrap.sh
echo "ejabberd ready: wss://localhost:25443/ws (CA: $(pwd)/tls-out/ca.crt)"
