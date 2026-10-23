import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  tarCalls: [] as string[],
}

const fakeDb = {
  select: () => ({ from: async () => [] }),
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
    state.rows.push(...pending)
    state.audits += audits
    return result
  },
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => ({ query: async () => [[{ holder: null }], []] }) } })
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_pool: unknown, _name: string, _timeout: number, action: (c: unknown) => Promise<unknown>) =>
      ({ acquired: true, value: await action({}) }),
  },
})
mock.module('../server/services/backup-sql', {
  namedExports: {
    dumpSql: async (target: string) => {
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

const { runBackup } = await import('../server/services/backup')

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
  state.tarCalls = []
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

test('a file that already existed under the failing archive\'s name is not deleted by the cleanup', async () => {
  // Two runs of the same trigger inside one second share a stamp, so a run can
  // write over an earlier run's registered archive (that overwrite predates this
  // change). The cleanup must still only DELETE files this run created: the
  // earlier archive's `done` row must not end up pointing at nothing.
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-23T03:00:00.000Z') })
  try {
    mkdirSync(backupDir(), { recursive: true })
    const earlier = 'cdkt-uploads-20261023T030000Z-manual.tar.gz'
    writeFileSync(path.join(backupDir(), earlier), 'an earlier, registered archive')
    state.failTar = 'uploads'
    await assert.rejects(run('files'), /tar failed on uploads/)
    assert.deepEqual(onDisk(), [earlier], 'the pre-existing archive must not be unlinked')
    assert.equal(failed()[0]?.filename, earlier)
  } finally {
    mock.timers.reset()
  }
})
