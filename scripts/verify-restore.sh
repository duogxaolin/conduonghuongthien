#!/usr/bin/env bash
#
# Prove a backup can actually be restored.
#
# A backup nobody has restored is a hypothesis, not a backup. This restores the
# given dump into a scratch database inside the same MySQL container, counts
# what came back, and drops the scratch database again. It never touches the
# live database.
#
#   ./scripts/verify-restore.sh backups/cdkt-cdkt_admin-20260726T030000Z.sql.gz
#
# Exit codes: 0 restore verified, 1 configuration error, 2 restore failed.

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
cleanup() {
  docker exec -e MYSQL_PWD="${MYSQL_ROOT_PASSWORD:-}" "$CONTAINER" \
    mysql -u root -e "DROP DATABASE IF EXISTS \`$SCRATCH\`" >/dev/null 2>&1 || true
}
trap cleanup EXIT

[[ -n "$ARCHIVE" ]] || fail "usage: verify-restore.sh <backup.sql.gz>" 1
[[ -f "$ARCHIVE" ]] || fail "no such file: $ARCHIVE" 1
[[ -n "${MYSQL_ROOT_PASSWORD:-}" ]] || fail "MYSQL_ROOT_PASSWORD is not set" 1
[[ "$SCRATCH" != "$LIVE_DATABASE" ]] || fail "refusing to use the live database as scratch" 1

docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER" \
  mysql -u root -e "CREATE DATABASE \`$SCRATCH\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci" \
  || fail "could not create the scratch database" 2

# The dumps in migrations/ carry a destructive-restore guard; a mysqldump does
# not, so this pipes straight in. It goes to $SCRATCH, never to the live schema.
if ! gzip -dc "$ARCHIVE" | docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER" \
      mysql -u root --default-character-set=utf8mb4 "$SCRATCH"; then
  fail "the dump did not apply cleanly" 2
fi

read -r TABLES USERS ARTICLES <<< "$(docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" "$CONTAINER" \
  mysql -u root -N -B -e "
    SELECT
      (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$SCRATCH'),
      (SELECT COUNT(*) FROM \`$SCRATCH\`.users),
      (SELECT COUNT(*) FROM \`$SCRATCH\`.articles)" 2>/dev/null)"

[[ "${TABLES:-0}" -ge 20 ]] || fail "only ${TABLES:-0} tables restored" 2
[[ "${USERS:-0}" -ge 1 ]] || fail "no user accounts in the restored database" 2

emit "succeeded" "{\"archive\":\"$ARCHIVE\",\"tables\":$TABLES,\"users\":$USERS,\"articles\":$ARTICLES}"
