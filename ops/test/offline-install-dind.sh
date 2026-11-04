#!/bin/sh
# Tests the offline install (NFR-23) as far as a container allows: a Docker-in-Docker container
# started with --network none plays the air-gapped host. Inside it, with no network interface
# but loopback, the test shows that no registry is reachable, then runs the bundle's own
# offline-install.sh (which loads the image, installs, starts ejabberd and runs
# check-deployment.sh), then an upgrade over the running install. The host then reaches the
# deployment through `docker exec` (exec-bridge.ts), never a network, to run the contract
# suite and the deployment checks against it.
#
#   sh ops/test/offline-install-dind.sh --bundle B.tar.gz --env wrx1.env --cert C --key K \
#     --ca CA --admin-password-file F [--bridge-port 35935] [--keep]
#
# What a container cannot show: a host with no network stack at all, a different kernel, CPU or
# Docker version, real DNS and certificate distribution, and browsers on other machines. That is
# the real-hardware run (NFR-23).
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
. "$repo/ops/lib.sh"
# docker:29-dind, pinned by digest like every image here.
dind=docker:29-dind@sha256:9e79b879b177fbd72c34376a3dd3d91747da5db49e1f560f76aea59561471977
name=wrx-offline-test
bundle="" env="" cert="" key="" ca="" pwfile=""
bridge=35935
keep=0
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) bundle=$2; shift 2 ;;
    --env) env=$2; shift 2 ;;
    --cert) cert=$2; shift 2 ;;
    --key) key=$2; shift 2 ;;
    --ca) ca=$2; shift 2 ;;
    --admin-password-file) pwfile=$2; shift 2 ;;
    --bridge-port) bridge=$2; shift 2 ;;
    --keep) keep=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done
for v in "$bundle" "$env" "$cert" "$key" "$ca" "$pwfile"; do [ -f "$v" ] || die "missing file: '$v'"; done
need_docker
abs() { printf '%s/%s' "$(cd "$(dirname "$1")" && pwd)" "$(basename "$1")"; }
domain=$(env_value "$env" WRX_DOMAIN)
port=$(env_value "$env" WRX_HTTPS_PORT)

in=$(mktemp -d)
cp "$(abs "$bundle")" "$in/bundle.tar.gz"
[ ! -f "$bundle.sha256" ] || sed 's/ .*/  bundle.tar.gz/' "$bundle.sha256" >"$in/bundle.tar.gz.sha256"
cp "$env" "$in/wrx1.env"
cp "$cert" "$in/server.crt"
cp "$key" "$in/server.key"
cp "$ca" "$in/ca.crt"
cp "$pwfile" "$in/admin.pw"
chmod -R a+rX "$in"

cleanup() {
  [ -z "${bridge_pid:-}" ] || kill "$bridge_pid" 2>/dev/null || true
  [ "$keep" = 1 ] || docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$in"
}
trap cleanup EXIT INT TERM

docker rm -f "$name" >/dev/null 2>&1 || true
say "starting the air-gapped host: $dind, --network none"
docker run -d --privileged --network none --name "$name" --add-host "$domain:127.0.0.1" \
  -v "$in:/in:ro" "$dind" >/dev/null
i=0
until docker exec "$name" docker info >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -lt 60 ] || die "dockerd did not start in the test container"
  sleep 1
done

say "the host has no network:"
docker exec "$name" sh -c 'ls /sys/class/net | tr "\n" " "; echo'
if docker exec "$name" sh -c 'wget -q -T 5 -O /dev/null https://registry-1.docker.io/v2/' 2>/dev/null; then
  die "the test container reached a registry: it is not air-gapped"
fi
if docker exec "$name" docker pull -q hello-world >/dev/null 2>&1; then
  die "the test container could pull an image: it is not air-gapped"
fi
say "  no registry reachable, docker pull fails"
[ -z "$(docker exec "$name" docker images -q)" ] || die "the test host already has images"

say "installing from the bundle, with the bundle's own offline-install.sh"
docker exec "$name" sh -c '
  set -e
  mkdir -p /tmp/b && tar -xzf /in/bundle.tar.gz -C /tmp/b
  sh /tmp/b/wrx1-bundle-*/ops/offline-install.sh /in/bundle.tar.gz --home /opt/wrx1 \
    --env /in/wrx1.env --cert /in/server.crt --key /in/server.key --ca /in/ca.crt \
    --admin-password-file /in/admin.pw
'
say "installing again over the running deployment (an upgrade: backs up first, keeps the data)"
docker exec "$name" sh -c 'sh /tmp/b/wrx1-bundle-*/ops/offline-install.sh /in/bundle.tar.gz --home /opt/wrx1'
docker exec "$name" sh -c 'ls /opt/wrx1/backups/*.tar.gz >/dev/null' || die "the upgrade made no backup"
docker exec "$name" docker images --format '{{.Repository}}:{{.Tag}}' | sed 's/^/  image: /'

say "bridging 127.0.0.1:$bridge to the test host's port $port through docker exec"
node "$repo/ops/test/exec-bridge.ts" "$name" "$port" "$bridge" &
bridge_pid=$!
sleep 1
export WRX_XMPP_WS="wss://$domain:$bridge/ws" WRX_XMPP_DOMAIN="$domain" WRX_XMPP_CA
WRX_XMPP_CA=$(abs "$ca")
WRX_ADMIN_PASSWORD=$(head -n 1 "$pwfile")
export WRX_ADMIN_PASSWORD WRX_EXPECT_CLIENT=1
say "deployment checks against the air-gapped install"
pnpm --dir "$repo" test:deployment:ejabberd
say "contract suite against the air-gapped install"
pnpm --dir "$repo" test:contract
say "offline install: passed"
