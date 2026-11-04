#!/bin/sh
# Makes a small internal CA for a WRX1 network that has no CA of its own (NFR-2). If your
# organisation runs a CA, use it instead: issue-server-cert.sh --csr-only makes the request.
#
#   sh make-internal-ca.sh --out DIR [--name "WRX1 Exercise CA"] [--permit exercise.internal]
#                          [--days 1825] [--no-passphrase]
#
# Writes DIR/ca.key (the CA's private key, encrypted with a passphrase you are asked for) and
# DIR/ca.crt (its certificate, which browsers and the server are given). --permit adds an X.509
# name constraint, so the CA can only vouch for that domain and its subdomains: a browser that
# trusts it trusts nothing else it might sign. Use it.
#
# Keep ca.key off the WRX1 server and offline (a USB key in a safe): anyone with it can make
# certificates browsers that trust the CA accept. Needs openssl.
set -eu
out=""
name="WRX1 Exercise CA"
permit=""
days=1825
encrypt=1
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --name) name=$2; shift 2 ;;
    --permit) permit=$2; shift 2 ;;
    --days) days=$2; shift 2 ;;
    --no-passphrase) encrypt=0; shift ;;
    -h | --help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$out" ] || { echo "usage: make-internal-ca.sh --out DIR [options] (see --help)" >&2; exit 2; }
command -v openssl >/dev/null 2>&1 || { echo "needs openssl" >&2; exit 1; }
[ ! -f "$out/ca.key" ] || { echo "$out/ca.key exists; not overwriting a CA" >&2; exit 1; }
umask 077
mkdir -p "$out"

cat >"$out/ca.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = ca
[dn]
CN = $name
[ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
[ -z "$permit" ] || printf 'nameConstraints = critical, permitted;DNS:%s\n' "$permit" >>"$out/ca.cnf"

if [ "$encrypt" = 1 ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -aes-256-cbc -out "$out/ca.key"
else
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$out/ca.key" 2>/dev/null
fi
openssl req -new -x509 -key "$out/ca.key" -days "$days" -sha256 -config "$out/ca.cnf" -out "$out/ca.crt"
chmod 600 "$out/ca.key"
chmod 644 "$out/ca.crt"
echo "CA certificate: $out/ca.crt (give this to the server and to browsers)"
echo "CA key:         $out/ca.key (keep offline)"
openssl x509 -in "$out/ca.crt" -noout -subject -enddate -fingerprint -sha256
