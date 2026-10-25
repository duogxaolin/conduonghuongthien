import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before, mock } from 'node:test'

/**
 * A restore and a media job never write at the same time — checked from BOTH sides.
 *
 * Each side takes its own lock, THEN asks about the other's (`IS_USED_LOCK`), so of two
 * that start together at least one sees the other:
 *  - a media job (sync, scan, self-heal, repair-urls, fix-thumbnails; repoint holds sync +
 *    scan) holds its lock, then refuses if a restore holds `cdkt:backup:restore`
 *    (`pre-job-backup.ts`);
 *  - a restore holds `cdkt:backup:restore`, then refuses with 409 — before its safety
 *    dump, before any status/log of a started restore — if any media job lock is held.
 *
 * Before: the restore side never asked, so a restore could start while a job that had
 * already passed its own check was writing into the tables the dump was replacing; and
 * the folder scan (`media-scan.ts`) never asked either.
 *
 * Real `backup-restore.ts` / `media-scan.ts`; fakes: the database, the named locks (held
 * names tracked), the pre-restore dump and the SQL restore (both spies).
 */

const logs: Array<Record<string, unknown>> = []
const push = (record: Record<string, unknown>) => { logs.push(record) }
const realLogger = await import('../server/utils/logger')
mock.module('../server/utils/logger', {
  namedExports: { ...realLogger, logInfo: push, logWarn: push, logError: push },
})

const state = {
  /** Media job locks some other connection holds. */
  jobLocksHeld: new Set<string>(),
  /** `IS_USED_LOCK('cdkt:backup:restore')` as another connection sees it. */
  restoreHolder: null as number | null,
  /** The query about the media job locks fails. */
  jobLockQueryFails: false,
  dbCalls: [] as string[],
  queries: [] as string[],
}
function chain(result: unknown): unknown {
  return new Proxy(function builder() {}, {
    get: (_target, prop) => {
      if (prop === 'then') return (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
      return () => chain(result)
    },
  })
}
const fakeDb: Record<string, unknown> = {
  select: () => { state.dbCalls.push('select'); return chain([]) },
  insert: () => { state.dbCalls.push('insert'); return chain([{ insertId: 1, affectedRows: 1 }]) },
  update: () => { state.dbCalls.push('update'); return chain([{ affectedRows: 0 }]) },
  delete: () => { state.dbCalls.push('delete'); return chain([{ affectedRows: 0 }]) },
  execute: async () => { state.dbCalls.push('execute'); return [[], []] },
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => { state.dbCalls.push('transaction'); return fn(fakeDb) },
}
/** Answers `IS_USED_LOCK` per alias: `media_job_<i>` for the job locks, `holder` for the restore lock. */
async function query(sql: string, params: unknown[] = []) {
  state.queries.push(sql)
  if (/media_job_\d+/.test(sql)) {
    if (state.jobLockQueryFails) throw new Error('fixture: lost connection')
    const row: Record<string, unknown> = {}
    params.forEach((name, index) => { row[`media_job_${index}`] = state.jobLocksHeld.has(String(name)) ? 77 : null })
    return [[row], []]
  }
  if (/GET_LOCK/.test(sql)) return [[{ acquired: 1 }], []]
  return [[{ holder: state.restoreHolder }], []]
}
const fakePool = {
  query,
  getConnection: async () => ({ query, release: () => {} }),
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => fakePool } })

/** Named locks this process holds right now, and every one it took. */
const held = new Set<string>()
const taken: string[] = []
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_pool: unknown, name: string, _timeout: number, action: (connection: unknown) => Promise<unknown>) => {
      taken.push(name)
      held.add(name)
      try {
        return { acquired: true, value: await action({ query }) }
      } finally {
        held.delete(name)
      }
    },
  },
})

const sqlCalls: string[] = []
const realSql = await import('../server/services/backup-sql')
mock.module('../server/services/backup-sql', {
  namedExports: { ...realSql, restoreSql: async (file: string) => { sqlCalls.push(file); return { legacyDateShift: false } } },
})
const backupCalls: unknown[][] = []
const realBackup = await import('../server/services/backup')
mock.module('../server/services/backup', {
  namedExports: {
    ...realBackup,
    runBackup: async (...args: unknown[]) => { backupCalls.push(args); throw new Error('fixture: safety dump not expected') },
  },
})

const { runRestore, getRestoreStatus } = await import('../server/services/backup-restore')
const { startScanJob, getScanJobStatus } = await import('../server/services/media-scan')
const { MEDIA_JOB_LOCK_NAMES } = await import('../server/services/pre-job-backup')
const { BackupRestoreError } = await import('../server/services/backup-restore-guards')

let workdir = ''
const originalCwd = process.cwd()
const FILE = 'cdkt-20261025T000000Z-manual.sql.gz'
before(() => {
  workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-restore-media-jobs-'))
  mkdirSync(path.join(workdir, 'backups'))
  mkdirSync(path.join(workdir, 'public', 'uploads'), { recursive: true })
  writeFileSync(path.join(workdir, 'backups', FILE), 'not read before the gate')
  process.env.CDKT_BACKUPS_DIR = path.join(workdir, 'backups')
  process.chdir(workdir)
})
after(() => {
  process.chdir(originalCwd)
  delete process.env.CDKT_BACKUPS_DIR
  rmSync(workdir, { recursive: true, force: true })
})
function reset() {
  state.jobLocksHeld.clear()
  state.restoreHolder = null
  state.jobLockQueryFails = false
  state.dbCalls.length = 0
  state.queries.length = 0
  logs.length = 0
  taken.length = 0
  backupCalls.length = 0
  sqlCalls.length = 0
}
const actor = { id: 1, username: 'root-admin' }
const events = (name: string) => logs.filter(record => record.event === name)

// ─── The restore side ─────────────────────────────────────────────────────────
test('the list is the five job locks (repoint holds two of them)', () => {
  assert.deepEqual([...MEDIA_JOB_LOCK_NAMES].sort(), [
    'cdkt:articles:scan-thumbnails', 'cdkt:media:repair-urls', 'cdkt:media:scan', 'cdkt:media:self-heal', 'cdkt:media:sync-storage',
  ])
})

for (const lock of ['cdkt:media:sync-storage', 'cdkt:media:scan', 'cdkt:media:self-heal', 'cdkt:media:repair-urls', 'cdkt:articles:scan-thumbnails']) {
  test(`a restore while ${lock} is held → 409 naming a media job; restore lock released; no safety dump, no restore, no "started"/"failed"`, async () => {
    reset()
    state.jobLocksHeld.add(lock)
    const err = await runRestore(FILE, actor).catch((error: unknown) => error)
    assert.ok(err instanceof BackupRestoreError, String(err))
    assert.equal(err.statusCode, 409)
    assert.equal(err.reason, 'media_job_running')
    assert.match(err.message, /^Đang có job xử lý ảnh chạy \(.+\) — chưa khôi phục gì\./)
    assert.ok(taken.includes(realBackup.LOCK_RESTORE), 'the restore asked only after taking its own lock')
    assert.equal(held.size, 0, 'the restore lock was not released')
    assert.equal(backupCalls.length, 0, 'the pre-restore safety dump was started')
    assert.equal(sqlCalls.length, 0, 'the dump was restored')
    assert.equal(events('backup.restore_started').length, 0, 'logged as a started restore')
    assert.equal(events('backup.restore_failed').length, 0, 'reported as a failed restore (and its alert)')
    assert.equal(events('backup.restore_refused').length, 1)
    assert.equal(events('backup.restore_refused')[0]!.reason, 'media_job_running')
    assert.equal(getRestoreStatus().phase, 'failed')
    assert.deepEqual(state.dbCalls, [], 'no audit row of a failed restore was written')
  })
}

test('the job locks cannot be checked → refused the same way (503), nothing started', async () => {
  reset()
  state.jobLockQueryFails = true
  const err = await runRestore(FILE, actor).catch((error: unknown) => error)
  assert.ok(err instanceof BackupRestoreError, String(err))
  assert.equal(err.statusCode, 503)
  assert.equal(err.reason, 'media_job_state_unknown')
  assert.equal(held.size, 0)
  assert.equal(backupCalls.length, 0)
  assert.equal(events('backup.restore_started').length, 0)
})

test('no media job lock held → the restore goes past the gate (and on to its own checks)', async () => {
  reset()
  // DB_NAME / MYSQL_DATABASE disagree: the restore stops at its NEXT check, inside the
  // lock — proof it passed the media-job gate, without a real MySQL.
  const previous = { DB_NAME: process.env.DB_NAME, MYSQL_DATABASE: process.env.MYSQL_DATABASE }
  delete process.env.DB_NAME
  process.env.MYSQL_DATABASE = 'other_db'
  try {
    const err = await runRestore(FILE, actor).catch((error: unknown) => error)
    assert.ok(err instanceof BackupRestoreError && err.reason === 'db_name_mismatch', String(err))
    assert.equal(events('backup.restore_started').length, 1)
    assert.ok(state.queries.some(sql => /media_job_0/.test(sql)), 'the job locks were asked about')
  } finally {
    if (previous.DB_NAME === undefined) delete process.env.DB_NAME
    else process.env.DB_NAME = previous.DB_NAME
    if (previous.MYSQL_DATABASE === undefined) delete process.env.MYSQL_DATABASE
    else process.env.MYSQL_DATABASE = previous.MYSQL_DATABASE
  }
})

// ─── The scan job side ────────────────────────────────────────────────────────
async function settledScan() {
  for (let i = 0; i < 400; i += 1) {
    const status = getScanJobStatus()
    if (status && !status.running) return status
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return assert.fail('the scan job never finished')
}

test('a folder scan while a restore holds its lock → aborted after taking the scan lock, with the same sentence as the other jobs, nothing read or written', async () => {
  reset()
  state.restoreHolder = 42
  await startScanJob(1)
  const status = await settledScan()
  assert.equal(status.phase, 'failed')
  assert.match(status.message, /^Đang khôi phục từ bản sao lưu — chưa quét thư mục ảnh, chưa ghi gì\. Thử lại sau khi khôi phục xong\.$/)
  assert.deepEqual(state.dbCalls, [], 'the scan read/wrote media rows during a restore')
  const ownLock = state.queries.findIndex(sql => /GET_LOCK/.test(sql))
  const restoreQuestion = state.queries.findIndex(sql => /AS holder/.test(sql))
  assert.ok(ownLock >= 0 && restoreQuestion > ownLock, 'the scan must take its own lock FIRST, then ask about the restore')
  assert.ok(state.queries.some(sql => /RELEASE_LOCK/.test(sql)), 'the scan lock was not released')
  const aborted = events('media.job_aborted_restore_in_progress')
  assert.equal(aborted.length, 1)
  assert.equal(aborted[0]!.job, 'scan')
})

test('a folder scan with no restore runs as before', async () => {
  reset()
  await startScanJob(1)
  const status = await settledScan()
  assert.equal(status.phase, 'done', status.message)
  assert.equal(events('media.job_aborted_restore_in_progress').length, 0)
})
