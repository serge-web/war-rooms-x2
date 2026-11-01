#!/bin/sh
# Backs up a running WRX1 deployment, with no downtime:
#
#   sh backup.sh [--home DIR] [--out DIR]
#
# What it saves (ops/README.md, "Backup and restore"). ejabberd keeps WRX1's data in two stores,
# and both are saved while it runs:
# - the SQLite database (SQLite's online backup, then PRAGMA integrity_check): the rooms with
#   their settings, members and message archives, the PubSub nodes and their items (game
#   documents and the theme's uploaded image assets, which live in PubSub), and the admin's
#   private storage (the encrypted observer vault and the publish marker);
# - the Mnesia database (ejabberdctl backup): the accounts, with passwords as SCRAM-SHA-256
#   hashes (auth_method internal keeps them there, not in SQLite);
# - the deployment's settings: wrx1.env, image.env, MANIFEST and the CA certificate.
# The two stores are copied one after the other, a second or so apart: an account created or a
# message posted in that second may be in one and not the other.
# Not saved: the server's private key (keep it with your certificates), the admin password
# (never stored), and the admin's design drafts, which live in the admin's browser (export the
# design from the admin backend).
#
# Output: OUT/wrx1-backup-<UTC time>.tar.gz (mode 600) and a .sha256 beside it. Default OUT is
# WRX_HOME/backups. The backup holds the game's messages and password hashes: store it as you
# store the game itself.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    --home) WRX_HOME=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    -h | --help) sed -n '2,23p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
wrx_home_abs
out=${out:-$WRX_HOME/backups}
need_docker
need tar gzip sha256sum mktemp
umask 077
mkdir -p "$out"
out=$(cd "$out" && pwd)

stamp=$(date -u +%Y%m%dT%H%M%SZ)
name="wrx1-backup-$stamp"
db=/home/ejabberd/database
domain=$(env_value "$WRX_HOME/wrx1.env" WRX_DOMAIN)
work=$(mktemp -d)
cleanup() {
  rm -rf "$work"
  wrx_compose exec -T ejabberd rm -f "$db/$name.db" "$db/$name.mnesia" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

[ -n "$(wrx_compose ps -q --status running ejabberd)" ] || die "ejabberd is not running (start it: docker compose up -d, in $WRX_HOME)"
mkdir -p "$work/$name"
say "backing up the SQLite database (online)"
wrx_compose exec -T ejabberd sqlite3 "$db/ejabberd.db" ".backup '$db/$name.db'"
check=$(wrx_compose exec -T ejabberd sqlite3 "$db/$name.db" 'PRAGMA integrity_check;')
[ "$check" = ok ] || die "the database copy failed its integrity check: $check"
say "backing up the Mnesia database (accounts)"
wrx_compose exec -T ejabberd ejabberdctl backup "$db/$name.mnesia" >/dev/null
wrx_compose cp "ejabberd:$db/$name.db" "$work/$name/ejabberd.db" >/dev/null
wrx_compose cp "ejabberd:$db/$name.mnesia" "$work/$name/mnesia.backup" >/dev/null
wrx_compose exec -T ejabberd rm -f "$db/$name.db" "$db/$name.mnesia"

for f in wrx1.env image.env MANIFEST; do
  [ ! -f "$WRX_HOME/$f" ] || cp "$WRX_HOME/$f" "$work/$name/"
done
[ ! -f "$WRX_HOME/tls/ca.crt" ] || cp "$WRX_HOME/tls/ca.crt" "$work/$name/"
accounts=$(wrx_compose exec -T ejabberd ejabberdctl registered_users "$domain" | grep -c . || true)
counts=$(wrx_compose exec -T ejabberd sqlite3 "$db/ejabberd.db" \
    "SELECT (SELECT count(*) FROM muc_room) || ' rooms, ' || (SELECT count(*) FROM archive) || ' archived messages, ' || (SELECT count(*) FROM pubsub_item) || ' PubSub items';" 2>/dev/null ||
  echo 'counts unavailable')
cat >"$work/$name/BACKUP" <<EOF
backup=wrx1
created=$stamp
domain=$domain
contents=$accounts accounts, $counts
EOF

tar -czf "$out/$name.tar.gz" -C "$work" "$name"
chmod 600 "$out/$name.tar.gz"
(cd "$out" && sha256sum "$name.tar.gz" >"$name.tar.gz.sha256")
say "backup: $out/$name.tar.gz ($accounts accounts, $counts)"
