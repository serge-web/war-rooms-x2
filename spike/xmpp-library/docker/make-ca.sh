#!/bin/sh
# Throwaway internal CA plus a "localhost" server cert for wss:// (NFR-2: internal CA supported).
# Adapted from serge-web/xmpp-spike @ 4992530, spike/docker/tls/make-ca.sh. Output: ./tls-out (gitignored).
set -eu
cd "$(dirname "$0")"
mkdir -p tls-out && cd tls-out
[ -f ca.key ] || openssl req -x509 -newkey rsa:3072 -nodes -keyout ca.key -out ca.crt -days 3650 -subj "/CN=WRX1 WP0.3 Test CA" 2>/dev/null
cat > san.cnf <<'CNF'
subjectAltName = DNS:localhost, DNS:conference.localhost, DNS:pubsub.localhost, IP:127.0.0.1
extendedKeyUsage = serverAuth
CNF
if [ ! -f server.pem ]; then
  openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" 2>/dev/null
  openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 825 -extfile san.cnf 2>/dev/null
  cat server.crt server.key > server.pem # ejabberd wants cert+key in one PEM
  chmod 644 server.pem server.key ca.crt
fi
echo "CA: $(pwd)/ca.crt"
