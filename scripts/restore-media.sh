#!/usr/bin/env bash
#
# Replace Media Portal's local work volume from an archive made by
# backup-media.sh.  The app must be stopped first so no request can publish a
# file halfway through the replacement.
#
#   docker compose stop app
#   ./scripts/restore-media.sh backups/cdkt-media-....tar.gz --replace
#   docker compose up -d app

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ARCHIVE="${1:-}"
CONFIRM="${2:-}"
fail() { printf 'restore-media: %s\n' "$1" >&2; exit "${2:-1}"; }

[[ -n "$ARCHIVE" && "$CONFIRM" == '--replace' ]] || fail 'usage: restore-media.sh <media.tar.gz> --replace'
[[ -f "$ARCHIVE" ]] || fail "archive does not exist: $ARCHIVE"
command -v docker >/dev/null 2>&1 || fail 'docker is not on PATH'
gzip -t "$ARCHIVE" 2>/dev/null || fail 'gzip archive is corrupt'
tar -tzf "$ARCHIVE" >/dev/null 2>&1 || fail 'tar archive cannot be listed'

# A backup created by this project contains relative paths only.  Reject an
# archive that could escape the media root before handing it to tar.
if tar -tzf "$ARCHIVE" | awk 'BEGIN { bad = 0 } /^\// || /(^|\/)\.\.($|\/)/ { bad = 1 } END { exit bad }'; then :; else
  fail 'archive contains an unsafe path'
fi

if docker compose ps --status running -q app | grep -q .; then
  fail 'the app is running; run "docker compose stop app" before restoring' 2
fi

# `docker compose run` joins the compose project and therefore mounts the
# correct named volume even when the project directory was renamed.  The shell
# command clears only the volume root, then extracts the already validated tar.
gzip -dc "$ARCHIVE" | docker compose run --rm -T --no-deps --entrypoint sh app -c \
  'rm -rf /var/lib/cdkt/media/* /var/lib/cdkt/media/.[!.]* /var/lib/cdkt/media/..?*; tar -xf - -C /var/lib/cdkt/media'

printf '%s\n' 'Media volume restored. Start the app with: docker compose up -d app'
