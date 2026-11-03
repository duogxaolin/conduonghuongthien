# Tasks

> Scope: only the files named here. Do not touch `seed.ts`; it is covered in wave1/wave2.
> Do not commit or push until the user explicitly asks. Merging deploys to production.

## 1. Pin the bug first (test before fix)

- [x] 1.1 Create `tests/media-category-migration-integration.test.ts` following the existing integration contract.
  - Env switch `MEDIA_CATEGORY_MIGRATION_INTEGRATION=1`, plus `MEDIA_CATEGORY_MIGRATION_HOST/PORT/USER/PASSWORD`.
  - Disposable DB name `cdkt_mediacat_<ts>_<pid>` with the `assertDisposableDatabase` guard. Drop the DB in `after`.
  - Verify: the suite skips cleanly without the switch.
- [x] 1.2 Add case "fresh DB, category survives reboot". Run `initDb()` + seed, assign `media_categories` id to a `media_items` row, run `initDb()` again, and assert the value is unchanged.
  - Verify: against current `main` with a local MySQL, this case FAILS (the value becomes NULL). This proves the test catches the bug.
- [x] 1.3 Add case "legacy upgrade".
  - Build the pre-split shape: drop the FK on `media_items.category_id`, then add one referencing `categories(id)`. Use two variants, named `fk_media_items_category` and auto-named.
  - Insert rows with `category_id` 2 and 6, then run `initDb()`.
  - Assert both rows are NULL, the column has exactly one FK, it references `media_categories(id)`, and `DELETE_RULE` is `SET NULL`.
- [x] 1.4 Add case "repeat boots after upgrade". Assign id 2 on the upgraded DB, run `initDb()` twice, and assert it is still 2.
- [x] 1.5 Add case "no FK + dangling value".
  - Drop the FK and set `category_id = 999`.
  - Assert `initDb()` resolves, the value stays 999, no FK exists, and the `db.migration.media_category_fk_blocked` event was logged. Capture it via the logger or a stdout spy, the same way other suites assert log events.
- [x] 1.6 Register the suite in `.github/workflows/ci.yml`.
  - Add a matrix `include` entry `{suite: media-category-migration, file: tests/media-category-migration-integration.test.ts, switch: MEDIA_CATEGORY_MIGRATION_INTEGRATION}`.
  - Add the `MEDIA_CATEGORY_MIGRATION_HOST/PORT/USER/PASSWORD` env lines to **both** the `Integration test` step and the `Fail if this suite skipped` step.
  - Verify: `npm test` passes, including `tests/ops-scripts.test.ts` and any CI-shape guards.
  - ← (verify: both env blocks carry the new vars; the matrix entry names an existing file)

## 2. Fix the migration

- [x] 2.1 In `server/db/migrations-additive.ts`, replace the block at ~545-580.
  - Read every FK on `media_items.category_id` via `information_schema.KEY_COLUMN_USAGE` joined to `REFERENTIAL_CONSTRAINTS`, the same query shape as `ensureChatbotForeignKey` (`:322-346`).
  - Branch exactly as in design.md D1, in the order from D2: legacy → UPDATE, DROP all FKs on the column, ADD; correct → nothing; wrong delete rule → DROP + ADD with no UPDATE; none → count dangling, then ADD or log-and-skip.
  - Keep the `CREATE TABLE IF NOT EXISTS media_categories` above it.
  - Rewrite the comment block to state the state-keyed rule, and why value-based clearing is wrong (the id collision).
  - Verify: all cases in group 1 pass on local MySQL (`E2E_DB_PORT`/dev docker MySQL).
- [x] 2.2 Add the stable event name `db.migration.media_category_fk_blocked` where documented log events live (`server/utils/logger.ts` event list or comments, following the existing convention). Log it with `{ danglingRows }` only, no row data.
  - Verify: a unit or source check that the name exists, and case 1.5 asserts it.
- [x] 2.3 Run `npm run db:drift`, `npm run typecheck` (or the repo's typecheck script) and `npm test`.
  - Verify: drift stays green (62 tables / 635 columns), 0 type errors, 0 test failures.
  - ← (verify: on an already-converted DB, the block issues no `UPDATE media_items` and no `ALTER TABLE media_items`; check via a general-log or statement spy in case 1.2/1.4)

## 3. Restore runbook and docs

- [x] 3.1 Add a "Media category restore after the 2026-09-22 boot wipe" section to `docs/decisions/data-layer.md`, with the seven steps from design.md D5.
  - Step 0 must be "preserve backups now (copy out of rotation)".
  - Include the exact SQL: a dry-run SELECT first, then the UPDATE joining on id + slug with `WHERE mi.category_id IS NULL`, and the `activity_logs` listing query.
  - State that it must run only after the fixed image is live, with no rollback pending.
  - Verify: section present; SQL uses only parameter-free literals and scratch-DB names as placeholders.
- [x] 3.2 In `production/README.md`, add a "Post-deploy data repair" pointer to that section, with the warning that a rollback to an image older than this fix wipes categories again.
  - Verify: the link resolves.
- [x] 3.3 Add a `docs/CHANGELOG.md` entry for the bug (cause commit `69a84eb`, window 2026-09-22 → fix date, every boot), the fix, and the test.
- [x] 3.4 Add one line to `CLAUDE.md` § "Quy ước tầng dữ liệu": the media-category conversion in `migrations-additive.ts` is keyed on the legacy FK, never on values, and must not write `media_items` on a converted database. Include the test name `tests/media-category-migration-integration.test.ts`. Do NOT state a general "boot never writes rows" rule: other boot writes still exist (`migrations-additive.ts:397-409, 755-764, 807-880`) and are handled by wave2 `schema-upgrade-safety`.
  - Verify: the line exists and stays short (CLAUDE.md is a checklist, not a narrative).
  - ← (verify: runbook steps match design D5; no instruction tells the operator to load a dump into the production DB)
