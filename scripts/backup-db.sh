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
#   ./scripts/backup-db.sh [destination-directory]
#
# Environment (read from .env next to this repo, or from the shell):
#   MYSQL_ROOT_PASSWORD   required
#   MYSQL_DATABASE        default: cdkt_admin
#   MYSQL_CONTAINER       default: cdkt_mysql
#   BACKUP_DIR            default: ./backups   (overridden by the argument)
#   BACKUP_KEEP_DAYS      default: 14
#
# Exit codes: 0 success, 1 configuration error, 2 dump failed, 3 verification failed.

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Load .env without exporting comments or tripping over values containing '='.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
  set +a
fi

CONTAINER="${MYSQL_CONTAINER:-cdkt_mysql}"
DATABASE="${MYSQL_DATABASE:-cdkt_admin}"
DEST="${1:-${BACKUP_DIR:-$REPO_ROOT/backups}}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
# The PID suffix keeps a manual run from colliding with the cron run in the same
# second — a collision would have one overwrite or delete the other's file.
TARGET="$DEST/cdkt-$DATABASE-$STAMP-$$.sql.gz"

emit() { printf '{"event":"backup.%s","time":"%s","detail":%s}\n' "$1" "$(date -u +%FT%TZ)" "$2"; }
fail() {
  # A rejected archive must not be left behind. A truncated file sitting in the
  # backup directory looks exactly like a good one to whoever needs it at 3am.
  [[ "$1" == "verify" && -n "${TARGET:-}" ]] && rm -f "$TARGET"
  emit "failed" "{\"stage\":\"$1\",\"message\":\"$2\"}" >&2
  exit "$3"
}

[[ -n "${MYSQL_ROOT_PASSWORD:-}" ]] || fail config "MYSQL_ROOT_PASSWORD is not set" 1
command -v docker >/dev/null 2>&1 || fail config "docker is not on PATH" 1
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail config "container $CONTAINER is not running" 1

mkdir -p "$DEST"

# --single-transaction keeps InnoDB consistent without locking the site out.
# --routines/--triggers/--events so a restore is actually complete.
# The password goes in through the environment, never on the command line where
# it would show up in `ps` for every user on the host.
if ! docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER" \
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

if ! gzip -dc "$TARGET" | tail -5 | grep -q 'Dump completed'; then
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
DELETED=0
while IFS= read -r old; do
  rm -f "$old" && DELETED=$((DELETED + 1))
done < <(find "$DEST" -maxdepth 1 -name "cdkt-$DATABASE-*.sql.gz" -type f -mtime "+$KEEP_DAYS" 2>/dev/null)

REMAINING="$(find "$DEST" -maxdepth 1 -name "cdkt-$DATABASE-*.sql.gz" -type f | wc -l | tr -d ' ')"

emit "succeeded" "{\"file\":\"$TARGET\",\"bytes\":$BYTES,\"plainBytes\":$PLAIN_BYTES,\"tables\":$TABLE_COUNT,\"rotated\":$DELETED,\"retained\":$REMAINING}"
