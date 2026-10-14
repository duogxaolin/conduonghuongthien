# Design

## Context

- `server/middleware/admin-auth.ts` is the only gate for 282 admin handlers. It reads `getRequestURL(event).pathname` (raw, percent-escapes intact). On h3 1.15.11 the app layer decodes the path before routing, so `event.path` is already decoded inside middleware while `getRequestURL().pathname` is not. Verified with a standalone h3 app (`/api/%61dmin/users`: raw `/api/%61dmin/users`, `event.path` `/api/admin/users`, handler reached; `%2e` and `..` stay literal in `event.path`, so they still start with `/api/admin/` and are gated). `tests/admin-auth-middleware.test.ts` fakes `getRequestURL`, so it cannot see the difference.
- 74 admin handler files do not call `requireResourcePermission`/`checkPermission` directly; an audit read all of them and found each enforces a check through a domain helper, a service call, an inline super-admin test, or an own-profile rule. No inventory test keeps that true.
- `server/services/backup.ts`: `restoreSql` gunzips the whole file into a string (`gunzipSync`, no output cap) and runs it with `multipleStatements: true` as `DB_USER` (root in the shipped compose). `restoreUploaded` writes the file and inserts a `backups` row **before** any validation. `restoreFiles` runs `tar -xzf` after only a name check. `dumpSql` reads each table with a separate `SELECT *` through a pool connection and formats `Date` with `toISOString()` (UTC), while the pool is configured `timezone: '+07:00'`.
- The MySQL container's `time_zone` is `SYSTEM` = UTC (`NOW() = UTC_TIMESTAMP()`); the app does not set a session time zone.
- `rotateOldBackups` (end of `runBackup`) deletes the oldest `done` rows beyond `keepCount`, including their files.
- Existing guards: `tests/reader-audit-atomicity.test.ts` (audit + write atomicity, scans `server/api/admin/**` and `server/services/`), `tests/admin-error-retry-ui.test.ts` and `tests/skeleton-loading-ui.test.ts` (pin patterns inside `backup.vue`).

See `proposal.md` — Why.

## Goals / Non-Goals

**Goals:**
- No spelling of a request path can reach an admin handler without passing the middleware.
- Restore, backup download and backup deletion require a super-administrator; the UI matches.
- A restore validates before it writes or executes, takes a safety backup, and is audited atomically.
- Dump → restore is lossless for date/time values and is a consistent snapshot, proven against real MySQL.
- The handler-authorization inventory is enforced by a test with named exemptions.

**Non-Goals:**
- Running restore as a restricted database user (the shipped `DB_USER=root` default stays; recorded as a recommendation only).
- Streaming dump/restore to avoid holding the whole dump in memory (known limit, unchanged).
- A dedicated `backup` RBAC resource (the decision for this change is super-admin-only; revisiting it would be a separate change).
- Fixing the pre-existing mismatch between `backups.trigger VARCHAR(16)` and the 18-character `pre-fix-thumbnails` trigger (observed, out of scope here; listed under Open Questions).
- The application-wide TIMESTAMP/`+07:00` interpretation quirks outside the dump path.

## Decisions

### D1. Gate on candidate paths, exempt only if every candidate is exempt

The middleware computes candidates from `event.path` (query and fragment removed), its `decodePath` form, and the raw `getRequestURL().pathname`. The request is an admin request if **any** candidate starts with `/api/admin/`; it is exempt only if **every distinct candidate** equals one of the four exact exempt paths. A candidate that cannot be decoded is kept in its raw form and still participates, so malformed encodings fail closed.
- Implementation refinement: the exemption check runs over the **decoded** candidates only (`event.path` without query/fragment, its decoded form, the decoded raw pathname). Literally requiring the undecoded raw pathname to be exempt would return 401 for `/api/admin/auth/log%69n`, which the spec requires to behave as the login endpoint. The undecoded raw pathname still takes part in "is this an admin request", so it can only make the gate stricter.
- Rationale: fail-closed against a mismatch between what the middleware sees and what the router matches, including a future h3/Nitro change in where decoding happens. Trusting `event.path` alone would be correct today but silent if that behaviour moved.
- Alternative: single `event.path` (simplest, matches the router today) — rejected because the failure mode is a silent auth bypass.
- Alternative: reject any path containing `%` under the admin prefix — rejected: legitimate encoded IDs/filenames (`/api/admin/backup/<encoded filename>`) exist.

### D2. Behavioural test with a real h3 app

A new test builds a real `createApp()` + `createRouter()` + `toNodeListener()` on an ephemeral port, mounts the real middleware (module mocks for the database and logger, as in `tests/admin-auth-middleware.test.ts`, with the real h3 functions installed as globals instead of fakes), and sends raw requests for every spelling in the spec (`%61dmin`, `%75sers`, `%2e%2e`, `//`, trailing slash, query string, malformed `%zz`, exempt endpoint with an encoded character). Assertion: for every non-exempt spelling the response is 401/400 **and the sentinel route handler was never invoked**. The existing test file stays (token/stage/revocation branches) and its event stub gains a `path` field so it exercises the new accessor.

### D3. Handler inventory guard with named exemptions

`tests/admin-handler-authorization.test.ts` enumerates `server/api/admin/**/*.ts`. A handler passes if its own source calls a recognised check (`requireResourcePermission`, `checkPermission`, the `require*Permission` helpers, `requireAnalyticsRead`, `requireSuperAdmin`) or imports (relative, one hop) a `server/services/**` / `server/utils/**` module that does. Everything else must appear in `AUTH_EXEMPTIONS: Record<path, reason>`. The test also fails for an exemption that no longer exists or now passes by itself. It is a source-reading guard by nature (the property is "no handler is forgotten"), and is kept deliberately small; behaviour is covered by D2 and by `tests/permissions-behavior.test.ts`.

### D4. `requireSuperAdmin` helper, restricted actions, UI

Add `requireSuperAdmin(actor)` beside `requireResourcePermission` in `server/utils/permissions.ts` (403, Vietnamese message, same shape as the existing inline check in `users/[id]/mfa.delete.ts`, which may adopt it). The four backup endpoints (`restore`, `restore-upload`, `[filename].get`, `[filename].delete`) keep their existing `requireResourcePermission(…, 'settings', …)` call (so the project-wide "every handler calls the helper" rule and its guards stay true) and add `requireSuperAdmin`. `backup.vue` reads `isSuperAdmin` from `useAdminAuth()` and omits the restore upload card and the per-row restore/download/delete buttons otherwise; the server remains the authority.
- Alternative (new `backup` RBAC resource): rejected for this change by the owner's decision (super-admin only, keep current UI).

### D5. Restore pipeline order

`restoreUploaded`: validate (name, gzip magic, compressed cap) → write temp file → verify decompressed cap by a bounded streaming gunzip (`maxOutputLength`/byte counter, never `gunzipSync` unbounded) → only then record in `backups` and call `runRestore`. Any failure removes the temp file and leaves no row. Caps are constants in `backup.ts` (not environment variables, so `production/` is unaffected): compressed 512 MiB, decompressed 256 MiB (the SQL text must fit in one JavaScript string; V8's limit is ~512 MiB of characters and the existing implementation already holds it whole).
`runRestore` for `.sql.gz`: acquire restore lock → `runBackup('sql', 'pre-restore', adminId)` (abort restore if it fails; if the backup lock is held, report "a backup is running") → execute → audit.
Rotation: `runBackup` accepts `{ rotate: false }`; the `pre-restore` call uses it, so rotation can never delete the restore target. `'pre-restore'` is added to `BackupTrigger`. (11 chars; fits `VARCHAR(16)`.)
`.tar.gz`: `tar -tzvf` listing is parsed; entries are rejected for `..` segments, absolute paths, type other than file/dir (`l`/`h` links, devices), or a top-level directory other than the expected one (`uploads` or `media`); extraction happens only if every entry passes. If the listing output cannot be parsed, restore fails closed.

### D6. Audit and security log

`runRestore` writes `backup_restore` (success) in the existing transaction and a `backup_restore_failed` entry (failure) in its own transaction in the `catch`, with the reason; refusals before the lock (permission/validation) emit a security log event only (no DB write is attempted for requests that never started). Events use `SECURITY_EVENTS` entries `backupRestoreStarted/Succeeded/Failed/Refused` added to `server/utils/logger.ts`. `services/backup.ts` is added to `AUDITED_SERVICES` in `tests/reader-audit-atomicity.test.ts` if not already scanned.

### D7. Dump on a dedicated connection with exact strings and a pinned time zone

`dumpSql` opens its own connection (same environment configuration as `restoreSql`, extracted into one `createBackupConnection()` helper) with `dateStrings: true` and big-number-as-string options, runs `SET SESSION time_zone = '+00:00'`, `SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ`, `START TRANSACTION WITH CONSISTENT SNAPSHOT`, reads all tables, then `ROLLBACK`. The dump header gains `-- CDKT dump-format: 2` and `SET time_zone = '+00:00';` so restore is independent of the server default and the file is self-describing. `escapeSqlValue` drops its `Date` branch (values are strings); numeric/bigint strings are emitted unquoted only when they match a strict numeric pattern, otherwise quoted.
- Rationale: exact strings remove every conversion step; pinning `+00:00` makes TIMESTAMP literals mean the same instant on any server default; a dedicated connection avoids leaving session state on a pooled connection.
- Alternative: keep the pool connection and format `Date` in `+07:00` — rejected: it keeps the mysql2 parse/format dance, is wrong for DATE columns at day boundaries, and depends on the server default time zone for TIMESTAMP.
- Spike (task 5.1) runs first: a throwaway integration test inserts DATETIME/TIMESTAMP/DATE rows (midnight, 16:59:59 / 17:00:00 UTC boundary, month end, `0000`-free) into a disposable database, dumps with the **old** code to confirm the 7-hour shift, then with the new code to confirm zero shift under server `time_zone` of `SYSTEM` (UTC) and of `+07:00`. The test stays as the permanent round-trip guard (`tests/backup-dump-integration.test.ts`, gated like the other integration suites, registered in `ci.yml`).

### D8. Legacy dump detection

`restoreSql` peeks at the first bytes of the decompressed stream: header `-- CDKT backup:` **without** `-- CDKT dump-format: 2` ⇒ legacy application dump. The restore status message and the audit `meta` carry `legacyDateShift: true`; the UI shows the status message. Dumps starting with `-- MySQL dump` (the `scripts/backup-db.sh` output) are not flagged. No attempt is made to "repair" legacy values; the shift cannot be undone reliably in SQL.

## Risks / Trade-offs

- [A permission change removes capability from existing settings editors] → documented as BREAKING; they keep list/status/run (Drive destination, `keep_count` and Drive OAuth also became super-admin only, see "Post-verification adjustments"); CLAUDE.md/CHANGELOG note; super-admin can still restore.
- [Safety backup doubles restore time and can fail when the DB is the thing that is broken] → the restore refuses with a clear reason; an operator with VPS access still has `scripts/` restore tooling (not changed here).
- [Caps reject a legitimately large dump] → 256 MiB decompressed is far above the current dumps (~2 MB gzip); the constant is easy to raise and the error message states the cap.
- [`tar -tzvf` output format differs between BusyBox and GNU tar] → parser tested against both formats' sample lines; unparseable output fails closed.
- [Consistent snapshot requires InnoDB] → every table in `schema-tables/*` is InnoDB; a non-InnoDB table would still dump (no snapshot guarantee) and the dump logs a warning naming it.
- [D1's "any candidate" rule could over-gate a path that the router would 404 anyway] → harmless (401 vs 404 for a nonexistent route under `/api/admin/`).
- [The legacy flag only recognises dumps with the `-- CDKT backup:` header] → true for every dump `dumpSql` ever produced.

## Migration Plan

1. Ship code (no schema change, no new environment variable; `production/` unchanged).
2. After deploy, existing legacy dumps remain restorable with the warning; new backups are format 2.
3. Rollback: revert the change; format-2 dumps remain valid SQL for old code (extra `SET time_zone` statement is harmless), and old code simply ignores the header line.

## Open Questions

- `backups.trigger` is `VARCHAR(16)` while `pre-fix-thumbnails` has 18 characters; confirm whether inserts for that trigger already fail in strict mode and open a follow-up change if so (does not affect this change: `pre-restore` fits).

## Post-verification adjustments

What the adversarial verification and fix wave changed relative to the decisions above (facts; the decisions above are otherwise unchanged):

- **Tar validation (D5)**: instead of parsing `tar -tzvf` text columns, the archive is validated by a Node `TarHeaderScanner` that walks the 512-byte tar headers of the decompressed stream.
- **Admin gate (D1)**: the gate strips only the query string (`?`); a path containing `#` or `%23` is treated as non-exempt. The candidate-path rule of D1 (admin if any candidate starts with `/api/admin/`, exempt only if every candidate is exempt) was kept.
- **Backup access (D4)**: the Google Drive destination, the `keep_count` setting and the Drive OAuth endpoints became super-admin only (owner decision), in addition to restore, download and delete.
- **Rotation**: rotation keeps the newest backup per family and every `pre-restore` file.
- **Dump header (D7)**: the dump header also pins `sql_mode='NO_AUTO_VALUE_ON_ZERO'`.
- **Handler guard (D3)**: the handler-authorization guard (`tests/admin-handler-authorization.test.ts`) is AST-based.
