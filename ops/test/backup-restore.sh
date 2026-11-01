#!/bin/sh
# Tests backup and restore end to end on this machine (WP 3.3), as a disaster recovery: install a
# bundle, publish a game and post messages, back up, delete the deployment and its data,
# install again from the same bundle, restore, and check that the vault unlocks, the audit is
# clean and every account, room, archived message, node and item is back.
#
#   sh ops/test/backup-restore.sh --bundle B.tar.gz --env wrx1.env --cert C --key K --ca CA \
#     --admin-password-file F --home DIR
#
# The env file's WRX_DOMAIN must resolve to this machine (e.g. a hosts entry), and the
# certificate must name it. Needs the repo's node_modules (pnpm install). Leaves the restored
# deployment running; stop it with: docker compose down -v (in DIR).
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
. "$repo/ops/lib.sh"
bundle="" env="" cert="" key="" ca="" pwfile=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bundle) bundle=$2; shift 2 ;;
    --env) env=$2; shift 2 ;;
    --cert) cert=$2; shift 2 ;;
    --key) key=$2; shift 2 ;;
    --ca) ca=$2; shift 2 ;;
    --admin-password-file) pwfile=$2; shift 2 ;;
    --home) WRX_HOME=$2; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
for v in "$bundle" "$env" "$cert" "$key" "$ca" "$pwfile"; do [ -f "$v" ] || die "missing file: '$v' (see the usage at the top)"; done
mkdir -p "$WRX_HOME"
wrx_home_abs
domain=$(env_value "$env" WRX_DOMAIN)
port=$(env_value "$env" WRX_HTTPS_PORT)
state="$WRX_HOME.fingerprint.json"
ca=$(cd "$(dirname "$ca")" && pwd)/$(basename "$ca")

install() {
  sh "$repo/ops/offline-install.sh" "$bundle" --home "$WRX_HOME" --env "$env" --cert "$cert" \
    --key "$key" --ca "$ca" --admin-password-file "$pwfile" --no-backup
}
wipe() {
  [ ! -f "$WRX_HOME/compose.yaml" ] || wrx_compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WRX_HOME"
  mkdir -p "$WRX_HOME"
}
check_step() {
  WRX_RESTORE_STEP=$1 WRX_RESTORE_STATE=$state WRX_XMPP_WS="wss://$domain:$port/ws" \
    WRX_XMPP_DOMAIN=$domain WRX_XMPP_CA=$ca WRX_ADMIN_PASSWORD=$(head -n 1 "$pwfile") \
    pnpm --dir "$repo" --filter @wrx/admin-ops test:restore:ejabberd
}

say "1. fresh install"
wipe
install
say "2. publish a game, post messages, record the server"
check_step seed
say "3. back up"
out=$(mktemp -d)
sh "$WRX_HOME/ops/backup.sh" --home "$WRX_HOME" --out "$out"
archive=$(find "$out" -name 'wrx1-backup-*.tar.gz' | head -n 1)
say "4. lose everything: the containers, the database volume and $WRX_HOME"
wipe
say "5. install again from the same bundle, onto an empty database"
install
say "6. restore"
sh "$WRX_HOME/ops/restore.sh" "$archive" --home "$WRX_HOME" --yes
say "7. check the restored server"
check_step verify
rm -rf "$out" "$state"
say "backup and restore: passed"
