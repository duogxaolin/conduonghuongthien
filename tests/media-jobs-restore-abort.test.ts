import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'

/**
 * The five media maintenance jobs that take an SQL backup before they write — self-heal,
 * repoint (đổi domain R2), repair-urls, sync local↔R2, fix-thumbnails — must NOT write
 * while a database restore holds the restore lock.
 *
 * `runBackup` refuses then with `BackupRestoreInProgressError` (wave2 ops). Four of the
 * jobs used to catch ANY pre-backup failure and carry on ("the snapshot is a bonus"), so
 * during a restore they wrote with no snapshot, into tables the restore was replacing —
 * the write lost when the dump re-creates the table, or half-old/half-new data. Repoint
 * already stopped, but as a 500 "backup failed, check the disk", which is the wrong
 * advice. Now: the restore case aborts every job before its first write, with one log
 * event and a 409 carrying a stable sentence. Every OTHER pre-backup failure keeps the
 * job's old behaviour — shown here with the parent class `BackupLockBusyError` (another
 * backup holds the run lock), so the match is on the exact type, not "any busy".
 *
 * Real `runBackup` (its restore-lock question answered by a fake pool), real services,
 * real endpoints; fakes only at the edges: the database (every call recorded), the named
 * locks, R2, the R2 settings.
 */

const logs: Array<Record<string, unknown>> = []
const push = (record: Record<string, unknown>) => { logs.push(record) }
mock.module('../server/utils/logger', { namedExports: { logInfo: push, logWarn: push, logError: push } })

/** Every database call a job makes, in order — the "no write" evidence. */
const dbCalls: string[] = []
/** A chain that accepts any builder call and resolves to `result`. */
function chain(result: unknown): unknown {
  return new Proxy(function builder() {}, {
    get: (_target, prop) => {
      if (prop === 'then') return (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
      return () => chain(result)
    },
  })
}
const fakeDb: Record<string, unknown> = {
  select: () => { dbCalls.push('select'); return chain([]) },
  selectDistinct: () => { dbCalls.push('select'); return chain([]) },
  insert: () => { dbCalls.push('insert'); return chain([{ insertId: 1, affectedRows: 1 }]) },
  update: () => { dbCalls.push('update'); return chain([{ affectedRows: 0 }]) },
  delete: () => { dbCalls.push('delete'); return chain([{ affectedRows: 0 }]) },
  execute: async () => { dbCalls.push('execute'); return [[], []] },
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => { dbCalls.push('transaction'); return fn(fakeDb) },
}
const state = {
  /** `IS_USED_LOCK('cdkt:backup:restore')` — a connection id while a restore runs. */
  restoreHolder: null as number | null,
  /** Another backup holds `cdkt:backup:run` → `BackupLockBusyError`. */
  runLockBusy: false,
  /** Asking MySQL about the restore lock fails. */
  restoreQueryFails: false,
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => fakeDb,
    getPool: () => ({
      query: async () => {
        if (state.restoreQueryFails) throw new Error('fixture: lost connection')
        return [[{ holder: state.restoreHolder }], []]
      },
    }),
  },
})
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_pool: unknown, name: string, _timeout: number, action: (connection: unknown) => Promise<unknown>) =>
      name === 'cdkt:backup:run' && state.runLockBusy ? { acquired: false } : { acquired: true, value: await action({}) },
  },
})
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })

const r2Calls: string[] = []
const realR2 = await import('../server/utils/media-r2')
mock.module('../server/utils/media-r2', {
  namedExports: {
    ...realR2,
    headR2Object: async () => { r2Calls.push('head'); return true },
    uploadR2File: async () => { r2Calls.push('upload'); return { url: 'https://cdn1.delify.vn/x.jpg', storagePath: 'x.jpg' } },
  },
})
const R2 = { accountId: '0123456789abcdef0123456789abcdef', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'stub-bucket', publicUrl: 'https://cdn1.delify.vn' }
const realMedia = await import('../server/services/media')
mock.module('../server/services/media', { namedExports: { ...realMedia, loadR2Config: async () => R2 } })

const h3 = await import('h3')
type Event = { body: unknown, context: { adminUser: { id: number } } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = h3.createError

// No dump ever runs here (the backup is refused before it starts) — but never `./backups`.
const backupDir = mkdtempSync(path.join(tmpdir(), 'cdkt-media-jobs-restore-'))
process.env.CDKT_BACKUPS_DIR = backupDir
after(() => {
  delete process.env.CDKT_BACKUPS_DIR
  rmSync(backupDir, { recursive: true, force: true })
})

const { selfHealMedia } = await import('../server/services/media-self-heal')
const { repairMediaUrls } = await import('../server/services/media-repair')
const { scanArticleThumbnails } = await import('../server/services/articles-thumbnail-scan')
const { repointR2Urls, RepointBackupError } = await import('../server/services/media-repoint')
const { startSyncJob, getSyncJobStatus } = await import('../server/services/media-sync')
type Handler = (event: Event) => Promise<unknown>
const endpoint = async (file: string) => (await import(`../server/api/admin/${file}`)).default as unknown as Handler

function reset() {
  dbCalls.length = 0
  r2Calls.length = 0
  logs.length = 0
  state.restoreHolder = null
  state.runLockBusy = false
  state.restoreQueryFails = false
}
const RESTORE_MESSAGE = /^Đang khôi phục cơ sở dữ liệu — chưa .+, chưa ghi gì\. Thử lại sau khi khôi phục xong\.$/
const aborted = (job: string) => logs.filter(record => record.event === 'media.job_aborted_restore_in_progress' && record.job === job)
async function httpFailure(handler: Handler, body: unknown): Promise<{ statusCode?: number, statusMessage?: string }> {
  try {
    await handler({ body, context: { adminUser: { id: 7 } } })
  } catch (error) {
    return error as { statusCode?: number, statusMessage?: string }
  }
  return assert.fail('the endpoint answered 2xx')
}
const restoreRefusal = (err: unknown) => {
  const shaped = err as { statusCode?: unknown, message?: unknown }
  assert.equal(shaped.statusCode, 409, `not a 409: ${String(shaped.message)}`)
  assert.match(String(shaped.message), RESTORE_MESSAGE)
  return true
}

const JOBS = [
  { id: 'self-heal', run: () => selfHealMedia(1), file: 'media/self-heal.post', body: { dryRun: false } },
  { id: 'repair-urls', run: () => repairMediaUrls(1), file: 'media/repair-urls.post', body: {} },
  { id: 'fix-thumbnails', run: () => scanArticleThumbnails(1, { dryRun: false, fixIds: [5] }), file: 'articles/scan-thumbnails.post', body: { dryRun: false, fixIds: [5] } },
  { id: 'repoint', run: () => repointR2Urls('old.cdn', 'cdn1.delify.vn', 1), file: 'media/repoint-r2-urls.post', body: { oldDomain: 'old.cdn', newDomain: 'cdn1.delify.vn' } },
] as const

for (const job of JOBS) {
  test(`${job.id}: a restore in progress aborts it before any write — 409, stable sentence, one log event`, async () => {
    reset()
    state.restoreHolder = 42
    await assert.rejects(job.run(), restoreRefusal)
    assert.deepEqual(dbCalls, [], 'the job used the database after its pre-backup was refused by a restore')
    assert.deepEqual(r2Calls, [], 'the job reached R2')
    assert.equal(aborted(job.id).length, 1)
    assert.ok(!logs.some(record => record.event === 'media.repoint_pre_backup_failed'), 'reported as a failed backup (disk/log advice) instead')
  })

  test(`${job.id}: its endpoint answers 409 with the service's sentence`, async () => {
    reset()
    state.restoreHolder = 42
    const error = await httpFailure(await endpoint(job.file), job.body)
    assert.equal(error.statusCode, 409)
    assert.match(String(error.statusMessage), RESTORE_MESSAGE)
    assert.deepEqual(dbCalls, [])
  })
}

// A restore takes its restore lock, THEN its own `pre-restore` dump holds the run lock
// (`allowDuringRestore`) — minutes on a large database. A job's pre-backup in that window
// finds the run lock busy and never reached the restore question: it got the parent
// `BackupLockBusyError` and four of the five jobs carried on, writing while the restore
// was about to replace the tables.
for (const job of JOBS) {
  test(`${job.id}: aborts too while the restore's own pre-restore dump holds the run lock`, async () => {
    reset()
    state.restoreHolder = 42
    state.runLockBusy = true
    await assert.rejects(job.run(), restoreRefusal)
    assert.deepEqual(dbCalls, [])
    assert.deepEqual(r2Calls, [])
    assert.equal(aborted(job.id).length, 1)
  })
}

test('runBackup: run lock busy + restore lock held → BackupRestoreInProgressError (still a "busy" error); unknown restore state fails closed; the restore\'s own pre-restore dump still gets plain "busy"', async () => {
  const { runBackup, BackupLockBusyError, BackupRestoreInProgressError } = await import('../server/services/backup')
  reset()
  state.runLockBusy = true
  state.restoreHolder = 42
  const during = await runBackup('sql', 'manual', 1).catch((err: unknown) => err)
  assert.ok(during instanceof BackupRestoreInProgressError, String(during))
  assert.ok(during instanceof BackupLockBusyError, 'callers that answer "busy" with 409 / not-an-attempt keep doing so')
  // Its own safety dump must not be told "a restore is running" about itself.
  const own = await runBackup('sql', 'pre-restore', 1, { rotate: false, allowDuringRestore: true }).catch((err: unknown) => err)
  assert.ok(own instanceof BackupLockBusyError && !(own instanceof BackupRestoreInProgressError), String(own))
  // Another backup only: plain busy, as before.
  state.restoreHolder = null
  const plain = await runBackup('sql', 'manual', 1).catch((err: unknown) => err)
  assert.ok(plain instanceof BackupLockBusyError && !(plain instanceof BackupRestoreInProgressError), String(plain))
  // Cannot ask MySQL: treated as a restore, like the check inside the run lock.
  state.restoreQueryFails = true
  const unknown = await runBackup('sql', 'manual', 1).catch((err: unknown) => err)
  assert.ok(unknown instanceof BackupRestoreInProgressError, String(unknown))
  assert.ok(logs.some(record => record.event === 'backup.restore_lock_unknown'))
})

test('self-heal / repair-urls / fix-thumbnails: any OTHER pre-backup failure still carries on (another backup running)', async () => {
  for (const job of JOBS.filter(candidate => candidate.id !== 'repoint')) {
    reset()
    state.runLockBusy = true
    const result = await job.run() as { backupStamp?: string | null }
    assert.equal(result.backupStamp, null, `${job.id}: no snapshot`)
    assert.ok(dbCalls.includes('transaction'), `${job.id}: did not run its writes`)
    assert.equal(aborted(job.id).length, 0, `${job.id}: aborted on a plain busy lock`)
  }
})

test('repoint: any OTHER pre-backup failure is still fatal as before — RepointBackupError, nothing written', async () => {
  reset()
  state.runLockBusy = true
  await assert.rejects(repointR2Urls('old.cdn', 'cdn1.delify.vn', 1), RepointBackupError)
  assert.deepEqual(dbCalls, [])
  assert.equal(aborted('repoint').length, 0)
  const error = await httpFailure(await endpoint('media/repoint-r2-urls.post'), { oldDomain: 'old.cdn', newDomain: 'cdn1.delify.vn' })
  assert.equal(error.statusCode, 500)
})

// ─── Sync runs in the background: the status poll is its HTTP surface ─────────
async function settledSync() {
  for (let i = 0; i < 400; i += 1) {
    const status = getSyncJobStatus()
    if (status && !status.running) return status
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return assert.fail('the sync job never finished')
}

test('sync: a restore in progress fails the background job before any write; the status says why', async () => {
  reset()
  state.restoreHolder = 42
  const handler = await endpoint('media/sync-storage.post')
  await handler({ body: { direction: 'to-r2' }, context: { adminUser: { id: 7 } } })
  const status = await settledSync()
  assert.equal(status.phase, 'failed')
  assert.match(status.message, RESTORE_MESSAGE)
  assert.equal(status.preBackupStamp, null)
  assert.deepEqual(dbCalls, [], 'the worker repaired/synced after its pre-backup was refused by a restore')
  assert.deepEqual(r2Calls, [])
  assert.equal(aborted('sync').length, 1)
})

test('sync: any OTHER pre-backup failure still carries on (another backup running)', async () => {
  reset()
  state.runLockBusy = true
  await startSyncJob('to-r2', 1)
  const status = await settledSync()
  assert.equal(status.phase, 'done', status.message)
  assert.ok(dbCalls.length > 0, 'the worker did not run')
  assert.equal(aborted('sync').length, 0)
})
