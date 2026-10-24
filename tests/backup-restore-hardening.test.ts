import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, linkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gzipSync, createGzip } from 'node:zlib'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import test, { after, before, beforeEach, describe, mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * Restore hardening, run against the REAL service code (`backup-restore.ts`,
 * `backup.ts`, `backup-sql.ts`, `backup-restore-guards.ts`) with the database,
 * the named lock and the MySQL driver faked. Files are real: the test chdirs into
 * a temporary directory, so `backups/` and `public/uploads/` are real folders and
 * real gzip / tar archives go through the real `gunzip` and `tar` binaries.
 *
 * What each block proves:
 *  - uploads are validated (name, gzip magic, compressed cap, decompressed cap,
 *    tar entries) BEFORE anything is written to `backups/`, recorded, or executed;
 *  - a tar archive with a traversal / absolute / symlink / hard link / foreign
 *    entry extracts NOTHING; BusyBox and GNU listing lines both parse;
 *  - a database restore takes a `pre-restore` backup first, never rotates away
 *    its own target, and does not execute anything if the safety backup fails;
 *  - success and failure each write exactly one restore audit row, inside a
 *    transaction, naming the actor and the file.
 */

// ─── Fakes ─────────────────────────────────────────────────────────────────────

const logs: Array<Record<string, unknown>> = []
const keep = (entry: Record<string, unknown>) => { logs.push(entry) }
mock.module('../server/utils/logger', {
  namedExports: {
    logInfo: keep, logWarn: keep, logError: keep,
    SECURITY_EVENTS: {
      backupRestoreStarted: 'backup.restore_started',
      backupRestoreSucceeded: 'backup.restore_succeeded',
      backupRestoreFailed: 'backup.restore_failed',
      backupRestoreRefused: 'backup.restore_refused',
    },
  },
})

const busyLocks = new Set<string>()
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_pool: unknown, name: string, _timeout: number, action: (connection: unknown) => Promise<unknown>) => {
      if (busyLocks.has(name)) return { acquired: false }
      return { acquired: true, value: await action({}) }
    },
  },
})

type Row = Record<string, unknown> & { id: number, filename: string, status: string, stamp: string }
const state = {
  backups: [] as Row[],
  users: [{ id: 1 }] as Array<{ id: number }>,
  settings: [] as Array<{ key: string, value: string }>,
  audit: [] as Array<{ via: 'tx' | 'db', values: Record<string, unknown> }>,
  nextId: 1,
}
/** SQL text executed on a `multipleStatements` (restore) connection. */
const executed: string[] = []
/** What happened, in order: `restoreSql` (dump executed), `initDb` (schema brought up to date), `tx` (a transaction). */
const order: string[] = []
/** The restored dump dies half-way through. */
let failRestoreSql = false
/** Bringing the schema up to date after the dump fails. */
let failConverge = false
// The boot's own schema steps (CREATE TABLE IF NOT EXISTS + additive migrations);
// the real thing runs against MySQL in tests/backup-dump-integration.test.ts.
mock.module('../server/db/init', {
  namedExports: {
    initDb: async () => {
      order.push('initDb')
      if (failConverge) throw new Error("fixture: ALTER TABLE `backups` ADD COLUMN failed")
    },
  },
})
let failDump = false
let restoredTableWipesBackups = true
/** The `settings` rows the restored dump brings back (it replaces the table); `null` = dump leaves settings alone. */
let restoredSettings: Array<{ key: string, value: string }> | null = null

const schema = await import('../server/db/schema')

function rowsOf(table: unknown): unknown[] {
  if (table === schema.backups) return state.backups
  if (table === schema.users) return state.users
  if (table === schema.settings) return state.settings
  return []
}
function chain(table: unknown) {
  let ordered = false
  const query = {
    where: () => query,
    orderBy: () => { ordered = true; return query },
    limit: () => query,
    offset: () => query,
    then: (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) => {
      const rows = ordered && table === schema.backups
        // `rotateOldBackups`: done rows, newest stamp first.
        ? state.backups.filter(row => row.status === 'done').sort((a, b) => b.stamp.localeCompare(a.stamp))
        : [...rowsOf(table)]
      return Promise.resolve(rows).then(resolve, reject)
    },
  }
  return query
}
function fakeDb(via: 'tx' | 'db'): Record<string, unknown> {
  return {
    select: () => ({ from: (table: unknown) => chain(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (table === schema.settings) {
          return {
            onDuplicateKeyUpdate: async ({ set }: { set: { value?: unknown } }) => {
              const value = String(set.value ?? values.value)
              state.settings = [...state.settings.filter(row => row.key !== values.key), { key: String(values.key), value }]
            },
          }
        }
        if (table === schema.activityLogs) state.audit.push({ via, values })
        else if (table === schema.backups) state.backups.push({ id: state.nextId++, driveUploaded: false, driveFileId: null, error: null, createdAt: new Date(), createdBy: null, ...values } as Row)
        return Promise.resolve()
      },
    }),
    delete: (table: unknown) => ({
      where: async (condition: SQL) => {
        if (table !== schema.settings) return
        const { sql, params } = new MySqlDialect().sqlToQuery(condition)
        assert.match(sql, /`settings`\.`key` = \?$/)
        state.settings = state.settings.filter(row => row.key !== params[0])
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => { order.push('tx'); return fn(fakeDb('tx')) },
  }
}

function fakeConnection(options: { multipleStatements?: boolean }) {
  return {
    query: async (sqlText: string) => {
      if (/^\s*SHOW (FULL )?TABLES/i.test(sqlText)) {
        if (failDump) throw new Error('simulated dump failure')
        return [[], []]
      }
      if (options.multipleStatements && !/^\s*SET FOREIGN_KEY_CHECKS/i.test(sqlText)) {
        executed.push(sqlText)
        if (!/^\s*SET SESSION/i.test(sqlText)) order.push('restoreSql')
        // The real dump starts with DROP TABLE backups: the table is replaced.
        if (restoredTableWipesBackups) state.backups = []
        if (restoredSettings) state.settings = restoredSettings.map(row => ({ ...row }))
        if (failRestoreSql && !/^\s*SET SESSION/i.test(sqlText)) throw new Error('fixture: restore died half-way (ER_LOCK_WAIT_TIMEOUT)')
      }
      return [[], []]
    },
    end: async () => {},
    release: () => {},
  }
}
const fakePool = { getConnection: async () => fakeConnection({}) }
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb('db'), getPool: () => fakePool } })
mock.module('mysql2/promise', {
  namedExports: { createConnection: async (options: { multipleStatements?: boolean }) => fakeConnection(options) },
  defaultExport: { createConnection: async (options: { multipleStatements?: boolean }) => fakeConnection(options) },
})

// ─── Subject ───────────────────────────────────────────────────────────────────

const guards = await import('../server/services/backup-restore-guards')
const restore = await import('../server/services/backup-restore')
const { BackupRestoreError } = guards

const ACTOR = { id: 1, username: 'admin' }
const originalCwd = process.cwd()
let workdir = ''
const backupsDir = () => path.join(workdir, 'backups')
const backupFiles = () => existsSync(backupsDir()) ? readdirSync(backupsDir()).sort() : []

before(() => {
  workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-restore-'))
  process.chdir(workdir)
})
after(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})
beforeEach(() => {
  rmSync(backupsDir(), { recursive: true, force: true })
  rmSync(path.join(workdir, 'public'), { recursive: true, force: true })
  mkdirSync(backupsDir(), { recursive: true })
  state.backups = []
  state.users = [{ id: 1 }]
  state.settings = []
  state.audit = []
  executed.length = 0
  order.length = 0
  failRestoreSql = false
  failConverge = false
  logs.length = 0
  failDump = false
  restoredTableWipesBackups = true
  restoredSettings = null
  busyLocks.clear()
})

async function rejection(promise: Promise<unknown>): Promise<InstanceType<typeof BackupRestoreError>> {
  try { await promise } catch (error) {
    assert.ok(error instanceof BackupRestoreError, `expected BackupRestoreError, got ${String(error)}`)
    return error
  }
  assert.fail('expected the promise to reject')
}

const restoreAudits = () => state.audit.filter(entry => String(entry.values.action).startsWith('backup_restore'))
const SMALL = { maxCompressedBytes: 64 * 1024, maxSqlBytes: 1024 * 1024, maxArchiveBytes: 1024 * 1024 }

// ─── 3.1 Upload validation ─────────────────────────────────────────────────────

describe('uploaded restore files are validated before use', () => {
  test('plain text named .sql.gz is rejected: nothing stored, recorded or executed', async () => {
    const error = await rejection(restore.restoreUploaded('x.sql.gz', Buffer.from('DROP TABLE users;'), ACTOR))
    assert.equal(error.statusCode, 400)
    assert.equal(error.reason, 'not_gzip')
    assert.deepEqual(backupFiles(), [])
    assert.equal(state.backups.length, 0)
    assert.equal(executed.length, 0)
    assert.equal(restore.getRestoreStatus().phase, 'failed')
    assert.match(restore.getRestoreStatus().message, /gzip/)
    assert.ok(logs.some(entry => entry.event === 'backup.restore_refused' && entry.reason === 'not_gzip'))
  })

  test('a wrong extension is rejected', async () => {
    const error = await rejection(restore.restoreUploaded('x.zip', gzipSync('SELECT 1;'), ACTOR))
    assert.equal(error.statusCode, 400)
    assert.deepEqual(backupFiles(), [])
  })

  test('an oversized upload is rejected before it is written to disk', async () => {
    const big = gzipSync((await import('node:crypto')).randomBytes(200_000))
    assert.ok(big.length > SMALL.maxCompressedBytes)
    const error = await rejection(restore.restoreUploaded('big.sql.gz', big, ACTOR, SMALL))
    assert.equal(error.statusCode, 413)
    assert.equal(error.reason, 'too_large')
    assert.deepEqual(backupFiles(), [])
    assert.equal(state.backups.length, 0)
  })

  test('a decompression bomb stops at the cap, memory stays bounded, nothing remains', async () => {
    // 64 MiB of zeros compress to ~64 KB; the cap is 1 MiB.
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024))
    assert.ok(bomb.length < SMALL.maxCompressedBytes * 2)
    const limits = { ...SMALL, maxCompressedBytes: bomb.length + 1 }
    const before = process.memoryUsage().arrayBuffers
    const error = await rejection(restore.restoreUploaded('bomb.sql.gz', bomb, ACTOR, limits))
    const grown = process.memoryUsage().arrayBuffers - before
    assert.equal(error.statusCode, 413)
    assert.equal(error.reason, 'decompressed_too_large')
    assert.ok(grown < 32 * 1024 * 1024, `decompression must stop early, arrayBuffers grew ${grown} bytes`)
    assert.deepEqual(backupFiles(), [], 'the temporary file is removed')
    assert.equal(state.backups.length, 0, 'no backups row')
    assert.equal(executed.length, 0)
  })

  test('the bounded gunzip refuses a stored bomb without inflating it (no gunzipSync)', async () => {
    const file = path.join(backupsDir(), 'stream-bomb.sql.gz')
    await pipeline(Readable.from((function* () { for (let i = 0; i < 256; i++) yield Buffer.alloc(1024 * 1024) })()), createGzip({ level: 1 }), createWriteStream(file))
    const before = process.memoryUsage().arrayBuffers
    const error = await rejection(guards.gunzipFileBounded(file, 4 * 1024 * 1024, true))
    assert.equal(error.reason, 'decompressed_too_large')
    assert.ok(process.memoryUsage().arrayBuffers - before < 64 * 1024 * 1024, 'a 256 MiB expansion is cut off near the 4 MiB cap')
  })

  test('a valid .sql.gz is recorded, then restored', async () => {
    const outcome = await restore.restoreUploaded('good.sql.gz', gzipSync('-- CDKT backup: x\n-- CDKT dump-format: 2\nSELECT 1;\n'), ACTOR)
    assert.equal(outcome.legacyDateShift, false)
    assert.ok(backupFiles().includes('good.sql.gz'))
    assert.ok(executed.some(text => text.includes('SELECT 1;')))
    assert.ok(state.backups.some(row => row.filename === 'good.sql.gz'), 'the uploaded file stays listed after the restore replaced the table')
    assert.ok(!backupFiles().some(name => name.endsWith('.partial')))
  })

  test('an upload never overwrites an existing backup of the same name', async () => {
    writeFileSync(path.join(backupsDir(), 'same.sql.gz'), gzipSync('-- original'))
    await restore.restoreUploaded('same.sql.gz', gzipSync('SELECT 2;'), ACTOR)
    assert.ok(backupFiles().includes('same.sql.gz'))
    assert.ok(backupFiles().some(name => /^same-upload-\d{8}T\d{6}Z\.sql\.gz$/.test(name)), backupFiles().join(','))
  })
})

// ─── 3.2 Archive entries ───────────────────────────────────────────────────────

function makeArchive(name: string, build: (root: string) => string[], extraArgs: string[] = []): string {
  const root = mkdtempSync(path.join(workdir, 'fixture-'))
  const members = build(root)
  const target = path.join(backupsDir(), name)
  execFileSync('tar', ['czf', target, ...extraArgs, '-C', root, ...members], { stdio: 'ignore' })
  rmSync(root, { recursive: true, force: true })
  return name
}
const uploadsTree = (root: string) => {
  mkdirSync(path.join(root, 'uploads', 'sub'), { recursive: true })
  writeFileSync(path.join(root, 'uploads', 'a.txt'), 'a')
  writeFileSync(path.join(root, 'uploads', 'sub', 'b.txt'), 'b')
}
const extracted = () => existsSync(path.join(workdir, 'public')) ? readdirSync(path.join(workdir, 'public'), { recursive: true }).map(String).sort() : []

describe('file-archive restore refuses unsafe entries', () => {
  test('a well-formed archive is extracted', async () => {
    const name = makeArchive('cdkt-uploads-20261013T000000Z-manual.tar.gz', (root) => { uploadsTree(root); return ['uploads'] })
    await restore.runRestore(name, ACTOR)
    assert.deepEqual(extracted(), ['uploads', 'uploads/a.txt', 'uploads/sub', 'uploads/sub/b.txt'])
    assert.equal(restoreAudits().length, 1)
  })

  const BAD: Array<{ label: string, reason: string, build: (root: string) => string[], args?: string[] }> = [
    { label: 'traversal entry uploads/../../evil.txt', reason: 'archive_traversal', build: (root) => { uploadsTree(root); return ['uploads'] }, args: ['--transform', 's,^uploads/a.txt$,uploads/../../evil.txt,'] },
    { label: 'absolute path', reason: 'archive_absolute_path', build: (root) => { uploadsTree(root); return ['uploads'] }, args: ['-P', '--transform', 's,^uploads/a.txt$,/abs-evil.txt,'] },
    { label: 'symbolic link', reason: 'archive_link_entry', build: (root) => { uploadsTree(root); symlinkSync('/etc/passwd', path.join(root, 'uploads', 'link')); return ['uploads'] } },
    { label: 'hard link', reason: 'archive_link_entry', build: (root) => { uploadsTree(root); linkSync(path.join(root, 'uploads', 'a.txt'), path.join(root, 'uploads', 'h')); return ['uploads'] } },
    { label: 'entry outside the expected tree', reason: 'archive_outside_tree', build: (root) => { uploadsTree(root); mkdirSync(path.join(root, 'etc')); writeFileSync(path.join(root, 'etc', 'x'), 'x'); return ['uploads', 'etc'] } },
  ]
  for (const bad of BAD) {
    test(`${bad.label}: refused, nothing extracted`, async () => {
      const name = makeArchive('cdkt-uploads-20261013T000000Z-manual.tar.gz', bad.build, bad.args)
      const error = await rejection(restore.runRestore(name, ACTOR))
      assert.equal(error.reason, bad.reason, error.message)
      assert.deepEqual(extracted(), [], 'not a single entry may be extracted')
      assert.ok(!existsSync(path.join(workdir, 'evil.txt')))
      assert.ok(!existsSync('/abs-evil.txt'))
      const audits = restoreAudits()
      assert.deepEqual(audits.map(entry => entry.values.action), ['backup_restore_failed'])
    })
  }

  // Replaces the former "BusyBox and GNU listing lines parse" test: the check no
  // longer parses `tar -tzvf` text (the owner/group columns are archive-controlled
  // and could forge a whole line — finding C3), it reads the tar headers. The
  // per-header cases (types, names, pax/GNU long names, framing) live in
  // `backup-tar-scanner.test.ts`; this one proves the bypass end to end through
  // `runRestore`: nothing is extracted, not even the innocent first member.
  test('owner/group names cannot forge a listing: the uname-spoofed outside/absolute members are refused, nothing extracted', async () => {
    const tarHeader = (name: string, size: number, uname: string, gname: string) => {
      const block = Buffer.alloc(512)
      const put = (offset: number, value: string) => Buffer.from(value, 'latin1').copy(block, offset)
      put(0, name); put(100, '0000644\0'); put(108, '0000000\0'); put(116, '0000000\0')
      put(124, `${size.toString(8).padStart(11, '0')}\0`); put(136, '15000000000\0')
      block.fill(0x20, 148, 156); put(156, '0'); put(257, 'ustar  \0'); put(265, uname); put(297, gname)
      let sum = 0
      for (const byte of block) sum += byte
      put(148, `${sum.toString(8).padStart(6, '0')}\0 `)
      return block
    }
    const member = (name: string, uname = 'ray', gname = 'ray') => Buffer.concat([tarHeader(name, 1, uname, gname), Buffer.from('x'), Buffer.alloc(511)])
    for (const [evil, reason] of [['evil/x.txt', 'archive_outside_tree'], ['/tmp/abs_pwn.txt', 'archive_absolute_path']] as const) {
      const name = `cdkt-uploads-2026101${evil.length % 10}T000000Z-manual.tar.gz`
      writeFileSync(path.join(backupsDir(), name), gzipSync(Buffer.concat([
        member('uploads/ok.txt'),
        member(evil, 'a 1 2026-01-01 00:00 uploads/ok', 'g 1 2025-10-09 09:53'),
        Buffer.alloc(1024),
      ])))
      const error = await rejection(restore.runRestore(name, ACTOR))
      assert.equal(error.reason, reason, error.message)
      assert.deepEqual(extracted(), [], 'not a single entry may be extracted')
      assert.ok(!existsSync(path.join(workdir, 'evil')))
      assert.ok(!existsSync('/tmp/abs_pwn.txt'))
    }
  })

  test('an uploaded archive is inspected before it is recorded', async () => {
    const name = makeArchive('staging.tar.gz', (root) => { uploadsTree(root); symlinkSync('/etc/passwd', path.join(root, 'uploads', 'link')); return ['uploads'] })
    const data = (await import('node:fs')).readFileSync(path.join(backupsDir(), name))
    rmSync(path.join(backupsDir(), name))
    const error = await rejection(restore.restoreUploaded('cdkt-uploads-x.tar.gz', data, ACTOR))
    assert.equal(error.reason, 'archive_link_entry')
    assert.deepEqual(backupFiles(), [])
    assert.equal(state.backups.length, 0)
    assert.deepEqual(extracted(), [])
  })
})

// ─── 3.3 Safety backup ─────────────────────────────────────────────────────────

function seedSqlBackup(filename: string, stamp: string, sqlText: string): void {
  writeFileSync(path.join(backupsDir(), filename), gzipSync(sqlText))
  state.backups.push({ id: state.nextId++, filename, type: 'sql', bytes: 1, stamp, trigger: 'manual', status: 'done', createdBy: 1, driveUploaded: false, driveFileId: null, error: null, createdAt: new Date() })
}

describe('a database restore is preceded by a safety backup', () => {
  test('restoring the OLDEST backup at the retention limit: the target still exists when it is read', async () => {
    state.settings = [{ key: 'backup_keep_count', value: '2' }]
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', '-- CDKT backup: x\n-- CDKT dump-format: 2\nSELECT "oldest";\n')
    seedSqlBackup('cdkt-20260201T000000Z-manual.sql.gz', '20260201T000000Z', 'SELECT "newer";')
    const outcome = await restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR)
    assert.ok(outcome.preRestoreBackup && /-pre-restore\.sql\.gz$/.test(outcome.preRestoreBackup), String(outcome.preRestoreBackup))
    assert.ok(executed.some(text => text.includes('SELECT "oldest";')), 'the target was read and executed')
    assert.ok(existsSync(path.join(backupsDir(), 'cdkt-20260101T000000Z-manual.sql.gz')), 'rotation did not delete the restore target')
    assert.ok(existsSync(path.join(backupsDir(), outcome.preRestoreBackup!)))
    // The restore replaced the `backups` table; the safety backup is listed again afterwards.
    assert.ok(state.backups.some(row => row.filename === outcome.preRestoreBackup && row.trigger === 'pre-restore'))
    // …with its off-site status (Drive is off here: `none`), not a NULL "unknown" (wave2 D-OFFSITE).
    assert.equal(state.backups.find(row => row.filename === outcome.preRestoreBackup)?.offsiteStatus, 'none')
    const audit = restoreAudits()
    assert.equal(audit.length, 1)
    assert.equal((audit[0]!.values.meta as Record<string, unknown>).preRestoreBackup, outcome.preRestoreBackup)
  })

  test('a failing safety backup prevents execution and says why', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    failDump = true
    const error = await rejection(restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR))
    assert.equal(error.reason, 'safety_backup_failed')
    assert.equal(executed.length, 0, 'the SQL executor must not be called')
    assert.equal(restore.getRestoreStatus().phase, 'failed')
    assert.match(restore.getRestoreStatus().message, /sao lưu an toàn/)
  })

  test('a running backup (lock held) blocks the restore with 409', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    busyLocks.add('cdkt:backup:run')
    const error = await rejection(restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR))
    assert.equal(error.statusCode, 409)
    assert.equal(error.reason, 'backup_running')
    assert.equal(executed.length, 0)
  })

  test('another restore in progress is a 409, nothing runs', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    busyLocks.add('cdkt:backup:restore')
    const error = await rejection(restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR))
    assert.equal(error.statusCode, 409)
    assert.equal(executed.length, 0)
    assert.equal(restoreAudits().length, 0, 'a request that never started writes no audit row')
  })

  test('a missing or escaping filename is refused before the lock', async () => {
    assert.equal((await rejection(restore.runRestore('nope.sql.gz', ACTOR))).statusCode, 404)
    assert.equal((await rejection(restore.runRestore('../../etc/passwd.sql.gz', ACTOR))).statusCode, 400)
    assert.equal(restoreAudits().length, 0)
  })
})

// ─── 4.3 Legacy dump flag ──────────────────────────────────────────────────────

const HEADERS = {
  format2: '-- CDKT backup: cdkt_admin\n-- CDKT dump-format: 2\n-- Generated: 2026-10-13T00:00:00.000Z\nSET NAMES utf8mb4;\nSELECT 1;\n',
  legacy: '-- CDKT backup: cdkt_admin\n-- Generated: 2026-09-01T00:00:00.000Z\nSET NAMES utf8mb4;\nSELECT 1;\n',
  mysqldump: '-- MySQL dump 10.13  Distrib 8.0.39, for Linux (x86_64)\n--\n-- Host: 127.0.0.1    Database: cdkt_admin\nSELECT 1;\n',
}

describe('legacy app-generated dumps are flagged on restore', () => {
  test('header detection: only an old CDKT dump is legacy', () => {
    assert.equal(guards.isLegacyAppDump(HEADERS.format2), false)
    assert.equal(guards.isLegacyAppDump(HEADERS.legacy), true)
    assert.equal(guards.isLegacyAppDump(HEADERS.mysqldump), false)
    assert.equal(guards.isLegacyAppDump(''), false)
    // The marker must be in the header, not somewhere in the data.
    assert.equal(guards.isLegacyAppDump(`${HEADERS.legacy}${'\n'.repeat(20)}-- CDKT dump-format: 2\n`), true)
  })

  for (const [variant, text] of Object.entries(HEADERS)) {
    const legacy = variant === 'legacy'
    test(`restoring a ${variant} dump ${legacy ? 'warns and records legacyDateShift' : 'carries no shift warning'}`, async () => {
      seedSqlBackup(`cdkt-20260101T000000Z-${variant}.sql.gz`, '20260101T000000Z', text)
      const outcome = await restore.runRestore(`cdkt-20260101T000000Z-${variant}.sql.gz`, ACTOR)
      assert.equal(outcome.legacyDateShift, legacy)
      assert.equal(outcome.warning === null, !legacy)
      const status = restore.getRestoreStatus()
      assert.equal(status.phase, 'done')
      assert.equal(/7 giờ/.test(status.message), legacy, status.message)
      const meta = restoreAudits()[0]!.values.meta as Record<string, unknown>
      assert.equal(meta.legacyDateShift === true, legacy)
    })
  }
})

// ─── 3.4 Audit + security log ──────────────────────────────────────────────────

describe('restore is audited and logged', () => {
  test('success: exactly one backup_restore row, in a transaction, naming the actor and the file', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    await restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR)
    const audit = restoreAudits()
    assert.equal(audit.length, 1)
    assert.equal(audit[0]!.via, 'tx')
    assert.equal(audit[0]!.values.action, 'backup_restore')
    assert.equal(audit[0]!.values.userId, 1)
    const meta = audit[0]!.values.meta as Record<string, unknown>
    assert.equal(meta.filename, 'cdkt-20260101T000000Z-manual.sql.gz')
    assert.equal(meta.actorUsername, 'admin')
    assert.ok(state.audit.every(entry => entry.via === 'tx'), 'no audit row is written on the pool outside a transaction')
    const events = logs.map(entry => entry.event)
    assert.ok(events.includes('backup.restore_started'))
    assert.ok(events.includes('backup.restore_succeeded'))
  })

  test('failure: exactly one backup_restore_failed row with the reason; nothing claims success', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    failDump = true
    await rejection(restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR))
    const audit = restoreAudits()
    assert.deepEqual(audit.map(entry => entry.values.action), ['backup_restore_failed'])
    assert.equal(audit[0]!.via, 'tx')
    const meta = audit[0]!.values.meta as Record<string, unknown>
    assert.equal(meta.filename, 'cdkt-20260101T000000Z-manual.sql.gz')
    assert.equal(meta.reason, 'safety_backup_failed')
    assert.equal(meta.actorId, 1)
    assert.ok(logs.some(entry => entry.event === 'backup.restore_failed' && entry.reason === 'safety_backup_failed'))
    assert.ok(!logs.some(entry => entry.event === 'backup.restore_succeeded'))
  })

  test('the actor missing from the restored users table does not break the audit (FK) — the name stays in meta', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    state.users = []
    await restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR)
    const audit = restoreAudits()
    assert.equal(audit.length, 1)
    assert.equal(audit[0]!.values.userId, null)
    assert.equal((audit[0]!.values.meta as Record<string, unknown>).actorUsername, 'admin')
  })
})

// ─── The schema is brought up to date right after the dump runs (wave2 ops, re-verification CRITICAL) ─
// An app dump carries DROP TABLE + CREATE TABLE: restoring one taken before a column
// was added brings the table back WITHOUT that column, while Drizzle names every
// schema column on every insert/select. The reattach insert inside the audit
// transaction then failed (`Unknown column 'offsite_status'`), the endpoint said
// "restore failed" although the data had been replaced, `backups` stayed empty and
// the next orphan sweep deleted the pre-restore dump. The restore now runs the boot's
// own schema steps (`initDb`) before anything touches the restored tables.

describe('a database restore brings the schema up to date before using it', () => {
  test('order: the dump runs, then the boot schema steps, then the reattach/audit transaction', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    await restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR)
    const restored = order.indexOf('restoreSql')
    const converged = order.indexOf('initDb')
    assert.ok(restored >= 0 && converged > restored, `order: ${order.join(' → ')}`)
    assert.equal(order.filter(step => step === 'initDb').length, 1)
    assert.ok(order.lastIndexOf('tx') > converged, `the audit transaction must come after: ${order.join(' → ')}`)
    assert.ok(logs.some(entry => entry.event === 'backup.restore_schema_converged'))
  })

  test('a dump that dies half-way still gets the schema steps, and its own error is what is reported', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    failRestoreSql = true
    await assert.rejects(restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR), /restore died half-way/)
    assert.ok(order.indexOf('initDb') > order.indexOf('restoreSql'), `order: ${order.join(' → ')}`)
    const audit = restoreAudits()
    assert.deepEqual(audit.map(entry => entry.values.action), ['backup_restore_failed'])
    assert.match(String((audit[0]!.values.meta as Record<string, unknown>).error), /restore died half-way/)
  })

  test('schema steps that fail after a complete dump: a named failure that says the data WAS replaced and names the pre-restore dump to go back to', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    failConverge = true
    const error = await rejection(restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR))
    assert.equal(error.reason, 'schema_convergence_failed')
    assert.match(error.message, /đã được nạp/)
    // Not "restart to finish": every container start runs the same failing step
    // (`init.ts && …`) and would loop. The way back is the safety dump, by name.
    assert.doesNotMatch(error.message, /khởi động lại ứng dụng để hoàn tất/)
    const pre = backupFiles().find(name => name.endsWith('-pre-restore.sql.gz'))
    assert.ok(pre && error.message.includes(pre), `the message names ${pre}: ${error.message}`)
    assert.match(error.message, /log máy chủ/)
    const audit = restoreAudits()
    assert.deepEqual(audit.map(entry => entry.values.action), ['backup_restore_failed'])
    assert.equal((audit[0]!.values.meta as Record<string, unknown>).reason, 'schema_convergence_failed')
    assert.ok(logs.some(entry => entry.event === 'backup.restore_schema_convergence_failed'))
    assert.ok(!logs.some(entry => entry.event === 'backup.restore_succeeded'))
  })

  test('the restore page names every phase the server reports (no raw "schema" on screen) and keeps the bar full during the schema step', () => {
    const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    const phases = new Set([...source('server/services/backup-restore.ts').matchAll(/setStatus\((?:true|false), '([a-z]+)'/g)].map(m => m[1]!))
    assert.ok(phases.has('schema'))
    const page = source('app/pages/admin/settings/backup.vue')
    const labels = /const RESTORE_PHASE_LABEL: Record<string, string> = \{([\s\S]*?)\n\}/.exec(page)?.[1] ?? ''
    for (const phase of phases) assert.match(labels, new RegExp(`^\\s+${phase}: '`, 'm'), `no label for phase "${phase}"`)
    assert.match(page, /if \(restoreStatus\.value\?\.phase === 'schema'\) return 100/)
  })

  test('DB_NAME empty while MYSQL_DATABASE names another database: refused BEFORE the safety backup and the dump (round 3, S1)', async () => {
    seedSqlBackup('cdkt-20260101T000000Z-manual.sql.gz', '20260101T000000Z', 'SELECT 1;')
    const saved = { DB_NAME: process.env.DB_NAME, MYSQL_DATABASE: process.env.MYSQL_DATABASE }
    process.env.DB_NAME = ''
    process.env.MYSQL_DATABASE = 'cdkt_other'
    try {
      const error = await rejection(restore.runRestore('cdkt-20260101T000000Z-manual.sql.gz', ACTOR))
      assert.equal(error.reason, 'db_name_mismatch')
      assert.match(error.message, /DB_NAME/)
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
    assert.ok(!backupFiles().some(name => name.endsWith('-pre-restore.sql.gz')), 'no safety backup was taken')
    assert.deepEqual(order.filter(step => step === 'restoreSql' || step === 'initDb'), [])
  })

  test('a file-archive restore touches no schema', async () => {
    const name = makeArchive('cdkt-uploads-20261013T000000Z-manual.tar.gz', (root) => { uploadsTree(root); return ['uploads'] })
    await restore.runRestore(name, ACTOR)
    assert.ok(!order.includes('initDb'))
  })
})

// ─── The scheduler's own record survives a restore (wave1 1B re-verification S3) ─

describe('a database restore keeps the live backup scheduler state', () => {
  const KEY = 'backup_scheduler_state'
  // The dump was taken DURING the Sunday scheduled run, so it holds that run as `running`.
  const IN_DUMP = JSON.stringify({ slot: '2026-10-24T20:00:00.000Z', attempts: 1, lastAttemptAt: '2026-10-24T20:02:00.000Z', outcome: 'running', lastDoneAt: '2026-10-17T20:02:00.000Z', schedule: { hour: 3, days: [0] } })
  // What actually happened afterwards on the live system: the run finished.
  const LIVE = JSON.stringify({ slot: '2026-10-24T20:00:00.000Z', attempts: 1, lastAttemptAt: '2026-10-24T20:02:00.000Z', outcome: 'done', lastDoneAt: '2026-10-24T20:02:00.000Z', schedule: { hour: 3, days: [0] } })
  const stateValue = () => state.settings.find(row => row.key === KEY)?.value

  test('the dump\'s stale "running" record is replaced by the live one — no off-policy retry after the restore', async () => {
    seedSqlBackup('cdkt-20261025T030000Z-scheduled.sql.gz', '20261025T030000Z', 'SELECT 1;')
    state.settings = [{ key: KEY, value: LIVE }, { key: 'site_name', value: 'live' }]
    restoredSettings = [{ key: KEY, value: IN_DUMP }, { key: 'site_name', value: 'from dump' }]
    await restore.runRestore('cdkt-20261025T030000Z-scheduled.sql.gz', ACTOR)
    assert.equal(stateValue(), LIVE)
    assert.equal(state.settings.find(row => row.key === 'site_name')?.value, 'from dump', 'every other setting is the restored one')
  })

  // wave2 ops round 3 (W3): a FAILED restore after the dump ran rewinds this row too.
  for (const [label, arm] of [
    ['the dump dies half-way', () => { failRestoreSql = true }],
    ['the schema step fails', () => { failConverge = true }],
  ] as const) {
    test(`a failed restore (${label}) keeps the live record as well`, async () => {
      seedSqlBackup('cdkt-20261025T030000Z-scheduled.sql.gz', '20261025T030000Z', 'SELECT 1;')
      state.settings = [{ key: KEY, value: LIVE }]
      restoredSettings = [{ key: KEY, value: IN_DUMP }]
      arm()
      await assert.rejects(restore.runRestore('cdkt-20261025T030000Z-scheduled.sql.gz', ACTOR))
      assert.equal(stateValue(), LIVE)
    })
  }

  test('no live record: the dump\'s record is removed, not kept', async () => {
    seedSqlBackup('cdkt-20261025T030000Z-scheduled.sql.gz', '20261025T030000Z', 'SELECT 1;')
    restoredSettings = [{ key: KEY, value: IN_DUMP }]
    await restore.runRestore('cdkt-20261025T030000Z-scheduled.sql.gz', ACTOR)
    assert.equal(stateValue(), undefined)
  })
})
