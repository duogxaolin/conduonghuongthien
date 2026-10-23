#!/usr/bin/env bash
#
# Nightly database backup, with verification and rotation.
#
# DEPLOY.md used to document a bare `mysqldump > backup.sql` to run by hand.
# That has three problems: nobody runs it every night, a truncated dump looks
# exactly like a good one until the day you need it, and yesterday's file is
# overwritten by today's. This script addresses all three and is meant to be
# driven from cron.
#
#   ./scripts/backup-db.sh [--prefix NAME] [destination-directory]
#
# Environment (read from .env next to this repo, or from the shell):
#   MYSQL_ROOT_PASSWORD   required
#   MYSQL_DATABASE        default: cdkt_admin
#   MYSQL_CONTAINER       default: cdkt_mysql
#   BACKUP_DIR            default: ./backups   (overridden by the argument)
#   BACKUP_KEEP_DAYS      default: 14
#   BACKUP_STAMP          optional shared timestamp set by backup.sh
#   HEALTHCHECK_PING_URL  optional; see ping_healthcheck below
#
# --prefix NAME  writes NAME-<db>-<stamp>-<pid>.sql.gz instead of cdkt-<db>-…, and
#                keeps the newest PREFIX_KEEP of THOSE files (by count, not by age).
#                The pre-deploy dump uses `--prefix cdkt-predeploy` (scripts/
#                deploy-remote.sh, production/manage.sh Update). A prefixed run never
#                touches the nightly dumps' rotation and never pings: a deploy-time
#                success must not hide a nightly cron that stopped.
#
# Exit codes: 0 success, 1 configuration error, 2 dump failed, 3 verification failed.

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Load .env without exporting comments or tripping over values containing '='.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
  set +a
fi

PREFIX=cdkt
PREFIX_KEEP=5
TARGET=''

emit() { printf '{"event":"backup.%s","time":"%s","detail":%s}\n' "$1" "$(date -u +%FT%TZ)" "$2"; }
fail() {
  # A rejected archive must not be left behind. A truncated file sitting in the
  # backup directory looks exactly like a good one to whoever needs it at 3am.
  [[ "$1" == "verify" && -n "${TARGET:-}" ]] && rm -f "$TARGET"
  emit "failed" "{\"stage\":\"$1\",\"message\":\"$2\"}" >&2
  exit "$3"
}

# Tell an external monitor (healthchecks.io style) how the run ended: the URL on
# success, <URL>/fail on failure. A cron job that silently stops is otherwise
# noticed on the day the backup is needed. The monitor being down must never
# change this script's own result, hence `|| true`; unset means "no monitor".
ping_healthcheck() {
  local url="${HEALTHCHECK_PING_URL:-}"
  [[ -n "$url" ]] || return 0
  [[ "$1" == 0 ]] || url="${url%/}/fail"
  curl -fsS -m 10 --retry 2 -o /dev/null "$url" || true
}
# The single exit handler: every exit path (config error, dump, verify, success)
# reports, and the script still exits with its own status.
on_exit() {
  local status=$?
  if [[ "$PREFIX" == cdkt ]]; then ping_healthcheck "$status"; fi
  exit "$status"
}
trap on_exit EXIT

if [[ "${1:-}" == --prefix ]]; then
  [[ $# -ge 2 ]] || fail config "--prefix needs a name" 1
  PREFIX="$2"
  shift 2
fi
case "${1:-}" in
  --prefix) fail config "--prefix must come before the destination directory" 1 ;;
  -*) fail config "unknown option: $1" 1 ;;
esac
# The prefix becomes part of a host-side filename and of the rotation glob below:
# only plain lower-case `cdkt-…` names, never a path.
[[ "$PREFIX" =~ ^cdkt(-[a-z0-9]+)*$ ]] || fail config "--prefix must look like cdkt-name (lower case, digits, dashes)" 1

CONTAINER="${MYSQL_CONTAINER:-cdkt_mysql}"
DATABASE="${MYSQL_DATABASE:-cdkt_admin}"
DEST="${1:-${BACKUP_DIR:-$REPO_ROOT/backups}}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
# The timestamp becomes part of a host-side filename.  `backup.sh` supplies it
# to pair the SQL dump with the media archive, but never let an arbitrary
# environment value turn this script into a path writer.
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { printf '%s\n' 'BACKUP_STAMP must use YYYYMMDDTHHMMSSZ' >&2; exit 1; }
# The PID suffix keeps a manual run from colliding with the cron run in the same
# second — a collision would have one overwrite or delete the other's file.
TARGET="$DEST/$PREFIX-$DATABASE-$STAMP-$$.sql.gz"

[[ -n "${MYSQL_ROOT_PASSWORD:-}" ]] || fail config "MYSQL_ROOT_PASSWORD is not set" 1
command -v docker >/dev/null 2>&1 || fail config "docker is not on PATH" 1
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail config "container $CONTAINER is not running" 1

mkdir -p "$DEST"

# --single-transaction keeps InnoDB consistent without locking the site out.
# --routines/--triggers/--events so a restore is actually complete.
# The password goes in through the environment, never on a command line where it
# would show up in `ps` for every user on the host.  `-e MYSQL_PWD` WITHOUT a value
# makes the docker CLI copy it from its own environment; the `-e MYSQL_PWD=<secret>`
# form puts the secret in the docker client's argv, which `ps` shows just the same.
if ! MYSQL_PWD="$MYSQL_ROOT_PASSWORD" docker exec -e MYSQL_PWD "$CONTAINER" \
      mysqldump -u root \
        --single-transaction --quick --routines --triggers --events \
        --default-character-set=utf8mb4 \
        "$DATABASE" 2>/tmp/cdkt-backup-err.$$ | gzip -9 > "$TARGET"; then
  DUMP_ERROR="$(tr -d '"' < /tmp/cdkt-backup-err.$$ | tail -c 400 | tr '\n' ' ')"
  rm -f /tmp/cdkt-backup-err.$$ "$TARGET"
  fail dump "$DUMP_ERROR" 2
fi
rm -f /tmp/cdkt-backup-err.$$

# ── Verification ────────────────────────────────────────────────────────────
# A dump that fails halfway still leaves a plausible-looking file. mysqldump
# writes a completion marker on the last line; without it the file is a
# fragment, and a fragment silently restored is worse than no backup at all.
gzip -t "$TARGET" 2>/dev/null || fail verify "gzip archive is corrupt" 3

# `grep -c` reads to the end; `grep -q` exits at the first match, and under
# pipefail the writer it leaves behind can die of SIGPIPE.
if [[ "$(gzip -dc "$TARGET" | tail -5 | grep -c 'Dump completed' || true)" -lt 1 ]]; then
  fail verify "dump has no completion marker — it is truncated" 3
fi

TABLE_COUNT="$(gzip -dc "$TARGET" | grep -c '^CREATE TABLE' || true)"
[[ "$TABLE_COUNT" -ge 20 ]] || fail verify "only $TABLE_COUNT tables in the dump; expected at least 20" 3

# Measured uncompressed: the compression ratio varies by an order of magnitude
# with the data, so a threshold on the archive size says nothing useful.
PLAIN_BYTES="$(gzip -dc "$TARGET" | wc -c | tr -d ' ')"
[[ "$PLAIN_BYTES" -ge 51200 ]] || fail verify "dump holds only $PLAIN_BYTES bytes of SQL" 3
BYTES="$(wc -c < "$TARGET" | tr -d ' ')"

# ── Rotation ────────────────────────────────────────────────────────────────
# Only this run's own family of files: the nightly `cdkt-<db>-…` by age, a
# prefixed family (pre-deploy dumps) by count. Neither ever sees the other's names.
DELETED=0
if [[ "$PREFIX" == cdkt ]]; then
  while IFS= read -r old; do
    rm -f "$old" && DELETED=$((DELETED + 1))
  done < <(find "$DEST" -maxdepth 1 -name "cdkt-$DATABASE-*.sql.gz" -type f -mtime "+$KEEP_DAYS" 2>/dev/null)
else
  # The stamp is fixed-width UTC, so glob (alphabetical) order is oldest first.
  OWN=("$DEST/$PREFIX-$DATABASE-"????????T??????Z-[0-9]*.sql.gz)
  EXCESS=$(( ${#OWN[@]} - PREFIX_KEEP ))
  if [[ "$EXCESS" -gt 0 ]]; then
    for old in "${OWN[@]:0:EXCESS}"; do
      rm -f -- "$old" && DELETED=$((DELETED + 1))
    done
  fi
fi

REMAINING="$(find "$DEST" -maxdepth 1 -name "$PREFIX-$DATABASE-*.sql.gz" -type f | wc -l | tr -d ' ')"

emit "succeeded" "{\"file\":\"$TARGET\",\"bytes\":$BYTES,\"plainBytes\":$PLAIN_BYTES,\"tables\":$TABLE_COUNT,\"rotated\":$DELETED,\"retained\":$REMAINING}"
