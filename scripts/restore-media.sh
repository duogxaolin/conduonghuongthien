#!/usr/bin/env bash
#
# Replace one of the app's file volumes from an archive made by backup-media.sh
# (or, for uploads, by the in-app backup).  The app must be stopped first so no
# request can publish a file halfway through the replacement.
#
#   docker compose stop app
#   ./scripts/restore-media.sh backups/cdkt-media-....tar.gz   --replace   # media_work
#   ./scripts/restore-media.sh backups/cdkt-uploads-....tar.gz --replace   # uploads_data
#   docker compose up -d app
#
# Options after --replace:
#   --no-safety-copy           skip the snapshot of the current volume (see below)
#   --i-know-app-is-stopped    when neither `docker compose ps` nor `docker inspect`
#                              can tell whether the app runs (e.g. a Compose too old
#                              for `ps --status`), vouch that it is stopped
#
# Which volume is replaced is decided by the archive's file name, never guessed:
#   cdkt-media-<stamp>-<pid>.tar.gz                -> /var/lib/cdkt/media   (media_work)
#   cdkt-uploads-<stamp>-*.tar.gz                  -> /app/public/uploads   (uploads_data)
#   cdkt-prerestore-media|uploads-<stamp>-<pid>.tar.gz   the safety copies this script
#                                                     writes, same layouts as above
# Any other name is refused, so a typo cannot wipe the wrong volume.
#
# Safety, in order — nothing in the volume changes until every step before it passed:
#   1. The archive is listed (GNU tar) and refused if any entry is not a plain file
#      or directory — a symlink/hardlink could point at /app/backups/*.sql.gz and the
#      app serves /uploads by following links — or if a name is absolute, has a `..`
#      segment, a backslash or a control character, or sits outside the expected root.
#   2. A snapshot of what is about to be replaced is written to
#      $BACKUP_DIR/cdkt-prerestore-<kind>-<stamp>-<pid>.tar.gz and verified
#      (skip with --no-safety-copy).  Not named like backup-media.sh's own archives,
#      so its age-based rotation never deletes it.
#   3. Inside a one-off container the archive is extracted into a staging directory
#      ON the volume, and `find` re-checks the result: any symlink, device, fifo,
#      socket or hard-linked file (in case the container's tar reads the archive
#      differently from the host's) discards the staging tree and the volume keeps
#      its current contents.  Only then is the old content removed and the staged
#      tree moved into place (same filesystem: a rename per top-level entry).
#   The staging tree needs free space on the volume for the restored contents while
#   the old contents still exist; running out fails step 3 and leaves the volume as
#   it was.
#
# Exit codes: 0 success, 1 refused / bad archive, 2 the app is running (or its state
#             cannot be determined), 3 the safety copy failed (nothing changed),
#             4 extraction failed or was refused inside the container (the volume
#             keeps its previous contents unless the final swap itself failed — then
#             restore the safety copy).

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
CONFIRM="${2:-}"
shift "$(( $# < 2 ? $# : 2 ))"
SAFETY_COPY=1
APP_STOPPED_VOUCHED=0
for opt in "$@"; do
  case "$opt" in
    --no-safety-copy) SAFETY_COPY=0 ;;
    --i-know-app-is-stopped) APP_STOPPED_VOUCHED=1 ;;
    *) printf 'restore-media: unknown option: %s\n' "$opt" >&2; exit 1 ;;
  esac
done
APP_CONTAINER="${APP_CONTAINER:-cdkt_app}"
DEST="${BACKUP_DIR:-$REPO_ROOT/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT=''
fail() { printf 'restore-media: %s\n' "$1" >&2; exit "${2:-1}"; }

[[ -n "$ARCHIVE" && "$CONFIRM" == '--replace' ]] || fail 'usage: restore-media.sh <cdkt-media-*|cdkt-uploads-*.tar.gz> --replace [--no-safety-copy] [--i-know-app-is-stopped]'
[[ -f "$ARCHIVE" ]] || fail "archive does not exist: $ARCHIVE"
command -v docker >/dev/null 2>&1 || fail 'docker is not on PATH'
gzip -t "$ARCHIVE" 2>/dev/null || fail 'gzip archive is corrupt'
tar -tzf "$ARCHIVE" >/dev/null 2>&1 || fail 'tar archive cannot be listed'

NAME="$(basename "$ARCHIVE")"
case "$NAME" in
  cdkt-prerestore-media-????????T??????Z-[0-9]*.tar.gz|cdkt-media-????????T??????Z-[0-9]*.tar.gz)
    TARGET_KIND=media
    ;;
  cdkt-media-*.tar.gz)
    # The in-app backup also writes cdkt-media-<stamp>-<trigger>.tar.gz, but it
    # roots the tree at `media/` — extracting it here would nest a second `media/`
    # inside the volume.  Different layout, so refuse instead of guessing.
    fail "$NAME is an in-app media archive (rooted at media/); this script restores archives from scripts/backup-media.sh (name ends in -<pid>)"
    ;;
  cdkt-prerestore-uploads-????????T??????Z-[0-9]*.tar.gz|cdkt-uploads-*.tar.gz)
    TARGET_KIND=uploads
    ;;
  *)
    fail "unrecognised archive name: $NAME (expected cdkt-media-* or cdkt-uploads-*)"
    ;;
esac

# ── 1. Every entry must be a plain file or directory with a tame name ────────
# The listing is GNU tar's: with --quoting-style=escape every entry is exactly one
# line (a newline in a name prints as `\n`), and the first character of a verbose
# line is the entry type.  BusyBox/bsd tar print neither reliably, so refuse to
# guess rather than parse them.
[[ "$(tar --version 2>/dev/null)" == *'GNU tar'* ]] || fail 'GNU tar is required on the host to inspect the archive before restoring'
NAMES="$(LC_ALL=C tar --quoting-style=escape -tzf "$ARCHIVE")" || fail 'tar archive cannot be listed'
LONG="$(LC_ALL=C tar --quoting-style=escape -tvzf "$ARCHIVE")" || fail 'tar archive cannot be listed'
[[ "$(wc -l <<< "$NAMES")" == "$(wc -l <<< "$LONG")" ]] || fail 'archive listing is inconsistent (entry names with line breaks?) — refusing'

# Types: `-` regular file, `d` directory.  Everything else — `l` symlink, `h` hard
# link, `c`/`b` device, `p` fifo, `s` socket… — is refused.
BAD_TYPES="$(awk 'substr($0, 1, 1) != "-" && substr($0, 1, 1) != "d" { print; if (++n == 5) exit }' <<< "$LONG")"
[[ -z "$BAD_TYPES" ]] || fail "archive contains entries that are not plain files or directories (links, devices, fifos) — refusing:
$BAD_TYPES"

# Names: no absolute path, no `..` segment, not the names step 3 works under.  In
# escape style a backslash in the
# listing means either a literal backslash or an escaped non-printable byte; bytes
# >= 0x80 (UTF-8 file names, printed as \2xx/\3xx) are fine, everything else —
# control characters, `\\` — is refused.
if awk 'BEGIN { bad = 0 }
        /^\// || /(^|\/)\.\.($|\/)/ { bad = 1 }
        /(^|\/)\.cdkt-restore-(staging|check)($|\/)/ { bad = 1 }
        { s = $0; gsub(/\\[23][0-7][0-7]/, "", s); if (index(s, "\\") > 0) bad = 1 }
        END { exit bad }' <<< "$NAMES"; then :; else
  fail 'archive contains an unsafe path'
fi

if [[ "$TARGET_KIND" == uploads ]]; then
  # Both writers (backup-media.sh and the in-app backup) keep `uploads/` as the
  # single top-level directory.  Anything else would land outside the uploads
  # tree, so check it rather than trust the name.
  if sed 's|^\./||' <<< "$NAMES" | awk 'BEGIN { bad = 0 } !($0 == "" || $0 == "uploads" || $0 ~ /^uploads\//) { bad = 1 } END { exit bad }'; then :; else
    fail "$NAME has entries outside uploads/ — not an uploads archive"
  fi
fi

# ── The app must be stopped (same rule as restore-db.sh) ─────────────────────
# Two independent signals; a `docker compose ps` that fails is "unknown", not
# "stopped" — see restore-db.sh.
app_state() {
  local out compose=unknown inspect=unknown
  if out="$(docker compose ps --status running -q app 2>/dev/null)"; then
    if [[ -n "$out" ]]; then compose=running; else compose=stopped; fi
  fi
  if out="$(docker inspect --format '{{.State.Running}}' "$APP_CONTAINER" 2>/dev/null)"; then
    case "$out" in true) inspect=running ;; false) inspect=stopped ;; esac
  fi
  if [[ "$compose" == running || "$inspect" == running ]]; then echo running
  elif [[ "$compose" == stopped || "$inspect" == stopped ]]; then echo stopped
  else echo unknown
  fi
}
case "$(app_state)" in
  stopped) ;;
  running) fail 'the app is running; run "docker compose stop app" before restoring' 2 ;;
  *)
    if [[ "$APP_STOPPED_VOUCHED" == 1 ]]; then
      printf 'restore-media: app state unknown (docker compose ps failed, %s not inspectable); continuing on --i-know-app-is-stopped\n' "$APP_CONTAINER" >&2
    else
      fail "cannot tell whether the app is running (docker compose ps failed and $APP_CONTAINER cannot be inspected) — refusing; after checking it is stopped, re-run with --i-know-app-is-stopped" 2
    fi
    ;;
esac

# `docker compose run` joins the compose project and therefore mounts the correct
# named volume even when the project directory was renamed.  Uploads run as root
# and hand the tree to `node` afterwards — the app runs as node, and a root-owned
# upload tree is a 500 on the next upload (same reason deploy-remote.sh runs
# fix_uploads_ownership).  Media keeps the image's user, as before.
if [[ "$TARGET_KIND" == media ]]; then
  VOLUME=/var/lib/cdkt/media; SNAP_PARENT=/var/lib/cdkt/media; SNAP_ENTRY=.; OWNER=''; RUN_USER=()
else
  VOLUME=/app/public/uploads; SNAP_PARENT=/app/public; SNAP_ENTRY=uploads; OWNER=node:node; RUN_USER=(--user root)
fi
compose_run() { docker compose run --rm -T --no-deps "${RUN_USER[@]}" --entrypoint sh app "$@"; }

# ── 2. Safety copy of what is about to be replaced ───────────────────────────
# Same layout as the archives this script restores, so putting it back is the same
# command with the safety copy's name.
if [[ "$SAFETY_COPY" == 1 ]]; then
  mkdir -p "$DEST"
  SNAPSHOT="$DEST/cdkt-prerestore-$TARGET_KIND-$STAMP-$$.tar.gz"
  if ! compose_run -c 'cd "$1" && tar -cf - "$2"' sh "$SNAP_PARENT" "$SNAP_ENTRY" </dev/null | gzip -9 > "$SNAPSHOT" \
     || ! gzip -t "$SNAPSHOT" 2>/dev/null \
     || [[ "$(tar -tzf "$SNAPSHOT" 2>/dev/null | wc -l | tr -d ' ')" -lt 1 ]]; then
    rm -f "$SNAPSHOT"
    fail "could not take a verified copy of $VOLUME before replacing it; nothing was changed (--no-safety-copy skips this)" 3
  fi
  printf 'restore-media: current %s saved to %s\n' "$VOLUME" "$SNAPSHOT"
fi

# ── 3. Extract into staging, re-check, then swap ─────────────────────────────
# POSIX sh for the image's BusyBox.  $1 volume root, $2 kind, $3 owner ("" = keep).
# shellcheck disable=SC2016  # expanded by the container's sh, not here
RESTORE_IN_CONTAINER='
set -eu
vol="$1"; kind="$2"; owner="$3"
stage="$vol/.cdkt-restore-staging"
check="$vol/.cdkt-restore-check"
rm -rf "$stage" "$check"
mkdir "$stage"
if ! tar -xf - -C "$stage"; then
  rm -rf "$stage"
  echo "restore-media: extraction failed; the volume keeps its previous contents" >&2
  exit 4
fi
# The host already refused links/devices; this is the second look, at what the
# container tar actually produced. A failing find (unsupported test) also aborts.
if ! find "$stage" \( -type l -o -type c -o -type b -o -type p -o -type s -o \( -type f -links +1 \) \) -print > "$check"; then
  rm -rf "$stage" "$check"
  echo "restore-media: could not check the extracted tree; the volume keeps its previous contents" >&2
  exit 4
fi
if [ -s "$check" ]; then
  echo "restore-media: the archive produced links/devices/fifos; nothing was replaced:" >&2
  head -n 5 "$check" >&2
  rm -rf "$stage" "$check"
  exit 4
fi
rm -f "$check"
if [ "$kind" = uploads ]; then src="$stage/uploads"; else src="$stage"; fi
mkdir -p "$src"
for e in "$vol"/* "$vol"/.[!.]* "$vol"/..?*; do
  [ "$e" = "$stage" ] && continue
  if [ -e "$e" ] || [ -L "$e" ]; then rm -rf "$e"; fi
done
for e in "$src"/* "$src"/.[!.]* "$src"/..?*; do
  if [ -e "$e" ] || [ -L "$e" ]; then mv "$e" "$vol"/; fi
done
rm -rf "$stage"
if [ -n "$owner" ]; then chown -R "$owner" "$vol"; fi
'
if ! gzip -dc "$ARCHIVE" | compose_run -c "$RESTORE_IN_CONTAINER" sh "$VOLUME" "$TARGET_KIND" "$OWNER"; then
  fail "restoring $VOLUME failed (see above)${SNAPSHOT:+ — its previous contents are in $SNAPSHOT}" 4
fi
if [[ "$TARGET_KIND" == media ]]; then
  printf '%s\n' 'Media volume restored. Start the app with: docker compose up -d app'
else
  printf '%s\n' 'Uploads volume restored. Start the app with: docker compose up -d app'
fi
