# Design

## Context

See proposal.md (Why). Verified facts at `main` 7dfed8c:

**The current migration block** (`server/db/migrations-additive.ts:545-580`)
- `CREATE TABLE IF NOT EXISTS media_categories`.
- Then `UPDATE media_items SET category_id = NULL WHERE category_id IS NOT NULL`, unconditionally, at `:565`.
- Then `DROP FOREIGN KEY fk_media_items_category` if a constraint with that **name** exists, whatever it references (`:568-576`).
- Then `ensureForeignKeyIfMissing(... REFERENCES media_categories ... ON DELETE SET NULL)` (`:577-580`).

**What a fresh database gets**
- `server/db/schema-tables/readers-media.ts:111` already declares `CONSTRAINT fk_media_items_category FOREIGN KEY (category_id) REFERENCES media_categories (id) ON DELETE SET NULL`, and `media_categories` is created first (`:64`).
- `server/db/schema.ts:927` agrees.
- A fresh database therefore never needs the conversion. Today it still pays an UPDATE plus a DROP/ADD FK, which is a table rebuild, on every boot.

**When the boot runs**
- `Dockerfile:100` runs `init.ts` → `seed.ts` → server on every container start.
- `docker-compose.yml` uses `restart: always`.
- `scripts/deploy-remote.sh` and `manage.sh` Update both recreate the app container.

**Existing pattern to copy**
- `ensureChatbotForeignKey` (`migrations-additive.ts:322-346`) reads `information_schema.KEY_COLUMN_USAGE` joined to `REFERENTIAL_CONSTRAINTS` **by column**, compares the referenced table, column and delete rule, and drops or re-adds only on mismatch.

**Test infrastructure**
- 17 `*-integration` suites call `initDb()` on a disposable database (`cdkt_<x>_<ts>_<pid>`, guarded by an `assertDisposableDatabase` regex).
- None of them seeds `media_items.category_id` and boots again.
- `tests/backup-dump-integration.test.ts:385-406` is the closest "boot 3×" precedent.

## Goals / Non-Goals

**Goals**
- The media-category conversion runs at most once per database, keyed on schema state, and is crash-safe at every step.
- A booted, converted database sees **zero** writes to `media_items` from this block.
- A real-MySQL test fails if anyone reintroduces an unconditional data write here.
- A documented, safe way to recover values wiped since 2026-09-22.

**Non-Goals**
- An automatic restore. It needs a human to pick a backup, and the values must be checked against the current `media_categories`.
- Other boot-time overwrites in `seed.ts`: the `home_sections.display_order` overwrite, and resurrection of deleted defaults. They are planned in wave1 (1B) and wave2.
- A general "every migration is idempotent" whole-schema suite. That is planned in wave2. This change pins the one table that is losing data.

## Decisions

### D1. Detect state by column and referenced table, not by constraint name
- Query every FK on `media_items.category_id` with `REFERENCED_TABLE_NAME` and `DELETE_RULE`.
- There are three outcomes. A fourth, a single FK to `media_categories` with the wrong delete rule, is handled as in `ensureChatbotForeignKey`: drop and re-add, and **no** UPDATE.

  | State | Action |
  |---|---|
  | Some FK on the column references `categories` (legacy) | 1. UPDATE `category_id` to NULL. 2. Drop every FK on the column. 3. Add `fk_media_items_category` → `media_categories(id)` SET NULL. |
  | Exactly one FK → `media_categories(id)`, SET NULL | Nothing. |
  | No FK on the column | Count dangling values. If 0, add the FK. If >0, log `db.migration.media_category_fk_blocked` with the count and skip; no UPDATE. |

- **Why by column.** A legacy database may carry an auto-named FK (for example `media_items_ibfk_1`), not only `fk_media_items_category`. Name-based detection is exactly how today's code ended up dropping the *correct* FK every boot.
- **Rejected: value-based clearing** (`LEFT JOIN media_categories … WHERE mc.id IS NULL`). Legacy ids 1–7 collide with the seeded media-category ids 1–4 (`seed.ts:80`). Stale ids would survive and silently mean a different category.
- **Rejected: a one-shot marker row in `settings`.** It adds a second source of truth that can drift from the schema, for example after a restore of an old dump. Schema state *is* the marker: the conversion removes its own trigger.

### D2. Order inside the legacy branch: UPDATE → DROP → ADD
- **Crash after UPDATE.** The legacy FK is still present, so the next boot repeats an UPDATE on rows that are already NULL. That is harmless.
- **Crash after DROP.** The state is "no FK, all NULL", so the next boot adds the FK with no data change.
- **Why not ADD before DROP.** Two FKs on one column referencing different tables would reject almost every write in between.

### D3. Dangling values without any FK: log and continue, do not crash
- `ensureForeignKeyIfMissing` throws on MySQL 1452 today, and the container would crash-loop.
- For this block, availability and data preservation win over the defense-in-depth FK.
- The error event is stable (added to the logger's documented events) so it can be alerted on later. The wave2 log work wires the alerting.

### D4. The test runs on real MySQL
- A fake pool cannot show what `information_schema` returns, or that a DROP/ADD happened. The previous bug survived because nothing exercised the real driver.
- New suite: `tests/media-category-migration-integration.test.ts`, following the existing suite contract.
  - Env switch `MEDIA_CATEGORY_MIGRATION_INTEGRATION=1` plus `*_HOST/_PORT/_USER/_PASSWORD`.
  - Disposable database name and the same `assertDisposableDatabase` guard.
  - Cases:
    1. **Legacy upgrade.** Hand-build the pre-split shape: `media_items.category_id` with an FK to `categories`, auto-named in one variant. Add rows with `category_id` 2 and 6 and run `initDb()`. Assert both are NULL, exactly one FK exists, it references `media_categories`, and the delete rule is SET NULL.
    2. **Repeat boots.** On that database, assign `media_categories` id 2 to a row, run `initDb()` twice, and assert the value is still 2.
    3. **Fresh database.** Run `initDb()` + seed, assign a category, run `initDb()` again, assert it is unchanged. Use `SHOW CREATE TABLE` / `information_schema` to assert the FK is the same constraint.
    4. **No FK + dangling value.** Drop the FK, set `category_id = 999`, run `initDb()`. Assert the value is still 999, no FK was added, and the boot resolved.
- **CI.** One matrix entry in `.github/workflows/ci.yml` `integration-tests.strategy.matrix.include`. The env vars go in **both** the `Integration test` step and the `Fail if this suite skipped` step. A missing second copy makes the skip check misreport; the comment at ci.yml ~463-470 records that lesson.

### D5. Restore runbook (documented, operator-run, after deploy)
0. **Preserve the backups before anything else, today, before this change is even merged.** Copy `./backups` and the in-app backup directory to a non-rotated location or off the VPS. Rotation (`BACKUP_KEEP_DAYS`, `backup_keep_count`) is deleting the only dumps that may hold the wiped values.
1. Confirm the fixed image is live and healthy, and that no rollback to a pre-fix image is pending. A pre-fix image would wipe the categories again on its first boot.
2. Take a fresh backup (`scripts/backup-db.sh`).
3. Pick a candidate dump.
   - It must be newer than 2026-09-22 (pre-split dumps hold article-category ids).
   - It must be taken after staff assigned categories and before the next restart.
   - List the backups with timestamps next to the deploy and restart history: `docker inspect` StartedAt, and the CI deploy runs.
4. Load the candidate into a **scratch** database on the same MySQL. Never load it into production.
5. Run a dry-run SELECT. Then run `UPDATE media_items mi JOIN scratch.media_items s ON s.id = mi.id JOIN scratch.media_categories sc ON sc.id = s.category_id JOIN media_categories pc ON pc.id = sc.id AND pc.slug = sc.slug SET mi.category_id = s.category_id WHERE mi.category_id IS NULL`.
   - The slug match refuses recycled ids.
   - `IS NULL` never overwrites a category staff re-assigned after the fix.
6. For videos with no restorable value, list the candidates for manual re-assignment from `activity_logs`:
   - `resource = 'media_portal'` and (`action = 'create'` with `JSON_EXTRACT(meta, '$.hasCategory') = true`, or `JSON_CONTAINS(JSON_EXTRACT(meta, '$.changed'), '"categoryId"')`) joined to `media_items` rows whose `category_id` is NULL.
   - Audit rows record *that* a category was set, not *which* (`media-portal.ts:760`, `:865`). Staff must choose the value.
7. Drop the scratch database.
- **Where it is documented.** `docs/decisions/data-layer.md` holds it as a section, and `production/README.md` links to it under a "post-deploy data repair" heading.

## Risks / Trade-offs

- **[Risk] Rolling back to a pre-fix image wipes categories again.** `deploy-remote.sh` automatically restores the previous image if the healthcheck fails, and before this change every image carries the wipe. → The runbook makes "no rollback pending" step 1, and the restore runs only after the fixed image is confirmed live. Wave 1 adds a pre-deploy DB dump, so later rollbacks have a matching snapshot.
- **[Risk] A database where the legacy FK was renamed or partially migrated by hand.** → D1 detects by column, so any FK to `categories` triggers the conversion, and the integration test covers the auto-named variant.
- **[Risk] The dry-run restore matches nothing.** That happens when every backup was taken after a restart. → Fall back to the activity-log list for manual re-assignment. Tell staff honestly that values from that window cannot be recovered.
- **[Trade-off] No FK when dangling values exist (D3).** Referential integrity on this column becomes a logged warning instead of a hard guarantee in that rare state. Today's alternative, silent nulling, is the very bug being fixed.

## Migration Plan

1. Merge this change **alone**. It deploys automatically, and the first boot of the new image makes no writes to `media_items` on an already-converted database.
2. Verify in production:
   - The container started.
   - `SHOW CREATE TABLE media_items` shows one FK to `media_categories` SET NULL.
   - Assign a test category, run `docker compose restart app`, and confirm it survived.
3. The operator runs the restore runbook (D5) with the chosen backup.
4. **Rollback.** Reverting this change brings the wipe back, so never roll back past it. If the new image fails to start for an unrelated reason, fix forward.
