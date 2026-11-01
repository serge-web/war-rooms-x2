#!/bin/sh
# Installs or upgrades WRX1 on a host with no network (NFR-23), from a bundle that
# ops/make-bundle.sh made on a connected machine. Needs: Docker Engine with the compose plugin,
# and sh, tar, gzip, sha256sum. Nothing is downloaded.
#
#   sh offline-install.sh <bundle.tar.gz | bundle folder> [options]
#
#   --home DIR                 where to install (default /opt/wrx1, or WRX_HOME)
#   --env FILE                 settings for a first install (from deploy/wrx1.env.example)
#   --cert FILE --key FILE     the server certificate (PEM, with any intermediates) and its key
#   --ca FILE                  the certificate of the CA that issued it (NFR-2)
#   --admin-password-file FILE the admin password, for a first install; else it is asked for
#   --reset-admin-password     set the admin password again (with the file, or asked for)
#   --no-backup                on an upgrade, do not back up the running deployment first
#
# A first install needs --env, --cert, --key and --ca. An upgrade (same --home) keeps the
# installed wrx1.env, certificates and data, backs up first, and replaces the image, the
# ejabberd config, the compose file and the client. See ops/README.md.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"

bundle=""
envfile=""
cert=""
key=""
ca=""
pwfile=""
resetpw=0
backup=1
while [ $# -gt 0 ]; do
  case "$1" in
    --home) WRX_HOME=$2; shift 2 ;;
    --env) envfile=$2; shift 2 ;;
    --cert) cert=$2; shift 2 ;;
    --key) key=$2; shift 2 ;;
    --ca) ca=$2; shift 2 ;;
    --admin-password-file) pwfile=$2; shift 2 ;;
    --reset-admin-password) resetpw=1; shift ;;
    --no-backup) backup=0; shift ;;
    -h | --help) sed -n '2,21p' "$0"; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) [ -z "$bundle" ] || die "one bundle only"; bundle=$1; shift ;;
  esac
done
[ -n "$bundle" ] || die "usage: offline-install.sh <bundle.tar.gz | folder> [options] (see --help)"

need_docker
need tar gzip sha256sum sed grep mktemp
umask 027

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

# ---- 1. the bundle: unpack and check every file against SHA256SUMS ----------------------------
if [ -d "$bundle" ]; then
  src=$(cd "$bundle" && pwd)
else
  [ -f "$bundle" ] || die "no bundle at $bundle"
  if [ -f "$bundle.sha256" ]; then
    (cd "$(dirname "$bundle")" && sha256sum -c "$(basename "$bundle").sha256" >/dev/null) ||
      die "$bundle does not match $bundle.sha256"
    say "bundle checksum matches $(basename "$bundle").sha256: $(cut -d' ' -f1 "$bundle.sha256")"
  else
    warn "no $bundle.sha256 beside the bundle: compare its SHA-256 by hand: $(sha256sum "$bundle" | cut -d' ' -f1)"
  fi
  tar -xzf "$bundle" -C "$work"
  src=$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'wrx1-bundle-*' | head -n 1)
  [ -n "$src" ] || die "$bundle is not a WRX1 bundle"
fi
[ -f "$src/MANIFEST" ] && [ -f "$src/SHA256SUMS" ] || die "$src is not a WRX1 bundle (no MANIFEST or SHA256SUMS)"
(cd "$src" && sha256sum -c SHA256SUMS >/dev/null 2>&1) || die "files in the bundle do not match its SHA256SUMS"
manifest() { env_value "$src/MANIFEST" "$1"; }
version=$(manifest version)
tag=$(manifest image_tag)
layers=$(manifest layers)
platform=$(manifest platform)
say "bundle $version, every file matches SHA256SUMS"

# ---- 2. the host --------------------------------------------------------------------------------
case "$(docker info --format '{{.Architecture}}')" in
  x86_64 | amd64) host=linux/amd64 ;;
  aarch64 | arm64) host=linux/arm64 ;;
  *) host="linux/$(docker info --format '{{.Architecture}}')" ;;
esac
[ "$host" = "$platform" ] || die "the bundle is for $platform, this host is $host (make a bundle with --platform $host)"

# ---- 3. the image: load it, and check it is the pinned one, layer by layer ----------------------
say "loading the ejabberd image"
docker load -i "$src/images/ejabberd.tar" >/dev/null
loaded=$(docker image inspect --format '{{json .RootFS.Layers}}' "$tag" 2>/dev/null) ||
  die "the bundle's image did not load as $tag"
[ "$loaded" = "$layers" ] || die "the loaded image's layers differ from the bundle's MANIFEST: not the pinned image"
local_tag="wrx1/ejabberd:$version"
docker tag "$tag" "$local_tag"
say "image $(manifest image) loaded and checked as $local_tag"

# ---- 4. settings --------------------------------------------------------------------------------
mkdir -p "$WRX_HOME"
WRX_HOME=$(cd "$WRX_HOME" && pwd)
chmod 750 "$WRX_HOME"
first=0
[ -f "$WRX_HOME/wrx1.env" ] || first=1
if [ "$first" = 1 ]; then
  [ -n "$envfile" ] || die "a first install needs --env FILE (start from $src/deploy/wrx1.env.example)"
  cp "$envfile" "$WRX_HOME/wrx1.env"
elif [ -n "$envfile" ]; then
  warn "keeping the installed $WRX_HOME/wrx1.env; edit it there to change settings ($envfile not used)"
fi
domain=$(env_value "$WRX_HOME/wrx1.env" WRX_DOMAIN)
port=$(env_value "$WRX_HOME/wrx1.env" WRX_HTTPS_PORT)
port=${port:-443}
label=$(env_value "$WRX_HOME/wrx1.env" WRX_LABEL)
label=${label:-$domain}
printf '%s' "$domain" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' ||
  die "WRX_DOMAIN in $WRX_HOME/wrx1.env must be a lower-case domain name, not '$domain'"
printf '%s' "$port" | grep -Eq '^[0-9]{1,5}$' || die "WRX_HTTPS_PORT must be a port number"
case "$label" in *'"'* | *'\'*) die "WRX_LABEL must not contain quotes or backslashes" ;; esac

# ---- 5. certificates (NFR-2) --------------------------------------------------------------------
mkdir -p "$WRX_HOME/tls"
chmod 750 "$WRX_HOME/tls"
if [ -n "$cert$key$ca" ]; then
  [ -n "$cert" ] && [ -n "$key" ] && [ -n "$ca" ] || die "--cert, --key and --ca go together"
  cat "$cert" "$key" >"$work/server.pem"
  cp "$ca" "$work/ca.crt"
elif [ "$first" = 1 ]; then
  die "a first install needs --cert, --key and --ca (see ops/README.md, 'Certificates')"
fi
if [ -f "$work/server.pem" ]; then
  # Check the pair with the image's openssl, so the host needs none.
  docker run --rm --network none --user 0:0 --entrypoint sh -v "$work:/c:ro" "$local_tag" -c '
    set -e
    openssl x509 -in /c/server.pem -noout -checkend 0 >/dev/null || { echo "the certificate cannot be read, or has expired"; exit 1; }
    c=$(openssl x509 -in /c/server.pem -noout -pubkey | openssl sha256)
    k=$(openssl pkey -in /c/server.pem -pubout | openssl sha256)
    [ "$c" = "$k" ] || { echo "the key does not belong to the certificate"; exit 1; }
    openssl verify -CAfile /c/ca.crt -untrusted /c/server.pem /c/server.pem >/dev/null ||
      { echo "the certificate does not chain to the CA given with --ca"; exit 1; }
    openssl x509 -in /c/server.pem -noout -checkhost "$1" | grep -q "does match" ||
      { echo "the certificate does not name $1 (subjectAltName)"; exit 1; }
  ' check "$domain" || die "certificate check failed"
  cp "$work/server.pem" "$WRX_HOME/tls/server.pem"
  cp "$work/ca.crt" "$WRX_HOME/tls/ca.crt"
  say "certificate for $domain installed"
fi
# ejabberd runs as uid 9000 in the container and must read the key; nobody else on the host may.
if [ "$(id -u)" = 0 ]; then
  chown 9000:9000 "$WRX_HOME/tls/server.pem"
  chmod 400 "$WRX_HOME/tls/server.pem"
  chmod 444 "$WRX_HOME/tls/ca.crt"
  chown root:9000 "$WRX_HOME/tls"
else
  chmod 644 "$WRX_HOME/tls/server.pem" "$WRX_HOME/tls/ca.crt"
  chmod 755 "$WRX_HOME/tls"
  warn "not run as root: the server key is readable by every account on this host"
fi

# ---- 6. back up a running deployment before changing it -----------------------------------------
if [ "$first" = 0 ] && [ "$backup" = 1 ] && [ -f "$WRX_HOME/compose.yaml" ] &&
  [ -n "$(wrx_compose ps -q ejabberd 2>/dev/null)" ]; then
  say "backing up the running deployment first"
  sh "$WRX_HOME/ops/backup.sh" --home "$WRX_HOME"
fi

# ---- 7. files -----------------------------------------------------------------------------------
cp "$src/deploy/compose.yaml" "$src/deploy/ejabberd.yml" "$src/deploy/wrx1.env.example" "$WRX_HOME/"
chmod 644 "$WRX_HOME/compose.yaml" "$WRX_HOME/ejabberd.yml"
rm -rf "$WRX_HOME/ops.new"
cp -R "$src/ops" "$WRX_HOME/ops.new"
rm -rf "$WRX_HOME/ops"
mv "$WRX_HOME/ops.new" "$WRX_HOME/ops"
cp "$src/MANIFEST" "$WRX_HOME/MANIFEST"
printf 'WRX_EJABBERD_IMAGE=%s\n' "$local_tag" >"$WRX_HOME/image.env"

# The client, with this deployment's config.json (NFR-9): the WebSocket is a path on the same
# origin, so the browser connects to wss://<host>/ws over the page's own TLS.
rm -rf "$WRX_HOME/www.new"
cp -R "$src/client" "$WRX_HOME/www.new"
cat >"$WRX_HOME/www.new/config.json" <<EOF
{
  "server": { "websocketUrl": "/ws", "domain": "$domain", "label": "$label" },
  "defaultBackend": "server"
}
EOF
chmod -R a+rX "$WRX_HOME/www.new"
rm -rf "$WRX_HOME/www.old"
[ ! -d "$WRX_HOME/www" ] || mv "$WRX_HOME/www" "$WRX_HOME/www.old"
mv "$WRX_HOME/www.new" "$WRX_HOME/www"
rm -rf "$WRX_HOME/www.old"
chmod 755 "$WRX_HOME"

# ---- 8. start ----------------------------------------------------------------------------------
# Always a new container: it must mount the new www/ (the old folder was moved away) and read
# the new ejabberd.yml. On an upgrade that is a restart of a few seconds.
say "starting ejabberd"
wrx_compose up -d --force-recreate --wait --wait-timeout 180 || {
  wrx_compose logs --tail 50 >&2 || true
  die "ejabberd did not become healthy"
}

# ---- 9. the admin account: the only out-of-band step (S4) ---------------------------------------
read_password() {
  if [ -n "$pwfile" ]; then
    [ -f "$pwfile" ] || die "no file $pwfile"
    head -n 1 "$pwfile"
  elif [ -t 0 ]; then
    printf 'Admin password for admin@%s (12 or more characters): ' "$domain" >&2
    stty -echo
    IFS= read -r pw
    stty echo
    printf '\n' >&2
    printf '%s' "$pw"
  else
    die "no admin password: pass --admin-password-file or run in a terminal"
  fi
}
exists=0
wrx_compose exec -T ejabberd ejabberdctl check_account admin "$domain" >/dev/null 2>&1 && exists=1
if [ "$exists" = 0 ] || [ "$resetpw" = 1 ]; then
  pw=$(read_password)
  [ "${#pw}" -ge 12 ] || die "the admin password must have 12 or more characters"
  # The password goes over stdin, never on a command line or into the environment.
  command=register
  [ "$exists" = 0 ] || command=change_password
  printf '%s\n' "$pw" | wrx_compose exec -T ejabberd sh -c \
    'IFS= read -r pw; ejabberdctl "$0" admin "$1" "$pw" >/dev/null' "$command" "$domain" ||
    die "could not set the admin password"
  pw=""
  say "admin@$domain $( [ "$exists" = 0 ] && echo created || echo 'password changed')"
fi

# ---- 10. check ----------------------------------------------------------------------------------
sh "$WRX_HOME/ops/check-deployment.sh" --home "$WRX_HOME"
url="https://$domain"
[ "$port" = 443 ] || url="$url:$port"
say "WRX1 $version is running: $url/ (admin backend: $url/#/admin)"
