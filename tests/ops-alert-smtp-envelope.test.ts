import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test, { afterEach, beforeEach, mock } from 'node:test'

/**
 * wave2 integration (CHANGELOG § 38, C): an ops alert (§ 36, D-ALERT) sends through
 * the SMTP password that 2A (§ 33, D-SECRETS) now stores as an envelope.
 *
 * The alert path reads `smtp_*` over its own short-lived connection (it also runs in
 * the boot CLI, which must not create the shared pool) and hands that reader to
 * `getSmtpConfig(read)` — the SAME resolution every other mail uses, which is where 2A
 * decrypts. A merge that kept the reader but lost the decryption would log in to the
 * SMTP server with the envelope JSON as the password; one that kept the decryption but
 * dropped the reader would open the pool from the boot CLI.
 *
 * Everything real except the two edges: `mysql2/promise` (the short-lived connection)
 * and `nodemailer` (the transport — what it is given is the assertion).
 */

process.env.CHATBOT_ENCRYPTION_SECRET = randomBytes(32).toString('base64')

const { sealSettingsSecret } = await import('../server/utils/settings-secrets')
const SMTP_PASSWORD = 'Mật-khẩu SMTP thật #1'

// ─── The short-lived connection's database ────────────────────────────────────
const fakeDb = {
  settings: [] as Array<{ key: string, value: string }>,
  counters: new Map<string, { hit_count: number, window_expires_at: Date }>(),
  poolsCreated: 0,
}
const fakeConnection = () => ({
  query: async (sql: string, params: unknown[] = []) => {
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
    if (/FROM `settings`/.test(sql)) return [fakeDb.settings.filter(row => (params[0] as string[]).includes(row.key)), []]
    throw new Error(`fake connection cannot run: ${sql}`)
  },
  end: async () => {},
})
const mysqlFake = {
  createConnection: async () => fakeConnection(),
  createPool: () => { fakeDb.poolsCreated += 1; throw new Error('the alert path must never create the shared pool') },
}
mock.module('mysql2/promise', { defaultExport: mysqlFake, namedExports: mysqlFake })

// ─── The SMTP transport ───────────────────────────────────────────────────────
const transports: Array<{ options: { auth?: { user: string, pass: string } }, sent: Array<Record<string, unknown>> }> = []
const nodemailerFake = {
  createTransport: (options: { auth?: { user: string, pass: string } }) => {
    const transport = { options, sent: [] as Array<Record<string, unknown>> }
    transports.push(transport)
    return {
      sendMail: async (message: Record<string, unknown>) => { transport.sent.push(message) },
      close: () => {},
    }
  },
}
mock.module('nodemailer', { defaultExport: nodemailerFake, namedExports: nodemailerFake })

const { SECURITY_EVENTS, logWarn, settleOpsAlerts } = await import('../server/utils/logger')
const { getSmtpConfig, SMTP_PASSWORD_UNREADABLE_MESSAGE } = await import('../server/utils/mailer')

// ─── Log capture ─────────────────────────────────────────────────────────────
let lines: Array<Record<string, unknown>> = []
const capture = (...args: unknown[]) => {
  try { lines.push(JSON.parse(String(args[0]))) } catch { /* not a log line */ }
}
let consoleSpies: Array<{ mock: { restore: () => void } }> = []
beforeEach(() => {
  lines = []
  transports.length = 0
  fakeDb.counters.clear()
  consoleSpies = [mock.method(console, 'error', capture), mock.method(console, 'log', capture)]
  process.env.OPS_ALERT_EMAIL = 'ops@example.test'
})
afterEach(() => {
  for (const spy of consoleSpies) spy.mock.restore()
  delete process.env.OPS_ALERT_EMAIL
})
const logged = (event: string) => lines.filter(line => line.event === event)

const smtpRows = (smtpPass: string) => [
  { key: 'smtp_host', value: 'smtp.example.test' },
  { key: 'smtp_user', value: 'ops-sender@example.test' },
  { key: 'smtp_pass', value: smtpPass },
]

test('getSmtpConfig(read) resolves through the given reader and decrypts the stored envelope', async () => {
  const envelope = sealSettingsSecret('smtp_pass', SMTP_PASSWORD)
  const config = await getSmtpConfig(async () => Object.fromEntries(smtpRows(envelope).map(row => [row.key, row.value])))
  assert.equal(config?.pass, SMTP_PASSWORD)
  assert.equal(config?.passUnreadable, undefined)
  assert.equal(fakeDb.poolsCreated, 0, 'a given reader means no shared pool')
})

test('an ops alert logs in to SMTP with the decrypted password, never the envelope', async () => {
  const envelope = sealSettingsSecret('smtp_pass', SMTP_PASSWORD)
  fakeDb.settings = smtpRows(envelope)
  logWarn({ event: SECURITY_EVENTS.backupRestoreFailed, filename: 'cdkt-x.sql.gz', reason: 'sql_failed' })
  await settleOpsAlerts()
  assert.equal(transports.length, 1, `one transport: ${JSON.stringify(logged('ops.alert_failed'))}`)
  assert.deepEqual(transports[0]!.options.auth, { user: 'ops-sender@example.test', pass: SMTP_PASSWORD })
  assert.equal(transports[0]!.sent.length, 1)
  assert.equal(transports[0]!.sent[0]!.to, 'ops@example.test')
  assert.equal(logged('ops.alert_sent').length, 1)
  assert.equal(fakeDb.poolsCreated, 0, 'the alert path still never creates the shared pool')
})

test('an SMTP password the current key cannot open: the alert is not sent unauthenticated — it fails with the re-entry message', async () => {
  const otherKey = randomBytes(32).toString('base64')
  fakeDb.settings = smtpRows(sealSettingsSecret('smtp_pass', SMTP_PASSWORD, otherKey))
  logWarn({ event: SECURITY_EVENTS.backupRestoreRefused, reason: 'not_super_admin' })
  await settleOpsAlerts()
  assert.equal(transports.length, 0, 'no transport was opened')
  const failures = logged('ops.alert_failed')
  assert.equal(failures.length, 1)
  assert.equal(failures[0]!.alertEvent, 'backup.restore_refused')
  assert.equal(failures[0]!.error, SMTP_PASSWORD_UNREADABLE_MESSAGE)
})
