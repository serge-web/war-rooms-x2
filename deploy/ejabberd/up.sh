#!/bin/sh
# Start the reference ejabberd (compose project wrx-contract) and create the admin account.
# Prints the WebSocket URL and the CA file that Node must trust (NODE_EXTRA_CA_CERTS).
set -eu
cd "$(dirname "$0")"
sh ./make-ca.sh
docker compose -f compose.yaml up -d --wait
docker compose -f compose.yaml exec -T ejabberd sh /home/ejabberd/bootstrap.sh
echo "ejabberd ready: wss://localhost:${WRX_XMPP_PORT:-35443}/ws (CA: $(pwd)/tls-out/ca.crt)"
