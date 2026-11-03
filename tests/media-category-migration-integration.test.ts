/**
 * Boot migrations must not erase the video categories staff assigned — real MySQL.
 *
 * The container runs `init.ts` → `seed.ts` → server on EVERY start (Dockerfile
 * CMD), and from 2026-09-22 (`69a84eb`) `applyAdditiveMigrations` ran
 * `UPDATE media_items SET category_id = NULL` unconditionally, then dropped and
 * re-added `fk_media_items_category`. Every deploy, every `manage.sh` Update and
 * every `restart: always` recovery wiped the media-portal categories. Nothing
 * caught it because no suite assigned a category and booted again.
 *
 * The conversion it was meant to be (article `categories` → `media_categories`)
 * is now keyed on SCHEMA STATE — an FK on `media_items.category_id` that still
 * references `categories` — never on values: legacy article-category ids 1–7
 * collide with the seeded media-category ids 1–4, so "id not found in
 * `media_categories`" cannot tell a stale id from a real assignment.
 *
 * Only a real server answers what this pins: what `information_schema` reports
 * for an auto-named FK, whether a DROP/ADD actually happened, and whether a
 * boot leaves a row alone. Cases:
 *
 *   1. fresh database (init + the real seed), category assigned, booted again →
 *      unchanged, same FK, and the migration issues no write to `media_items`;
 *   2. legacy upgrade, FK named `fk_media_items_category` → `categories`, with
 *      `media_categories` id 2 present (the id collision) → legacy ids 2 and 6
 *      cleared once, one FK → `media_categories(id)` SET NULL; then a category
 *      assigned and two more boots → it survives, no write to `media_items`;
 *   3. legacy upgrade, auto-named FK (`media_items_ibfk_N`), `media_categories`
 *      not yet created (the real pre-split shape) → same end state;
 *   4. drifted constraint, no data clearing in any branch:
 *      a. no FK, values valid (also the "interrupted after DROP" state) → FK
 *         added, values unchanged;
 *      b. FK → `media_categories` with the wrong delete rule → rebuilt SET NULL,
 *         values unchanged, no UPDATE;
 *      c. no FK and a dangling value → the boot still resolves, the value stays,
 *         no FK is added, and `db.migration.media_category_fk_blocked` is logged
 *         with the dangling-row count.
 *
 * Gated and self-cleaning like the other *-integration suites:
 *
 *   MEDIA_CATEGORY_MIGRATION_INTEGRATION=1 MEDIA_CATEGORY_MIGRATION_PORT=33069 \
 *   MEDIA_CATEGORY_MIGRATION_PASSWORD=... \
 *     node --experimental-strip-types --experimental-test-module-mocks \
 *     --import ./scripts/ts-resolver.mjs --test tests/media-category-migration-integration.test.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import test, { after, before, type TestContext } from 'node:test'
import mysql, { type Connection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'

const enabled = process.env.MEDIA_CATEGORY_MIGRATION_INTEGRATION === '1'
const host = process.env.MEDIA_CATEGORY_MIGRATION_HOST || '127.0.0.1'
const port = Number(process.env.MEDIA_CATEGORY_MIGRATION_PORT || 3306)
const user = process.env.MEDIA_CATEGORY_MIGRATION_USER || 'root'
const password = process.env.MEDIA_CATEGORY_MIGRATION_PASSWORD || ''
const runId = `${Date.now()}_${process.pid}`
const DB = {
  fresh: `cdkt_mediacat_${runId}_fresh`,
  legacyNamed: `cdkt_mediacat_${runId}_legacynamed`,
  legacyAuto: `cdkt_mediacat_${runId}_legacyauto`,
  drift: `cdkt_mediacat_${runId}_drift`,
}
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const FK_BLOCKED_EVENT = 'db.migration.media_category_fk_blocked'
const originalEnv = { ...process.env }

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_mediacat_\d+_\d+_(fresh|legacynamed|legacyauto|drift)$/)
  assert.notEqual(name, 'cdkt_admin')
  if (originalEnv.DB_NAME) assert.notEqual(name, originalEnv.DB_NAME)
}

function pointAppAt(database: string) {
  assertDisposableDatabase(database)
  Object.assign(process.env, { DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME: database })
}

async function open(database: string) {
  assertDisposableDatabase(database)
  return mysql.createConnection({ host, port, user, password, database })
}

async function withConnection<T>(database: string, work: (conn: Connection) => Promise<T>): Promise<T> {
  const conn = await open(database)
  try {
    return await work(conn)
  } finally {
    await conn.end()
  }
}

/** The `init.ts` half of a container start, in process — what `npm run db:init` runs. */
async function bootInit(database: string) {
  const { initDb } = await import('../server/db/init.ts')
  pointAppAt(database)
  await initDb()
}

/**
 * The `seed.ts` half of a container start. It runs itself on import and ends with
 * `process.exit`, so — like the Dockerfile CMD and tests/e2e/global-setup.ts — it
 * runs as its own process. The admin password is generated per run, checked with
 * the policy the seed enforces, and never printed.
 */
async function bootSeed(database: string) {
  assertDisposableDatabase(database)
  const { passwordRejectionMessage } = await import('../server/utils/password-policy.ts')
  let adminPassword = ''
  for (let attempt = 0; attempt < 5 && !adminPassword; attempt += 1) {
    const candidate = `Qx7#${randomBytes(12).toString('base64url')}`
    if (!passwordRejectionMessage(candidate, { username: 'admin' })) adminPassword = candidate
  }
  assert.ok(adminPassword, 'could not generate a password satisfying the policy')
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--import', './scripts/ts-resolver.mjs', 'server/db/seed.ts'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...originalEnv,
        DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME: database,
        ADMIN_PASSWORD: adminPassword,
        ADMIN_EMAIL: 'mediacat@example.test',
        JWT_SECRET: randomBytes(32).toString('hex'),
        CHATBOT_ENCRYPTION_SECRET: randomBytes(32).toString('base64'),
        ANALYTICS_HMAC_SECRET: randomBytes(32).toString('hex'),
      },
    },
  )
  assert.equal(result.status, 0, `seed.ts failed (exit ${result.status})\n${result.stdout}\n${result.stderr}`)
}

type CategoryFk = { name: string, table: string, column: string, rule: string }

/** Every FK on `media_items.category_id`, read by COLUMN — not by constraint name. */
async function categoryFks(database: string): Promise<CategoryFk[]> {
  return withConnection(database, async (conn) => {
    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT k.CONSTRAINT_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       WHERE k.CONSTRAINT_SCHEMA = ? AND k.TABLE_NAME = 'media_items' AND k.COLUMN_NAME = 'category_id'
       ORDER BY k.CONSTRAINT_NAME`,
      [database],
    )
    return rows.map(row => ({
      name: String(row.CONSTRAINT_NAME),
      table: String(row.REFERENCED_TABLE_NAME),
      column: String(row.REFERENCED_COLUMN_NAME),
      rule: String(row.DELETE_RULE),
    }))
  })
}

const CONVERTED_FK: CategoryFk[] = [{ name: 'fk_media_items_category', table: 'media_categories', column: 'id', rule: 'SET NULL' }]

/** The FK clause exactly as the server prints it — a DROP/ADD with another shape would change it. */
async function categoryFkClause(database: string) {
  return withConnection(database, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SHOW CREATE TABLE `media_items`')
    const ddl = String(rows[0]?.['Create Table'] ?? '')
    return ddl.split('\n').map(line => line.trim()).filter(line => /FOREIGN KEY \(`category_id`\)/.test(line))
  })
}

/** `{ media_items.id: category_id }` for every row. */
async function categoriesById(database: string) {
  return withConnection(database, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT `id`, `category_id` FROM `media_items` ORDER BY `id`')
    return Object.fromEntries(rows.map(row => [Number(row.id), row.category_id === null ? null : Number(row.category_id)]))
  })
}

async function insertMediaItem(conn: Connection, key: string, categoryId: number | null) {
  const [result] = await conn.query<ResultSetHeader>(
    'INSERT INTO `media_items` (`slug`, `short_id`, `title`, `category_id`) VALUES (?, ?, ?, ?)',
    [`video-${key}`, `sid${key}`, `Video ${key}`, categoryId],
  )
  return result.insertId
}

/**
 * The article categories a pre-split database pointed at. On every real server the
 * seven defaults hold ids 1–7 — the same ids the legacy `media_items.category_id`
 * held. `initDb()` used to insert them itself (`schema-tables/content.ts`); since
 * wave2 D7 only `seed.ts` does, once per database, so the legacy fixture inserts the
 * two it needs with those ids.
 */
async function insertLegacyArticleCategories(conn: Connection) {
  await conn.query(
    "INSERT INTO `categories` (`id`, `name`, `slug`, `type`, `display_order`) VALUES (2, 'Tin hoạt động', 'tin-hoat-dong', 'news', 2), (6, 'Văn bản pháp luật', 'van-ban-phap-luat', 'document', 1)",
  )
  const [rows] = await conn.query<RowDataPacket[]>('SELECT `id` FROM `categories` WHERE `id` IN (2, 6) ORDER BY `id`')
  assert.deepEqual(rows.map(row => Number(row.id)), [2, 6], 'article categories 2 and 6 are missing — the legacy fixture needs them')
}

async function insertMediaCategories(conn: Connection) {
  for (let id = 1; id <= 4; id += 1) {
    await conn.query('INSERT INTO `media_categories` (`id`, `name`, `slug`, `display_order`) VALUES (?, ?, ?, ?)', [id, `Danh mục video ${id}`, `danh-muc-video-${id}`, id])
  }
}

function sqlText(statement: unknown): string {
  if (typeof statement === 'string') return statement
  if (statement && typeof statement === 'object' && 'sql' in statement) return String((statement as { sql: unknown }).sql)
  return String(statement)
}

/**
 * Runs the boot's migration step (`applyAdditiveMigrations`, the part of `initDb()`
 * that touches existing tables) on a connection whose `query`/`execute` are
 * recorded, and returns every SQL statement it sent.
 */
async function migrationStatements(t: TestContext, database: string): Promise<string[]> {
  const { applyAdditiveMigrations } = await import('../server/db/init.ts')
  const statements: string[] = []
  await withConnection(database, async (conn) => {
    for (const method of ['query', 'execute'] as const) {
      const original = conn[method].bind(conn) as (...args: unknown[]) => unknown
      t.mock.method(conn, method, (statement: unknown, ...rest: unknown[]) => {
        statements.push(sqlText(statement))
        return original(statement, ...rest)
      })
    }
    await applyAdditiveMigrations(conn, database)
  })
  // Non-vacuity: the recorder saw the media-category section run at all, including
  // its by-column FK inspection — so moving that block out of the boot path fails
  // here instead of passing on an empty recording.
  assert.ok(statements.some(sql => /CREATE TABLE IF NOT EXISTS `media_categories`/.test(sql)), 'the statement recorder saw nothing of the media-category migration')
  assert.ok(
    statements.some(sql => /information_schema\.KEY_COLUMN_USAGE/.test(sql) && /k\.TABLE_NAME = 'media_items' AND k\.COLUMN_NAME = 'category_id'/.test(sql)),
    'the media-category FK inspection did not run during the boot migration',
  )
  return statements
}

/**
 * Writes to `media_items` among recorded statements, minus one named exception:
 * `modifyColumn(… 'media_items', 'short_id', 'VARCHAR(16) NOT NULL')` re-applies
 * the short-id column definition on every boot. It is a separate migration that
 * never touches `category_id`; the general "boot never rewrites a table" rule
 * belongs to wave2 `schema-upgrade-safety`, not to this suite.
 */
function writesToMediaItems(statements: string[]) {
  return statements
    .filter(sql => /^\s*(UPDATE|ALTER\s+TABLE|DELETE\s+FROM|INSERT\s+INTO|REPLACE\s+INTO)\s+`?media_items`?(\s|$)/i.test(sql))
    .filter(sql => !/^\s*ALTER TABLE `media_items` MODIFY COLUMN `short_id` VARCHAR\(16\) NOT NULL\s*$/.test(sql))
    .map(sql => sql.replace(/\s+/g, ' ').trim())
}

type LogLine = Record<string, unknown>

/** Structured log lines the logger writes through `console.error` (error/warn level). */
function captureErrorLog(t: TestContext): LogLine[] {
  const lines: LogLine[] = []
  t.mock.method(console, 'error', (line: unknown) => {
    try {
      const parsed = JSON.parse(String(line)) as unknown
      if (parsed && typeof parsed === 'object') lines.push(parsed as LogLine)
    } catch { /* not a structured line */ }
  })
  return lines
}

before(async () => {
  if (!enabled) return
  for (const name of Object.values(DB)) assertDisposableDatabase(name)
})

after(async () => {
  if (!enabled) return
  const conn = await mysql.createConnection({ host, port, user, password })
  try {
    for (const name of Object.values(DB)) {
      assertDisposableDatabase(name)
      await conn.query(`DROP DATABASE IF EXISTS \`${name}\``)
    }
  } finally {
    await conn.end()
  }
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]
  Object.assign(process.env, originalEnv)
})

test('fresh database: a category assigned after the first boot survives the next boot', { skip: !enabled, timeout: 180_000 }, async (t) => {
  // Boot 1: the full start sequence on an empty server.
  await bootInit(DB.fresh)
  await bootSeed(DB.fresh)
  assert.deepEqual(await categoryFks(DB.fresh), CONVERTED_FK, 'a fresh database is born converted')

  // Staff assign real, seeded media categories (looked up by slug, not assumed ids).
  const ids = await withConnection(DB.fresh, async (conn) => {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT `id`, `slug` FROM `media_categories` WHERE `slug` IN ('video-huong-dan', 'video-tuyen-truyen')")
    const bySlug = Object.fromEntries(rows.map(row => [String(row.slug), Number(row.id)]))
    assert.ok(bySlug['video-huong-dan'] && bySlug['video-tuyen-truyen'], 'the seed did not create the default media categories')
    return {
      guide: await insertMediaItem(conn, 'guide', bySlug['video-huong-dan']!),
      outreach: await insertMediaItem(conn, 'outreach', bySlug['video-tuyen-truyen']!),
      none: await insertMediaItem(conn, 'none', null),
    }
  })
  const assigned = await categoriesById(DB.fresh)
  assert.notEqual(assigned[ids.guide], null)
  assert.notEqual(assigned[ids.outreach], null)
  const clauseBefore = await categoryFkClause(DB.fresh)

  // Boot 2: the same start sequence again — a deploy or a restart.
  await bootInit(DB.fresh)
  await bootSeed(DB.fresh)
  assert.deepEqual(await categoriesById(DB.fresh), assigned, 'a restart erased the assigned media categories')
  assert.deepEqual(await categoryFks(DB.fresh), CONVERTED_FK)
  assert.deepEqual(await categoryFkClause(DB.fresh), clauseBefore, 'the category FK was rebuilt in another shape')

  // Boot 3, recorded: the migration sends no UPDATE and no ALTER to media_items.
  const statements = await migrationStatements(t, DB.fresh)
  assert.deepEqual(writesToMediaItems(statements), [], 'an already-converted database was written to by the boot migration')
  assert.deepEqual(await categoriesById(DB.fresh), assigned)
})

test('legacy upgrade, FK named fk_media_items_category → categories: legacy ids cleared once, assignments survive later boots', { skip: !enabled, timeout: 180_000 }, async (t) => {
  await bootInit(DB.legacyNamed)
  // The pre-split shape: the category FK still points at the article `categories`,
  // and `media_categories` already holds id 2 — the collision value-based clearing
  // would miss.
  const ids = await withConnection(DB.legacyNamed, async (conn) => {
    await insertLegacyArticleCategories(conn)
    await insertMediaCategories(conn)
    await conn.query('ALTER TABLE `media_items` DROP FOREIGN KEY `fk_media_items_category`')
    await conn.query('ALTER TABLE `media_items` ADD CONSTRAINT `fk_media_items_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL')
    return { two: await insertMediaItem(conn, 'two', 2), six: await insertMediaItem(conn, 'six', 6) }
  })
  assert.deepEqual(await categoryFks(DB.legacyNamed), [{ name: 'fk_media_items_category', table: 'categories', column: 'id', rule: 'SET NULL' }])

  await bootInit(DB.legacyNamed)
  assert.deepEqual(await categoriesById(DB.legacyNamed), { [ids.two]: null, [ids.six]: null }, 'legacy article-category ids must be cleared — id 2 included, although media_categories has an id 2')
  assert.deepEqual(await categoryFks(DB.legacyNamed), CONVERTED_FK)

  // Repeat boots after the upgrade: an assignment made now must survive them.
  await withConnection(DB.legacyNamed, conn => conn.query('UPDATE `media_items` SET `category_id` = 2 WHERE `id` = ?', [ids.two]))
  await bootInit(DB.legacyNamed)
  await bootInit(DB.legacyNamed)
  assert.deepEqual(await categoriesById(DB.legacyNamed), { [ids.two]: 2, [ids.six]: null }, 'a boot after the upgrade erased an assigned media category')
  assert.deepEqual(await categoryFks(DB.legacyNamed), CONVERTED_FK)

  const statements = await migrationStatements(t, DB.legacyNamed)
  assert.deepEqual(writesToMediaItems(statements), [], 'the conversion ran again on an upgraded database')
  assert.deepEqual(await categoriesById(DB.legacyNamed), { [ids.two]: 2, [ids.six]: null })
})

test('legacy upgrade, auto-named FK → categories and no media_categories table yet: converted to the one SET NULL FK', { skip: !enabled, timeout: 180_000 }, async () => {
  await bootInit(DB.legacyAuto)
  // The real pre-split server had no `media_categories` table at all, and a
  // hand-made or older FK may carry MySQL's generated name, not ours.
  const ids = await withConnection(DB.legacyAuto, async (conn) => {
    await insertLegacyArticleCategories(conn)
    await conn.query('ALTER TABLE `media_items` DROP FOREIGN KEY `fk_media_items_category`')
    await conn.query('DROP TABLE `media_categories`')
    await conn.query('ALTER TABLE `media_items` ADD FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL')
    return { two: await insertMediaItem(conn, 'two', 2), six: await insertMediaItem(conn, 'six', 6) }
  })
  const legacy = await categoryFks(DB.legacyAuto)
  assert.equal(legacy.length, 1)
  assert.match(legacy[0]!.name, /^media_items_ibfk_\d+$/, 'the fixture did not produce an auto-named FK')
  assert.equal(legacy[0]!.table, 'categories')

  await bootInit(DB.legacyAuto)
  assert.deepEqual(await categoriesById(DB.legacyAuto), { [ids.two]: null, [ids.six]: null })
  assert.deepEqual(await categoryFks(DB.legacyAuto), CONVERTED_FK, 'the auto-named legacy FK survived next to the new one')
})

test('drifted constraint: missing FK is added and a wrong delete rule rebuilt without clearing values; dangling values block the FK, are kept and logged', { skip: !enabled, timeout: 180_000 }, async (t) => {
  await bootInit(DB.drift)
  const ids = await withConnection(DB.drift, async (conn) => {
    await insertMediaCategories(conn)
    return { three: await insertMediaItem(conn, 'three', 3), cleared: await insertMediaItem(conn, 'cleared', null) }
  })
  const values = { [ids.three]: 3, [ids.cleared]: null }

  // a. No FK, every value valid — also the state an interrupted conversion leaves
  //    after its DROP. The FK comes back; nothing is cleared.
  await withConnection(DB.drift, conn => conn.query('ALTER TABLE `media_items` DROP FOREIGN KEY `fk_media_items_category`'))
  assert.deepEqual(await categoryFks(DB.drift), [])
  const addStatements = await migrationStatements(t, DB.drift)
  assert.deepEqual(await categoriesById(DB.drift), values, 'a missing FK was repaired by clearing data')
  assert.deepEqual(await categoryFks(DB.drift), CONVERTED_FK)
  assert.deepEqual(writesToMediaItems(addStatements).filter(sql => /^UPDATE/i.test(sql)), [], 'no UPDATE when only the FK is missing')

  // b. One FK → media_categories with the wrong delete rule: rebuilt, no UPDATE.
  await withConnection(DB.drift, async (conn) => {
    await conn.query('ALTER TABLE `media_items` DROP FOREIGN KEY `fk_media_items_category`')
    await conn.query('ALTER TABLE `media_items` ADD CONSTRAINT `fk_media_items_category` FOREIGN KEY (`category_id`) REFERENCES `media_categories` (`id`) ON DELETE CASCADE')
  })
  assert.deepEqual(await categoryFks(DB.drift), [{ name: 'fk_media_items_category', table: 'media_categories', column: 'id', rule: 'CASCADE' }])
  const ruleStatements = await migrationStatements(t, DB.drift)
  assert.deepEqual(await categoriesById(DB.drift), values)
  assert.deepEqual(await categoryFks(DB.drift), CONVERTED_FK)
  assert.deepEqual(writesToMediaItems(ruleStatements).filter(sql => /^UPDATE/i.test(sql)), [], 'no UPDATE when only the delete rule is wrong')

  // c. No FK and a value pointing at no media category. The boot must still come
  //    up (a throw here is a crash-looping container), keep the value, add no FK,
  //    and say so in one stable error event carrying only the count.
  await withConnection(DB.drift, async (conn) => {
    await conn.query('ALTER TABLE `media_items` DROP FOREIGN KEY `fk_media_items_category`')
    await conn.query('UPDATE `media_items` SET `category_id` = 999 WHERE `id` = ?', [ids.cleared])
  })
  const blockedValues = { [ids.three]: 3, [ids.cleared]: 999 }
  const log = captureErrorLog(t)
  await bootInit(DB.drift)
  assert.deepEqual(await categoriesById(DB.drift), blockedValues, 'a dangling value was cleared at boot')
  assert.deepEqual(await categoryFks(DB.drift), [], 'an FK was added over a dangling value')
  const blocked = log.filter(line => line.event === FK_BLOCKED_EVENT)
  assert.equal(blocked.length, 1, `expected one ${FK_BLOCKED_EVENT} event per boot`)
  const { time, ...record } = blocked[0]!
  assert.equal(typeof time, 'string')
  assert.deepEqual(record, { level: 'error', event: FK_BLOCKED_EVENT, danglingRows: 1 }, 'the event carries the count and no row data')

  const blockedStatements = await migrationStatements(t, DB.drift)
  assert.deepEqual(writesToMediaItems(blockedStatements), [], 'a blocked FK still led to a write on media_items')
  assert.deepEqual(await categoriesById(DB.drift), blockedValues)
  assert.equal(log.filter(line => line.event === FK_BLOCKED_EVENT).length, 2, 'every boot in that state reports it')
})
