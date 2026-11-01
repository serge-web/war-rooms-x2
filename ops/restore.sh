#!/bin/sh
# Restores a backup made by backup.sh into an installed WRX1 deployment:
#
#   sh restore.sh <wrx1-backup-*.tar.gz> [--home DIR] [--yes] [--no-backup]
#
# Everything on the server is replaced by the backup's contents: accounts, rooms and their
# archives, nodes and items, the admin's private storage. ejabberd is stopped for the swap
# (about a minute). Unless --no-backup, the current state is backed up first, so a restore can
# be undone. The installed settings (wrx1.env, certificates, image, client) are kept; the
# backup's copies are only compared, with a warning if the domain differs, since accounts are
# stored per domain.
#
# For a new host: install the same or a later bundle with offline-install.sh, then restore.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/lib.sh"
archive=""
yes=0
backup=1
while [ $# -gt 0 ]; do
  case "$1" in
    --home) WRX_HOME=$2; shift 2 ;;
    --yes) yes=1; shift ;;
    --no-backup) backup=0; shift ;;
    -h | --help) sed -n '2,13p' "$0"; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) archive=$1; shift ;;
  esac
done
[ -n "$archive" ] && [ -f "$archive" ] || die "usage: restore.sh <wrx1-backup-*.tar.gz> [--home DIR] [--yes]"
wrx_home_abs
need_docker
need tar gzip sha256sum mktemp
umask 077

if [ -f "$archive.sha256" ]; then
  (cd "$(dirname "$archive")" && sha256sum -c "$(basename "$archive").sha256" >/dev/null) ||
    die "$archive does not match $archive.sha256"
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
tar -xzf "$archive" -C "$work"
dir=$(find "$work" -mindepth 1 -maxdepth 1 -type d -name 'wrx1-backup-*' | head -n 1)
[ -n "$dir" ] && [ -f "$dir/ejabberd.db" ] && [ -f "$dir/mnesia.backup" ] && [ -f "$dir/BACKUP" ] ||
  die "$archive is not a WRX1 backup"
chmod 755 "$work" "$dir"
chmod 644 "$dir/ejabberd.db" "$dir/mnesia.backup"

image=$(env_value "$WRX_HOME/image.env" WRX_EJABBERD_IMAGE)
[ -n "$image" ] || die "no installed deployment in $WRX_HOME"
check=$(docker run --rm --network none --entrypoint sqlite3 -v "$dir:/restore:ro" "$image" \
  /restore/ejabberd.db 'PRAGMA integrity_check;')
[ "$check" = ok ] || die "the backup's database failed its integrity check: $check"
installed=$(env_value "$WRX_HOME/wrx1.env" WRX_DOMAIN)
saved=$(env_value "$dir/wrx1.env" WRX_DOMAIN 2>/dev/null || true)
[ -z "$saved" ] || [ "$saved" = "$installed" ] ||
  warn "the backup is of domain $saved, this deployment is $installed: its accounts will not log in here"
say "restoring $(env_value "$dir/BACKUP" created): $(env_value "$dir/BACKUP" contents)"

if [ "$yes" = 0 ]; then
  [ -t 0 ] || die "restoring replaces everything on the server: pass --yes to confirm"
  printf 'This replaces every account, room, message and document on the server. Type RESTORE: ' >&2
  read -r answer
  [ "$answer" = RESTORE ] || die "not restored"
fi

if [ "$backup" = 1 ] && [ -n "$(wrx_compose ps -q --status running ejabberd)" ]; then
  sh "$here/backup.sh" --home "$WRX_HOME"
fi

say "stopping ejabberd"
wrx_compose stop ejabberd >/dev/null
# Empty the database volume, as on a fresh install, and put the backup's SQLite file and Mnesia
# backup in it. ejabberd then starts on the SQLite file and a new, empty Mnesia, and the Mnesia
# backup (the accounts) is loaded into the running server.
wrx_compose run --rm --no-deps -T --entrypoint sh -v "$dir:/restore:ro" ejabberd -c '
  set -e
  cd /home/ejabberd/database
  find . -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp /restore/ejabberd.db ejabberd.db
  cp /restore/mnesia.backup restore.mnesia
' >/dev/null
say "starting ejabberd"
wrx_compose up -d --wait --wait-timeout 180 >/dev/null || die "ejabberd did not become healthy after the restore"
say "loading the accounts (Mnesia)"
wrx_compose exec -T ejabberd ejabberdctl restore /home/ejabberd/database/restore.mnesia >/dev/null ||
  die "ejabberd could not load the Mnesia backup"
wrx_compose exec -T ejabberd rm -f /home/ejabberd/database/restore.mnesia
accounts=$(wrx_compose exec -T ejabberd ejabberdctl registered_users "$installed" | grep -c . || true)
say "$accounts accounts on the server"
sh "$here/check-deployment.sh" --home "$WRX_HOME"
say "restored"
