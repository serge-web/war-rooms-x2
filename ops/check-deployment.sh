#!/bin/sh
# Checks a running WRX1 deployment from the outside, the way a browser meets it (NFR-2, NFR-10,
# NFR-22): the certificate, TLS versions, the client and its config.json, the HTTP security
# headers, the WebSocket endpoint, and that no admin or API page answers. offline-install.sh
# runs it after every install; run it any time:
#
#   sh check-deployment.sh [--home DIR] [--connect HOST:PORT]
#
# --connect is where to reach the server (default 127.0.0.1 and WRX_HTTPS_PORT); the TLS name
# checked is always WRX_DOMAIN. Needs openssl on the host, or uses the one in
# the installed ejabberd image. Prints one line per check; exits 1 if any fails.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
connect=""
while [ $# -gt 0 ]; do
  case "$1" in
    --home) WRX_HOME=$2; shift 2 ;;
    --connect) connect=$2; shift 2 ;;
    -h | --help) sed -n '2,11p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
wrx_home_abs
env="$WRX_HOME/wrx1.env"
[ -f "$env" ] || die "no $env"
domain=$(env_value "$env" WRX_DOMAIN)
port=$(env_value "$env" WRX_HTTPS_PORT)
port=${port:-443}
connect=${connect:-127.0.0.1:$port}
cafile=$(wrx_tls_path ca.crt)
servercert=$(wrx_tls_path server.pem)

failed=0
pass() { printf '  pass  %s\n' "$*"; }
fail() {
  printf '  FAIL  %s\n' "$*"
  failed=1
}

tls() {
  wrx_openssl s_client -connect "$connect" -servername "$domain" -CAfile "$cafile" "$@"
}
# One HTTPS request; prints the status line, headers and body.
request() {
  printf 'GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n%b\r\n' "$1" "$domain" "${2:-}" |
    tls -quiet -verify_return_error 2>/dev/null | tr -d '\r'
}
status() { request "$@" | sed -n '1s/^HTTP\/1\.[01] \([0-9]*\).*/\1/p'; }
header() { request "$1" | sed -n "1,/^\$/s/^$2: //Ip" | head -n 1; }

say "checking https://$domain:$port/ (connecting to $connect)"

out=$(tls -verify_hostname "$domain" -verify_return_error </dev/null 2>&1 || true)
if printf '%s' "$out" | grep -q 'Verify return code: 0 (ok)'; then
  pass "the certificate chains to tls/ca.crt and names $domain"
else
  fail "the certificate does not verify for $domain: $(printf '%s' "$out" | grep -m1 -i -E 'verify error|errno|refused' || echo 'no TLS connection')"
fi
end=$(wrx_openssl x509 -noout -enddate -in "$servercert" 2>/dev/null | cut -d= -f2 || true)
if [ -f "$WRX_HOME/tls/server.pem" ] && ! wrx_openssl x509 -noout -checkend 2592000 -in "$servercert" >/dev/null 2>&1; then
  fail "the certificate expires within 30 days ($end)"
elif [ -n "$end" ]; then
  pass "the certificate is valid until $end"
fi
for old in tls1 tls1_1; do
  if tls "-$old" -cipher 'DEFAULT@SECLEVEL=0' </dev/null 2>&1 | grep -q 'BEGIN CERTIFICATE\|^Server certificate'; then
    fail "$old is accepted"
  else
    pass "$old is refused (TLS 1.2 or later only)"
  fi
done

[ "$(status /)" = 200 ] && pass "the client page answers 200" || fail "the client page does not answer 200"
csp=$(header / Content-Security-Policy)
case "$csp" in
  *"connect-src 'self'"*"frame-ancestors 'none'"*) pass "Content-Security-Policy: connect-src 'self', frame-ancestors 'none'" ;;
  *) fail "Content-Security-Policy header missing or not narrowed: '$csp'" ;;
esac
# The Python runner (WP 6.2, SRD Annex C PR3): WebAssembly and blob: workers, never eval.
case "$csp" in
  *"'unsafe-eval'"*) fail "the policy allows 'unsafe-eval'" ;;
  *"script-src 'self' 'wasm-unsafe-eval';"*"worker-src 'self' blob:;"*)
    pass "Content-Security-Policy: 'wasm-unsafe-eval' and blob: workers, no 'unsafe-eval'" ;;
  *) fail "Content-Security-Policy lacks the Python runner's script-src or worker-src: '$csp'" ;;
esac
wasm=$(header /py/pyodide/pyodide.asm.wasm Content-Type)
[ "$wasm" = application/wasm ] && pass "Pyodide's .wasm is served as application/wasm" ||
  fail "Pyodide's .wasm is served as '${wasm:-nothing}', not application/wasm"
[ "$(header / X-Content-Type-Options)" = nosniff ] && pass "X-Content-Type-Options: nosniff" ||
  fail "no X-Content-Type-Options: nosniff"
[ "$(header / Referrer-Policy)" = no-referrer ] && pass "Referrer-Policy: no-referrer" ||
  fail "no Referrer-Policy: no-referrer"
config=$(request /config.json | sed '1,/^$/d')
case "$config" in
  *'"websocketUrl": "/ws"'*"\"domain\": \"$domain\""*) pass "config.json names /ws and $domain" ;;
  *) fail "config.json is missing or wrong: $(printf '%s' "$config" | head -c 200)" ;;
esac
[ "$(status /popout.html)" = 200 ] && pass "popout.html answers 200" || fail "popout.html does not answer 200"

# The WebSocket stays open after the 101, so this request is cut off after a few seconds.
WRX_TIMEOUT=5
ws=$(status /ws 'Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: d3J4MS1jaGVjay1rZXk=\r\nSec-WebSocket-Protocol: xmpp\r\n')
WRX_TIMEOUT=20
[ "$ws" = 101 ] && pass "wss://$domain:$port/ws accepts a WebSocket (xmpp)" ||
  fail "the WebSocket endpoint answered ${ws:-nothing}, not 101"
for path in /api /api/status /admin /admin/ /register /upload /oauth; do
  code=$(status "$path")
  [ "$code" = 404 ] && pass "$path answers 404" || fail "$path answers ${code:-nothing}, not 404"
done

if [ "$failed" = 0 ]; then
  say "all checks passed"
else
  say "some checks FAILED"
  exit 1
fi
