import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, mock } from 'node:test'
import type { SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { backups, settings } from '../server/db/schema'

/**
 * The public surface of `server/services/backup.ts`, and the behaviour of the public
 * functions no other suite pins (`timestampStamp`, `defaultArchiveSources`,
 * `getBackupStatus`, `listBackups`).
 *
 * Written BEFORE `backup.ts` (733 lines) was split into a barrel plus parts, and green
 * on the original: the split must keep every runtime export and every exported type
 * under the same name, and these functions must behave the same through the barrel.
 * `getBackupStatus` matters most there — it reads state that `runBackup` writes, so the
 * two must keep sharing ONE module-level owner.
 *
 * `runBackup` runs for real on a temp directory; the database, the named lock and
 * `mysqldump` are fakes.
 */

mock.module('../server/utils/logger', {
  namedExports: { logInfo: () => {}, logWarn: () => {}, logError: () => {} },
})

type Row = { id: number, filename: string, type: string, status: string, stamp: string, trigger: string }
const state = {
  rows: [] as Row[],
  nextId: 1,
  /** `IS_USED_LOCK('cdkt:backup:restore')`: a connection id while a restore runs. */
  restoreHolder: null as null | number,
  lockBusy: false,
  failDump: false,
  /** `getBackupStatus()` as seen from inside the dump. */
  seenDuringDump: null as unknown,
  /** Every query `listBackups` builds: projection, where, order, limit, offset. */
  listQueries: [] as Array<{ count: boolean, where: string | null, orderBy: number, limit: number | null, offset: number | null }>,
  countRow: [{ c: 0 }] as Array<{ c: number }>,
}
const dialect = new MySqlDialect()
const compile = (where: SQL) => {
  const { sql, params } = dialect.sqlToQuery(where)
  return `${sql} ${JSON.stringify(params)}`
}

/** A thenable select over `backups`/`settings`: records the shape, answers from `state`. */
function selectFrom(table: unknown, projection: Record<string, unknown> | undefined) {
  const record = { count: Boolean(projection && 'c' in projection), where: null as string | null, orderBy: 0, limit: null as number | null, offset: null as number | null }
  if (table === backups) state.listQueries.push(record)
  let whereSql: SQL | undefined
  const run = async () => {
    if (table === settings) return []
    if (record.count) return state.countRow
    const filename = whereSql ? /`backups`\.`filename` = \?/.test(dialect.sqlToQuery(whereSql).sql) : false
    const rows = filename ? state.rows.filter(row => row.filename === dialect.sqlToQuery(whereSql!).params[0]) : state.rows
    return projection ? rows.map(row => Object.fromEntries(Object.keys(projection).map(key => [key, row[key as keyof Row]]))) : rows
  }
  const query = {
    where: (condition: SQL | undefined) => { whereSql = condition; record.where = condition ? compile(condition) : null; return query },
    orderBy: (...columns: unknown[]) => { record.orderBy = columns.length; return query },
    limit: (n: number) => { record.limit = n; return query },
    offset: (n: number) => { record.offset = n; return query },
    then: (resolve: (rows: unknown) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject),
  }
  return query
}
const fakeDb = {
  select: (projection?: Record<string, unknown>) => ({ from: (table: unknown) => selectFrom(table, projection) }),
  insert: (table: unknown) => ({
    values: async (value: Omit<Row, 'id'>) => { if (table === backups) state.rows.push({ id: state.nextId++, ...value }) },
  }),
  update: () => ({ set: () => ({ where: async () => {} }) }),
  delete: () => ({ where: async () => {} }),
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
    insert: (table: unknown) => ({
      values: async (value: Omit<Row, 'id'>) => { if (table === backups) state.rows.push({ id: state.nextId++, ...value }) },
    }),
  }),
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => fakeDb,
    getPool: () => ({ query: async () => [[{ holder: state.restoreHolder }], []] }),
  },
})
mock.module('../server/utils/named-lock', {
  namedExports: {
    withNamedLock: async (_pool: unknown, _name: string, _timeout: number, action: (c: unknown) => Promise<unknown>) =>
      state.lockBusy ? { acquired: false } : { acquired: true, value: await action({}) },
  },
})
let getStatus: () => unknown = () => null
mock.module('../server/services/backup-sql', {
  namedExports: {
    dumpSql: async (target: string) => {
      state.seenDuringDump = getStatus()
      writeFileSync(target, state.failDump ? 'partial' : 'complete sql dump')
      if (state.failDump) throw new Error('fixture: mysqldump died')
      return 17
    },
  },
})

const backupDir = mkdtempSync(path.join(tmpdir(), 'cdkt-backup-api-'))
process.env.CDKT_BACKUPS_DIR = backupDir
after(() => {
  delete process.env.CDKT_BACKUPS_DIR
  rmSync(backupDir, { recursive: true, force: true })
})

const backup = await import('../server/services/backup')
getStatus = backup.getBackupStatus

// ─── The surface ──────────────────────────────────────────────────────────────
const RUNTIME_EXPORTS = [
  'BACKUP_TRIGGERS', 'BackupDeleteError', 'BackupLockBusyError', 'BackupNameCollisionError',
  'BackupRestoreInProgressError', 'LOCK_RESTORE', 'backupFamilyOf', 'backupsDir',
  'defaultArchiveSources', 'deleteBackup', 'getBackupStatus', 'holdRestoreTarget',
  'isPreRestoreBackup', 'listBackups', 'readBackupConfig', 'restoreTargetsInProgress',
  'rotateOldBackups', 'runBackup', 'selectRotationVictims', 'sweepStaleBackupFiles', 'timestampStamp',
]
const TYPE_ONLY_EXPORTS = ['ArchiveSource', 'BackupResult', 'BackupTrigger', 'BackupType', 'RotationGuards', 'RunBackupOptions', 'RunStatus']

test('the module exports exactly the runtime API callers use — nothing lost, no internal leaked', () => {
  assert.deepEqual(Object.keys(backup).sort(), [...RUNTIME_EXPORTS].sort())
})

test('the module exports exactly these names to the type checker (values and type-only exports)', () => {
  const ts = createRequire(import.meta.url)('typescript') as typeof import('typescript')
  const file = new URL('../server/services/backup.ts', import.meta.url).pathname
  const program = ts.createProgram([file], {
    noEmit: true, allowImportingTsExtensions: true, skipLibCheck: true, types: [],
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022,
  })
  const checker = program.getTypeChecker()
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(file)!)!
  const exported = checker.getExportsOfModule(moduleSymbol).map((symbol) => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return `${symbol.name}:${target.flags & ts.SymbolFlags.Value ? 'value' : 'type'}`
  })
  assert.deepEqual(exported.sort(), [
    ...RUNTIME_EXPORTS.map(name => `${name}:value`),
    ...TYPE_ONLY_EXPORTS.map(name => `${name}:type`),
  ].sort())
})

// ─── Small public helpers ─────────────────────────────────────────────────────
test('timestampStamp() is the current UTC second, compact ISO — never local time', () => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 9, 24, 23, 5, 9, 987) })
  try {
    // The suite runs with TZ=Asia/Ho_Chi_Minh: local time is already 25 Oct 06:05.
    assert.equal(backup.timestampStamp(), '20261024T230509Z')
  } finally {
    mock.timers.reset()
  }
  assert.match(backup.timestampStamp(), /^\d{8}T\d{6}Z$/)
})

test('defaultArchiveSources(): uploads under <cwd>/public, then media under /var/lib/cdkt — a fresh list each call', () => {
  const sources = backup.defaultArchiveSources()
  assert.deepEqual(sources, [
    { tree: 'uploads', parent: path.resolve(process.cwd(), 'public') },
    { tree: 'media', parent: '/var/lib/cdkt' },
  ])
  sources.pop()
  assert.equal(backup.defaultArchiveSources().length, 2, 'a caller editing its copy changed the default')
})

// ─── getBackupStatus: the state runBackup writes ─────────────────────────────
test('getBackupStatus() is idle before any run, follows a run through its phases, and is a copy', async () => {
  assert.deepEqual(backup.getBackupStatus(), { running: false, phase: '', message: '', startedAt: null, progress: undefined })

  const result = await backup.runBackup('sql', 'manual', 1)
  assert.equal(result.files.length, 1)
  const during = state.seenDuringDump as { running: boolean, phase: string, message: string, startedAt: number | null }
  assert.equal(during.running, true)
  assert.equal(during.phase, 'sql')
  assert.equal(during.message, 'Đang dump CSDL')
  assert.equal(typeof during.startedAt, 'number')

  const done = backup.getBackupStatus()
  assert.equal(done.running, false)
  assert.equal(done.phase, 'done')
  assert.equal(done.message, 'Backup xong')

  done.phase = 'tampered'
  done.running = true
  assert.equal(backup.getBackupStatus().phase, 'done', 'the caller mutated the live status')
  assert.equal(backup.getBackupStatus().running, false)
})

test('getBackupStatus() reports a failed dump; a refused run (restore in progress, lock busy) leaves it alone', async () => {
  state.failDump = true
  try {
    await assert.rejects(backup.runBackup('sql', 'pre-sync', 1), /mysqldump died/)
  } finally {
    state.failDump = false
  }
  const failed = backup.getBackupStatus()
  assert.equal(failed.running, false)
  assert.equal(failed.phase, 'failed')
  assert.equal(failed.message, 'Dump SQL thất bại')

  state.restoreHolder = 42
  try {
    await assert.rejects(backup.runBackup('sql', 'pre-repoint', 1), backup.BackupRestoreInProgressError)
  } finally {
    state.restoreHolder = null
  }
  assert.deepEqual(backup.getBackupStatus(), failed, 'a run refused before it started rewrote the status')

  state.lockBusy = true
  try {
    await assert.rejects(backup.runBackup('sql', 'pre-repair-urls', 1), backup.BackupLockBusyError)
  } finally {
    state.lockBusy = false
  }
  assert.deepEqual(backup.getBackupStatus(), failed)
})

// ─── listBackups ──────────────────────────────────────────────────────────────
test('listBackups(): newest id first, page → offset, a type filter on both the page and the count', async () => {
  state.rows = [
    { id: 1, filename: 'a.sql.gz', type: 'sql', status: 'done', stamp: 's1', trigger: 'manual' },
    { id: 2, filename: 'b.tar.gz', type: 'media', status: 'done', stamp: 's2', trigger: 'manual' },
  ]
  state.countRow = [{ c: 57 }]

  state.listQueries = []
  const all = await backup.listBackups(3, 20)
  assert.equal(all.total, 57)
  assert.deepEqual(all.items.map(row => row.id), [1, 2], 'the page rows are returned as read')
  assert.deepEqual(state.listQueries, [
    { count: false, where: null, orderBy: 1, limit: 20, offset: 40 },
    { count: true, where: null, orderBy: 0, limit: null, offset: null },
  ])

  for (const filter of [undefined, 'all']) {
    state.listQueries = []
    await backup.listBackups(1, 10, filter)
    assert.ok(state.listQueries.every(query => query.where === null), `filter ${String(filter)} must not filter`)
    assert.equal(state.listQueries[0]!.offset, 0)
  }

  state.listQueries = []
  await backup.listBackups(2, 5, 'sql')
  assert.deepEqual(state.listQueries.map(query => query.where), [
    '`backups`.`type` = ? ["sql"]',
    '`backups`.`type` = ? ["sql"]',
  ])
  assert.equal(state.listQueries[0]!.offset, 5)

  state.countRow = []
  assert.equal((await backup.listBackups(1, 10)).total, 0, 'no count row reads as zero, not undefined')
})
