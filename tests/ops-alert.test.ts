import assert from 'node:assert/strict'
import test, { afterEach, beforeEach, mock } from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Spec `ops-logging` (wave2 D-ALERT): "Selected security events are sent to an
 * operator, rate-limited". When OPS_ALERT_EMAIL is set, an allowlisted event logged
 * through `server/utils/logger.ts` e-mails that address — at most one per event
 * name per 15 minutes, event name + time + non-secret context only — and a failed
 * send never affects the request that logged it.
 *
 * Two layers are tested:
 *  - `createOpsAlertDispatcher` with injected clock/session/mailer (rate limit,
 *    bursts, the shared store, message content, failures);
 *  - the REAL logger → `ops-alert.ts` default wiring, with `mysql2/promise` and the
 *    mailer faked underneath (unset address, the 3-in-5-minutes scenario, no
 *    recursion, never the shared pool — the boot migrations run in a CLI process
 *    that must exit, see ops-alert.ts).
 */

// ─── Fakes under the default wiring ───────────────────────────────────────────
type Counter = { hit_count: number, window_expires_at: Date }
const fakeDb = {
  counters: new Map<string, Counter>(),
  smtp: [{ key: 'smtp_host', value: 'smtp.example.test' }, { key: 'smtp_user', value: 'ops@example.test' }] as Array<{ key: string, value: string }>,
  connectionsOpened: 0,
  connectionsClosed: 0,
  poolsCreated: 0,
  connectFails: false,
  queries: [] as string[],
}
const rateLimitQuery = (sql: string, params: unknown[]) => {
  if (sql.startsWith('INSERT INTO rate_limit_counters')) {
    const [key, expiresAt, now] = params as [string, Date, Date]
    const current = fakeDb.counters.get(key)
    if (!current || current.window_expires_at <= now) fakeDb.counters.set(key, { hit_count: 1, window_expires_at: expiresAt })
    else current.hit_count += 1
    return [{ affectedRows: 1 }, []]
  }
  if (sql.startsWith('SELECT hit_count')) {
    const row = fakeDb.counters.get(String(params[0]))
    return [row ? [{ ...row }] : [], []]
  }
  return null
}
const fakeConnection = () => ({
  query: async (sql: string, params: unknown[] = []) => {
    fakeDb.queries.push(sql)
    const limited = rateLimitQuery(sql, params)
    if (limited) return limited
    if (/FROM `settings`/.test(sql)) return [fakeDb.smtp.filter(row => (params[0] as string[]).includes(row.key)), []]
    throw new Error(`fake connection cannot run: ${sql}`)
  },
  end: async () => { fakeDb.connectionsClosed += 1 },
})
const mysqlFake = {
  createConnection: async () => {
    fakeDb.connectionsOpened += 1
    if (fakeDb.connectFails) throw new Error('fixture: ECONNREFUSED')
    return fakeConnection()
  },
  createPool: () => { fakeDb.poolsCreated += 1; throw new Error('the alert path must never create the shared pool') },
}
mock.module('mysql2/promise', { defaultExport: mysqlFake, namedExports: mysqlFake })

const mail = {
  sent: [] as Array<{ to: string, subject: string, text?: string, config?: unknown }>,
  fail: null as null | Error,
  /** Runs inside sendMail — lets a test log from within the alert path. */
  during: null as null | (() => void),
}
mock.module('../server/utils/mailer', {
  namedExports: {
    SMTP_KEYS: ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from'],
    // The real resolution reads through whatever reader it is given; the fake does the same.
    getSmtpConfig: async (read: () => Promise<Record<string, string>>) => {
      const map = await read()
      return map.smtp_host ? { host: map.smtp_host, port: 587, secure: false, user: map.smtp_user ?? '', pass: '', from: map.smtp_user ?? '' } : null
    },
    sendMail: async (args: { to: string, subject: string, text?: string, config?: unknown }) => {
      mail.during?.()
      if (mail.fail) throw mail.fail
      mail.sent.push(args)
    },
  },
})

const logger = await import('../server/utils/logger')
const { ALERT_EVENTS, SECURITY_EVENTS, BOOT_MIGRATION_EVENTS, SKIP_OPS_ALERT, logWarn, logError, logInfo, settleOpsAlerts } = logger
const { createOpsAlertDispatcher, buildOpsAlertMessage, parseAlertRecipients, OPS_ALERT_WINDOW_SECONDS } = await import('../server/utils/ops-alert')

// ─── Log capture ─────────────────────────────────────────────────────────────
let lines: Array<Record<string, unknown>> = []
const capture = (...args: unknown[]) => {
  try { lines.push(JSON.parse(String(args[0]))) } catch { /* not a log line */ }
}
let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
// Restored one by one: `mock.restoreAll()` would also undo the module mocks above.
let consoleSpies: Array<{ mock: { restore: () => void } }> = []
beforeEach(() => {
  lines = []
  unhandled = []
  consoleSpies = [mock.method(console, 'error', capture), mock.method(console, 'log', capture)]
  process.on('unhandledRejection', onUnhandled)
  mail.sent = []
  mail.fail = null
  mail.during = null
  fakeDb.counters.clear()
  fakeDb.connectionsOpened = 0
  fakeDb.connectionsClosed = 0
  fakeDb.connectFails = false
  fakeDb.queries = []
  process.env.OPS_ALERT_EMAIL = 'ops@example.test'
})
afterEach(() => {
  for (const spy of consoleSpies) spy.mock.restore()
  mock.timers.reset()
  process.off('unhandledRejection', onUnhandled)
  delete process.env.OPS_ALERT_EMAIL
  delete process.env.LOG_LEVEL
})
const logged = (event: string) => lines.filter(line => line.event === event)

// ─── The allowlist ────────────────────────────────────────────────────────────
test('the alert list is the D-ALERT subset, and nothing else alerts', () => {
  assert.deepEqual([...ALERT_EVENTS].sort(), [
    'auth.mfa_challenge_locked',
    'backup.restore_failed',
    'backup.restore_refused',
    'backup.scheduler_blocked',
    'backup.slot_abandoned',
    'db.migration.media_category_fk_blocked',
    'security.cross_site_refused',
    'security.link_host_rejected',
  ])
  assert.ok(ALERT_EVENTS.includes(SECURITY_EVENTS.backupRestoreFailed))
  // wave2 integration (2A × ops): the origin gate's refusal is on the D-ALERT list.
  assert.ok(ALERT_EVENTS.includes(SECURITY_EVENTS.crossSiteRefused))
  assert.ok(ALERT_EVENTS.includes(BOOT_MIGRATION_EVENTS.mediaCategoryFkBlocked))
  assert.ok(!ALERT_EVENTS.includes(SECURITY_EVENTS.loginFailed), 'routine noise is not paged')
})

test('every alert event is really emitted somewhere under server/ (a rename cannot silently stop an alert)', () => {
  const root = new URL('../server/', import.meta.url).pathname
  const sources: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.ts') && !full.endsWith('utils/logger.ts')) sources.push(readFileSync(full, 'utf8'))
    }
  }
  walk(root)
  const all = sources.join('\n')
  const constantName = (event: string) => [...Object.entries(SECURITY_EVENTS), ...Object.entries(BOOT_MIGRATION_EVENTS)].find(([, value]) => value === event)?.[0]
  for (const event of ALERT_EVENTS) {
    const name = constantName(event)
    const emitted = all.includes(`event: '${event}'`) || (name !== undefined && new RegExp(`event: (SECURITY_EVENTS|BOOT_MIGRATION_EVENTS)\\.${name}\\b`).test(all))
    assert.ok(emitted, `${event} is in ALERT_EVENTS but nothing logs it`)
  }
})

// ─── Spec scenarios through the real logger ───────────────────────────────────
test('spec "Not configured": OPS_ALERT_EMAIL unset → no alert e-mail is attempted, no database touched', async () => {
  delete process.env.OPS_ALERT_EMAIL
  logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, filename: 'x.sql.gz' })
  await settleOpsAlerts()
  assert.equal(mail.sent.length, 0)
  assert.equal(fakeDb.connectionsOpened, 0, 'nothing was even looked up')
  // A blank value is "unset" too.
  process.env.OPS_ALERT_EMAIL = '   '
  logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, filename: 'x.sql.gz' })
  await settleOpsAlerts()
  assert.equal(fakeDb.connectionsOpened, 0)
})

test('spec "Repeated restore failures": three within 5 minutes → exactly one e-mail; a new window sends again', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T01:00:00.000Z') })
  for (let i = 0; i < 3; i += 1) {
    logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, filename: `cdkt-${i}.sql.gz`, reason: 'sql_failed' })
    await settleOpsAlerts()
    mock.timers.tick(2 * 60 * 1000)
  }
  assert.equal(mail.sent.length, 1)
  assert.equal(mail.sent[0]!.to, 'ops@example.test')
  assert.match(mail.sent[0]!.subject, /backup\.restore_failed/)
  // 16 minutes after the first: a new window.
  mock.timers.tick(11 * 60 * 1000)
  logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, filename: 'later.sql.gz' })
  await settleOpsAlerts()
  assert.equal(mail.sent.length, 2)
  assert.match(String(mail.sent[1]!.text), /2 lần/, 'the next alert says how many repeats the window swallowed')
})

test('the limit is per event name: a different alert event in the same minute still goes out', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T02:00:00.000Z') })
  logWarn({ event: SECURITY_EVENTS.mfaChallengeLocked, username: 'cb01' })
  logWarn({ event: SECURITY_EVENTS.linkHostRejected, host: 'evil.test' })
  await settleOpsAlerts()
  assert.deepEqual(mail.sent.map(m => /: (\S+)$/.exec(m.subject)?.[1]).sort(), ['auth.mfa_challenge_locked', 'security.link_host_rejected'])
})

test('an event that is not on the list never alerts, at any level', async () => {
  logError({ event: 'backup.drive_failed', error: 'quota' })
  logWarn({ event: SECURITY_EVENTS.loginFailed, username: 'x' })
  await settleOpsAlerts()
  assert.equal(mail.sent.length, 0)
  assert.equal(fakeDb.connectionsOpened, 0)
})

test('alerts do not depend on LOG_LEVEL: a warn-level alert event alerts even when only errors are printed', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T03:00:00.000Z') })
  process.env.LOG_LEVEL = 'error'
  logWarn({ event: SECURITY_EVENTS.backupRestoreRefused, reason: 'not_super_admin' })
  await settleOpsAlerts()
  assert.equal(mail.sent.length, 1)
  assert.equal(logged(SECURITY_EVENTS.backupRestoreRefused).length, 0, 'the line itself is still filtered')
})

test('a failed send is swallowed and logged; the caller is unaffected and nothing rejects unhandled', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T04:00:00.000Z') })
  mail.fail = new Error('fixture: 535 auth failed')
  assert.doesNotThrow(() => logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, filename: 'y.sql.gz' }))
  await settleOpsAlerts()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(mail.sent.length, 0)
  const failure = logged('ops.alert_failed')
  assert.equal(failure.length, 1)
  assert.equal(failure[0]!.alertEvent, 'backup.restore_failed')
  assert.match(String(failure[0]!.error), /535 auth failed/)
  assert.deepEqual(unhandled, [])
  assert.equal(fakeDb.connectionsClosed, fakeDb.connectionsOpened, 'the short-lived connection is closed on the failure path too')
})

test('the database being down is a failed alert, not a crash', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T05:00:00.000Z') })
  fakeDb.connectFails = true
  logError({ event: BOOT_MIGRATION_EVENTS.mediaCategoryFkBlocked, danglingRows: 3 })
  await settleOpsAlerts()
  assert.equal(mail.sent.length, 0)
  assert.match(String(logged('ops.alert_failed')[0]?.error), /ECONNREFUSED/)
  assert.deepEqual(unhandled, [])
})

test('no recursion: the alert path\'s own lines carry the skip flag, and a flagged line never alerts', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T06:00:00.000Z') })
  // A flagged line with an alert event name is NOT dispatched.
  logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, [SKIP_OPS_ALERT]: true })
  await settleOpsAlerts()
  assert.equal(fakeDb.connectionsOpened, 0)
  assert.equal(logged(SECURITY_EVENTS.backupRestoreFailed).length, 1, 'the line is still written')
  assert.ok(!JSON.stringify(lines).includes('skipOpsAlert'), 'the flag is not serialised')

  // A failing send logs ops.alert_failed exactly once and starts no second dispatch.
  mail.fail = new Error('fixture: down')
  logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, filename: 'z.sql.gz' })
  await settleOpsAlerts()
  assert.equal(fakeDb.connectionsOpened, 1, 'exactly one dispatch')
  assert.equal(logged('ops.alert_failed').length, 1)

  // Every log call inside ops-alert.ts is flagged.
  const source = readFileSync(new URL('../server/utils/ops-alert.ts', import.meta.url), 'utf8')
  const calls = [...source.matchAll(/\blog(?:Info|Warn|Error)?\(\{[^}]*\}\)/g)].map(m => m[0])
  assert.ok(calls.length >= 3, `expected the alert path to log, found ${calls.length} calls`)
  for (const call of calls) assert.match(call, /\[SKIP_OPS_ALERT\]: true/, call)
})

test('the alert path never creates the shared connection pool, and closes what it opens (CLI boot must exit)', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T07:00:00.000Z') })
  logError({ event: BOOT_MIGRATION_EVENTS.mediaCategoryFkBlocked, danglingRows: 3 })
  await settleOpsAlerts()
  assert.equal(mail.sent.length, 1)
  assert.equal(fakeDb.poolsCreated, 0)
  assert.equal(fakeDb.connectionsOpened, 1)
  assert.equal(fakeDb.connectionsClosed, 1)
  // SMTP settings were read through that same connection, via the mailer's own resolution.
  assert.ok(fakeDb.queries.some(sql => /FROM `settings`/.test(sql)))
  assert.ok(fakeDb.queries.some(sql => sql.startsWith('INSERT INTO rate_limit_counters')), 'the shared rate-limit store was consulted')
})

test('another process already alerted in this window (shared store) → no second e-mail', async () => {
  const now = new Date('2026-10-24T08:00:00.000Z')
  mock.timers.enable({ apis: ['Date'], now })
  fakeDb.counters.set('ops-alert:backup.slot_abandoned', { hit_count: 1, window_expires_at: new Date(now.getTime() + 10 * 60 * 1000) })
  logWarn({ event: 'backup.slot_abandoned', slot: '2026-10-24T03', failures: 3 })
  await settleOpsAlerts()
  assert.equal(mail.sent.length, 0)
  assert.equal(logged('ops.alert_failed').length, 0, 'suppression is not a failure')
})

// ─── The dispatcher, with injected dependencies ───────────────────────────────
function harness(over: Partial<Parameters<typeof createOpsAlertDispatcher>[0]> = {}) {
  let clock = Date.parse('2026-10-24T09:00:00.000Z')
  const sent: Array<{ to: string, subject: string, text?: string }> = []
  let opened = 0
  const dispatcher = createOpsAlertDispatcher({
    recipients: () => 'ops@example.test',
    now: () => clock,
    host: () => 'cdkt.example.test',
    openSession: async () => {
      opened += 1
      return {
        execute: null,
        smtpConfig: async () => ({ host: 'smtp', port: 587, secure: false, user: 'u', pass: 'p', from: 'u' }),
        close: async () => {},
      }
    },
    sendMail: async args => { sent.push(args) },
    ...over,
  })
  return { dispatcher, sent, opened: () => opened, advance: (ms: number) => { clock += ms } }
}
const record = (event: string, extra: Record<string, unknown> = {}) => ({ level: 'warn', time: '2026-10-24T09:00:00.000Z', event, ...extra })

test('a burst of the same event in one tick sends one e-mail (the in-memory mark is taken synchronously)', async () => {
  const h = harness()
  await Promise.all([1, 2, 3, 4, 5].map(() => h.dispatcher.dispatch(record('backup.restore_failed'))))
  assert.equal(h.sent.length, 1)
  assert.equal(h.opened(), 1, 'the repeats never reach the database either')
})

test('a cross-site refusal (2A origin gate) is rate-limited harder: one e-mail per 6 hours, not per 15 minutes', async () => {
  // D-ALERT: a browser posting from another site is either a probe that repeats for
  // hours or a misconfigured integration — the first refusal is the signal, the rest
  // are in the log. Six hours: four e-mails a day at most for a campaign that never stops.
  const event = SECURITY_EVENTS.crossSiteRefused
  assert.equal(OPS_ALERT_WINDOW_SECONDS[event], 6 * 60 * 60)
  assert.ok(OPS_ALERT_WINDOW_SECONDS[event]! > OPS_ALERT_WINDOW_SECONDS.default!)
  const h = harness()
  await h.dispatcher.dispatch(record(event, { method: 'POST', path: '/api/admin/users', originHost: 'evil.example' }))
  assert.equal(h.sent.length, 1)
  assert.match(h.sent[0]!.subject, /security\.cross_site_refused/)
  h.advance(15 * 60 * 1000 + 1) // past the default window
  await h.dispatcher.dispatch(record(event))
  h.advance(5 * 60 * 60 * 1000) // 5 h 15 min after the first
  await h.dispatcher.dispatch(record(event))
  assert.equal(h.sent.length, 1, 'still inside the six-hour window')
  h.advance(45 * 60 * 1000) // 6 h after the first
  await h.dispatcher.dispatch(record(event))
  assert.equal(h.sent.length, 2)
  assert.match(String(h.sent[1]!.text), /Trong 360 phút trước đó còn 2 lần/, 'the next e-mail counts what the window swallowed')
})

test('the origin gate\'s refusal alerts through the real logger, once per window', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T07:00:00.000Z') })
  for (let i = 0; i < 3; i += 1) {
    logWarn({ event: SECURITY_EVENTS.crossSiteRefused, method: 'POST', path: '/api/admin/settings', originHost: 'evil.example', reason: 'origin_not_allowed' })
    await settleOpsAlerts()
    mock.timers.tick(20 * 60 * 1000)
  }
  assert.equal(mail.sent.length, 1)
  assert.match(mail.sent[0]!.subject, /security\.cross_site_refused/)
  assert.match(String(mail.sent[0]!.text), /originHost: evil\.example/)
})

test('the window is 15 minutes by default and can be set per event', async () => {
  assert.equal(OPS_ALERT_WINDOW_SECONDS.default, 15 * 60)
  const h = harness()
  await h.dispatcher.dispatch(record('backup.restore_failed'))
  h.advance(14 * 60 * 1000)
  await h.dispatcher.dispatch(record('backup.restore_failed'))
  assert.equal(h.sent.length, 1)
  h.advance(60 * 1000 + 1)
  await h.dispatcher.dispatch(record('backup.restore_failed'))
  assert.equal(h.sent.length, 2)
})

test('the message carries the event, the time and non-secret context only', () => {
  const { subject, text } = buildOpsAlertMessage(record('backup.restore_failed', {
    userId: 5, username: 'cb01', filename: 'cdkt-x.sql.gz', reason: 'sql_failed',
    password: '[redacted]', apiKey: '[redacted]',
    error: { name: 'Error', message: 'Duplicate entry', stack: 'Error: Duplicate entry\n    at /app/server/x.ts:1:1' },
    nested: { deep: { secret: 'no' } },
    note: 'A'.repeat(1000),
  }), { host: 'cdkt.example.test', suppressed: 0, windowSeconds: 900 })
  assert.equal(subject, '[CDKT cdkt.example.test] Cảnh báo vận hành: backup.restore_failed')
  assert.match(text, /Sự kiện: backup\.restore_failed/)
  assert.match(text, /2026-10-24T09:00:00\.000Z/)
  assert.match(text, /filename: cdkt-x\.sql\.gz/)
  assert.match(text, /error: Duplicate entry/)
  assert.doesNotMatch(text, /at \/app\/server/, 'no stack trace')
  assert.doesNotMatch(text, /password|apiKey|redacted/i, 'redacted keys are dropped entirely')
  assert.doesNotMatch(text, /secret: no|nested/, 'nested objects are not dumped')
  assert.ok(!text.includes('A'.repeat(300)), 'long values are cut')
  assert.match(text, /15 phút/)
})

test('OPS_ALERT_EMAIL: a list of addresses is accepted; anything that is not an address disables sending', () => {
  assert.equal(parseAlertRecipients(''), null)
  assert.equal(parseAlertRecipients(undefined), null)
  assert.deepEqual(parseAlertRecipients(' ops@a.test , oncall@b.test '), ['ops@a.test', 'oncall@b.test'])
  assert.deepEqual(parseAlertRecipients('ops@a.test\nBcc: x@y.test'), [], 'a header injection is not an address list')
  assert.deepEqual(parseAlertRecipients('not-an-address'), [])
})

test('an invalid OPS_ALERT_EMAIL is reported once and nothing is sent', async () => {
  const h = harness({ recipients: () => 'nope' })
  await h.dispatcher.dispatch(record('backup.restore_failed'))
  await h.dispatcher.dispatch(record('auth.mfa_challenge_locked'))
  assert.equal(h.sent.length, 0)
  assert.equal(h.opened(), 0)
  assert.equal(logged('ops.alert_misconfigured').length, 1)
})

test('SMTP not configured is a logged failure, once per window', async () => {
  const h = harness({
    openSession: async () => ({ execute: null, smtpConfig: async () => null, close: async () => {} }),
  })
  await h.dispatcher.dispatch(record('backup.restore_failed'))
  await h.dispatcher.dispatch(record('backup.restore_failed'))
  assert.equal(h.sent.length, 0)
  assert.equal(logged('ops.alert_failed').length, 1)
  assert.match(String(logged('ops.alert_failed')[0]!.error), /SMTP/)
})

test('dispatch never rejects, whatever its dependencies throw', async () => {
  const h = harness({ openSession: async () => { throw new Error('boom') }, sendMail: async () => { throw new Error('boom') } })
  await assert.doesNotReject(h.dispatcher.dispatch(record('backup.restore_failed')))
  const throwing = harness({ recipients: () => { throw new Error('env exploded') } })
  await assert.doesNotReject(throwing.dispatcher.dispatch(record('backup.restore_failed')))
})

test('logInfo of an alert event alerts too (the level does not decide what is alert-worthy)', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T10:00:00.000Z') })
  logInfo({ event: SECURITY_EVENTS.linkHostRejected, host: 'evil.test' })
  await settleOpsAlerts()
  assert.equal(mail.sent.length, 1)
})
