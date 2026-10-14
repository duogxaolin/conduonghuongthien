#!/usr/bin/env bash
#
# Archive the app's two file volumes beside its database backup.
#
# The portal keeps files outside MySQL, in two named Docker volumes:
#   media_work   -> /var/lib/cdkt/media    originals, thumbnails and HLS segments
#   uploads_data -> /app/public/uploads    images and documents uploaded through
#                                          the admin (article photos, avatars, ...)
# A database dump alone restores rows that point at files that are gone.  Each
# volume gets its own archive, sharing one timestamp with the SQL dump:
#
#   cdkt-media-<stamp>-<pid>.tar.gz     contents of the media work dir (no prefix)
#   cdkt-uploads-<stamp>-<pid>.tar.gz   one top-level directory `uploads/`
#
# `uploads/` as the top-level directory is exactly the layout the in-app backup
# (server/services/backup.ts) writes, so one restore path serves both.
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
TARGET=''

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

# archive_volume <volume-label> <path-in-container> <file-prefix>
#
# `docker cp CONTAINER:PATH -` writes a tar stream.  Its source is the mounted
# directory in the running app container, so this follows the actual compose
# volume instead of guessing a project-name-prefixed volume name.
#
# Rotation only touches files this script names itself: <prefix>-<stamp>-<pid>.
# The in-app backup writes into the same ./backups directory under the same
# `cdkt-media-` / `cdkt-uploads-` prefixes, but ends the name with a word
# (`-manual`, `-scheduled`, ...), and its own count-based rotation owns those.
# A bare `cdkt-media-*` glob here would delete them by age behind its back.
archive_volume() {
  local label="$1" src="$2" prefix="$3"
  TARGET="$DEST/$prefix-$STAMP-$$.tar.gz"

  if ! docker cp "$CONTAINER:$src" - | gzip -9 > "$TARGET"; then
    fail archive "could not archive $src ($label) from $CONTAINER" 2
  fi

  gzip -t "$TARGET" 2>/dev/null || fail verify "gzip archive of $label is corrupt" 3
  if ! tar -tzf "$TARGET" >/dev/null 2>&1; then
    fail verify "tar archive of $label cannot be listed" 3
  fi

  local entries bytes deleted=0 remaining old
  entries="$(tar -tzf "$TARGET" | wc -l | tr -d ' ')"
  bytes="$(wc -c < "$TARGET" | tr -d ' ')"

  while IFS= read -r old; do
    rm -f "$old" && deleted=$((deleted + 1))
  done < <(find "$DEST" -maxdepth 1 -name "$prefix-????????T??????Z-[0-9]*.tar.gz" -type f -mtime "+$KEEP_DAYS" 2>/dev/null)

  remaining="$(find "$DEST" -maxdepth 1 -name "$prefix-????????T??????Z-[0-9]*.tar.gz" -type f | wc -l | tr -d ' ')"
  emit "succeeded" "{\"volume\":\"$label\",\"file\":\"$TARGET\",\"bytes\":$bytes,\"entries\":$entries,\"rotated\":$deleted,\"retained\":$remaining}"
  TARGET=''
}

archive_volume media_work "/var/lib/cdkt/media/." cdkt-media
# No trailing `/.`: copying the directory itself keeps `uploads/` as the single
# top-level entry, matching the in-app archives and restore-uploads handling.
archive_volume uploads_data "/app/public/uploads" cdkt-uploads
