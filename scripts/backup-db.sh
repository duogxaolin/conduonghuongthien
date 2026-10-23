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
#                success must not hide a nightly cron that stopped. Its destination is
#                a directory of its own (.deploy-db-backups/) and is set to 0700.
#
# Permissions: a dump is the whole production database (password hashes, reader
# e-mails). Every file and directory this script creates is owner-only (umask 077 —
# under the usual 022 a dump was 0644 in a 0755 directory, readable by every account
# on the host). The nightly destination (./backups) is the app container's bind mount
# and keeps its mode; the files in it are 0600 all the same.
#
# The archive is written as <name>.sql.gz.partial and renamed only after it passed
# verification, so no rotation glob, `verify-restore.sh --latest` or `ls *.sql.gz`
# ever sees a half-written dump. INT/TERM/HUP end the run through the exit handler,
# which removes the partial (bash would otherwise die on the spot and leave gzip to
# close a truncated dump as a perfectly valid .sql.gz). A partial that could not be
# cleaned up (SIGKILL, power loss) is removed by a later run of the same family once
# it is a day old.
#
# Exit codes: 0 success, 1 configuration error, 2 dump failed, 3 verification failed,
#             128+N interrupted by signal N.

set -Eeuo pipefail
umask 077

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
PARTIAL=''
ERR_FILE="/tmp/cdkt-backup-err.$$"

emit() { printf '{"event":"backup.%s","time":"%s","detail":%s}\n' "$1" "$(date -u +%FT%TZ)" "$2"; }
fail() {
  # The exit handler removes the partial archive: a rejected or truncated file
  # sitting in the backup directory looks exactly like a good one at 3am.
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
# The single exit handler: every exit path (config error, dump, verify, signal,
# success) removes what this run has not finished, reports, and the script still
# exits with its own status. After a successful run the partial was renamed, so the
# `rm` finds nothing.
on_exit() {
  local status=$?
  if [[ -n "$PARTIAL" ]]; then rm -f -- "$PARTIAL"; fi
  rm -f -- "$ERR_FILE"
  if [[ "$PREFIX" == cdkt ]]; then ping_healthcheck "$status"; fi
  exit "$status"
}
trap on_exit EXIT
# Without these, a non-interactive bash dies of the signal on the spot: no exit
# handler, and the gzip still running writes a truncated dump out as a VALID archive.
# With them, bash finishes the pipeline it is waiting for, then exits through on_exit.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

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
# The pre-deploy directory holds nothing but these dumps: owner-only even if an
# earlier run (under umask 022) or an operator created it 0755. The nightly
# directory is shared with the app container and is left as it is. A directory the
# caller may write to but does not own cannot be chmod-ed: warn and dump anyway —
# the files are 0600 regardless, and refusing the dump would stop every deploy.
if [[ "$PREFIX" != cdkt ]] && ! chmod 700 "$DEST" 2>/dev/null; then
  emit "warning" "{\"message\":\"could not set $DEST to 0700 (not its owner); the dumps in it are still 0600\"}" >&2
fi

# Written under a name nothing else globs for, renamed once verified.
PARTIAL="$TARGET.partial"

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
        "$DATABASE" 2>"$ERR_FILE" | gzip -9 > "$PARTIAL"; then
  DUMP_ERROR="$(tr -d '"' < "$ERR_FILE" | tail -c 400 | tr '\n' ' ')"
  fail dump "$DUMP_ERROR" 2
fi
rm -f -- "$ERR_FILE"

# ── Verification ────────────────────────────────────────────────────────────
# A dump that fails halfway still leaves a plausible-looking file. mysqldump
# writes a completion marker on the last line; without it the file is a
# fragment, and a fragment silently restored is worse than no backup at all.
gzip -t "$PARTIAL" 2>/dev/null || fail verify "gzip archive is corrupt" 3

# `grep -c` reads to the end; `grep -q` exits at the first match, and under
# pipefail the writer it leaves behind can die of SIGPIPE.
if [[ "$(gzip -dc "$PARTIAL" | tail -5 | grep -c 'Dump completed' || true)" -lt 1 ]]; then
  fail verify "dump has no completion marker — it is truncated" 3
fi

TABLE_COUNT="$(gzip -dc "$PARTIAL" | grep -c '^CREATE TABLE' || true)"
[[ "$TABLE_COUNT" -ge 20 ]] || fail verify "only $TABLE_COUNT tables in the dump; expected at least 20" 3

# Measured uncompressed: the compression ratio varies by an order of magnitude
# with the data, so a threshold on the archive size says nothing useful.
PLAIN_BYTES="$(gzip -dc "$PARTIAL" | wc -c | tr -d ' ')"
[[ "$PLAIN_BYTES" -ge 51200 ]] || fail verify "dump holds only $PLAIN_BYTES bytes of SQL" 3
BYTES="$(wc -c < "$PARTIAL" | tr -d ' ')"

# Verified: only now does the dump exist under a name anything will pick up.
mv -f -- "$PARTIAL" "$TARGET"

# ── Rotation ────────────────────────────────────────────────────────────────
# Only this run's own family of files: the nightly `cdkt-<db>-…` by age, a
# prefixed family (pre-deploy dumps) by count. Neither ever sees the other's names.
# Partials this family left behind (a run killed outright) go once a day old: a
# running dump keeps writing, so its partial is never that old.
find "$DEST" -maxdepth 1 -name "$PREFIX-$DATABASE-*.sql.gz.partial" -type f -mmin +1440 -delete 2>/dev/null || true
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
