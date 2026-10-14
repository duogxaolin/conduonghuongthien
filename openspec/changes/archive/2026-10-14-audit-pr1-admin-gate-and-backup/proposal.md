# Proposal

## Why

A 2026-10-13 audit found two High security defects in the admin surface:

1. The authentication middleware in front of every `/api/admin/**` route compares the **raw** request path, while the router matches the **decoded** path. A percent-encoded prefix such as `/api/%61dmin/users` reaches the handler without any token, `isActive`, `tokenVersion` or MFA-stage check. Today nothing leaks only because every handler re-checks permissions; one new handler without its own check would be fully public. The existing middleware test cannot catch this because it fakes the URL accessor.
2. Backup restore executes an uploaded SQL file with `multipleStatements` as the database user (root by default) and needs only `settings.update`; the full dump (password hashes, citizen submissions) is downloadable with `settings.read`. A user who may edit settings but not users/roles can therefore escalate to full database control, bypassing the superadmin-only gate on `tracking_custom_head`.

The audit also found that the in-app dump writes every `Date` in UTC while the pool uses `+07:00`, so restored DATETIME/TIMESTAMP/DATE values shift by seven hours, and that the dump is not a consistent snapshot. A restore that silently corrupts timestamps is a data-integrity defect on top of the security one, and both live in the same code path.

## What Changes

- **Admin gate**: the middleware decides "is this an admin API request" and "is this an exempt login-flow endpoint" from the decoded path (query string removed), and a behavioural test drives a real h3 app + router instead of a faked URL accessor.
- **Admin handler inventory guard**: a test that lists every `server/api/admin/**` handler and requires each to enforce a permission check or appear in a named exemption list with a reason (defence in depth against a future handler that relies on the middleware alone).
- **Backup access**: restore (by filename and by upload), download of a backup file, and deletion of a backup become **superadmin-only**. Listing and status stay on `settings.read`. The backup page hides the actions for everyone else.
- **Restore safety**: a `pre-restore` backup is taken before the restore runs; uploaded files are validated (gzip magic, compressed and decompressed size caps) before anything is written or executed; the tar branch lists entries first and refuses `..`, absolute paths, symlinks and hard links; every restore is audited atomically and emits a security log event; rotation never deletes the file being restored.
- **Dump fidelity**: the dump emits date/time columns as the exact strings MySQL stores (no JavaScript `Date` conversion), pins the session `time_zone`, and reads all tables inside one consistent-snapshot transaction. A round-trip test against real MySQL proves DATETIME, TIMESTAMP and DATE survive dump → restore unchanged.
- **BREAKING**: non-superadmin administrators who currently hold `settings.update`/`settings.read` lose restore, download and delete of backups, and (owner decision, added during verification) changing the Google Drive backup destination, the `keep_count` retention setting, and the Drive OAuth endpoints, which become super-admin only. They keep listing, status and running a backup.

## Capabilities

### New Capabilities

- `admin-api-authentication`: contract for how `/api/admin/**` requests are authenticated before any handler runs (path canonicalisation, exempt endpoints, token/user/session/MFA-stage checks) and how handler-level authorization coverage is kept honest.
- `backup-restore`: who may download, restore and delete backups, what a restore must verify before executing anything, how restore is audited, and what a database dump must preserve (timestamps, consistency).

### Modified Capabilities

<!-- None: no existing spec under openspec/specs covers admin authentication or backups. -->

## Impact

- Code: `server/middleware/admin-auth.ts`, `server/utils/permissions.ts` (superadmin helper), `server/api/admin/backup/{restore,restore-upload,[filename].get,[filename].delete}.ts`, `server/services/backup.ts`, `app/pages/admin/settings/backup.vue` (and the extracted backup components), tests under `tests/` (middleware, backup, reader-audit-atomicity guard names).
- Data: none (no schema change). `backups.trigger` gains the value `pre-restore` (the column is a free string; confirm in design).
- Ops: no new environment variable. `production/` needs no change (confirmed in design); `docs/` and CLAUDE.md get a note on backup access.
- Behaviour change visible to staff: see **BREAKING** above.
