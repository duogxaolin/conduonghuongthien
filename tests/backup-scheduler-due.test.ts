import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'
import { readFileSync } from 'node:fs'

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
 * The decision reads ONE durable record, the settings key `backup_scheduler_state`,
 * never the `backups` rows: rotation deletes those rows across every trigger (a
 * few manual backups were enough to delete this week's scheduled SQL row), and a
 * slot whose evidence was rotated away looked failed — a full backup mid-week,
 * repeated until a false "abandoned". The scheduler writes the record when an
 * attempt STARTS (inside the backup lock, before any work — so a failure before
 * the first file still counts, and a lock-busy refusal does not) and when it ends.
 *
 * Every date here is LOCAL wall-clock time (`new Date(y, m, d, h, min)`): the
 * policy is local, so the table passes in any TZ (CI runs Asia/Ho_Chi_Minh).
 */

type BackupRow = { id: number, filename: string, type: string, stamp: string, status: string, trigger: string }
const db = {
  touched: 0,
  settings: new Map<string, string>(),
  backups: [] as BackupRow[],
}
const fakeDb = {
  select: () => {
    db.touched += 1
    return {
      from: (table: unknown) => {
        if (table === schema.settings) {
          const rows = [...db.settings].map(([key, value]) => ({ key, value }))
          return Object.assign(Promise.resolve(rows), { where: async () => rows })
        }
        // The `backups` table: only scheduled rows, as the e0dbaca loader asked for.
        const rows = db.backups.filter(row => row.trigger === 'scheduled')
        return Object.assign(Promise.resolve(rows), { where: async () => rows })
      },
    }
  },
  insert: (table: unknown) => ({
    values: (value: { key: string, value: string }) => ({
      onDuplicateKeyUpdate: async ({ set }: { set: { value?: string } }) => {
        assert.equal(table, schema.settings)
        db.settings.set(value.key, String(set.value ?? value.value))
      },
    }),
  }),
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => null } })
const logs: Array<Record<string, unknown>> = []
/** The level each record was logged at (only `logWarn`+ reaches the ops alert list). */
const levels = new WeakMap<Record<string, unknown>, 'info' | 'warn' | 'error'>()
const logAt = (level: 'info' | 'warn' | 'error') => (e: Record<string, unknown>) => { levels.set(e, level); logs.push(e) }
mock.module('../server/utils/logger', {
  namedExports: { logInfo: logAt('info'), logWarn: logAt('warn'), logError: logAt('error') },
})

// The REAL rotation selection, loaded before `runBackup` is replaced for the scheduler.
const realBackup = await import('../server/services/backup')

type RunOptions = { onStarted?: () => Promise<void> }
const sweeps = { count: 0 }
const backupCalls: Array<unknown[]> = []
/** The time the fake backup "runs" at — the stamp of the rows it writes. */
let clock = new Date(0)
let nextId = 1
const stampOf = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
/** Rows a real `runBackup('all', trigger)` leaves behind: the dump and two archives. */
function writeRunRows(date: Date, trigger: string, kinds: Array<'sql' | 'uploads' | 'media'> = ['sql', 'uploads', 'media']) {
  for (const kind of kinds) {
    db.backups.push({
      id: nextId++, stamp: stampOf(date), status: 'done', trigger,
      type: kind === 'sql' ? 'sql' : 'media',
      filename: kind === 'sql' ? `cdkt-${stampOf(date)}-${trigger}.sql.gz` : `cdkt-${kind}-${stampOf(date)}-${trigger}.tar.gz`,
    })
  }
}
/** How the fake backup ends; default: starts (lock acquired), writes its rows, succeeds. */
let backupOutcome: (options: RunOptions) => Promise<unknown> = async (options) => {
  await options.onStarted?.()
  writeRunRows(clock, 'scheduled')
  return {}
}
mock.module('../server/services/backup', {
  namedExports: {
    runBackup: async (...args: unknown[]) => { backupCalls.push(args); return backupOutcome((args[3] ?? {}) as RunOptions) },
    BackupLockBusyError: realBackup.BackupLockBusyError,
    sweepStaleBackupFiles: async () => { sweeps.count += 1; return 0 },
  },
})

const schema = await import('../server/db/schema')
const scheduler = await import('../server/services/backup-scheduler')
const { backupSchedulerEnabledByServer } = await import('../server/utils/backup-scheduler-switch')
const {
  isBackupDue, lastSlot, parseBackupHour, parseBackupDays, parseSchedulerState,
  backupSchedulerTick, startBackupScheduler, stopBackupScheduler, BACKUP_SCHEDULER_STATE_KEY, scheduleStartupBackupSweep,
} = scheduler

beforeEach(() => {
  db.touched = 0
  db.settings = new Map()
  db.backups = []
  backupCalls.length = 0
  backupOutcome = async (options) => {
    await options.onStarted?.()
    writeRunRows(clock, 'scheduled')
    return {}
  }
  logs.length = 0
  nextId = 1
})

/** 2026-10: the 18th and 25th are Sundays. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)

type State = NonNullable<ReturnType<typeof parseSchedulerState>>
type Schedule = { hour: number, days: number[] }
const DAILY_3 : Schedule = { hour: 3, days: [] }
const SUNDAY_3: Schedule = { hour: 3, days: [0] }
/** A state record: the slot, attempts on it, the latest attempt, its outcome, the latest success, the schedule it served. */
const state = (slot: Date, attempts: number, lastAttemptAt: Date, outcome: State['outcome'], lastDoneAt: Date | null, schedule: Schedule = DAILY_3): State => ({
  slot: slot.toISOString(), attempts, lastAttemptAt: lastAttemptAt.toISOString(), outcome,
  lastDoneAt: lastDoneAt ? lastDoneAt.toISOString() : null, schedule,
})
const servedAt = (slot: Date, startedAt: Date, schedule: Schedule = DAILY_3) => state(slot, 1, startedAt, 'done', startedAt, schedule)
/** The scheduler process started long before every row below, unless a row says otherwise. */
const LONG_AGO = new Date(2026, 9, 1, 0, 0)

test('fixture sanity: the 18th and 25th of October 2026 are Sundays', () => {
  assert.equal(at(18, 3).getDay(), 0)
  assert.equal(at(25, 3).getDay(), 0)
})

const SUNDAY_3AM = { enabled: true, hour: 3, days: [0] }
const DAILY_3AM = { enabled: true, hour: 3, days: [] as number[] }
const DAILY_MIDNIGHT = { enabled: true, hour: 0, days: [] as number[] }

const table: Array<{ name: string, policy: { enabled: boolean, hour: number, days: number[] }, now: Date, state: State | null, run: boolean, reason: string, slot?: Date, boot?: Date }> = [
  { name: 'switch off', policy: { ...DAILY_3AM, enabled: false }, now: at(26, 3, 5), state: null, run: false, reason: 'disabled' },
  // Spec: "Weekly policy does not run mid-week".
  { name: 'weekly Sunday, Monday 15:30 after Sunday 03:05 succeeded', policy: SUNDAY_3AM, now: at(26, 15, 30), state: servedAt(at(25, 3), at(25, 3, 5)), run: false, reason: 'slot_done', slot: at(25, 3) },
  { name: 'weekly Sunday, Wednesday 10:00 after Sunday succeeded', policy: SUNDAY_3AM, now: at(28, 10), state: servedAt(at(25, 3), at(25, 3, 2)), run: false, reason: 'slot_done', slot: at(25, 3) },
  { name: 'weekly Sunday, Sunday 03:10, last week served', policy: SUNDAY_3AM, now: at(25, 3, 10), state: servedAt(at(18, 3), at(18, 3, 5)), run: true, reason: 'slot', slot: at(25, 3) },
  { name: 'weekly Sunday, Saturday 23:00: last slot is LAST Sunday, already served', policy: SUNDAY_3AM, now: at(24, 23), state: servedAt(at(18, 3), at(18, 3, 5)), run: false, reason: 'slot_done', slot: at(18, 3) },
  // Spec: "Midnight is honoured" — hour 0 is a slot at 00:00, not 03:00.
  { name: 'hour 0, 00:05', policy: DAILY_MIDNIGHT, now: at(26, 0, 5), state: servedAt(at(25, 0), at(25, 0, 2)), run: true, reason: 'slot', slot: at(26, 0) },
  { name: 'hour 0, 02:59 after the 00:02 run', policy: DAILY_MIDNIGHT, now: at(26, 2, 59), state: servedAt(at(26, 0), at(26, 0, 2)), run: false, reason: 'slot_done', slot: at(26, 0) },
  // Spec: "Failure at 03:00 → a retry starts no earlier than 04:00".
  { name: 'failed at 03:02, 03:40', policy: DAILY_3AM, now: at(26, 3, 40), state: state(at(26, 3), 1, at(26, 3, 2), 'failed', null), run: false, reason: 'retry_wait', slot: at(26, 3) },
  { name: 'failed at 03:02, 04:05', policy: DAILY_3AM, now: at(26, 4, 5), state: state(at(26, 3), 1, at(26, 3, 2), 'failed', null), run: true, reason: 'retry', slot: at(26, 3) },
  { name: 'failed twice, third attempt', policy: DAILY_3AM, now: at(26, 5, 10), state: state(at(26, 3), 2, at(26, 4, 5), 'failed', null), run: true, reason: 'retry', slot: at(26, 3) },
  { name: 'three failures: slot abandoned', policy: DAILY_3AM, now: at(26, 6, 30), state: state(at(26, 3), 3, at(26, 5, 10), 'failed', null), run: false, reason: 'slot_abandoned', slot: at(26, 3) },
  { name: 'marked abandoned', policy: DAILY_3AM, now: at(26, 9), state: state(at(26, 3), 3, at(26, 5, 10), 'abandoned', null), run: false, reason: 'slot_abandoned', slot: at(26, 3) },
  { name: 'abandoned yesterday, next slot runs', policy: DAILY_3AM, now: at(27, 3, 5), state: state(at(26, 3), 3, at(26, 5, 10), 'abandoned', null), run: true, reason: 'slot', slot: at(27, 3) },
  { name: 'a retry that succeeded serves the slot', policy: DAILY_3AM, now: at(26, 9), state: state(at(26, 3), 2, at(26, 4, 5), 'done', at(26, 4, 5)), run: false, reason: 'slot_done', slot: at(26, 3) },
  // A run cut off mid-way (container stopped) left its record "running": an attempt, not a success.
  { name: 'interrupted at 03:02, 03:40', policy: DAILY_3AM, now: at(26, 3, 40), state: state(at(26, 3), 1, at(26, 3, 2), 'running', null), run: false, reason: 'retry_wait', slot: at(26, 3) },
  { name: 'interrupted at 03:02, 04:05', policy: DAILY_3AM, now: at(26, 4, 5), state: state(at(26, 3), 1, at(26, 3, 2), 'running', null), run: true, reason: 'retry', slot: at(26, 3) },
  { name: 'third attempt interrupted', policy: DAILY_3AM, now: at(26, 6, 30), state: state(at(26, 3), 3, at(26, 5, 10), 'running', null), run: false, reason: 'slot_abandoned', slot: at(26, 3) },
  // Spec: "Missed slot is caught up once" — down at Sunday 03:00, up at 07:00: the
  // slot fell BEFORE this process started, under the schedule it was serving.
  { name: 'down at the slot, up at 07:00: catch up', policy: SUNDAY_3AM, now: at(25, 7, 2), boot: at(25, 7), state: servedAt(at(18, 3), at(18, 3, 5), SUNDAY_3), run: true, reason: 'catch_up', slot: at(25, 3) },
  { name: '…and only once', policy: SUNDAY_3AM, now: at(25, 7, 20), boot: at(25, 7), state: servedAt(at(25, 3), at(25, 7, 2), SUNDAY_3), run: false, reason: 'slot_done', slot: at(25, 3) },
  { name: '…not again on Monday', policy: SUNDAY_3AM, now: at(26, 15, 30), boot: at(25, 7), state: servedAt(at(25, 3), at(25, 7, 2), SUNDAY_3), run: false, reason: 'slot_done', slot: at(25, 3) },
  { name: 'daily, down for three days: catch up the latest slot once', policy: DAILY_3AM, now: at(26, 10), boot: at(26, 9, 58), state: servedAt(at(23, 3), at(23, 3, 4)), run: true, reason: 'catch_up', slot: at(26, 3) },
  { name: 'up all along (the slot fell after boot): a missed slot is not made up', policy: SUNDAY_3AM, now: at(25, 7), boot: at(25, 2), state: servedAt(at(18, 3), at(18, 3, 5), SUNDAY_3), run: false, reason: 'outside_slot', slot: at(25, 3) },
  // Spec: "Admin enables automatic backups → the next configured slot produces a backup".
  { name: 'switched on Wednesday, weekly Sunday, no history: wait', policy: SUNDAY_3AM, now: at(28, 10), state: null, run: false, reason: 'outside_slot', slot: at(25, 3) },
  { name: 'switched on at 10:00, daily 03:00, no history: wait for tomorrow', policy: DAILY_3AM, now: at(26, 10), state: null, run: false, reason: 'outside_slot', slot: at(26, 3) },
  { name: '…and the next slot runs', policy: DAILY_3AM, now: at(27, 3, 7), state: null, run: true, reason: 'slot', slot: at(27, 3) },
  { name: '…even just after a deploy: no history, nothing to catch up', policy: SUNDAY_3AM, now: at(28, 10), boot: at(28, 9, 58), state: null, run: false, reason: 'outside_slot', slot: at(25, 3) },
  { name: 'switched back on after a month off: no catch-up, wait for the slot', policy: DAILY_3AM, now: at(26, 10), state: servedAt(at(1, 3), at(1, 3, 2)), run: false, reason: 'outside_slot', slot: at(26, 3) },
  { name: 'switched off for three days and back on (server up): no catch-up', policy: DAILY_3AM, now: at(26, 10), state: servedAt(at(23, 3), at(23, 3, 2)), run: false, reason: 'outside_slot', slot: at(26, 3) },
  // A policy EDIT creates past "slots" that never existed under the old schedule.
  { name: 'hour edited 03 → 10 (served at 03:02 the 26th): the 27th at 09:00 does not run', policy: { enabled: true, hour: 10, days: [] }, now: at(27, 9), state: servedAt(at(26, 3), at(26, 3, 2)), run: false, reason: 'outside_slot', slot: at(26, 10) },
  { name: '…nor right after a deploy that came after the "new" slot', policy: { enabled: true, hour: 10, days: [] }, now: at(27, 9), boot: at(27, 8), state: servedAt(at(26, 3), at(26, 3, 2)), run: false, reason: 'outside_slot', slot: at(26, 10) },
  { name: '…and the new hour runs once at 10:05', policy: { enabled: true, hour: 10, days: [] }, now: at(27, 10, 5), state: servedAt(at(26, 3), at(26, 3, 2)), run: true, reason: 'slot', slot: at(27, 10) },
  { name: 'Wednesday added to a Sunday schedule: Thursday 10:00 does not run', policy: { enabled: true, hour: 3, days: [0, 3] }, now: at(29, 10), state: servedAt(at(25, 3), at(25, 3, 2), SUNDAY_3), run: false, reason: 'outside_slot', slot: at(28, 3) },
  { name: '…nor after a deploy on Thursday morning', policy: { enabled: true, hour: 3, days: [0, 3] }, now: at(29, 10), boot: at(29, 8), state: servedAt(at(25, 3), at(25, 3, 2), SUNDAY_3), run: false, reason: 'outside_slot', slot: at(28, 3) },
  { name: 'Sunday switched to Monday: Tuesday does not run', policy: { enabled: true, hour: 3, days: [1] }, now: at(27, 10), state: servedAt(at(25, 3), at(25, 3, 2), SUNDAY_3), run: false, reason: 'outside_slot', slot: at(26, 3) },
]

for (const row of table) {
  test(`isBackupDue — ${row.name}`, () => {
    const decision = isBackupDue(row.policy, row.now, row.state, row.boot ?? LONG_AGO)
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

test('parseSchedulerState: a well-formed record or null — never a half-read one', () => {
  const good = state(at(26, 3), 2, at(26, 4, 5), 'failed', at(25, 3, 2))
  assert.deepEqual(parseSchedulerState(JSON.stringify(good)), good)
  assert.deepEqual(parseSchedulerState(JSON.stringify({ ...good, lastDoneAt: null })), { ...good, lastDoneAt: null })
  // No recorded schedule (or an unreadable one): known history, unknown schedule — never caught up.
  const { schedule: _omitted, ...withoutSchedule } = good
  assert.deepEqual(parseSchedulerState(JSON.stringify(withoutSchedule)), { ...good, schedule: null })
  assert.deepEqual(parseSchedulerState(JSON.stringify({ ...good, schedule: { hour: 24, days: [] } })), { ...good, schedule: null })
  assert.deepEqual(parseSchedulerState(JSON.stringify({ ...good, schedule: { hour: 3, days: [7] } })), { ...good, schedule: null })
  for (const bad of [
    null, undefined, '', 'not json', '[]', '{}',
    JSON.stringify({ ...good, slot: 'yesterday' }),
    JSON.stringify({ ...good, attempts: -1 }),
    JSON.stringify({ ...good, attempts: 1.5 }),
    JSON.stringify({ ...good, outcome: 'maybe' }),
    JSON.stringify({ ...good, lastAttemptAt: 42 }),
  ]) assert.equal(parseSchedulerState(bad), null, String(bad))
})

test('server switch: on in production unless BACKUP_SCHEDULER says off; off in development unless it says on', () => {
  for (const off of ['0', 'false', 'OFF', ' no ']) assert.equal(backupSchedulerEnabledByServer(off, 'production'), false, off)
  for (const on of ['1', 'true', 'on', 'YES']) assert.equal(backupSchedulerEnabledByServer(on, 'development'), true, on)
  assert.equal(backupSchedulerEnabledByServer(undefined, 'production'), true)
  assert.equal(backupSchedulerEnabledByServer('', 'production'), true)
  assert.equal(backupSchedulerEnabledByServer(undefined, 'development'), false)
  assert.equal(backupSchedulerEnabledByServer(undefined, undefined), false)
})

test('the plugin boots the scheduler through the shared switch, sweeps partial files at startup, and stops on close', () => {
  const plugin = readFileSync(new URL('../server/plugins/backup-scheduler.ts', import.meta.url), 'utf8')
  assert.match(plugin, /backupSchedulerEnabledByServer\(process\.env\.BACKUP_SCHEDULER, process\.env\.NODE_ENV\)/)
  assert.match(plugin, /nitroApp\.hooks\.hook\('close', stopBackupScheduler\)/)
  // The startup sweep only where the scheduler runs (behaviour: tests/backup-dir-isolation.test.ts).
  assert.ok(plugin.indexOf('scheduleStartupBackupSweep()') > plugin.indexOf('backupSchedulerEnabledByServer('))
  const endpoint = readFileSync(new URL('../server/api/admin/settings/backup.get.ts', import.meta.url), 'utf8')
  assert.match(endpoint, /schedulerDisabledByServer: !backupSchedulerEnabledByServer\(process\.env\.BACKUP_SCHEDULER, process\.env\.NODE_ENV\)/)
})

test('.env.example documents BACKUP_SCHEDULER with its production default', () => {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  const block = example.slice(example.indexOf('BACKUP_SCHEDULER') - 600, example.lastIndexOf('BACKUP_SCHEDULER') + 40)
  assert.match(example, /^# BACKUP_SCHEDULER=0$/m)
  assert.match(block, /production/)
  assert.match(block, /backup_auto_enabled|Backup tự động theo lịch/)
})

test('the state key cannot be written through the settings API', () => {
  const put = readFileSync(new URL('../server/api/admin/settings/index.put.ts', import.meta.url), 'utf8')
  assert.equal(BACKUP_SCHEDULER_STATE_KEY, 'backup_scheduler_state')
  assert.doesNotMatch(put, /backup_scheduler_state/)
})

// ─── The tick ─────────────────────────────────────────────────────────────────

const enable = (hour: string, days = '[]') => {
  db.settings.set('backup_auto_enabled', 'true')
  db.settings.set('backup_auto_hour', hour)
  db.settings.set('backup_auto_days', days)
}
const storedState = () => parseSchedulerState(db.settings.get('backup_scheduler_state'))
async function tickAt(now: Date) {
  clock = now
  await backupSchedulerTick(now)
}

test('tick: hour "0" is read as midnight and the slot runs a scheduled "all" backup, recorded as done', async () => {
  enable('0')
  await tickAt(at(26, 0, 5))
  assert.equal(backupCalls.length, 1)
  assert.deepEqual(backupCalls[0]!.slice(0, 3), ['all', 'scheduled', null])
  assert.deepEqual(storedState(), state(at(26, 0), 1, at(26, 0, 5), 'done', at(26, 0, 5), { hour: 0, days: [] }))
})

// The verifier's scenario: a weekly policy served on Sunday, then a few manual
// backups in the week. Rotation (`selectRotationVictims` counts every trigger)
// deletes this Sunday's scheduled SQL row first. The slot must stay served.
for (const [label, keepCount, manual] of [
  ['keep 14, four manual "all" backups', 14, 4],
  ['keep 14, twelve pre-* SQL backups', 14, -12],
  ['keep 4, one manual "all" backup', 4, 1],
  ['keep 5, one manual "all" backup', 5, 1],
] as const) {
  test(`tick: rotation cannot make a served slot run again mid-week (${label})`, async () => {
    enable('3', '[0]')
    await tickAt(at(18, 3, 2))
    await tickAt(at(25, 3, 2))
    assert.equal(backupCalls.length, 2, 'both Sundays ran')

    for (let i = 1; i <= Math.abs(manual); i += 1) {
      if (manual > 0) writeRunRows(at(26, 9 + i), 'manual')
      else writeRunRows(at(26, 9, i), 'pre-repoint', ['sql'])
    }
    const victims = new Set(realBackup.selectRotationVictims(db.backups, keepCount).map(row => row.id))
    assert.ok(victims.size > 0, 'the scenario must actually rotate something')
    db.backups = db.backups.filter(row => !victims.has(row.id))

    for (const now of [at(28, 10), at(28, 11, 15), at(29, 3, 5), at(31, 23)]) await tickAt(now)
    assert.equal(backupCalls.length, 2, 'a backup ran outside the policy')
    assert.equal(logs.filter(entry => entry.event === 'backup.slot_abandoned').length, 0, 'no false "abandoned"')

    await tickAt(at(1 + 31, 3, 4)) // next Sunday (Nov 1): the policy's next slot runs
    assert.equal(backupCalls.length, 3)
  })
}

test('tick: a failure before the first file (lock held, config read failed) counts — at most 3 attempts, 60 min apart', async () => {
  enable('3')
  backupOutcome = async (options) => {
    await options.onStarted?.()
    throw new Error('EACCES: mkdir backups')
  }
  await tickAt(at(26, 3, 5))
  assert.equal(backupCalls.length, 1)
  assert.equal(storedState()?.outcome, 'failed')
  assert.equal(storedState()?.attempts, 1)
  await tickAt(at(26, 3, 20))
  await tickAt(at(26, 3, 35))
  assert.equal(backupCalls.length, 1, 'not every 15-minute tick')
  await tickAt(at(26, 4, 6))
  await tickAt(at(26, 5, 7))
  assert.equal(backupCalls.length, 3)
  assert.equal(storedState()?.outcome, 'abandoned')
  await tickAt(at(26, 6, 30))
  await tickAt(at(26, 9))
  assert.equal(backupCalls.length, 3)
  const abandoned = logs.filter(entry => entry.event === 'backup.slot_abandoned')
  assert.equal(abandoned.length, 1, 'one log line per abandoned slot, not one per tick')
  assert.equal(abandoned[0]!.failures, 3)
  assert.ok(logs.filter(entry => entry.event === 'backup.scheduler_failed').length === 3)
})

test('tick: a lock-busy refusal (another backup is running) is not an attempt', async () => {
  enable('3')
  backupOutcome = async () => { throw new realBackup.BackupLockBusyError() }
  await tickAt(at(26, 3, 5))
  assert.equal(storedState(), null, 'nothing recorded')
  backupOutcome = async (options) => { await options.onStarted?.(); writeRunRows(clock, 'scheduled'); return {} }
  await tickAt(at(26, 3, 20))
  assert.equal(backupCalls.length, 2, 'tried again at the next tick, not 60 min later')
  assert.equal(storedState()?.outcome, 'done')
})

test('tick: a refusal because a database restore is running is "busy" too — not an attempt, retried at the next tick', async () => {
  enable('3')
  backupOutcome = async () => { throw new realBackup.BackupRestoreInProgressError() }
  const logsBefore = logs.length
  await tickAt(at(26, 3, 5))
  assert.equal(storedState(), null, 'nothing recorded')
  const tickLogs = logs.slice(logsBefore)
  assert.ok(tickLogs.some(entry => entry.event === 'backup.scheduler_busy' && /khôi phục/.test(String(entry.reason))), 'logged as busy, with the reason')
  assert.ok(!tickLogs.some(entry => entry.event === 'backup.scheduler_failed'), 'a refusal is not a failure')
  backupOutcome = async (options) => { await options.onStarted?.(); writeRunRows(clock, 'scheduled'); return {} }
  await tickAt(at(26, 3, 20))
  assert.equal(backupCalls.length, 2)
  assert.equal(storedState()?.outcome, 'done')
})

// ─── Refused as "busy" until the slot is lost → the operator gets a mail ──────
// `backup.scheduler_busy` is info and not an attempt, so a lock that stays held (a
// hung backup, a restore that never ends) used to drop scheduled backups silently.
// Decided by TIME, not by counting ticks: a count of 4 misfired with the off-grid
// 120 s warmup tick, never fired when timer drift left 3 due ticks in a window, named
// the wrong slot once a streak ran into the next day, and fired while one due tick of
// the window was still to come.
const blocked = () => logs.filter(entry => entry.event === 'backup.scheduler_blocked')
const refuseAsBusy = (restore = false) => {
  backupOutcome = async () => { throw restore ? new realBackup.BackupRestoreInProgressError() : new realBackup.BackupLockBusyError() }
}
/** A run that takes the lock — clears any streak earlier tests left in the module. */
async function startedRun(now: Date) {
  backupOutcome = async (options) => { await options.onStarted?.(); writeRunRows(clock, 'scheduled'); return {} }
  await tickAt(now)
  logs.length = 0
}

test('tick: warmup tick off the grid + 15-minute ticks: no alert while the window is open; ONE warn at the first tick past it, naming the slot', async () => {
  enable('3')
  await startedRun(at(25, 3, 5))
  refuseAsBusy()
  // 03:02 is the boot+120 s warmup tick; 03:13 … 03:58 the interval grid — all inside 03:00–04:00.
  for (const minute of [2, 13, 28, 43, 58]) await tickAt(at(26, 3, minute))
  assert.equal(blocked().length, 0, 'paged while the slot could still run (03:58 was its last chance)')
  await tickAt(at(26, 4, 13))
  assert.equal(blocked().length, 1)
  const alert = blocked()[0]!
  assert.equal(levels.get(alert), 'warn', 'below warn the ops alert never fires')
  assert.equal(alert.slot, at(26, 3).toISOString())
  assert.equal(alert.since, at(26, 3, 2).toISOString())
  assert.equal(alert.busyTicks, 5)
  assert.ok(logs.filter(entry => entry.event === 'backup.scheduler_busy').every(entry => levels.get(entry) === 'info'), 'each refusal stays info')
  await tickAt(at(26, 4, 28))
  assert.equal(blocked().length, 1, 'one mail per lost slot, not one per tick')
  assert.equal(storedState()?.slot, at(25, 3).toISOString(), 'no attempt was ever recorded for the lost slot')
})

test('tick: timer drift leaves only 3 due ticks in the window — still one alert, at the first tick past it', async () => {
  enable('3')
  await startedRun(at(25, 3, 5))
  refuseAsBusy(true) // a restore holding the lock is "busy" too
  for (const minute of [14, 30, 46]) await tickAt(at(26, 3, minute))
  assert.equal(blocked().length, 0)
  await tickAt(at(26, 4, 2))
  assert.equal(blocked().length, 1)
  assert.equal(blocked()[0]!.slot, at(26, 3).toISOString())
  assert.equal(blocked()[0]!.since, at(26, 3, 14).toISOString())
  assert.match(String(blocked()[0]!.reason), /khôi phục/)
})

test('tick: a lock held across two daily slots → one alert per lost slot, each naming ITS slot', async () => {
  enable('3')
  await startedRun(at(25, 3, 5))
  refuseAsBusy()
  for (const [day, hour, minute] of [[26, 3, 5], [26, 3, 20], [26, 3, 35], [26, 3, 50], [26, 4, 5], [26, 12, 0]] as const) await tickAt(at(day, hour, minute))
  assert.deepEqual(blocked().map(alert => alert.slot), [at(26, 3).toISOString()])
  for (const [day, hour, minute] of [[27, 3, 5], [27, 3, 20], [27, 3, 35], [27, 3, 50]] as const) await tickAt(at(day, hour, minute))
  assert.equal(blocked().length, 1, 'the second slot\'s window is still open')
  await tickAt(at(27, 4, 5))
  assert.deepEqual(blocked().map(alert => alert.slot), [at(26, 3).toISOString(), at(27, 3).toISOString()])
  assert.equal(blocked()[1]!.since, at(27, 3, 5).toISOString(), 'the streak of the new slot starts at its own first refusal')
})

test('tick: a retry (no slot window) blocked for a whole hour → one alert; a run that starts first → none', async () => {
  enable('3')
  await startedRun(at(25, 3, 5))
  backupOutcome = async (options) => { await options.onStarted?.(); throw new Error('EACCES: mkdir backups') }
  await tickAt(at(26, 3, 5)) // attempt 1 fails → retries are due from 04:05, any time of day
  refuseAsBusy()
  for (const [hour, minute] of [[4, 6], [4, 21], [4, 36], [4, 51]] as const) await tickAt(at(26, hour, minute))
  assert.equal(blocked().length, 0)
  await tickAt(at(26, 5, 6)) // one hour after the first refused retry
  assert.equal(blocked().length, 1)
  assert.equal(blocked()[0]!.slot, at(26, 3).toISOString())
  assert.equal(blocked()[0]!.since, at(26, 4, 6).toISOString())

  // Next day: refused retries again, but the lock frees and the run STARTS before the hour is up.
  logs.length = 0
  backupOutcome = async (options) => { await options.onStarted?.(); throw new Error('EACCES: mkdir backups') }
  await tickAt(at(27, 3, 5))
  refuseAsBusy()
  for (const [hour, minute] of [[4, 6], [4, 21], [4, 36], [4, 51]] as const) await tickAt(at(27, hour, minute))
  backupOutcome = async (options) => { await options.onStarted?.(); writeRunRows(clock, 'scheduled'); return {} }
  await tickAt(at(27, 5, 6))
  await tickAt(at(27, 5, 21))
  assert.equal(blocked().length, 0, 'the run that started cleared the streak — no mail just before a success')
})

test('tick: turning automatic backups off clears the streak', async () => {
  enable('3')
  await startedRun(at(25, 3, 5))
  refuseAsBusy()
  for (const minute of [2, 17, 32]) await tickAt(at(26, 3, minute))
  db.settings.set('backup_auto_enabled', 'false')
  await tickAt(at(26, 3, 40))
  enable('3')
  await tickAt(at(26, 3, 47))
  await tickAt(at(26, 4, 2))
  assert.equal(blocked().length, 1, 'the slot was still lost while busy')
  assert.equal(blocked()[0]!.since, at(26, 3, 47).toISOString(), 'the streak restarted when the switch went off')
})

test('tick: a run cut off mid-way stays "running" and is retried after 60 min, then abandoned at the third', async () => {
  enable('3')
  // A process killed during the backup never gets to write the outcome.
  db.settings.set('backup_scheduler_state', JSON.stringify(state(at(26, 3), 3, at(26, 5, 10), 'running', null)))
  await tickAt(at(26, 6, 30))
  assert.equal(backupCalls.length, 0)
  assert.equal(storedState()?.outcome, 'abandoned')
  assert.equal(logs.filter(entry => entry.event === 'backup.slot_abandoned').length, 1)
})

test('tick: only one tick runs at a time — a second tick cannot start a backup before the first records its attempt', async () => {
  // Once the attempt is recorded (`running`), the state alone holds off a second
  // run; the in-process guard covers the gap before that — here the first tick is
  // still waiting to start (e.g. on the lock) when the next tick fires.
  enable('3')
  const waiting: Array<() => void> = []
  backupOutcome = async (options) => {
    await new Promise<void>(resolve => { waiting.push(resolve) })
    await options.onStarted?.()
    writeRunRows(clock, 'scheduled')
    return {}
  }
  clock = at(26, 3, 5)
  const first = backupSchedulerTick(at(26, 3, 5))
  await new Promise(resolve => setImmediate(resolve))
  const second = backupSchedulerTick(at(26, 3, 20))
  await new Promise(resolve => setImmediate(resolve))
  const calls = backupCalls.length
  for (const resume of waiting) resume()
  await Promise.all([first, second])
  assert.equal(calls, 1, 'the second tick started a second backup')
  assert.equal(storedState()?.outcome, 'done')
})

test('tick: a backup that throws is logged, not thrown', async () => {
  enable('3')
  backupOutcome = async (options) => { await options.onStarted?.(); throw new Error('disk full') }
  await tickAt(at(26, 3, 5))
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

test('stopBackupScheduler clears the startup partial-file sweep too', () => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  try {
    sweeps.count = 0
    scheduleStartupBackupSweep()
    stopBackupScheduler()
    mock.timers.tick(10 * 60_000)
    assert.equal(sweeps.count, 0, 'the sweep ran after the scheduler was stopped')
    // Control: not stopped, it runs once.
    scheduleStartupBackupSweep()
    mock.timers.tick(10 * 60_000)
    assert.equal(sweeps.count, 1)
  } finally {
    stopBackupScheduler()
    mock.timers.reset()
  }
})

test('tick: an attempt records the schedule it served; a boot after a missed slot catches it up once', async () => {
  enable('3', '[0]')
  await tickAt(at(18, 3, 2))
  assert.deepEqual(storedState()?.schedule, { hour: 3, days: [0] })
  // Down over the next Sunday 03:00, back at 07:00 — this process started after the slot.
  clock = at(25, 7, 2)
  await backupSchedulerTick(at(25, 7, 2), at(25, 7))
  assert.equal(backupCalls.length, 2, 'the slot missed while down is caught up')
  clock = at(25, 7, 20)
  await backupSchedulerTick(at(25, 7, 20), at(25, 7))
  assert.equal(backupCalls.length, 2, 'only once')
})

test('tick: a schedule edit never runs a backup outside the new schedule', async () => {
  enable('3')
  await tickAt(at(26, 3, 2))
  enable('10') // edited the next morning
  for (const [now, boot] of [[at(27, 9), at(20, 0)], [at(27, 9, 15), at(27, 9, 10)]] as const) {
    clock = now
    await backupSchedulerTick(now, boot)
  }
  assert.equal(backupCalls.length, 1, 'ran before the new hour')
  await tickAt(at(27, 10, 5))
  assert.equal(backupCalls.length, 2)
})
