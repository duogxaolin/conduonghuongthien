#!/usr/bin/env bash
#
# Archive the Media Portal working volume beside its database backup.
#
# The portal publishes originals, thumbnails and HLS segments under
# /var/lib/cdkt/media.  Those files are a named Docker volume rather than rows
# in MySQL, so a database dump alone cannot restore a playable video.
#
#   ./scripts/backup-media.sh [destination-directory]
#
# Environment (read from .env next to this repo, or from the shell):
#   APP_CONTAINER      default: cdkt_app
#   BACKUP_DIR         default: ./backups
#   BACKUP_KEEP_DAYS   default: 14
#   BACKUP_STAMP       optional shared timestamp set by backup.sh
#
# Exit codes: 0 success, 1 configuration error, 2 archive failed, 3 verification failed.

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1090,SC1091
  source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env)
  set +a
fi

CONTAINER="${APP_CONTAINER:-cdkt_app}"
DEST="${1:-${BACKUP_DIR:-$REPO_ROOT/backups}}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { printf '%s\n' 'BACKUP_STAMP must use YYYYMMDDTHHMMSSZ' >&2; exit 1; }
TARGET="$DEST/cdkt-media-$STAMP-$$.tar.gz"

emit() { printf '{"event":"media_backup.%s","time":"%s","detail":%s}\n' "$1" "$(date -u +%FT%TZ)" "$2"; }
fail() {
  [[ -n "${TARGET:-}" ]] && rm -f "$TARGET"
  emit "failed" "{\"stage\":\"$1\",\"message\":\"$2\"}" >&2
  exit "$3"
}

[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || fail config "BACKUP_KEEP_DAYS must be a non-negative integer" 1
command -v docker >/dev/null 2>&1 || fail config "docker is not on PATH" 1
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail config "container $CONTAINER is not running" 1
mkdir -p "$DEST"

# `docker cp CONTAINER:PATH -` writes a tar stream.  Its source is the mounted
# directory in the running app container, so this follows the actual compose
# volume name instead of guessing it from a project name.
if ! docker cp "$CONTAINER:/var/lib/cdkt/media/." - | gzip -9 > "$TARGET"; then
  fail archive "could not archive /var/lib/cdkt/media from $CONTAINER" 2
fi

gzip -t "$TARGET" 2>/dev/null || fail verify "gzip archive is corrupt" 3
if ! tar -tzf "$TARGET" >/dev/null 2>&1; then
  fail verify "tar archive cannot be listed" 3
fi

ENTRIES="$(tar -tzf "$TARGET" | wc -l | tr -d ' ')"
BYTES="$(wc -c < "$TARGET" | tr -d ' ')"

DELETED=0
while IFS= read -r old; do
  rm -f "$old" && DELETED=$((DELETED + 1))
done < <(find "$DEST" -maxdepth 1 -name 'cdkt-media-*.tar.gz' -type f -mtime "+$KEEP_DAYS" 2>/dev/null)

REMAINING="$(find "$DEST" -maxdepth 1 -name 'cdkt-media-*.tar.gz' -type f | wc -l | tr -d ' ')"
emit "succeeded" "{\"file\":\"$TARGET\",\"bytes\":$BYTES,\"entries\":$ENTRIES,\"rotated\":$DELETED,\"retained\":$REMAINING}"
