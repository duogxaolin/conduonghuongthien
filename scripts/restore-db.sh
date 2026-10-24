#!/usr/bin/env bash
#
# Restore a database dump made by backup-db.sh — or by the app itself
# (backups/cdkt-<stamp>-<trigger>.sql.gz, e.g. the `pre-restore` safety dump a failed
# in-app restore names) — into the MySQL container.
#
# This is DESTRUCTIVE: the dump carries `DROP TABLE IF EXISTS` for every table, so
# every table in it replaces the live one.  Hence the guards below — the target
# database is named explicitly (no default, so a wrong .env cannot pick it),
# `--replace` is required, the app must be stopped, and a dump of what is about to
# be overwritten is taken and verified FIRST; if that dump fails, nothing is
# restored.
#
#   docker compose stop app
#   ./scripts/verify-restore.sh backups/cdkt-cdkt_admin-<stamp>-<pid>.sql.gz   # optional dry run
#   ./scripts/restore-db.sh backups/cdkt-cdkt_admin-<stamp>-<pid>.sql.gz cdkt_admin --replace
#   docker compose up -d app
#
# "Stopped" is checked two ways (docker compose ps, docker inspect $APP_CONTAINER).
# If neither can answer — e.g. a Compose too old for `ps --status` — the script
# refuses; check by hand (`docker ps`) and add `--i-know-app-is-stopped` after
# `--replace` to vouch for it.
#
# Tables that exist in the database but NOT in the dump are left alone (a dump only
# drops what it recreates).  On a fresh host that is nothing; on a live one, restore
# into an empty database if "exactly the backup" matters.
#
# Environment (read from .env next to this repo, or from the shell):
#   MYSQL_ROOT_PASSWORD   required
#   MYSQL_CONTAINER       default: cdkt_mysql
#   APP_CONTAINER         default: cdkt_app     (second "is the app stopped?" signal)
#   BACKUP_DIR           default: ./backups   (where the pre-restore dump goes)
#
# Exit codes: 0 restored, 1 usage / configuration, 2 refused (precondition not met),
#             3 the pre-restore dump failed (nothing was restored), 4 restore failed.

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
DATABASE="${2:-}"
CONFIRM="${3:-}"
shift "$(( $# < 3 ? $# : 3 ))"
APP_STOPPED_VOUCHED=0
EXTRA_ARG=''
for opt in "$@"; do
  case "$opt" in
    --i-know-app-is-stopped) APP_STOPPED_VOUCHED=1 ;;
    *) EXTRA_ARG="$opt" ;;
  esac
done
CONTAINER="${MYSQL_CONTAINER:-cdkt_mysql}"
APP_CONTAINER="${APP_CONTAINER:-cdkt_app}"
DEST="${BACKUP_DIR:-$REPO_ROOT/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PRE_DUMP=''
ERR_FILE=''

emit() { printf '{"event":"restore_db.%s","time":"%s","detail":%s}\n' "$1" "$(date -u +%FT%TZ)" "$2"; }
cleanup() { [[ -n "$ERR_FILE" ]] && rm -f "$ERR_FILE"; return 0; }
trap cleanup EXIT
fail() { emit "failed" "{\"stage\":\"$1\",\"message\":\"$2\"}" >&2; exit "$3"; }

# The root password goes in by NAME (`-e MYSQL_PWD`, no value): the docker CLI copies
# it from its own environment, so it is never in an argv that `ps` shows.
dexec() { MYSQL_PWD="${MYSQL_ROOT_PASSWORD:-}" docker exec -e MYSQL_PWD "$@"; }

[[ -n "$ARCHIVE" && -n "$DATABASE" ]] || fail usage "usage: restore-db.sh <backup.sql.gz> <target-database> --replace" 1
[[ "$CONFIRM" == '--replace' ]] || fail usage "refusing without --replace: this overwrites tables in $DATABASE" 1
[[ -z "$EXTRA_ARG" ]] || fail usage "unknown option: $EXTRA_ARG (only --i-know-app-is-stopped may follow --replace)" 1
# The name is interpolated into SQL below; MySQL identifiers here are plain words.
[[ "$DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || fail usage "target database must match [A-Za-z0-9_]+" 1
[[ -f "$ARCHIVE" ]] || fail usage "no such file: $ARCHIVE" 1
[[ -n "${MYSQL_ROOT_PASSWORD:-}" ]] || fail config "MYSQL_ROOT_PASSWORD is not set" 1
command -v docker >/dev/null 2>&1 || fail config "docker is not on PATH" 1
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail config "container $CONTAINER is not running" 1

# ── The dump must be a complete mysqldump of ONE database ────────────────────
# Same completion rule backup-db.sh enforces when it writes the file: a truncated
# dump restored over live tables is worse than no restore.
gzip -t "$ARCHIVE" 2>/dev/null || fail archive "gzip archive is corrupt" 2
gzip -dc "$ARCHIVE" | tail -5 | grep -q 'Dump completed' || fail archive "dump has no completion marker — it is truncated" 2
TABLE_COUNT="$(gzip -dc "$ARCHIVE" | grep -c '^CREATE TABLE' || true)"
[[ "$TABLE_COUNT" -ge 20 ]] || fail archive "only $TABLE_COUNT tables in the dump; expected at least 20 — wrong file?" 2
# A dump that selects its own database would write somewhere other than the name the
# operator just confirmed.  backup-db.sh never produces one; refuse rather than obey.
# (verify-restore.sh carries the same check — keep the two in step.)
#
# What counts, at the start of a line (after an optional UTF-8 BOM, leading blanks,
# or a `/*!NNNNN` / `/*M!NNNNNN` executable-comment opener — MySQL/MariaDB RUN those):
#   CREATE|DROP DATABASE|SCHEMA, USE <db>, and the mysql client commands that switch
#   or leave the database the dump was piped into: \u, connect / \r, source / \., and
#   system / \! (a shell in the MySQL container).
# A mysqldump of ONE database (`--databases`/`--all-databases` are what emit these)
# never starts a line with any of them.  Only line starts are checked: inside an
# extended INSERT a `; use ` is just article text, and telling data from code there
# needs a SQL lexer — this guard is for the wrong KIND of dump, not a crafted file.
DB_SWITCH_RE=$'^(\xEF\xBB\xBF)?[[:space:]]*(/\\*M?![0-9]*[[:space:]]*)?((CREATE|DROP)[[:space:]]+(DATABASE|SCHEMA)([^A-Za-z0-9_$]|$)|USE([[:space:]`;]|$)|CONNECT([[:space:];]|$)|SOURCE[[:space:]]|SYSTEM[[:space:]]|\\\\[ur.!])'
dump_selects_database() {
  # `grep -c` reads to EOF, so gzip never dies of SIGPIPE.  `grep -q` stopped at the
  # first hit, gzip got 141, pipefail made the whole `if` false — the guard passed
  # exactly the dumps that had the line near the top.  gzip's own status is still
  # judged: an archive that cannot be read to the end fails closed.
  local scan hits statuses
  scan="$(gzip -dc -- "$1" 2>/dev/null | LC_ALL=C grep -aicE -- "$DB_SWITCH_RE"; printf '%s %s\n' "${PIPESTATUS[0]}" "${PIPESTATUS[1]}")"
  hits="${scan%%$'\n'*}"
  statuses="${scan##*$'\n'}"
  case "$statuses" in
    '0 0') return 0 ;;                         # found
    '0 1') [[ "$hits" == 0 ]] && return 1 ;;   # clean
  esac
  return 2                                     # gzip or grep failed: unknown
}
set +e; dump_selects_database "$ARCHIVE"; SELECTS_DB=$?; set -e
case "$SELECTS_DB" in
  1) ;;
  0) fail archive "dump selects its own database or leaves it (CREATE/DROP DATABASE, USE, or a mysql client command such as connect / source / system) — refusing, it would not land in $DATABASE" 2 ;;
  *) fail archive "could not read the whole dump to check which database it writes to — refusing" 2 ;;
esac

# ── The app must be stopped (same rule as restore-media.sh) ──────────────────
# Two independent signals.  A `docker compose ps` that FAILS (a Compose too old for
# --status, a compose file that does not parse, no daemon) used to read exactly like
# "nothing is running" and the restore went ahead under a live app.  Now any signal
# saying "running" refuses; "stopped" needs a signal that positively says so; when
# neither can tell, refuse unless the operator vouches with --i-know-app-is-stopped.
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
  running) fail precondition 'the app is running; run "docker compose stop app" before restoring' 2 ;;
  *)
    if [[ "$APP_STOPPED_VOUCHED" == 1 ]]; then
      emit "app_state_unknown" "{\"container\":\"$APP_CONTAINER\",\"vouched\":true}" >&2
    else
      fail precondition "cannot tell whether the app is running (docker compose ps failed and $APP_CONTAINER cannot be inspected) — refusing; after checking it is stopped, re-run with --i-know-app-is-stopped" 2
    fi
    ;;
esac

# ── The target must exist: a typo should fail, not create a stray database ───
EXISTS="$(dexec "$CONTAINER" mysql -u root -N -B \
  -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '$DATABASE'" 2>/dev/null)" \
  || fail precondition "could not query $CONTAINER" 2
[[ "$EXISTS" == "1" ]] || fail precondition "database $DATABASE does not exist in $CONTAINER (check the name; compose creates MYSQL_DATABASE)" 2

# ── Dump what is about to be overwritten, and verify it ──────────────────────
EXISTING_TABLES="$(dexec "$CONTAINER" mysql -u root -N -B \
  -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$DATABASE'" 2>/dev/null)" \
  || fail precondition "could not count tables in $DATABASE" 2

if [[ "$EXISTING_TABLES" -gt 0 ]]; then
  mkdir -p "$DEST"
  # Not named cdkt-<db>-*, so backup-db.sh's age-based rotation never deletes it.
  PRE_DUMP="$DEST/cdkt-prerestore-$DATABASE-$STAMP-$$.sql.gz"
  ERR_FILE="$(mktemp)"
  if ! dexec "$CONTAINER" mysqldump -u root \
        --single-transaction --quick --routines --triggers --events \
        --default-character-set=utf8mb4 "$DATABASE" 2>"$ERR_FILE" | gzip -9 > "$PRE_DUMP" \
     || ! gzip -t "$PRE_DUMP" 2>/dev/null \
     || ! gzip -dc "$PRE_DUMP" | tail -5 | grep -q 'Dump completed'; then
    ERR="$(tr -d '"' < "$ERR_FILE" | tail -c 300 | tr '\n' ' ')"
    rm -f "$PRE_DUMP"
    fail pre_dump "could not take a verified dump of $DATABASE before overwriting it; nothing was restored. ${ERR}" 3
  fi
  emit "pre_dump" "{\"database\":\"$DATABASE\",\"file\":\"$PRE_DUMP\",\"tables\":$EXISTING_TABLES}"
else
  emit "pre_dump_skipped" "{\"database\":\"$DATABASE\",\"reason\":\"database is empty\"}"
fi

# ── Restore ──────────────────────────────────────────────────────────────────
if ! gzip -dc "$ARCHIVE" | dexec -i "$CONTAINER" \
      mysql -u root --default-character-set=utf8mb4 "$DATABASE"; then
  fail restore "the dump did not apply cleanly to $DATABASE${PRE_DUMP:+ — the previous contents are in $PRE_DUMP}" 4
fi

read -r TABLES USERS ARTICLES <<< "$(dexec "$CONTAINER" mysql -u root -N -B -e "
  SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = '$DATABASE'),
    (SELECT COUNT(*) FROM \`$DATABASE\`.users),
    (SELECT COUNT(*) FROM \`$DATABASE\`.articles)" 2>/dev/null)" \
  || fail verify "restored, but could not count the result in $DATABASE" 4

emit "succeeded" "{\"database\":\"$DATABASE\",\"archive\":\"$ARCHIVE\",\"preRestoreDump\":\"${PRE_DUMP}\",\"tables\":$TABLES,\"users\":$USERS,\"articles\":$ARTICLES}"
printf '%s\n' 'Database restored. Start the app with: docker compose up -d app'
