import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * The backup scheduler follows its policy (wave1 D10, spec `backup-restore`).
 *
 * The old `isBackupDue` ran a backup whenever the last one was older than 36 h —
 * on any day, at any hour (a weekly policy ran mid-week); read hour 0 as "unset"
 * (`Number('0') || 3`); counted the newest scheduled row whatever its status, so a
 * FAILED run was "done" for the day; and the plugin never started the scheduler
 * unless `BACKUP_SCHEDULER=1`, so the admin switch did nothing in production.
 *
 * Now: the slot is the most recent configured weekday-at-hour ≤ now. A slot is
 * served by a successful scheduled run that started at or after it. Without one:
 * run during the slot's hour; retry a failed attempt after 60 min, at most 3
 * attempts, then abandon the slot (logged once); and catch up a slot missed while
 * the server was down — only if the scheduler was serving slots before it, so
 * turning the switch on mid-week waits for the next configured slot.
 *
 * Every date here is LOCAL wall-clock time (`new Date(y, m, d, h, min)`): the
 * policy is local, so the table passes in any TZ (CI runs Asia/Ho_Chi_Minh).
 */

const db = { touched: 0, settings: [] as Array<{ key: string, value: string }>, runs: [] as Array<{ stamp: string, type: string, status: string }> }
const fakeDb = {
  select: () => {
    db.touched += 1
    return {
      from: (table: unknown) => {
        const rows = table === schema.settings ? db.settings : db.runs
        return Object.assign(Promise.resolve(rows), { where: async () => rows })
      },
    }
  },
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb } })
const backupCalls: Array<unknown[]> = []
let backupOutcome: () => Promise<unknown> = async () => ({})
mock.module('../server/services/backup', {
  namedExports: { runBackup: async (...args: unknown[]) => { backupCalls.push(args); return backupOutcome() } },
})
const logs: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: { logInfo: (e: Record<string, unknown>) => logs.push(e), logWarn: (e: Record<string, unknown>) => logs.push(e), logError: (e: Record<string, unknown>) => logs.push(e) },
})

const schema = await import('../server/db/schema')
const scheduler = await import('../server/services/backup-scheduler')
const { backupSchedulerEnabledByServer } = await import('../server/utils/backup-scheduler-switch')
const {
  isBackupDue, lastSlot, parseBackupHour, parseBackupDays, groupScheduledRuns, parseBackupStamp,
  backupSchedulerTick, startBackupScheduler, stopBackupScheduler,
} = scheduler

beforeEach(() => {
  db.touched = 0
  db.settings = []
  db.runs = []
  backupCalls.length = 0
  backupOutcome = async () => ({})
  logs.length = 0
})

/** 2026-10: the 18th and 25th are Sundays. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)
const stampOf = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const done = (date: Date) => ({ startedAt: date, status: 'done' as const })
const failed = (date: Date) => ({ startedAt: date, status: 'failed' as const })

test('fixture sanity: the 18th and 25th of October 2026 are Sundays', () => {
  assert.equal(at(18, 3).getDay(), 0)
  assert.equal(at(25, 3).getDay(), 0)
})

const SUNDAY_3AM = { enabled: true, hour: 3, days: [0] }
const DAILY_3AM = { enabled: true, hour: 3, days: [] as number[] }
const DAILY_MIDNIGHT = { enabled: true, hour: 0, days: [] as number[] }

const table: Array<{ name: string, policy: { enabled: boolean, hour: number, days: number[] }, now: Date, runs: Array<ReturnType<typeof done>>, run: boolean, reason: string, slot?: Date }> = [
  { name: 'switch off', policy: { ...DAILY_3AM, enabled: false }, now: at(26, 3, 5), runs: [], run: false, reason: 'disabled' },
  // Spec: "Weekly policy does not run mid-week".
  { name: 'weekly Sunday, Monday 15:30 after Sunday 03:05 succeeded', policy: SUNDAY_3AM, now: at(26, 15, 30), runs: [done(at(25, 3, 5))], run: false, reason: 'slot_done', slot: at(25, 3) },
  { name: 'weekly Sunday, Sunday 03:10, last week served', policy: SUNDAY_3AM, now: at(25, 3, 10), runs: [done(at(18, 3, 5))], run: true, reason: 'slot', slot: at(25, 3) },
  { name: 'weekly Sunday, Saturday 23:00: last slot is LAST Sunday, already served', policy: SUNDAY_3AM, now: at(24, 23), runs: [done(at(18, 3, 5))], run: false, reason: 'slot_done', slot: at(18, 3) },
  // Spec: "Midnight is honoured" — hour 0 is a slot at 00:00, not 03:00.
  { name: 'hour 0, 00:05', policy: DAILY_MIDNIGHT, now: at(26, 0, 5), runs: [done(at(25, 0, 2))], run: true, reason: 'slot', slot: at(26, 0) },
  { name: 'hour 0, 02:59 after the 00:02 run', policy: DAILY_MIDNIGHT, now: at(26, 2, 59), runs: [done(at(26, 0, 2))], run: false, reason: 'slot_done', slot: at(26, 0) },
  // Spec: "Failure at 03:00 → a retry starts no earlier than 04:00".
  { name: 'failed at 03:02, 03:40', policy: DAILY_3AM, now: at(26, 3, 40), runs: [failed(at(26, 3, 2))], run: false, reason: 'retry_wait', slot: at(26, 3) },
  { name: 'failed at 03:02, 04:05', policy: DAILY_3AM, now: at(26, 4, 5), runs: [failed(at(26, 3, 2))], run: true, reason: 'retry', slot: at(26, 3) },
  { name: 'failed twice, third attempt', policy: DAILY_3AM, now: at(26, 5, 10), runs: [failed(at(26, 3, 2)), failed(at(26, 4, 5))], run: true, reason: 'retry', slot: at(26, 3) },
  { name: 'three failures: slot abandoned', policy: DAILY_3AM, now: at(26, 6, 30), runs: [failed(at(26, 3, 2)), failed(at(26, 4, 5)), failed(at(26, 5, 10))], run: false, reason: 'slot_abandoned', slot: at(26, 3) },
  { name: 'abandoned yesterday, next slot runs', policy: DAILY_3AM, now: at(27, 3, 5), runs: [failed(at(26, 3, 2)), failed(at(26, 4, 5)), failed(at(26, 5, 10))], run: true, reason: 'slot', slot: at(27, 3) },
  { name: 'a retry that succeeded serves the slot', policy: DAILY_3AM, now: at(26, 9), runs: [failed(at(26, 3, 2)), done(at(26, 4, 5))], run: false, reason: 'slot_done', slot: at(26, 3) },
  // Spec: "Missed slot is caught up once" — down at Sunday 03:00, up at 07:00.
  { name: 'down at the slot, up at 07:00: catch up', policy: SUNDAY_3AM, now: at(25, 7), runs: [done(at(18, 3, 5))], run: true, reason: 'catch_up', slot: at(25, 3) },
  { name: '…and only once', policy: SUNDAY_3AM, now: at(25, 7, 20), runs: [done(at(18, 3, 5)), done(at(25, 7, 2))], run: false, reason: 'slot_done', slot: at(25, 3) },
  { name: '…not again on Monday', policy: SUNDAY_3AM, now: at(26, 15, 30), runs: [done(at(18, 3, 5)), done(at(25, 7, 2))], run: false, reason: 'slot_done', slot: at(25, 3) },
  { name: 'daily, down for three days: catch up the latest slot once', policy: DAILY_3AM, now: at(26, 10), runs: [done(at(23, 3, 4))], run: true, reason: 'catch_up', slot: at(26, 3) },
  // Spec: "Admin enables automatic backups → the next configured slot produces a backup".
  { name: 'switched on Wednesday, weekly Sunday, no history: wait', policy: SUNDAY_3AM, now: at(28, 10), runs: [], run: false, reason: 'outside_slot', slot: at(25, 3) },
  { name: 'switched on at 10:00, daily 03:00, no history: wait for tomorrow', policy: DAILY_3AM, now: at(26, 10), runs: [], run: false, reason: 'outside_slot', slot: at(26, 3) },
  { name: '…and the next slot runs', policy: DAILY_3AM, now: at(27, 3, 7), runs: [], run: true, reason: 'slot', slot: at(27, 3) },
  { name: 'switched back on after a month off: no catch-up, wait for the slot', policy: DAILY_3AM, now: at(26, 10), runs: [done(at(1, 3, 2))], run: false, reason: 'outside_slot', slot: at(26, 3) },
]

for (const row of table) {
  test(`isBackupDue — ${row.name}`, () => {
    const decision = isBackupDue(row.policy, row.now, row.runs)
    assert.equal(decision.run, row.run, `run (${decision.reason})`)
    assert.equal(decision.reason, row.reason)
    if (row.slot) assert.equal(decision.slot?.getTime(), row.slot.getTime(), `slot ${decision.slot?.toString()}`)
  })
}

test('lastSlot: the most recent configured weekday-at-hour that is not after now', () => {
  assert.equal(lastSlot(at(26, 15, 30), [0], 3).getTime(), at(25, 3).getTime())
  assert.equal(lastSlot(at(25, 3), [0], 3).getTime(), at(25, 3).getTime(), 'exactly at the slot')
  assert.equal(lastSlot(at(25, 2, 59), [0], 3).getTime(), at(18, 3).getTime(), 'a minute early: last week')
  assert.equal(lastSlot(at(26, 22), [], 23).getTime(), at(25, 23).getTime(), 'daily, before the hour: yesterday')
  assert.equal(lastSlot(at(26, 0, 0), [], 0).getTime(), at(26, 0).getTime())
  assert.equal(lastSlot(at(28, 12), [1, 5], 9).getTime(), at(26, 9).getTime(), 'Mon+Fri, Wednesday: Monday')
})

test('parseBackupHour: an integer 0..23, 0 included; anything else falls back to 3', () => {
  for (const [raw, hour] of [['0', 0], ['23', 23], [' 7 ', 7], ['3', 3]] as const) assert.equal(parseBackupHour(raw), hour, String(raw))
  for (const raw of ['24', '-1', 'abc', '', '3.5', null, undefined, '1e1']) assert.equal(parseBackupHour(raw), 3, String(raw))
})

test('parseBackupDays: valid weekdays only, deduplicated; unreadable means every day', () => {
  assert.deepEqual(parseBackupDays('[0,6]'), [0, 6])
  assert.deepEqual(parseBackupDays('[7, 1, 1, "2", 2.5]'), [1])
  assert.deepEqual(parseBackupDays('not json'), [])
  assert.deepEqual(parseBackupDays('{"0":1}'), [])
  assert.deepEqual(parseBackupDays(null), [])
})

test('groupScheduledRuns: one run per stamp; done only with a done dump AND a done archive and no failure', () => {
  const stamp = stampOf(at(26, 3, 2))
  const later = stampOf(at(26, 4, 5))
  const interrupted = stampOf(at(26, 5, 10))
  const runs = groupScheduledRuns([
    { stamp, type: 'sql', status: 'done' }, { stamp, type: 'media', status: 'done' }, { stamp, type: 'media', status: 'failed' },
    { stamp: later, type: 'sql', status: 'done' }, { stamp: later, type: 'media', status: 'done' }, { stamp: later, type: 'media', status: 'done' },
    // The container stopped mid-run (deploy during the slot hour): the dump was
    // registered, the archive never was, and no `failed` row was written. That run
    // did not serve the slot — it counts as a failed attempt.
    { stamp: interrupted, type: 'sql', status: 'done' },
    { stamp: 'garbage', type: 'sql', status: 'done' },
  ])
  assert.deepEqual(runs.map(r => [r.startedAt.getTime(), r.status]), [
    [at(26, 3, 2).getTime(), 'failed'], [at(26, 4, 5).getTime(), 'done'], [at(26, 5, 10).getTime(), 'failed'],
  ])
  assert.equal(parseBackupStamp('20261025T200500Z')?.toISOString(), '2026-10-25T20:05:00.000Z')
  assert.equal(parseBackupStamp('2026-10-25'), null)
})

test('server switch: on in production unless BACKUP_SCHEDULER says off; off in development unless it says on', () => {
  for (const off of ['0', 'false', 'OFF', ' no ']) assert.equal(backupSchedulerEnabledByServer(off, 'production'), false, off)
  for (const on of ['1', 'true', 'on', 'YES']) assert.equal(backupSchedulerEnabledByServer(on, 'development'), true, on)
  assert.equal(backupSchedulerEnabledByServer(undefined, 'production'), true)
  assert.equal(backupSchedulerEnabledByServer('', 'production'), true)
  assert.equal(backupSchedulerEnabledByServer(undefined, 'development'), false)
  assert.equal(backupSchedulerEnabledByServer(undefined, undefined), false)
})

test('the plugin boots the scheduler through the shared switch and stops it on close', async () => {
  const { readFileSync } = await import('node:fs')
  const plugin = readFileSync(new URL('../server/plugins/backup-scheduler.ts', import.meta.url), 'utf8')
  assert.match(plugin, /backupSchedulerEnabledByServer\(process\.env\.BACKUP_SCHEDULER, process\.env\.NODE_ENV\)/)
  assert.match(plugin, /nitroApp\.hooks\.hook\('close', stopBackupScheduler\)/)
  const endpoint = readFileSync(new URL('../server/api/admin/settings/backup.get.ts', import.meta.url), 'utf8')
  assert.match(endpoint, /schedulerDisabledByServer: !backupSchedulerEnabledByServer\(process\.env\.BACKUP_SCHEDULER, process\.env\.NODE_ENV\)/)
})

// ─── The tick ─────────────────────────────────────────────────────────────────

/** The `backups` rows of one scheduled "all" run: the dump, then an archive (failed → the archive's failed row). */
const runRows = (date: Date, status: 'done' | 'failed') => [
  { stamp: stampOf(date), type: 'sql', status: 'done' },
  { stamp: stampOf(date), type: 'media', status },
]

const enable = (hour: string, days = '[]') => {
  db.settings = [
    { key: 'backup_auto_enabled', value: 'true' },
    { key: 'backup_auto_hour', value: hour },
    { key: 'backup_auto_days', value: days },
  ]
}

test('tick: hour "0" is read as midnight and the slot runs a scheduled "all" backup', async () => {
  enable('0')
  db.runs = runRows(at(25, 0, 2), 'done')
  await backupSchedulerTick(at(26, 0, 5))
  assert.deepEqual(backupCalls, [['all', 'scheduled', null]])
})

test('tick: a failed attempt is not the slot\'s success, and the third failure is logged as abandoned once', async () => {
  enable('3')
  db.runs = runRows(at(26, 3, 2), 'failed')
  await backupSchedulerTick(at(26, 3, 30))
  assert.equal(backupCalls.length, 0, 'within 60 min of the failure')
  await backupSchedulerTick(at(26, 4, 5))
  assert.equal(backupCalls.length, 1, 'retried after 60 min')

  db.runs.push(...runRows(at(26, 4, 5), 'failed'), ...runRows(at(26, 5, 10), 'failed'))
  await backupSchedulerTick(at(26, 6, 30))
  await backupSchedulerTick(at(26, 6, 45))
  assert.equal(backupCalls.length, 1)
  const abandoned = logs.filter(entry => entry.event === 'backup.slot_abandoned')
  assert.equal(abandoned.length, 1, 'one log line per abandoned slot, not one per tick')
  assert.equal(abandoned[0]!.failures, 3)
})

test('tick: a backup that throws is logged, not thrown', async () => {
  enable('3')
  backupOutcome = async () => { throw new Error('disk full') }
  await backupSchedulerTick(at(26, 3, 5))
  assert.ok(logs.some(entry => entry.event === 'backup.scheduler_failed' && entry.error === 'disk full'))
})

test('stopBackupScheduler clears the 120 s startup tick as well as the interval', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    enable('3')
    startBackupScheduler()
    stopBackupScheduler()
    mock.timers.tick(120_000 + 15 * 60_000 + 1)
    assert.equal(db.touched, 0, 'a tick ran after the scheduler was stopped (shutdown drain)')
  } finally {
    stopBackupScheduler()
    mock.timers.reset()
  }
})
