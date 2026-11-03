#!/usr/bin/env bash
#
# Prove a backup can actually be restored.
#
# A backup nobody has restored is a hypothesis, not a backup. This restores the
# given dump into a scratch database inside the same MySQL container, counts
# what came back, and drops the scratch database again. It never touches the
# live database.
#
#   ./scripts/verify-restore.sh backups/cdkt-cdkt_admin-20260726T030000Z-1234.sql.gz
#   ./scripts/verify-restore.sh --latest     # newest backup-db.sh dump of MYSQL_DATABASE
#
# `--latest` is what cron should use: it picks the newest
# $BACKUP_DIR/cdkt-<MYSQL_DATABASE>-<stamp>-<pid>.sql.gz, so the crontab line does not
# hard-code a database name that Deploy lets the operator choose.
#
# HEALTHCHECK_PING_URL (optional, from .env or the shell): requested when the check
# succeeds, <URL>/fail when it does not — see ping_healthcheck.
#
# Exit codes: 0 restore verified, 1 configuration error, 2 restore failed / refused.

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
  set +a
fi

ARCHIVE="${1:-}"
CONTAINER="${MYSQL_CONTAINER:-cdkt_mysql}"
LIVE_DATABASE="${MYSQL_DATABASE:-cdkt_admin}"
SCRATCH="cdkt_restore_check_$$"

emit() { printf '{"event":"restore_check.%s","time":"%s","detail":%s}\n' "$1" "$(date -u +%FT%TZ)" "$2"; }
fail() { emit "failed" "{\"message\":\"$1\"}" >&2; cleanup; exit "$2"; }
# `docker exec` with the root password passed by NAME (`-e MYSQL_PWD`, no value): the
# docker CLI copies it from its own environment, so the secret is never in an argv
# that `ps` shows to every local user (`-e MYSQL_PWD=<secret>` would be).
dexec() { MYSQL_PWD="${MYSQL_ROOT_PASSWORD:-}" docker exec -e MYSQL_PWD "$@"; }
cleanup() {
  dexec "$CONTAINER" \
    mysql -u root -e "DROP DATABASE IF EXISTS \`$SCRATCH\`" >/dev/null 2>&1 || true
}
# Same contract as scripts/backup-db.sh: the URL on success, <URL>/fail on failure,
# nothing when unset, and an unreachable monitor never changes the exit status.
ping_healthcheck() {
  local url="${HEALTHCHECK_PING_URL:-}"
  [[ -n "$url" ]] || return 0
  [[ "$1" == 0 ]] || url="${url%/}/fail"
  curl -fsS -m 10 --retry 2 -o /dev/null "$url" || true
}
# ONE exit handler. A second `trap … EXIT` would replace the first, and the scratch
# database would outlive every run.
on_exit() {
  local status=$?
  cleanup
  ping_healthcheck "$status"
  exit "$status"
}
trap on_exit EXIT

[[ -n "$ARCHIVE" ]] || fail "usage: verify-restore.sh <backup.sql.gz> | --latest" 1
if [[ "$ARCHIVE" == --latest ]]; then
  # Same name backup-db.sh writes (…-<pid>.sql.gz): neither the in-app backup's
  # cdkt-<stamp>-<trigger>.sql.gz nor restore-db.sh's cdkt-prerestore-* match.
  # A glob plus -nt, not `ls -t | head`: under pipefail a long listing can die of
  # SIGPIPE and take the script with it.
  ARCHIVE=''
  for candidate in "${BACKUP_DIR:-$REPO_ROOT/backups}"/cdkt-"$LIVE_DATABASE"-????????T??????Z-[0-9]*.sql.gz; do
    [[ -f "$candidate" ]] || continue
    if [[ -z "$ARCHIVE" || "$candidate" -nt "$ARCHIVE" ]]; then ARCHIVE="$candidate"; fi
  done
  [[ -n "$ARCHIVE" ]] || fail "no backup-db.sh dump of $LIVE_DATABASE in ${BACKUP_DIR:-$REPO_ROOT/backups}" 1
fi
[[ -f "$ARCHIVE" ]] || fail "no such file: $ARCHIVE" 1
[[ -n "${MYSQL_ROOT_PASSWORD:-}" ]] || fail "MYSQL_ROOT_PASSWORD is not set" 1
[[ "$SCRATCH" != "$LIVE_DATABASE" ]] || fail "refusing to use the live database as scratch" 1

# The scratch database is only the DEFAULT database of the import below.  A dump that
# switches database (`USE live_db;` — what `mysqldump --databases` writes) would run
# its `DROP TABLE IF EXISTS …` against THAT database, while cleanup drops only the
# scratch one: a "verification" that wipes production.  Same check, same pattern and
# same reasoning as restore-db.sh (keep the two in step; tests run one table of
# dumps through both).
DB_SWITCH_RE=$'^(\xEF\xBB\xBF)?[[:space:]]*(/\\*M?![0-9]*[[:space:]]*)?((CREATE|DROP)[[:space:]]+(DATABASE|SCHEMA)([^A-Za-z0-9_$]|$)|USE([[:space:]`;]|$)|CONNECT([[:space:];]|$)|SOURCE[[:space:]]|SYSTEM[[:space:]]|\\\\[ur.!])'
dump_selects_database() {
  # `grep -c` reads to EOF (no SIGPIPE for gzip, unlike `grep -q` under pipefail);
  # gzip's own status is judged so an unreadable archive fails closed.
  local scan hits statuses
  scan="$(gzip -dc -- "$1" 2>/dev/null | LC_ALL=C grep -aicE -- "$DB_SWITCH_RE"; printf '%s %s\n' "${PIPESTATUS[0]}" "${PIPESTATUS[1]}")"
  hits="${scan%%$'\n'*}"
  statuses="${scan##*$'\n'}"
  case "$statuses" in
    '0 0') return 0 ;;
    '0 1') [[ "$hits" == 0 ]] && return 1 ;;
  esac
  return 2
}
set +e; dump_selects_database "$ARCHIVE"; SELECTS_DB=$?; set -e
case "$SELECTS_DB" in
  1) ;;
  0) fail "dump selects its own database or leaves it (CREATE/DROP DATABASE, USE, or a mysql client command) — refusing, it would not stay in the scratch database" 2 ;;
  *) fail "could not read the whole dump (corrupt gzip?) — refusing" 2 ;;
esac

dexec "$CONTAINER" \
  mysql -u root -e "CREATE DATABASE \`$SCRATCH\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" \
  || fail "could not create the scratch database" 2

# The dumps in migrations/ carry a destructive-restore guard; a mysqldump does
# not, so this pipes straight in. It goes to $SCRATCH, never to the live schema.
if ! gzip -dc "$ARCHIVE" | dexec -i "$CONTAINER" \
      mysql -u root --default-character-set=utf8mb4 "$SCRATCH"; then
  fail "the dump did not apply cleanly" 2
fi

read -r TABLES USERS ARTICLES <<< "$(dexec "$CONTAINER" \
  mysql -u root -N -B -e "
    SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$SCRATCH'),
      (SELECT COUNT(*) FROM \`$SCRATCH\`.users),
      (SELECT COUNT(*) FROM \`$SCRATCH\`.articles)" 2>/dev/null)"

[[ "${TABLES:-0}" -ge 20 ]] || fail "only ${TABLES:-0} tables restored" 2
[[ "${USERS:-0}" -ge 1 ]] || fail "no user accounts in the restored database" 2

emit "succeeded" "{\"archive\":\"$ARCHIVE\",\"tables\":$TABLES,\"users\":$USERS,\"articles\":$ARTICLES}"
