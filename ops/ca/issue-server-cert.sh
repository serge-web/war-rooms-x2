#!/bin/sh
# Makes the WRX1 server's TLS key and certificate (NFR-2):
#
#   sh issue-server-cert.sh --host wrx.exercise.internal [--host other.name] --out DIR \
#      (--ca-dir CADIR [--days 397] | --csr-only)
#
# With --ca-dir, signs with the CA that make-internal-ca.sh made (asks for its passphrase).
# With --csr-only, writes DIR/server.csr for your organisation's CA to sign, and stops; put the
# certificate it returns at DIR/server.crt.
#
# Writes DIR/server.key (mode 600) and DIR/server.crt. Every --host goes into the certificate's
# subjectAltName; the first is its subject. Name the host users type in the browser
# (WRX_HOSTNAME, or WRX_DOMAIN). Then install with:
#   offline-install.sh <bundle> --cert DIR/server.crt --key DIR/server.key --ca CADIR/ca.crt ...
# Needs openssl.
set -eu
out=""
cadir=""
csronly=0
days=397
hosts=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) hosts="$hosts $2"; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --ca-dir) cadir=$2; shift 2 ;;
    --csr-only) csronly=1; shift ;;
    --days) days=$2; shift 2 ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] && [ -n "$hosts" ] || { echo "usage: issue-server-cert.sh --host NAME --out DIR (--ca-dir DIR | --csr-only)" >&2; exit 2; }
[ "$csronly" = 1 ] || [ -f "$cadir/ca.key" ] || { echo "no CA key in '$cadir' (or pass --csr-only)" >&2; exit 2; }
command -v openssl >/dev/null 2>&1 || { echo "needs openssl" >&2; exit 1; }
umask 077
mkdir -p "$out"
first=""
san=""
for h in $hosts; do
  printf '%s' "$h" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$' || { echo "not a host name: $h" >&2; exit 2; }
  first=${first:-$h}
  san="${san:+$san, }DNS:$h"
done

cat >"$out/server.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $first
[server]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $san
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF
[ -f "$out/server.key" ] || openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$out/server.key" 2>/dev/null
chmod 600 "$out/server.key"
openssl req -new -key "$out/server.key" -config "$out/server.cnf" -out "$out/server.csr"
if [ "$csronly" = 1 ]; then
  echo "request: $out/server.csr (for $san). Have your CA sign it for serverAuth with that subjectAltName."
  exit 0
fi
openssl x509 -req -in "$out/server.csr" -CA "$cadir/ca.crt" -CAkey "$cadir/ca.key" \
  -CAcreateserial -CAserial "$cadir/ca.srl" -days "$days" -sha256 \
  -extfile "$out/server.cnf" -extensions server -out "$out/server.crt"
chmod 644 "$out/server.crt"
openssl verify -CAfile "$cadir/ca.crt" "$out/server.crt"
echo "certificate: $out/server.crt ($san, $days days)"
echo "key:         $out/server.key"
