import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before, beforeEach, mock } from 'node:test'
import { activityLogs, backups } from '../server/db/schema'

/**
 * A failed backup run leaves no unregistered archive (wave1 D11, spec `backup-restore`).
 *
 * Before: `archiveFiles` wrote BOTH archives and only then inserted their rows, and
 * the failure branch inserted a `failed` row hard-coded to `cdkt-media-…`. So when
 * the media `tar` failed after the uploads archive was written, the uploads
 * archive stayed on disk with no row (invisible to the admin list and to rotation,
 * never deleted), a partial media archive stayed too, and when it was the UPLOADS
 * archive that failed, the failed row still named the media archive.
 *
 * Now every archive path the run creates is tracked, each archive gets its `done`
 * row right after it is written and checked, and on any failure every tracked file
 * without a `done` row is deleted; the failed row names the archive whose step threw.
 *
 * Runs the real `runBackup` on real files in a temp directory; `tar`, `mysqldump`,
 * the database and the named lock are fakes.
 */

const logs: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: { logInfo: (e: Record<string, unknown>) => logs.push(e), logWarn: (e: Record<string, unknown>) => logs.push(e), logError: (e: Record<string, unknown>) => logs.push(e) },
})

type Row = { filename: string, type: string, status: string, stamp: string, trigger: string, error?: string | null }
const state = {
  rows: [] as Row[],
  audits: 0,
  /** The tree whose `tar` fails after writing part of its archive. */
  failTar: null as null | 'uploads' | 'media',
  /** The SQL dump fails after writing part of its file. */
  failDump: false,
  /** Archive name whose `done` row cannot be written. */
  failDoneRowFor: null as null | RegExp,
  /** Archive name whose transaction fails AFTER its callback ran (commit error). */
  failCommitFor: null as null | RegExp,
  /** Reading the backup settings fails (a failure before the first file step). */
  failConfigRead: false,
  /** Another backup holds the run lock. */
  lockBusy: false,
  tarCalls: [] as string[],
  /** Every path `mysqldump`/`tar` was asked to write. */
  writeTargets: [] as string[],
}

const fakeDb = {
  select: () => ({
    from: async () => {
      if (state.failConfigRead) throw new Error('fixture: settings read failed')
      return []
    },
  }),
  insert: (table: unknown) => ({
    values: async (value: Row) => {
      assert.equal(table, backups, 'only the failed row is written outside a transaction')
      state.rows.push({ ...value })
    },
  }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const pending: Row[] = []
    let audits = 0
    const tx = {
      insert: (table: unknown) => ({
        values: async (value: Row) => {
          if (table === backups) {
            if (state.failDoneRowFor?.test(value.filename)) throw new Error('fixture: done row insert failed')
            pending.push({ ...value })
          } else if (table === activityLogs) audits += 1
        },
      }),
    }
    const result = await fn(tx)
    if (pending.some(row => state.failCommitFor?.test(row.filename))) throw new Error('fixture: commit failed')
    state.rows.push(...pending)
    state.audits += audits
    return result
  },
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => ({ query: async () => [[{ holder: null }], []] }) } })
const lockNames: string[] = []
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_pool: unknown, name: string, _timeout: number, action: (c: unknown) => Promise<unknown>) => {
      lockNames.push(name)
      if (state.lockBusy) return { acquired: false }
      return { acquired: true, value: await action({}) }
    },
  },
})
mock.module('../server/services/backup-sql', {
  namedExports: {
    dumpSql: async (target: string) => {
      state.writeTargets.push(target)
      writeFileSync(target, state.failDump ? 'partial' : 'complete sql dump')
      if (state.failDump) throw new Error('fixture: mysqldump died')
      return 17
    },
  },
})
/** `tar czf <target> -C <parent> <tree>`: writes the archive, or part of it then fails. */
mock.module('node:child_process', {
  namedExports: {
    execFile: (file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: string) => void) => {
      assert.equal(file, 'tar')
      const [, target, , , tree] = args as [string, string, string, string, 'uploads' | 'media']
      state.tarCalls.push(tree)
      state.writeTargets.push(target!)
      if (state.failTar === tree) {
        writeFileSync(target!, 'partial gzip')
        setImmediate(() => callback(new Error(`fixture: tar failed on ${tree}`)))
        return
      }
      writeFileSync(target!, `archive of ${tree}`)
      setImmediate(() => callback(null, ''))
    },
  },
})

const { runBackup, sweepPartialBackups, BackupLockBusyError } = await import('../server/services/backup')

const originalCwd = process.cwd()
let workdir = ''
const backupDir = () => path.join(workdir, 'backups')
const onDisk = () => (existsSync(backupDir()) ? readdirSync(backupDir()).sort() : [])
const sources = () => [
  { tree: 'uploads' as const, parent: path.join(workdir, 'public') },
  { tree: 'media' as const, parent: path.join(workdir, 'var-lib-cdkt') },
]

before(() => {
  workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-backup-orphans-'))
  mkdirSync(path.join(workdir, 'public', 'uploads'), { recursive: true })
  mkdirSync(path.join(workdir, 'var-lib-cdkt', 'media'), { recursive: true })
  process.chdir(workdir)
})
after(() => {
  process.chdir(originalCwd)
  rmSync(workdir, { recursive: true, force: true })
})
beforeEach(() => {
  rmSync(backupDir(), { recursive: true, force: true })
  state.rows = []
  state.audits = 0
  state.failTar = null
  state.failDump = false
  state.failDoneRowFor = null
  state.failCommitFor = null
  state.failConfigRead = false
  state.lockBusy = false
  state.tarCalls = []
  state.writeTargets = []
  lockNames.length = 0
  logs.length = 0
})

const run = (type: 'sql' | 'files' | 'all') => runBackup(type, 'manual', 1, { rotate: false, archiveSources: sources() })
const done = () => state.rows.filter(row => row.status === 'done').map(row => row.filename).sort()
const failed = () => state.rows.filter(row => row.status === 'failed')

test('success: every archive is on disk with exactly one done row and one audit row', async () => {
  const result = await run('all')
  assert.equal(result.files.length, 3)
  assert.deepEqual(onDisk(), done())
  assert.deepEqual(state.rows.map(row => row.filename.replace(/-\d{8}T\d{6}Z-/, '-<stamp>-')), [
    'cdkt-<stamp>-manual.sql.gz', 'cdkt-uploads-<stamp>-manual.tar.gz', 'cdkt-media-<stamp>-manual.tar.gz',
  ])
  assert.equal(state.audits, 3)
  assert.equal(failed().length, 0)
})

test('the media archive fails after the uploads archive was written: no unregistered file remains, the failed row names media', async () => {
  state.failTar = 'media'
  await assert.rejects(run('all'), /tar failed on media/)

  assert.deepEqual(state.tarCalls, ['uploads', 'media'])
  // What stays on disk is exactly what has a `done` row: the SQL dump and the uploads archive.
  assert.deepEqual(onDisk(), done())
  assert.equal(done().length, 2)
  assert.ok(!onDisk().some(name => name.startsWith('cdkt-media-')), 'the partial media archive must be deleted')
  assert.equal(failed().length, 1)
  assert.match(failed()[0]!.filename, /^cdkt-media-\d{8}T\d{6}Z-manual\.tar\.gz$/)
  assert.match(String(failed()[0]!.error), /tar failed on media/)
})

test('the uploads archive fails first: nothing is left on disk and the failed row names the UPLOADS archive', async () => {
  state.failTar = 'uploads'
  await assert.rejects(run('files'), /tar failed on uploads/)

  assert.deepEqual(state.tarCalls, ['uploads'], 'the run stops at the failing archive')
  assert.deepEqual(onDisk(), [])
  assert.deepEqual(done(), [])
  assert.equal(failed().length, 1)
  assert.match(failed()[0]!.filename, /^cdkt-uploads-\d{8}T\d{6}Z-manual\.tar\.gz$/)
})

test('an archive whose done row cannot be written is deleted too, and named in the failed row', async () => {
  state.failDoneRowFor = /^cdkt-uploads-/
  await assert.rejects(run('files'), /done row insert failed/)

  assert.deepEqual(onDisk(), [], 'a written archive without a done row is an orphan')
  assert.deepEqual(state.tarCalls, ['uploads'])
  assert.equal(failed().length, 1)
  assert.match(failed()[0]!.filename, /^cdkt-uploads-/)
})

test('a failed SQL dump leaves no partial dump and names the dump in the failed row', async () => {
  state.failDump = true
  await assert.rejects(run('all'), /mysqldump died/)

  assert.deepEqual(onDisk(), [])
  assert.deepEqual(state.tarCalls, [], 'no archive is attempted after the dump failed')
  assert.equal(failed().length, 1)
  assert.match(failed()[0]!.filename, /^cdkt-\d{8}T\d{6}Z-manual\.sql\.gz$/)
  assert.equal(failed()[0]!.type, 'sql')
})

test('a name already taken (two runs in the same second) is refused before anything is written', async () => {
  // Two runs of the same trigger inside one second share a stamp. Writing anyway
  // overwrote the earlier run's REGISTERED archive with this run's content; a
  // `failed` row under the same name would also make "delete" of that row unlink
  // the good file. The run refuses the name instead: no write, no row.
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-23T03:00:00.000Z') })
  try {
    mkdirSync(backupDir(), { recursive: true })
    const earlier = 'cdkt-uploads-20261023T030000Z-manual.tar.gz'
    writeFileSync(path.join(backupDir(), earlier), 'an earlier, registered archive')
    await assert.rejects(run('files'), /đã tồn tại/)
    assert.deepEqual(state.tarCalls, [], 'nothing was written')
    assert.deepEqual(onDisk(), [earlier])
    assert.equal(readFileSync(path.join(backupDir(), earlier), 'utf8'), 'an earlier, registered archive', 'the registered archive is untouched')
    assert.deepEqual(state.rows, [], 'no row of any status under a name that already exists')
  } finally {
    mock.timers.reset()
  }
})

// ─── Killed mid-write: temporary names + sweep (wave1 1B, verifier W3) ─────────

test('dumps and archives are written under a `.partial` name and renamed only with their done row', async () => {
  await run('all')
  assert.equal(state.writeTargets.length, 3)
  for (const target of state.writeTargets) assert.match(path.basename(target), /^cdkt-.*\.partial$/)
  assert.deepEqual(onDisk(), done(), 'after success only the final names remain')
  assert.ok(!onDisk().some(name => name.endsWith('.partial')))
})

test('a commit that fails after the rename leaves neither the final file nor the partial one', async () => {
  state.failCommitFor = /^cdkt-uploads-/
  await assert.rejects(run('files'), /commit failed/)
  assert.deepEqual(onDisk(), [], 'a file without its done row is an orphan')
  assert.match(failed()[0]!.filename, /^cdkt-uploads-/)
})

/** What a SIGKILL mid-run leaves, next to things the sweep must never touch. */
function seedLeftovers() {
  mkdirSync(backupDir(), { recursive: true })
  const files = {
    stale: 'cdkt-media-20261022T030000Z-scheduled.tar.gz.partial',
    staleSql: 'cdkt-20261022T030000Z-scheduled.sql.gz.partial',
    registered: 'cdkt-20261022T030000Z-manual.sql.gz',
    uploadRestore: '.upload-3f1c.partial', // an upload-restore in progress (restore lock, not run lock)
    shellDump: 'cdkt-cdkt_admin-20261022T020000Z-123.sql.gz', // scripts/backup-db.sh, no row
    other: 'notes.partial',
  }
  for (const name of Object.values(files)) writeFileSync(path.join(backupDir(), name), name)
  return files
}

test('a run starts by sweeping partial files left by a killed run — and nothing else', async () => {
  const files = seedLeftovers()
  await run('sql')
  assert.ok(!onDisk().includes(files.stale) && !onDisk().includes(files.staleSql), 'stale partial archives survived')
  for (const keep of [files.registered, files.uploadRestore, files.shellDump, files.other]) assert.ok(onDisk().includes(keep), `${keep} was deleted`)
  assert.ok(logs.some(entry => entry.event === 'backup.partial_swept' && entry.count === 2))
})

test('sweepPartialBackups (startup) deletes only cdkt-*.partial, and only while no backup holds the run lock', async () => {
  const files = seedLeftovers()
  state.lockBusy = true
  assert.equal(await sweepPartialBackups(), 0, 'a running backup owns its partial file')
  assert.ok(onDisk().includes(files.stale))
  state.lockBusy = false
  assert.equal(await sweepPartialBackups(), 2)
  assert.deepEqual(lockNames, ['cdkt:backup:run', 'cdkt:backup:run'])
  assert.deepEqual(onDisk(), [files.uploadRestore, files.registered, files.shellDump, files.other].sort())
})

// ─── The attempt starts inside the lock (scheduler counts it there) ────────────

test('onStarted runs inside the run lock before any work, so a failure before the first file is still an attempt', async () => {
  const started: string[] = []
  state.failConfigRead = true
  await assert.rejects(
    runBackup('all', 'scheduled', null, { rotate: false, archiveSources: sources(), onStarted: async () => { started.push('started') } }),
    /settings read failed/,
  )
  assert.deepEqual(started, ['started'])
})

test('onStarted is not called when another backup holds the lock', async () => {
  const started: string[] = []
  state.lockBusy = true
  await assert.rejects(
    runBackup('all', 'scheduled', null, { rotate: false, archiveSources: sources(), onStarted: async () => { started.push('started') } }),
    (error: unknown) => error instanceof BackupLockBusyError,
  )
  assert.deepEqual(started, [])
})
