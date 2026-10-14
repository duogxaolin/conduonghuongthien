/**
 * Backup dump → restore against a real MySQL.
 *
 * The in-app dump used to format every `Date` with `toISOString()` (UTC) while
 * the pool reads DATETIME/TIMESTAMP/DATE as `+07:00`, so every restored date
 * moved seven hours earlier; BIGINT and integers inside JSON beyond 2^53 lost
 * precision; and each table was read at a different moment. None of that is
 * visible to a test with a fake driver, so this suite runs the real
 * `dumpSql` / `restoreSql` / `restoreUploaded` code against disposable databases:
 *
 *   1. round trip: DATETIME / TIMESTAMP / DATE at midnight, at the 16:59:59 /
 *      17:00:00 UTC boundary and at month end, BIGINT beyond 2^53, JSON with a
 *      big integer, DECIMAL and a zero-padded VARCHAR come back identical —
 *      under the server's default time zone AND under `SET GLOBAL time_zone =
 *      '+07:00'` (restored in `finally`);
 *   2. consistent snapshot: a parent + child written in one transaction while the
 *      dump is between tables appear together or not at all;
 *   3. end to end: a super-admin restores an uploaded `.sql.gz`; a `pre-restore`
 *      backup is listed afterwards and the audit row names the actor; a settings
 *      editor gets 403 on the same request and nothing changes;
 *   4. `backups.trigger` holds every trigger the app writes — on a fresh
 *      `initDb()` AND on an old database whose column is still VARCHAR(16)
 *      (`runBackup('sql', 'pre-fix-thumbnails')` used to die with
 *      ER_DATA_TOO_LONG under strict sql_mode, writing no row at all).
 *
 * Gated and self-cleaning like the other *-integration suites:
 *
 *   BACKUP_DUMP_INTEGRATION=1 BACKUP_DUMP_PORT=33069 BACKUP_DUMP_PASSWORD=... \
 *     node --experimental-strip-types --experimental-test-module-mocks \
 *     --import ./scripts/ts-resolver.mjs --test tests/backup-dump-integration.test.ts
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import test, { after, before } from 'node:test'
import mysql, { type RowDataPacket } from 'mysql2/promise'

const enabled = process.env.BACKUP_DUMP_INTEGRATION === '1'
const host = process.env.BACKUP_DUMP_HOST || '127.0.0.1'
const port = Number(process.env.BACKUP_DUMP_PORT || 3306)
const user = process.env.BACKUP_DUMP_USER || 'root'
const password = process.env.BACKUP_DUMP_PASSWORD || 'rootpassword'
const runId = `${Date.now()}_${process.pid}`
const DB = {
  src: `cdkt_backup_dump_${runId}_src`,
  dst: `cdkt_backup_dump_${runId}_dst`,
  e2e: `cdkt_backup_dump_${runId}_e2e`,
  modeSrc: `cdkt_backup_dump_${runId}_modesrc`,
  modeDst: `cdkt_backup_dump_${runId}_modedst`,
  trigFresh: `cdkt_backup_dump_${runId}_trigfresh`,
  trigOld: `cdkt_backup_dump_${runId}_trigold`,
}

/** Never let a typo in the env point this at a real deployment. */
function assertDisposableDatabase(name: string) {
  assert.match(name, /^cdkt_backup_dump_\d+_\d+_(src|dst|e2e|modesrc|modedst|trigfresh|trigold)$/)
  assert.notEqual(name, 'cdkt_admin')
}

const originalEnv = { ...process.env }
const originalCwd = process.cwd()
let workdir = ''

function pointAppAt(database: string) {
  assertDisposableDatabase(database)
  Object.assign(process.env, { DB_HOST: host, DB_PORT: String(port), DB_USER: user, DB_PASSWORD: password, DB_NAME: database })
}

async function admin() {
  return mysql.createConnection({ host, port, user, password })
}

/** Reads values exactly as stored: strings, UTC session, no driver conversion. */
async function exactRows(database: string, sqlText: string) {
  const conn = await mysql.createConnection({ host, port, user, password, database, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, jsonStrings: true })
  try {
    await conn.query("SET SESSION time_zone = '+00:00'")
    const [rows] = await conn.query<RowDataPacket[]>(sqlText)
    return rows.map(row => ({ ...row }))
  } finally {
    await conn.end()
  }
}

before(async () => {
  if (!enabled) return
  workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-backup-dump-'))
  process.chdir(workdir)
  const conn = await admin()
  try {
    for (const name of Object.values(DB)) {
      assertDisposableDatabase(name)
      await conn.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4`)
    }
  } finally {
    await conn.end()
  }
})

after(async () => {
  if (!enabled) return
  const { closeDb } = await import('../server/utils/db')
  await closeDb()
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
  const conn = await admin()
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

const FIXTURE_DDL = `CREATE TABLE fidelity (
  id INT PRIMARY KEY,
  dt DATETIME NULL,
  ts TIMESTAMP NULL DEFAULT NULL,
  d DATE NULL,
  big BIGINT NULL,
  j JSON NULL,
  amount DECIMAL(20,4) NULL,
  code VARCHAR(16) NULL
) ENGINE=InnoDB`

const FIXTURE_ROWS = `INSERT INTO fidelity VALUES
  (1, '2026-10-13 00:00:00', '2026-10-13 00:00:00', '2026-10-13', 9007199254740993, '{"n": 9007199254740993, "s": "a''b"}', 12345678901234.5678, '007'),
  (2, '2026-10-12 16:59:59', '2026-10-12 16:59:59', '2026-10-31', -9007199254740993, '[1, 2, {"k": null}]', -0.0001, '1e3'),
  (3, '2026-10-12 17:00:00', '2026-10-12 17:00:00', '2026-12-31', 0, '"text"', 0, ''),
  (4, '2026-01-31 23:59:59', '2026-01-31 23:59:59', '2026-02-28', 1, 'null', 1, 'x\\\\y'),
  (5, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`

const SELECT_FIDELITY = 'SELECT id, dt, ts, d, big, CAST(j AS CHAR) AS j, amount, code FROM fidelity ORDER BY id'

/** Dump `src` (or reuse a dump made earlier), restore it into an empty `dst`. */
async function roundTrip(label: string, reuseDump?: string) {
  const { closeDb } = await import('../server/utils/db')
  const { dumpSql, restoreSql } = await import('../server/services/backup-sql')
  await closeDb()
  const target = reuseDump ?? path.join(workdir, `${label}.sql.gz`)

  pointAppAt(DB.src)
  if (!reuseDump) await dumpSql(target)

  // Restore into an EMPTY database.
  const conn = await admin()
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${DB.dst}\``)
    await conn.query(`CREATE DATABASE \`${DB.dst}\` CHARACTER SET utf8mb4`)
  } finally {
    await conn.end()
  }
  pointAppAt(DB.dst)
  await restoreSql(target)
  await closeDb()

  return { target, before: await exactRows(DB.src, SELECT_FIDELITY), after: await exactRows(DB.dst, SELECT_FIDELITY), dump: gunzipSync(readFileSync(target)).toString('utf8') }
}

test('round trip: date/time, big integers and JSON survive dump → restore unchanged', { skip: !enabled, timeout: 120_000 }, async () => {
  const conn = await mysql.createConnection({ host, port, user, password, database: DB.src })
  try {
    await conn.query("SET SESSION time_zone = '+00:00'")
    await conn.query(FIXTURE_DDL)
    await conn.query(FIXTURE_ROWS)
  } finally {
    await conn.end()
  }

  const serverDefault = await roundTrip('server-default')
  assert.deepEqual(serverDefault.after, serverDefault.before, 'under the server default time zone every value must come back identical')

  // Same again with the server's default time zone moved to +07:00. A GLOBAL
  // change only affects NEW connections; dumpSql/restoreSql open their own.
  const root = await admin()
  const [[{ tz: previousGlobal }]] = await root.query<RowDataPacket[]>('SELECT @@GLOBAL.time_zone AS tz') as unknown as [[{ tz: string }]]
  try {
    await root.query("SET GLOBAL time_zone = '+07:00'")
    const shifted = await roundTrip('global-plus-seven')
    assert.deepEqual(shifted.after, shifted.before, 'under GLOBAL time_zone +07:00 every value must come back identical')
    assert.deepEqual(shifted.after, serverDefault.after, 'the server default time zone does not change what is restored')
    // Dumped under one server default, restored under another.
    const crossed = await roundTrip('crossed', serverDefault.target)
    assert.deepEqual(crossed.after, serverDefault.before, 'a dump made under the old default restores identically under +07:00')
  } finally {
    await root.query('SET GLOBAL time_zone = ?', [previousGlobal])
    const [[{ tz: restored }]] = await root.query<RowDataPacket[]>('SELECT @@GLOBAL.time_zone AS tz') as unknown as [[{ tz: string }]]
    await root.end()
    assert.equal(restored, previousGlobal, 'the GLOBAL time_zone must be restored')
  }
})

test('consistent snapshot: two rows written together appear together or not at all', { skip: !enabled, timeout: 120_000 }, async () => {
  const { closeDb } = await import('../server/utils/db')
  const { dumpSql } = await import('../server/services/backup-sql')
  await closeDb()
  const conn = await mysql.createConnection({ host, port, user, password, database: DB.src })
  try {
    // SHOW TABLES lists alphabetically: `snap_child` is read before `snap_parent`.
    await conn.query('CREATE TABLE snap_parent (id INT PRIMARY KEY, marker VARCHAR(32)) ENGINE=InnoDB')
    await conn.query('CREATE TABLE snap_child (id INT PRIMARY KEY, parent_id INT, marker VARCHAR(32)) ENGINE=InnoDB')
    await conn.query("INSERT INTO snap_parent VALUES (1, 'before-parent')")
    await conn.query("INSERT INTO snap_child VALUES (1, 1, 'before-child')")
  } finally {
    await conn.end()
  }

  pointAppAt(DB.src)
  const target = path.join(workdir, 'snapshot.sql.gz')
  let wroteDuringDump = false
  await dumpSql(target, {
    afterTable: async (table: string) => {
      if (table !== 'snap_child' || wroteDuringDump) return
      wroteDuringDump = true
      const writer = await mysql.createConnection({ host, port, user, password, database: DB.src })
      try {
        await writer.beginTransaction()
        await writer.query("INSERT INTO snap_parent VALUES (2, 'during-parent')")
        await writer.query("INSERT INTO snap_child VALUES (2, 2, 'during-child')")
        await writer.commit()
      } finally {
        await writer.end()
      }
    },
  })
  assert.ok(wroteDuringDump, 'the writer ran between the two tables')
  const dump = gunzipSync(readFileSync(target)).toString('utf8')
  assert.ok(dump.includes('before-parent') && dump.includes('before-child'))
  const parent = dump.includes('during-parent')
  const child = dump.includes('during-child')
  assert.equal(parent, child, `rows committed together must be dumped together (parent=${parent}, child=${child})`)
  assert.equal(parent, false, 'the snapshot predates the concurrent write')
})

test('end to end: super-admin restores an upload; pre-restore backup listed; audit names the actor; settings editor gets 403', { skip: !enabled, timeout: 180_000 }, async () => {
  const { closeDb, getDb } = await import('../server/utils/db')
  await closeDb()
  pointAppAt(DB.e2e)
  const { initDb } = await import('../server/db/init')
  await initDb()

  const seed = await mysql.createConnection({ host, port, user, password, database: DB.e2e })
  try {
    await seed.query("INSERT INTO roles (id, name, is_system) VALUES (1, 'SuperAdmin', 1), (2, 'Biên tập', 0)")
    await seed.query("INSERT INTO users (id, username, password_hash, role_id, is_active) VALUES (1, 'root-admin', 'x', 1, 1), (2, 'settings-editor', 'x', 2, 1)")
    await seed.query("INSERT INTO settings (`key`, value) VALUES ('e2e_marker', 'original')")
  } finally {
    await seed.end()
  }

  // A valid upload: a format-2 dump of the current state.
  const { dumpSql } = await import('../server/services/backup-sql')
  const uploadFile = path.join(workdir, 'upload-source.sql.gz')
  await dumpSql(uploadFile)
  const upload = readFileSync(uploadFile)

  // Change the data after the dump, so the restore is observable.
  const db = getDb()
  const { settings, backups, activityLogs } = await import('../server/db/schema')
  const { eq } = await import('drizzle-orm')
  await db.update(settings).set({ value: 'changed' }).where(eq(settings.key, 'e2e_marker'))

  // Settings editor through the real endpoint: 403, nothing stored or run.
  const h3 = await import('h3')
  const globals = globalThis as unknown as Record<string, unknown>
  globals.defineEventHandler = (handler: unknown) => handler
  globals.createError = h3.createError
  globals.getRequestHeader = () => undefined
  let bodyRead = false
  globals.readMultipartFormData = async () => { bodyRead = true; return [{ name: 'file', filename: 'restore.sql.gz', data: upload }] }
  const endpoint = (await import('../server/api/admin/backup/restore-upload.post.ts')).default as unknown as (event: unknown) => Promise<{ ok: boolean }>
  const editor = { id: 2, username: 'settings-editor', isSuperAdmin: false, permissions: [{ resource: 'settings', canCreate: true, canRead: true, canUpdate: true, canDelete: true }] }
  await assert.rejects(endpoint({ context: { adminUser: editor } }), (error: unknown) => (error as { statusCode: number }).statusCode === 403)
  assert.equal(bodyRead, false)
  assert.equal((await db.select().from(backups)).length, 0)
  assert.equal((await exactRows(DB.e2e, "SELECT value FROM settings WHERE `key` = 'e2e_marker'"))[0]!.value, 'changed')

  // Super-admin through the same endpoint.
  const superAdmin = { id: 1, username: 'root-admin', isSuperAdmin: true, permissions: [] }
  const result = await endpoint({ context: { adminUser: superAdmin } })
  assert.equal(result.ok, true)
  assert.equal(bodyRead, true)

  assert.equal((await exactRows(DB.e2e, "SELECT value FROM settings WHERE `key` = 'e2e_marker'"))[0]!.value, 'original', 'the upload was restored')
  const listed = await exactRows(DB.e2e, 'SELECT filename, `trigger`, status FROM backups ORDER BY id')
  assert.ok(listed.some(row => String(row.trigger) === 'pre-restore' && row.status === 'done'), `pre-restore backup listed: ${JSON.stringify(listed)}`)
  assert.ok(listed.some(row => row.filename === 'restore.sql.gz'), 'the uploaded file is listed')
  const files = readdirSync(path.join(workdir, 'backups'))
  assert.ok(files.some(name => name.endsWith('-pre-restore.sql.gz')), files.join(','))

  const audit = await db.select().from(activityLogs).where(eq(activityLogs.action, 'backup_restore'))
  assert.equal(audit.length, 1)
  assert.equal(audit[0]!.userId, 1)
  const meta = audit[0]!.meta as Record<string, unknown>
  assert.equal(meta.filename, 'restore.sql.gz')
  assert.equal(meta.actorUsername, 'root-admin')
  assert.match(String(meta.preRestoreBackup), /-pre-restore\.sql\.gz$/)
  assert.equal((await db.select().from(activityLogs).where(eq(activityLogs.action, 'backup_restore_failed'))).length, 0)
})

test('sql_mode is pinned by the dump: a NO_BACKSLASH_ESCAPES session runs no injected SQL, and id 0 stays 0', { skip: !enabled, timeout: 120_000 }, async () => {
  const { closeDb } = await import('../server/utils/db')
  const { dumpSql, restoreSql } = await import('../server/services/backup-sql')
  await closeDb()
  const injected = `injected_${runId}`
  // `quoteSqlString` writes `'` as `\'`. Under NO_BACKSLASH_ESCAPES that ends the
  // string; the `)` closes the VALUES tuple and the CREATE runs — unless the file
  // itself pins sql_mode. The payload row is the LAST row of the ONLY table so the
  // trailing `-- ` comment swallows the `');` and the red case is a clean injection.
  const payload = `x\\'); CREATE TABLE ${injected} (i INT); -- `
  const src = await mysql.createConnection({ host, port, user, password, database: DB.modeSrc })
  try {
    await src.query('CREATE TABLE titles (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, title VARCHAR(255)) ENGINE=InnoDB')
    await src.query("SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'")
    await src.query('INSERT INTO titles (id, title) VALUES (0, ?), (5, ?)', ['zero-row', payload])
  } finally {
    await src.end()
  }
  pointAppAt(DB.modeSrc)
  const target = path.join(workdir, 'sql-mode.sql.gz')
  await dumpSql(target)
  const dump = gunzipSync(readFileSync(target)).toString('utf8')

  const injectedExists = async () => (await exactRows(DB.modeDst, `SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${DB.modeDst}' AND TABLE_NAME = '${injected}'`))[0]!.n
  const expected = [{ id: 0, title: 'zero-row' }, { id: 5, title: payload }]

  // 1. The dump text itself, run on a session that starts in NO_BACKSLASH_ESCAPES.
  const hostile = await mysql.createConnection({ host, port, user, password, database: DB.modeDst, multipleStatements: true })
  let sessionMode = ''
  try {
    await hostile.query("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'")
    await hostile.query(dump)
    const [[{ mode }]] = await hostile.query<RowDataPacket[]>('SELECT @@SESSION.sql_mode AS mode') as unknown as [[{ mode: string }]]
    sessionMode = mode
  } finally {
    await hostile.end()
  }
  assert.equal(Number(await injectedExists()), 0, 'the injected CREATE TABLE never ran')
  assert.equal(sessionMode, 'NO_AUTO_VALUE_ON_ZERO', 'the header replaced the hostile session mode')
  assert.deepEqual(await exactRows(DB.modeDst, 'SELECT id, title FROM titles ORDER BY id'), expected, 'id 0 kept, payload stored verbatim')

  // 2. restoreSql on a fresh database (its own session pins the mode too).
  const root = await admin()
  try {
    await root.query(`DROP DATABASE IF EXISTS \`${DB.modeDst}\``)
    await root.query(`CREATE DATABASE \`${DB.modeDst}\` CHARACTER SET utf8mb4`)
  } finally {
    await root.end()
  }
  pointAppAt(DB.modeDst)
  await restoreSql(target)
  assert.equal(Number(await injectedExists()), 0)
  assert.deepEqual(await exactRows(DB.modeDst, 'SELECT id, title FROM titles ORDER BY id'), expected)
})

async function triggerColumn(database: string) {
  const rows = await exactRows(database, `SELECT COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${database}' AND TABLE_NAME = 'backups' AND COLUMN_NAME = 'trigger'`)
  return rows[0]
}

/** Every trigger the app writes goes through the REAL `runBackup` and lands as a `done` row. */
async function backupEveryTrigger(database: string) {
  const { BACKUP_TRIGGERS, runBackup } = await import('../server/services/backup')
  for (const trigger of BACKUP_TRIGGERS) {
    const result = await runBackup('sql', trigger, null, { rotate: false })
    assert.equal(result.files.length, 1, trigger)
  }
  const rows = await exactRows(database, 'SELECT `trigger`, status FROM backups ORDER BY id')
  assert.deepEqual(rows.filter(row => row.status === 'done').map(row => String(row.trigger)), [...BACKUP_TRIGGERS])
}

test('backups.trigger fits every trigger: fresh initDb() and an old VARCHAR(16) table upgraded at boot', { skip: !enabled, timeout: 180_000 }, async () => {
  const { closeDb } = await import('../server/utils/db')
  const { initDb } = await import('../server/db/init')
  const wide = { type: 'varchar(32)', nullable: 'NO', dflt: 'manual' }

  // Fresh database: the CREATE TABLE body declares the final shape.
  await closeDb()
  pointAppAt(DB.trigFresh)
  await initDb()
  assert.deepEqual({ ...await triggerColumn(DB.trigFresh) }, wide)
  await backupEveryTrigger(DB.trigFresh)

  // Old database: column still VARCHAR(16) with a row in it; the next boot
  // (`initDb()` → `applyAdditiveMigrations`) widens it in place, keeps the row,
  // and running it again is a no-op.
  await closeDb()
  pointAppAt(DB.trigOld)
  await initDb()
  const old = await mysql.createConnection({ host, port, user, password, database: DB.trigOld })
  try {
    await old.query("ALTER TABLE backups MODIFY COLUMN `trigger` VARCHAR(16) NOT NULL DEFAULT 'manual'")
    await old.query("INSERT INTO backups (filename, type, bytes, stamp, `trigger`, status) VALUES ('cdkt-20260101T000000Z-scheduled.sql.gz', 'sql', 1, '20260101T000000Z', 'scheduled', 'done')")
  } finally {
    await old.end()
  }
  assert.equal((await triggerColumn(DB.trigOld))!.type, 'varchar(16)')
  // (The first initDb() above already re-applied the widening to a column that
  // was VARCHAR(32) — the idempotent case; this one is the real upgrade.)
  await initDb()
  assert.deepEqual({ ...await triggerColumn(DB.trigOld) }, wide)
  assert.deepEqual(await exactRows(DB.trigOld, 'SELECT `trigger`, status FROM backups ORDER BY id'), [{ trigger: 'scheduled', status: 'done' }])
  const cleanup = await mysql.createConnection({ host, port, user, password, database: DB.trigOld })
  try {
    await cleanup.query('DELETE FROM backups')
  } finally {
    await cleanup.end()
  }
  await backupEveryTrigger(DB.trigOld)
  await closeDb()
})
