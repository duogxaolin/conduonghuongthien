import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before, beforeEach, mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
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

type Row = { id: number, filename: string, type: string, status: string, stamp: string, trigger: string, error?: string | null }
const state = {
  rows: [] as Row[],
  nextId: 1,
  /** The rotation's read of `done` rows fails (a transient DB error after the run is registered). */
  failRotationSelect: false,
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
  /** `IS_USED_LOCK('cdkt:backup:restore')`: a connection id while a restore runs, null when free. */
  restoreHolder: null as null | number,
  /** Asking MySQL about the restore lock fails. */
  failRestoreLockQuery: false,
  tarCalls: [] as string[],
  /** Every path `mysqldump`/`tar` was asked to write. */
  writeTargets: [] as string[],
}

/**
 * `backups` WHERE clauses the service builds, compiled with the real MySQL dialect and
 * evaluated here: `filename = ?`, `id = ?`, `status = ?` (the shapes `backup.ts` uses).
 */
const dialect = new MySqlDialect()
function matches(row: Row, where: SQL | undefined): boolean {
  if (!where) return true
  const { sql, params } = dialect.sqlToQuery(where)
  const column = /`backups`\.`(filename|id|status)` = \?$/.exec(sql)?.[1] as keyof Row | undefined
  assert.ok(column, `fake db cannot evaluate: ${sql}`)
  return row[column] === params[0]
}
function selectBackups(projection: Record<string, unknown> | undefined) {
  let where: SQL | undefined
  let ordered = false
  const run = async () => {
    if (state.failRotationSelect && ordered) throw new Error('fixture: connection reset during rotation')
    const rows = state.rows.filter(row => matches(row, where))
    return projection ? rows.map(row => Object.fromEntries(Object.keys(projection).map(key => [key, row[key as keyof Row]]))) : rows
  }
  const query = {
    where: (condition: SQL) => { where = condition; return query },
    orderBy: () => { ordered = true; return query },
    limit: () => query,
    then: (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject),
  }
  return query
}
const deleteFrom = (table: unknown) => ({
  where: async (condition: SQL) => {
    assert.equal(table, backups)
    state.rows = state.rows.filter(row => !matches(row, condition))
  },
})
const fakeDb = {
  select: (projection?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (table === backups) return selectBackups(projection)
      if (state.failConfigRead) return Promise.reject(new Error('fixture: settings read failed'))
      return Promise.resolve([])
    },
  }),
  insert: (table: unknown) => ({
    values: async (value: Omit<Row, 'id'>) => {
      assert.equal(table, backups, 'only the failed row is written outside a transaction')
      state.rows.push({ id: state.nextId++, ...value })
    },
  }),
  delete: deleteFrom,
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const pending: Row[] = []
    const deletes: SQL[] = []
    let audits = 0
    const tx = {
      insert: (table: unknown) => ({
        values: async (value: Omit<Row, 'id'>) => {
          if (table === backups) {
            if (state.failDoneRowFor?.test(value.filename)) throw new Error('fixture: done row insert failed')
            pending.push({ id: state.nextId++, ...value })
          } else if (table === activityLogs) audits += 1
        },
      }),
      delete: (table: unknown) => ({ where: async (condition: SQL) => { assert.equal(table, backups); deletes.push(condition) } }),
    }
    const result = await fn(tx)
    if (pending.some(row => state.failCommitFor?.test(row.filename))) throw new Error('fixture: commit failed')
    state.rows.push(...pending)
    for (const condition of deletes) state.rows = state.rows.filter(row => !matches(row, condition))
    state.audits += audits
    return result
  },
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => fakeDb,
    getPool: () => ({
      query: async () => {
        if (state.failRestoreLockQuery) throw new Error('fixture: lost connection')
        return [[{ holder: state.restoreHolder }], []]
      },
    }),
  },
})
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

const { runBackup, sweepStaleBackupFiles, deleteBackup, BackupLockBusyError, BackupDeleteError } = await import('../server/services/backup')

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
  state.failRotationSelect = false
  state.nextId = 1
  state.lockBusy = false
  state.restoreHolder = null
  state.failRestoreLockQuery = false
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
    // scripts/backup-db.sh (nightly cron via backup.sh) writes into the SAME ./backups
    // directory as `<name>.partial` and renames it when verified. The app's run lock
    // says nothing about that script, so its partial may be a dump IN PROGRESS.
    shellPartial: 'cdkt-cdkt_admin-20261022T020000Z-4242.sql.gz.partial',
    // Same family names as the app's archives, but written by scripts/backup-media.sh (`-<pid>`).
    shellMediaLike: 'cdkt-media-20261022T020000Z-4243.tar.gz.partial',
    other: 'notes.partial',
  }
  for (const name of Object.values(files)) writeFileSync(path.join(backupDir(), name), name)
  // "registered" means it has a row.
  state.rows.push({ id: state.nextId++, filename: files.registered, type: 'sql', status: 'done', stamp: '20261022T030000Z', trigger: 'manual' })
  return files
}
const untouchable = (files: ReturnType<typeof seedLeftovers>) =>
  [files.registered, files.uploadRestore, files.shellDump, files.shellPartial, files.shellMediaLike, files.other]

test('a run starts by sweeping partial files left by a killed run — and nothing else', async () => {
  const files = seedLeftovers()
  await run('sql')
  assert.ok(!onDisk().includes(files.stale) && !onDisk().includes(files.staleSql), 'stale partial archives survived')
  for (const keep of untouchable(files)) assert.ok(onDisk().includes(keep), `${keep} was deleted`)
  assert.ok(logs.some(entry => entry.event === 'backup.partial_swept' && entry.count === 2))
})

test('sweepStaleBackupFiles (startup) deletes only the app\'s own partial names, and only while no backup holds the run lock', async () => {
  const files = seedLeftovers()
  state.lockBusy = true
  assert.equal(await sweepStaleBackupFiles(), 0, 'a running backup owns its partial file')
  assert.ok(onDisk().includes(files.stale))
  state.lockBusy = false
  assert.equal(await sweepStaleBackupFiles(), 2)
  assert.deepEqual(lockNames, ['cdkt:backup:run', 'cdkt:backup:run'])
  assert.deepEqual(onDisk(), untouchable(files).sort())
})

test('the sweep pattern matches every name runBackup writes, for every trigger', async () => {
  const { BACKUP_TRIGGERS } = await import('../server/services/backup')
  mkdirSync(backupDir(), { recursive: true })
  const names = BACKUP_TRIGGERS.flatMap(trigger => [
    `cdkt-20261022T030000Z-${trigger}.sql.gz.partial`,
    `cdkt-uploads-20261022T030000Z-${trigger}.tar.gz.partial`,
    `cdkt-media-20261022T030000Z-${trigger}.tar.gz.partial`,
  ])
  for (const name of names) writeFileSync(path.join(backupDir(), name), name)
  assert.equal(await sweepStaleBackupFiles(), names.length)
  assert.deepEqual(onDisk(), [])
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

// ─── Re-verification (W2, W3, S1) ─────────────────────────────────────────────

test('W2: a failed run keeps its name taken — a same-second run of the same trigger is refused, not a second row', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T03:00:00.000Z') })
  try {
    state.failDump = true
    await assert.rejects(run('sql'), /mysqldump died/)
    const name = 'cdkt-20261024T030000Z-manual.sql.gz'
    assert.deepEqual(state.rows.map(row => [row.filename, row.status]), [[name, 'failed']])
    assert.deepEqual(onDisk(), [], 'the failed dump is gone, so the disk alone says the name is free')

    state.failDump = false
    await assert.rejects(run('sql'), /đã tồn tại/)
    assert.equal(state.rows.filter(row => row.filename === name).length, 1, 'two rows with one filename: deleting one would delete the other\'s file')
    assert.equal(state.writeTargets.length, 1, 'the refused run wrote nothing')
  } finally {
    mock.timers.reset()
  }
})

/** Two rows sharing one filename (legacy data, before W2): a failed one and a done one. */
function seedDuplicateRows() {
  mkdirSync(backupDir(), { recursive: true })
  const name = 'cdkt-20261024T030000Z-manual.sql.gz'
  writeFileSync(path.join(backupDir(), name), 'the good dump')
  state.rows.push(
    { id: 11, filename: name, type: 'sql', status: 'failed', stamp: '20261024T030000Z', trigger: 'manual' },
    { id: 12, filename: name, type: 'sql', status: 'done', stamp: '20261024T030000Z', trigger: 'manual' },
  )
  return name
}

test('W2: deleting a row by id removes only that row, and the file only when no other row still references it', async () => {
  const name = seedDuplicateRows()
  await deleteBackup(name, 1, 11)
  assert.deepEqual(state.rows.map(row => row.id), [12], 'only the failed row is gone')
  assert.deepEqual(onDisk(), [name], 'the done row still references the file')
  assert.equal(state.audits, 1)
  await deleteBackup(name, 1, 12)
  assert.deepEqual(state.rows, [])
  assert.deepEqual(onDisk(), [])
})

test('W2: without an id, one row is deleted as before; two rows sharing the name are a 409; a wrong id is a 404', async () => {
  const name = seedDuplicateRows()
  const statusOf = async (promise: Promise<unknown>) => {
    try { await promise; return null } catch (error) { assert.ok(error instanceof BackupDeleteError, String(error)); return error.statusCode }
  }
  assert.equal(await statusOf(deleteBackup(name, 1)), 409)
  assert.equal(await statusOf(deleteBackup(name, 1, 99)), 404)
  assert.equal(await statusOf(deleteBackup('cdkt-20261001T000000Z-manual.sql.gz', 1, 11)), 404, 'the id must belong to that filename')
  assert.equal(state.rows.length, 2, 'nothing deleted by a refused request')
  state.rows = state.rows.filter(row => row.id === 12)
  await deleteBackup(name, 1)
  assert.deepEqual(state.rows, [])
  assert.deepEqual(onDisk(), [])
})

test('W3: final-named app backups with no row (killed between rename and commit) are swept under the run lock — nothing else is', async () => {
  const files = seedLeftovers()
  const old = new Date(Date.now() - 60 * 60 * 1000)
  const orphan = 'cdkt-uploads-20261022T030000Z-scheduled.tar.gz'
  const fresh = 'cdkt-media-20261024T030000Z-manual.tar.gz' // just renamed: an upload-restore inserts its row right after
  const shellArchive = 'cdkt-media-20261022T020000Z-4243.tar.gz' // scripts/backup-media.sh, never has a row
  for (const name of [orphan, fresh, shellArchive]) writeFileSync(path.join(backupDir(), name), name)
  for (const name of [orphan, shellArchive, files.registered, files.shellDump]) utimesSync(path.join(backupDir(), name), old, old)

  assert.equal(await sweepStaleBackupFiles(), 3, 'two partials + one unregistered final archive')
  assert.ok(!onDisk().includes(orphan), 'the unregistered app archive survived')
  for (const keep of [...untouchable(files), fresh, shellArchive]) assert.ok(onDisk().includes(keep), `${keep} was deleted`)
  assert.ok(logs.some(entry => entry.event === 'backup.orphan_swept' && entry.filename === orphan))
})

test('W3: when the rows cannot be read, no final file is deleted', async () => {
  const orphan = 'cdkt-uploads-20261022T030000Z-scheduled.tar.gz'
  mkdirSync(backupDir(), { recursive: true })
  writeFileSync(path.join(backupDir(), orphan), orphan)
  const old = new Date(Date.now() - 60 * 60 * 1000)
  utimesSync(path.join(backupDir(), orphan), old, old)
  const original = fakeDb.select
  fakeDb.select = ((projection?: Record<string, unknown>) => ({
    from: (table: unknown) => (table === backups ? Promise.reject(new Error('fixture: db down')) : original(projection).from(table)),
  })) as typeof fakeDb.select
  try {
    assert.equal(await sweepStaleBackupFiles(), 0)
  } finally {
    fakeDb.select = original
  }
  assert.deepEqual(onDisk(), [orphan])
})

// ─── A restore rewinds the registry (wave2 ops re-verification round 2) ────────
// A database restore replaces `backups` with the dump's copy. If that restore fails
// before the live rows are put back, every file registered since the dump looks like
// an orphan to a registry that is "well shaped" — and the sweep deleted the
// pre-restore dump and the newer backups. Three rules, each enough on its own for the
// case it covers:
//  - a pre-restore dump is never an orphan (rotation already never deletes one);
//  - an unregistered app file whose stamp is not after the newest pre-restore dump
//    predates the last restore attempt: it may be unregistered only because the
//    registry was rewound, so it is kept (only a killed run's leftover is lost to the
//    sweep, and only until that pre-restore dump is deleted);
//  - while a restore holds its lock (or that cannot be asked), no final file goes.

const aged = (...names: string[]) => {
  mkdirSync(backupDir(), { recursive: true })
  const old = new Date(Date.now() - 60 * 60 * 1000)
  for (const name of names) {
    writeFileSync(path.join(backupDir(), name), name)
    utimesSync(path.join(backupDir(), name), old, old)
  }
}

test('the sweep never deletes a pre-restore dump, registered or not', async () => {
  const pre = 'cdkt-20261020T030000Z-pre-restore.sql.gz'
  const preMedia = 'cdkt-media-20261020T030000Z-pre-restore.tar.gz'
  aged(pre, preMedia)
  assert.equal(await sweepStaleBackupFiles(), 0)
  assert.deepEqual(onDisk(), [preMedia, pre].sort())
})

test('unregistered app files from before the newest restore attempt are kept; a killed run after it is still swept', async () => {
  const pre = 'cdkt-20261020T030000Z-pre-restore.sql.gz'
  const before = 'cdkt-20261019T030000Z-manual.sql.gz'      // registered before the restore, rewound away
  const sameSecond = 'cdkt-uploads-20261020T030000Z-scheduled.tar.gz'
  const after = 'cdkt-media-20261021T030000Z-manual.tar.gz'  // a run killed after the restore attempt
  aged(pre, before, sameSecond, after)
  assert.equal(await sweepStaleBackupFiles(), 1)
  assert.deepEqual(onDisk(), [sameSecond, before, pre].sort())
  assert.ok(logs.some(entry => entry.event === 'backup.orphan_swept' && entry.filename === after))
  assert.ok(logs.some(entry => entry.event === 'backup.orphan_kept_restore_window' && entry.count === 2))
})

test('while a restore holds its lock — or the lock cannot be asked — no final file is swept; partials still are', async () => {
  const orphan = 'cdkt-uploads-20261022T030000Z-scheduled.tar.gz'
  const partial = 'cdkt-20261022T030000Z-manual.sql.gz.partial'
  for (const setup of [() => { state.restoreHolder = 42 }, () => { state.failRestoreLockQuery = true }]) {
    rmSync(backupDir(), { recursive: true, force: true })
    state.restoreHolder = null
    state.failRestoreLockQuery = false
    setup()
    aged(orphan, partial)
    assert.equal(await sweepStaleBackupFiles(), 1, 'only the partial')
    assert.deepEqual(onDisk(), [orphan])
  }
  assert.ok(logs.some(entry => entry.event === 'backup.orphan_sweep_skipped' && entry.reason === 'restore_in_progress'))
})

// ─── No backup while a restore runs (wave2 ops round 3, W2) ───────────────────
// A backup that finished DURING a database restore was not in the restore's list of
// live rows and its stamp was after the newest pre-restore dump: the restore rewound
// the registry under it, nothing put its row back, and the sweep deleted it. Now a
// backup refuses to start while the restore lock is held — except the restore's own
// pre-restore run.

test('runBackup refuses while a restore holds its lock — typed, busy, nothing written, onStarted not called', async () => {
  const { BackupRestoreInProgressError } = await import('../server/services/backup')
  state.restoreHolder = 42
  let started = false
  const error = await runBackup('sql', 'manual', 1, { rotate: false, archiveSources: sources(), onStarted: async () => { started = true } }).catch((err: unknown) => err)
  assert.ok(error instanceof BackupRestoreInProgressError, String(error))
  assert.ok(error instanceof BackupLockBusyError, 'callers that treat "busy" as 409 / not-an-attempt keep doing so')
  assert.match((error as Error).message, /khôi phục/)
  assert.equal(started, false, 'the scheduler must not count it as an attempt')
  assert.deepEqual(onDisk(), [])
  assert.deepEqual(state.rows, [])
})

test('…unless the lock state cannot be read (refused too), and the restore\'s own pre-restore run always proceeds', async () => {
  const { BackupRestoreInProgressError } = await import('../server/services/backup')
  state.failRestoreLockQuery = true
  await assert.rejects(run('sql'), (err: unknown) => err instanceof BackupRestoreInProgressError)
  state.failRestoreLockQuery = false
  state.restoreHolder = 42
  const own = await runBackup('sql', 'pre-restore', 1, { rotate: false, archiveSources: sources(), allowDuringRestore: true })
  assert.equal(own.files.length, 1)
  assert.match(own.files[0]!.name, /-pre-restore\.sql\.gz$/)
})

test('S1: a rotation error after the backup is registered is logged, not a failed run', async () => {
  state.failRotationSelect = true
  const result = await runBackup('sql', 'scheduled', null, { archiveSources: sources() })
  assert.equal(result.files.length, 1)
  assert.deepEqual(state.rows.map(row => row.status), ['done'])
  assert.ok(logs.some(entry => entry.event === 'backup.rotate_failed' && /connection reset/.test(String(entry.error))))
})
