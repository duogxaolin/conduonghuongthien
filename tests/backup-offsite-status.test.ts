import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before, beforeEach, mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { activityLogs, backups, settings } from '../server/db/schema'

/**
 * Spec `backup-restore` (wave2 D-OFFSITE): "Scheduled backups reach an off-VPS
 * destination when one is configured". Every backup file now carries
 * `offsite_status`:
 *   - `uploaded` — the Drive upload of THIS file succeeded;
 *   - `failed`   — an off-site copy was expected (Drive on and configured) but this
 *                  file has none: the upload threw, or the run died before Drive;
 *   - `none`     — no off-site destination is configured (Drive off, or on with
 *                  neither an OAuth link nor a service account).
 * A Drive failure never deletes the local file and never fails the run.
 *
 * Before: the Drive phase only flipped `drive_uploaded` on success. A failure was a
 * log line and a toast, and the list showed the same empty circle for "Drive is
 * off" and "Drive failed last night" — the backup page could not tell an operator
 * that the off-site copy was missing.
 *
 * Runs the real `runBackup` on real files in a temp directory; `tar`, `mysqldump`,
 * the database, the named lock and the three Drive modules are fakes.
 */

const logs: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: { logInfo: (e: Record<string, unknown>) => logs.push(e), logWarn: (e: Record<string, unknown>) => logs.push(e), logError: (e: Record<string, unknown>) => logs.push(e) },
})

type Row = {
  id: number, filename: string, type: string, status: string, stamp: string, trigger: string,
  offsiteStatus?: string | null, driveUploaded?: boolean, driveFileId?: string | null, error?: string | null,
}
const state = {
  rows: [] as Row[],
  nextId: 1,
  settings: [] as Array<{ key: string, value: string }>,
  /** OAuth link state returned by the fake `getUsableDriveLink`. */
  link: { ok: false, reason: 'not_linked' } as { ok: true, refreshToken: string } | { ok: false, reason: 'not_linked' | 'secret_unreadable' },
  oauthConfig: { ok: true, clientId: 'cid', clientSecret: 'csecret' } as { ok: true, clientId: string, clientSecret: string } | { ok: false, reason: 'disabled' | 'not_configured' | 'secret_unreadable' },
  /** File names whose Drive upload throws. */
  failUploadFor: null as null | RegExp,
  /** Every `db.update(backups)` throws (a DB blip after the run is registered). */
  failUpdates: false,
  failTar: null as null | 'uploads' | 'media',
  uploads: [] as Array<{ mode: 'oauth' | 'service-account', name: string }>,
}

const dialect = new MySqlDialect()
/** Evaluates the WHERE shapes the backup services build: `col = ?` and `col in (?, …)`. */
function matches(row: Row, where: SQL | undefined): boolean {
  if (!where) return true
  const { sql, params } = dialect.sqlToQuery(where)
  const eq = /`backups`\.`(filename|id|status)` = \?$/.exec(sql)
  if (eq) return row[eq[1] as keyof Row] === params[0]
  const inList = /`backups`\.`(filename)` in \((\?(?:, \?)*)\)$/.exec(sql)
  if (inList) return params.includes(row[inList[1] as keyof Row])
  assert.fail(`fake db cannot evaluate: ${sql}`)
}
const COLUMN_OF: Record<string, keyof Row> = { offsiteStatus: 'offsiteStatus', driveUploaded: 'driveUploaded', driveFileId: 'driveFileId' }
function selectBackups(projection: Record<string, unknown> | undefined) {
  let where: SQL | undefined
  const run = async () => {
    const rows = state.rows.filter(row => matches(row, where))
    return projection ? rows.map(row => Object.fromEntries(Object.keys(projection).map(key => [key, row[key as keyof Row]]))) : rows
  }
  const query = {
    where: (condition: SQL) => { where = condition; return query },
    orderBy: () => query,
    limit: () => query,
    then: (resolve: (rows: unknown[]) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject),
  }
  return query
}
const fakeDb = {
  select: (projection?: Record<string, unknown>) => ({
    from: (table: unknown) => {
      if (table === backups) return selectBackups(projection)
      if (table === settings) return Promise.resolve(state.settings)
      return Promise.resolve([])
    },
  }),
  insert: (table: unknown) => ({
    values: async (value: Omit<Row, 'id'>) => {
      assert.equal(table, backups)
      state.rows.push({ id: state.nextId++, ...value })
    },
  }),
  update: (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: async (condition: SQL) => {
        assert.equal(table, backups)
        for (const key of Object.keys(values)) assert.ok(key in COLUMN_OF, `unexpected column update: ${key}`)
        if (state.failUpdates) throw new Error('fixture: update failed')
        for (const row of state.rows) if (matches(row, condition)) Object.assign(row, values)
      },
    }),
  }),
  delete: () => ({ where: async () => {} }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const pending: Row[] = []
    const tx = {
      insert: (table: unknown) => ({
        values: async (value: Omit<Row, 'id'>) => {
          if (table === backups) pending.push({ id: state.nextId++, ...value })
          else assert.equal(table, activityLogs)
        },
      }),
    }
    const result = await fn(tx)
    state.rows.push(...pending)
    return result
  },
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => ({ query: async () => [[{ holder: null }], []] }) } })
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_pool: unknown, _name: string, _timeout: number, action: (c: unknown) => Promise<unknown>) => ({ acquired: true, value: await action({}) }),
  },
})
mock.module('../server/services/backup-sql', {
  namedExports: { dumpSql: async (target: string) => { writeFileSync(target, 'complete sql dump'); return 17 } },
})
mock.module('node:child_process', {
  namedExports: {
    execFile: (_file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout?: string) => void) => {
      const [, target, , , tree] = args as [string, string, string, string, 'uploads' | 'media']
      writeFileSync(target!, `archive of ${tree}`)
      setImmediate(() => callback(state.failTar === tree ? new Error(`fixture: tar failed on ${tree}`) : null, ''))
    },
  },
})
mock.module('../server/services/backup-drive-oauth', {
  namedExports: { getUsableDriveLink: async () => state.link },
})
mock.module('../server/services/backup-drive-oauth-config', {
  namedExports: { getUsableDriveOauthConfig: async () => state.oauthConfig },
})
const upload = (mode: 'oauth' | 'service-account') => async (filePath: string, name: string) => {
  assert.ok(existsSync(filePath), 'the upload reads the registered local file')
  state.uploads.push({ mode, name })
  if (state.failUploadFor?.test(name)) throw new Error('fixture: Drive quota exceeded')
  return `drive-${name}`
}
mock.module('../server/services/backup-drive', {
  namedExports: { uploadBackupToDrive: upload('service-account'), uploadBackupToDriveOAuth: upload('oauth') },
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
  workdir = mkdtempSync(path.join(tmpdir(), 'cdkt-backup-offsite-'))
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
  state.nextId = 1
  state.settings = []
  state.link = { ok: false, reason: 'not_linked' }
  state.oauthConfig = { ok: true, clientId: 'cid', clientSecret: 'csecret' }
  state.failUploadFor = null
  state.failUpdates = false
  state.failTar = null
  state.uploads = []
  logs.length = 0
})

const SERVICE_ACCOUNT = '{"type":"service_account","client_email":"backup@corp.iam"}'
const driveOn = (serviceAccount = SERVICE_ACCOUNT) => {
  state.settings = [
    { key: 'backup_drive_enabled', value: 'true' },
    { key: 'backup_drive_service_account', value: serviceAccount },
  ]
}
const scheduled = (type: 'sql' | 'files' | 'all' = 'all') => runBackup(type, 'scheduled', null, { rotate: false, archiveSources: sources() })
const done = () => state.rows.filter(row => row.status === 'done')
const statusOf = (pattern: RegExp) => done().find(row => pattern.test(row.filename))?.offsiteStatus
const events = (name: string) => logs.filter(entry => entry.event === name)

test('spec: a scheduled backup whose Drive upload fails is listed with off-site status failed, and the local file remains', async () => {
  driveOn()
  state.failUploadFor = /./
  const result = await scheduled('sql')

  assert.equal(done().length, 1)
  assert.equal(done()[0]!.offsiteStatus, 'failed')
  assert.equal(done()[0]!.driveUploaded ?? false, false)
  assert.deepEqual(onDisk(), [done()[0]!.filename], 'the local copy is kept')
  assert.equal(readFileSync(path.join(backupDir(), done()[0]!.filename), 'utf8'), 'complete sql dump')
  assert.equal(result.driveUploaded, false)
  assert.match(String(result.driveError), /quota exceeded/)
  const failure = events('backup.drive_failed')
  assert.equal(failure.length, 1, 'the Drive failure is logged once')
  assert.match(String(failure[0]!.error), /quota exceeded/)
  assert.deepEqual(failure[0]!.files, [done()[0]!.filename], 'the log names the files left without an off-site copy')
})

test('a successful Drive upload marks every file of the run uploaded', async () => {
  driveOn()
  const result = await scheduled('all')
  assert.equal(done().length, 3)
  for (const row of done()) {
    assert.equal(row.offsiteStatus, 'uploaded', row.filename)
    assert.equal(row.driveUploaded, true)
    assert.equal(row.driveFileId, `drive-${row.filename}`)
  }
  assert.equal(result.driveUploaded, true)
  assert.deepEqual(state.uploads.map(entry => entry.mode), ['service-account', 'service-account', 'service-account'])
})

test('status is per file: an upload that fails half-way leaves the earlier files uploaded and the rest failed', async () => {
  driveOn()
  state.failUploadFor = /^cdkt-uploads-/
  const result = await scheduled('all')

  assert.equal(statusOf(/\.sql\.gz$/), 'uploaded')
  assert.equal(statusOf(/^cdkt-uploads-/), 'failed')
  assert.equal(statusOf(/^cdkt-media-/), 'failed', 'a file the loop never reached has no off-site copy either')
  assert.equal(result.driveUploaded, false, 'the run is only "uploaded" when every file is')
  assert.equal(onDisk().length, 3, 'no local file is deleted')
})

test('Drive switched off: every file is marked none and Drive is never contacted', async () => {
  state.settings = [{ key: 'backup_drive_enabled', value: 'false' }, { key: 'backup_drive_service_account', value: SERVICE_ACCOUNT }]
  await scheduled('all')
  assert.equal(done().length, 3)
  for (const row of done()) assert.equal(row.offsiteStatus, 'none', row.filename)
  assert.deepEqual(state.uploads, [])
})

test('Drive switched on but neither linked nor given a service account: none, and the misconfiguration is logged', async () => {
  driveOn('')
  await scheduled('sql')
  assert.equal(done()[0]!.offsiteStatus, 'none')
  assert.deepEqual(state.uploads, [])
  assert.equal(events('backup.offsite_not_configured').length, 1)
  assert.equal(events('backup.drive_failed').length, 0, 'not configured is not a Drive failure')
})

test('an OAuth link whose token cannot be decrypted is a failure, not "not configured"', async () => {
  driveOn('')
  state.link = { ok: false, reason: 'secret_unreadable' }
  await scheduled('sql')
  assert.equal(done()[0]!.offsiteStatus, 'failed')
  assert.equal(events('backup.drive_failed').length, 1)
})

test('the OAuth link is preferred over the service account, and its upload marks the file uploaded', async () => {
  driveOn()
  state.link = { ok: true, refreshToken: 'rt' }
  await scheduled('sql')
  assert.equal(done()[0]!.offsiteStatus, 'uploaded')
  assert.deepEqual(state.uploads.map(entry => entry.mode), ['oauth'])
})

test('a linked account with an unusable OAuth client config fails every file', async () => {
  driveOn()
  state.link = { ok: true, refreshToken: 'rt' }
  state.oauthConfig = { ok: false, reason: 'disabled' }
  await scheduled('sql')
  assert.equal(done()[0]!.offsiteStatus, 'failed')
  assert.deepEqual(state.uploads, [])
})

test('a status write that fails is logged and does not turn a registered backup into a failed run', async () => {
  driveOn()
  state.failUpdates = true
  const result = await scheduled('sql')
  assert.equal(result.files.length, 1)
  assert.equal(done().length, 1, 'the done row stays')
  assert.ok(events('backup.offsite_status_unwritten').length >= 1)
})

test('a run that dies before the Drive phase marks the files it already registered failed — and still reports its own error', async () => {
  driveOn()
  state.failTar = 'media'
  await assert.rejects(scheduled('all'), /tar failed on media/)
  assert.equal(statusOf(/\.sql\.gz$/), 'failed')
  assert.equal(statusOf(/^cdkt-uploads-/), 'failed')
  assert.deepEqual(state.uploads, [], 'the Drive phase never ran')
})

test('…and with Drive off, those registered files stay none', async () => {
  state.failTar = 'media'
  await assert.rejects(scheduled('all'), /tar failed on media/)
  assert.equal(statusOf(/\.sql\.gz$/), 'none')
  assert.equal(statusOf(/^cdkt-uploads-/), 'none')
})

test('a backup that failed itself has no off-site status at all', async () => {
  driveOn()
  state.failTar = 'uploads'
  await assert.rejects(scheduled('files'), /tar failed on uploads/)
  const failedRow = state.rows.find(row => row.status === 'failed')
  assert.ok(failedRow)
  assert.equal(failedRow.offsiteStatus ?? null, null)
})
