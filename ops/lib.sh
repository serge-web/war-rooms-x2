# Shared by the ops scripts (sourced, not run). POSIX sh; needs docker with the compose plugin.
# Nothing here prints a password or writes one to disk.

WRX_HOME=${WRX_HOME:-/opt/wrx1}

# WRX_HOME as an absolute path (Docker bind mounts need one), once it exists.
wrx_home_abs() {
  [ ! -d "$WRX_HOME" ] || WRX_HOME=$(cd "$WRX_HOME" && pwd)
}

say() { printf '%s\n' "wrx1: $*"; }
warn() { printf '%s\n' "wrx1: warning: $*" >&2; }
die() {
  printf '%s\n' "wrx1: error: $*" >&2
  exit 1
}

need() {
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || die "needs '$tool' on the PATH"
  done
}

need_docker() {
  need docker
  docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon (is it running, and may this user use it?)"
  docker compose version >/dev/null 2>&1 || die "needs the Docker Compose plugin (docker compose)"
}

# The value of KEY in an env file (KEY=value lines; no quotes or expansion), or empty.
env_value() {
  sed -n "s/^$2=//p" "$1" | tail -n 1
}

# docker compose for the installed deployment in WRX_HOME.
wrx_compose() {
  wrx_home_abs
  [ -f "$WRX_HOME/compose.yaml" ] || die "no deployment in $WRX_HOME (run ops/offline-install.sh first, or set WRX_HOME)"
  docker compose --project-directory "$WRX_HOME" -f "$WRX_HOME/compose.yaml" \
    --env-file "$WRX_HOME/wrx1.env" --env-file "$WRX_HOME/image.env" "$@"
}

# Runs openssl from the host, or from the installed ejabberd image when the host has none (the
# image carries openssl, so the checks need nothing the bundle does not bring).
# Each run is cut off after WRX_TIMEOUT seconds (default 20), so a connection that stays open
# cannot hang a check.
wrx_openssl() {
  if command -v openssl >/dev/null 2>&1; then
    timeout "${WRX_TIMEOUT:-20}" openssl "$@"
  else
    image=$(env_value "$WRX_HOME/image.env" WRX_EJABBERD_IMAGE)
    [ -n "$image" ] || die "no openssl on the host and no installed image to borrow it from"
    timeout "${WRX_TIMEOUT:-20}" docker run --rm -i --network host --entrypoint openssl \
      -v "$WRX_HOME/tls/ca.crt:/tmp/ca.crt:ro" -v "$WRX_HOME/tls/server.pem:/tmp/server.pem:ro" \
      "$image" "$@"
  fi
}

# The path of tls/ca.crt or tls/server.pem for wrx_openssl: inside the image when it runs there.
wrx_tls_path() {
  if command -v openssl >/dev/null 2>&1; then printf '%s' "$WRX_HOME/tls/$1"; else printf '/tmp/%s' "$1"; fi
}
