#!/usr/bin/env bash
#
# Create the database dump and Media Portal volume archive as one named backup
# run.  The two stores cannot be snapshot atomically through Docker, but sharing
# a timestamp keeps the compatible pair explicit and makes a restore auditable.
#
#   ./scripts/backup.sh [destination-directory]

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

[[ "$#" -le 1 ]] || { printf '%s\n' 'usage: backup.sh [destination-directory]' >&2; exit 1; }
STAMP="${BACKUP_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { printf '%s\n' 'BACKUP_STAMP must use YYYYMMDDTHHMMSSZ' >&2; exit 1; }
export BACKUP_STAMP="$STAMP"

./scripts/backup-db.sh "${1:-}"
./scripts/backup-media.sh "${1:-}"
