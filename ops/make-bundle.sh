#!/bin/sh
# Packs everything an air-gapped WRX1 host needs into one file (NFR-23). Run it on a connected
# machine, from a checkout of this repository:
#
#   pnpm --filter @wrx/web build:server     # or pass --build
#   sh ops/make-bundle.sh [--build] [--client DIR] [--out DIR] [--platform linux/amd64]
#
# It writes ops/out/wrx1-bundle-<version>.tar.gz and a .sha256 file beside it. Carry both to the
# host, compare the SHA-256 with the one printed here over a second channel (a phone call, a
# signed note), and run ops/offline-install.sh there.
#
# The bundle holds: the ejabberd image (pinned by digest, saved with `docker save`), the built
# client (the real-server build, without any config.json), the compose file and ejabberd.yml,
# the ops scripts and their guide, a MANIFEST (versions, the image's digest and layer digests)
# and SHA256SUMS. It holds no secret: no password, no private key, no certificate of any host.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
. "$repo/ops/lib.sh"

client="$repo/apps/web/server-build/dist"
out="$repo/ops/out"
platform=linux/amd64
build=0
while [ $# -gt 0 ]; do
  case "$1" in
    --client) client=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --platform) platform=$2; shift 2 ;;
    --build) build=1; shift ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

need_docker
need tar gzip sha256sum sed grep find

# The image, as deploy/wrx1/compose.yaml pins it (tools/check-deploy.ts keeps the stacks equal).
ref=$(grep -o 'ejabberd/ecs:[0-9.]*@sha256:[0-9a-f]\{64\}' "$repo/deploy/wrx1/compose.yaml" | head -n 1)
[ -n "$ref" ] || die "no pinned ejabberd image in deploy/wrx1/compose.yaml"
tag=${ref%@*}

if [ "$build" = 1 ]; then
  need pnpm
  say "building the client (real-server build)"
  (cd "$repo" && pnpm --filter @wrx/web build:server)
fi
[ -f "$client/index.html" ] || die "no built client in $client (run: pnpm --filter @wrx/web build:server, or pass --build)"
# The real-server build reads config.json; the mock-only build would never reach the server.
grep -q 'connect-src[^"]*wss:' "$client/index.html" ||
  die "$client is not the real-server build (vite build --mode server)"

commit=$(git -C "$repo" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)
dirty=$(git -C "$repo" status --porcelain 2>/dev/null | head -n 1)
appversion=$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "$repo/apps/web/package.json" | head -n 1)
version="${appversion:-0.0.0}-$commit${dirty:+-dirty}"
[ -z "$dirty" ] || warn "the checkout has uncommitted changes; the bundle is marked -dirty"

name="wrx1-bundle-$version"
stage="$out/$name"
rm -rf "$stage" "$out/$name.tar.gz" "$out/$name.tar.gz.sha256"
mkdir -p "$stage/images" "$stage/client" "$stage/deploy" "$stage/ops/ca"

if docker image inspect "$ref" >/dev/null 2>&1; then
  say "image $ref is already here"
else
  say "pulling $ref ($platform)"
  docker pull --platform "$platform" "$ref"
fi
arch=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$ref")
[ "$arch" = "$platform" ] || die "the local image is $arch, not $platform (docker pull --platform $platform $ref)"
layers=$(docker image inspect --format '{{json .RootFS.Layers}}' "$ref")
docker tag "$ref" "$tag"
say "saving $tag"
docker save --platform "$platform" -o "$stage/images/ejabberd.tar" "$tag" 2>/dev/null ||
  docker save -o "$stage/images/ejabberd.tar" "$tag"

say "copying the client, deploy files and ops scripts"
(cd "$client" && tar -cf - --exclude=./config.json .) | (cd "$stage/client" && tar -xf -)
cp "$repo/deploy/wrx1/compose.yaml" "$repo/deploy/wrx1/wrx1.env.example" "$stage/deploy/"
cp "$repo/deploy/ejabberd/ejabberd.yml" "$stage/deploy/"
cp "$repo/ops/lib.sh" "$repo/ops/offline-install.sh" "$repo/ops/backup.sh" "$repo/ops/restore.sh" \
  "$repo/ops/check-deployment.sh" "$repo/ops/README.md" "$stage/ops/"
cp "$repo/ops/ca/"*.sh "$stage/ops/ca/"

cat >"$stage/MANIFEST" <<EOF
bundle=wrx1
version=$version
commit=$commit
created=$(date -u +%Y-%m-%dT%H:%M:%SZ)
image=$ref
image_tag=$tag
platform=$platform
layers=$layers
EOF

# Nothing secret travels: refuse a bundle that carries a private key.
if grep -rIl -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$stage" >/dev/null 2>&1; then
  die "a private key is in the bundle: $(grep -rIl -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$stage" | head -n 1)"
fi

(cd "$stage" && find . -type f ! -name SHA256SUMS | LC_ALL=C sort | sed 's|^\./||' |
  while IFS= read -r f; do sha256sum "$f"; done >SHA256SUMS)
tar -czf "$out/$name.tar.gz" -C "$out" "$name"
(cd "$out" && sha256sum "$name.tar.gz" >"$name.tar.gz.sha256")
rm -rf "$stage"

say "bundle: $out/$name.tar.gz"
say "SHA-256: $(cut -d' ' -f1 "$out/$name.tar.gz.sha256")"
say "check this value on the target host before installing (sha256sum -c $name.tar.gz.sha256)"
