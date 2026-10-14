import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before, beforeEach, mock } from 'node:test'

/**
 * Xoay vòng backup không được xoá file đang được khôi phục.
 *
 * Trước đây: bản `pre-restore` bỏ xoay vòng, nhưng một lượt backup KHÁC (lịch
 * chạy, bấm tay…) kết thúc trong lúc đang khôi phục một bản CŨ vẫn chạy
 * `rotateOldBackups` — và bản cũ nhất là ứng viên đầu tiên bị xoá. Nay:
 *  - khoá `cdkt:backup:restore` đang bị giữ (hỏi `IS_USED_LOCK`, không chờ) → bỏ
 *    cả lượt xoay vòng + log `backup.rotate_skipped_restore_active`;
 *    không đọc được trạng thái khoá → cũng bỏ;
 *  - file đang khôi phục trong tiến trình (`holdRestoreTarget`, đăng ký trước khi
 *    `runRestore` lấy khoá) → không bao giờ bị xoá;
 *  - không có lượt khôi phục → xoay vòng y như `selectRotationVictims`.
 * Chạy code thật của `backup.ts` / `backup-restore.ts` trên file thật trong thư
 * mục tạm; CSDL, pool và khoá là bản giả.
 */

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

type Row = { id: number, filename: string, stamp: string, trigger: string, status: string }
const state = {
  rows: [] as Row[],
  deletes: 0,
  /** What `IS_USED_LOCK('cdkt:backup:restore')` answers; an Error makes the query fail. */
  lockHolder: null as number | null | Error,
  lockQueries: [] as Array<{ sql: string, params: unknown[] }>,
  /** Called by the fake `withNamedLock` for every lock taken. */
  onLock: null as null | ((name: string) => Promise<{ acquired: boolean }>),
}

const fakeDb = {
  select: () => ({
    from: () => {
      const query = {
        where: () => query,
        orderBy: () => query,
        then: (resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(state.rows.filter(r => r.status === 'done').sort((a, b) => b.stamp.localeCompare(a.stamp))).then(resolve, reject),
      }
      return query
    },
  }),
  delete: () => ({ where: async () => { state.deletes += 1 } }),
}
const fakePool = {
  query: async (sql: string, params: unknown[]) => {
    state.lockQueries.push({ sql, params })
    if (state.lockHolder instanceof Error) throw state.lockHolder
    return [[{ holder: state.lockHolder }], []]
  },
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => fakePool } })
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_pool: unknown, name: string, _timeout: number, action: (c: unknown) => Promise<unknown>) => {
      const decision = state.onLock ? await state.onLock(name) : { acquired: true }
      if (!decision.acquired) return { acquired: false }
      return { acquired: true, value: await action({}) }
    },
  },
})

const backup = await import('../server/services/backup')
const restore = await import('../server/services/backup-restore')
const { rotateOldBackups, selectRotationVictims, holdRestoreTarget, restoreTargetsInProgress, LOCK_RESTORE } = backup

const originalCwd = process.cwd()
let workdir = ''
const dir = () => path.join(workdir, 'backups')
const onDisk = () => readdirSync(dir()).sort()

let nextId = 1
const row = (filename: string, stamp: string, trigger = 'scheduled'): Row => ({ id: nextId++, filename, stamp, trigger, status: 'done' })

/** keepCount=2 over five SQL backups: the three oldest are victims; the oldest is the one being restored. */
const OLDEST = 'cdkt-20261001T000000Z-scheduled.sql.gz'
function seed() {
  state.rows = [
    row(OLDEST, '20261001T000000Z'),
    row('cdkt-20261002T000000Z-scheduled.sql.gz', '20261002T000000Z'),
    row('cdkt-20261003T000000Z-scheduled.sql.gz', '20261003T000000Z'),
    row('cdkt-20261004T000000Z-scheduled.sql.gz', '20261004T000000Z'),
    row('cdkt-20261005T000000Z-scheduled.sql.gz', '20261005T000000Z'),
    row('cdkt-20260930T000000Z-pre-restore.sql.gz', '20260930T000000Z', 'pre-restore'),
  ]
  for (const r of state.rows) writeFileSync(path.join(dir(), r.filename), 'x')
}
const KEEP = 2

before(() => {
  workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-rotate-restore-'))
  process.chdir(workdir)
})
after(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})
beforeEach(() => {
  rmSync(dir(), { recursive: true, force: true })
  mkdirSync(dir(), { recursive: true })
  state.deletes = 0
  state.lockHolder = null
  state.lockQueries = []
  state.onLock = null
  logs.length = 0
  seed()
})

const skippedLogs = () => logs.filter(entry => entry.event === 'backup.rotate_skipped_restore_active')

test('no restore running: rotation deletes exactly the selectRotationVictims files (unchanged behaviour)', async () => {
  const expected = selectRotationVictims(state.rows, KEEP).map(r => r.filename).sort()
  assert.ok(expected.includes(OLDEST))
  const deleted = await rotateOldBackups(fakeDb as never, KEEP)
  assert.equal(deleted, expected.length)
  assert.equal(state.deletes, expected.length)
  for (const name of expected) assert.ok(!existsSync(path.join(dir(), name)), `${name} rotated away`)
  assert.ok(existsSync(path.join(dir(), 'cdkt-20260930T000000Z-pre-restore.sql.gz')), 'pre-restore never rotated')
  assert.equal(skippedLogs().length, 0)
  // The default guard asked MySQL about the restore lock, by name, without waiting.
  assert.equal(state.lockQueries.length, 1)
  assert.match(state.lockQueries[0]!.sql, /IS_USED_LOCK\(\?\)/)
  assert.deepEqual(state.lockQueries[0]!.params, [LOCK_RESTORE])
  assert.equal(LOCK_RESTORE, 'cdkt:backup:restore')
})

test('restore lock held anywhere (IS_USED_LOCK returns a connection id): nothing is rotated, event logged', async () => {
  state.lockHolder = 4242
  const before = onDisk()
  assert.equal(await rotateOldBackups(fakeDb as never, KEEP), 0)
  assert.deepEqual(onDisk(), before)
  assert.equal(state.deletes, 0)
  assert.equal(skippedLogs().length, 1)
  assert.equal(skippedLogs()[0]!.reason, 'restore_lock_held')
})

test('restore lock state unreadable: rotation is skipped, not guessed', async () => {
  state.lockHolder = new Error('connection lost')
  const before = onDisk()
  assert.equal(await rotateOldBackups(fakeDb as never, KEEP), 0)
  assert.deepEqual(onDisk(), before)
  assert.ok(logs.some(entry => entry.event === 'backup.rotate_skipped_restore_unknown'))
})

test('the file being restored in this process survives rotation at the retention limit; other victims still go', async () => {
  const release = holdRestoreTarget(OLDEST)
  try {
    const victims = selectRotationVictims(state.rows, KEEP).map(r => r.filename)
    const deleted = await rotateOldBackups(fakeDb as never, KEEP)
    assert.equal(deleted, victims.length - 1)
    assert.ok(existsSync(path.join(dir(), OLDEST)), 'restore target kept')
    for (const name of victims.filter(n => n !== OLDEST)) assert.ok(!existsSync(path.join(dir(), name)), `${name} rotated`)
    assert.equal(skippedLogs().length, 1)
    assert.equal(skippedLogs()[0]!.filename, OLDEST)
  } finally {
    release()
  }
  assert.ok(!restoreTargetsInProgress().has(OLDEST))
})

test('holds are reference-counted and released idempotently', () => {
  const a = holdRestoreTarget(OLDEST)
  const b = holdRestoreTarget(OLDEST)
  a()
  a()
  assert.ok(restoreTargetsInProgress().has(OLDEST), 'second holder still holds')
  b()
  assert.ok(!restoreTargetsInProgress().has(OLDEST))
})

test('runRestore registers its file BEFORE taking the restore lock and releases it on every exit (409 included)', async () => {
  const seen: Array<{ lock: string, held: boolean }> = []
  state.onLock = async (name) => {
    seen.push({ lock: name, held: restoreTargetsInProgress().has(OLDEST) })
    return { acquired: false } // another restore holds the lock → 409
  }
  await assert.rejects(restore.runRestore(OLDEST, { id: 1, username: 'admin' }), (err: unknown) => (err as { statusCode?: number }).statusCode === 409)
  assert.deepEqual(seen, [{ lock: LOCK_RESTORE, held: true }])
  assert.ok(!restoreTargetsInProgress().has(OLDEST), 'released after the 409')
})

test('a scheduled backup that rotates while an old file is being restored leaves that file in place', async () => {
  let rotatedDuringRestore = -1
  state.onLock = async (name) => {
    if (name === LOCK_RESTORE) {
      // Inside the restore: another process's backup finishes and rotates. MySQL
      // is (pessimistically) asked and reports the lock free — the in-process
      // registration alone must still protect the file.
      rotatedDuringRestore = await rotateOldBackups(fakeDb as never, KEEP, { restoreLockHeld: async () => false })
      return { acquired: true }
    }
    return { acquired: false } // safety backup lock busy → restore stops cleanly afterwards
  }
  await assert.rejects(restore.runRestore(OLDEST, { id: 1, username: 'admin' }))
  assert.ok(rotatedDuringRestore > 0, 'rotation did run and deleted other victims')
  assert.ok(existsSync(path.join(dir(), OLDEST)), 'the restore target survived')
  assert.ok(!restoreTargetsInProgress().has(OLDEST))
})
