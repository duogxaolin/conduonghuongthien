import assert from 'node:assert/strict'
import test, { afterEach, beforeEach, mock } from 'node:test'
import type { ChatbotSettings } from '../server/db/schema'
import type { ChatDependencies, ChatEvent } from '../server/utils/chatbot/chat-policy'

/**
 * Part 4 (operations): the chatbot's output-side sovereignty guard no longer trips in silence. When it
 * replaces a model answer (`chatbot.sovereignty_output_replaced`) or a cached one
 * (`chatbot.sovereignty_cached_answer_replaced`), the EXISTING ops-alert mechanism (`ops-alert.ts`,
 * `OPS_ALERT_EMAIL`) e-mails the operators. These tests run the REAL `answerGroundedChat` → real logger →
 * real `ops-alert.ts` default wiring, with only the edges faked (MySQL connection, SMTP, answer cache,
 * AI gateway), and prove:
 *   - the first trip mails; a burst mails once per window and the next mail carries the swallowed count;
 *   - the mail carries NO personal data (no question, no answer, no session, no IP) — even if a future log
 *     line adds such fields;
 *   - a hanging/failing/missing SMTP, or an unset OPS_ALERT_EMAIL, never changes what the citizen gets
 *     and never delays it: the official stance, as before.
 * The matcher's routine answer (`chatbot.sovereignty_answered`) is deliberately NOT an alert.
 */

// ─── Edges: MySQL connection for the alert path, SMTP ─────────────────────────
type Counter = { hit_count: number, window_expires_at: Date }
const fakeDb = {
  counters: new Map<string, Counter>(),
  smtp: [{ key: 'smtp_host', value: 'smtp.example.test' }, { key: 'smtp_user', value: 'ops@example.test' }] as Array<{ key: string, value: string }>,
  connectionsOpened: 0,
}
const poolQueries: string[] = []
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
    if (/FROM `settings`/.test(sql)) return [fakeDb.smtp.filter(row => (params[0] as string[]).includes(row.key)), []]
    throw new Error(`fake connection cannot run: ${sql}`)
  },
  end: async () => {},
})
const mysqlFake = {
  createConnection: async () => { fakeDb.connectionsOpened += 1; return fakeConnection() },
  // The chat path's own AI-quota counters use the shared pool (a database that is down → the store's memory
  // fallback). The alert path must never touch it: every pool query is recorded and checked below.
  createPool: () => ({
    query: async (sql: string, params: unknown[] = []) => { poolQueries.push(`${sql} ${JSON.stringify(params)}`); throw new Error('fixture: pool down') },
  }),
}
mock.module('mysql2/promise', { defaultExport: mysqlFake, namedExports: mysqlFake })

type Mail = { to: string, subject: string, text?: string }
const mail = {
  sent: [] as Mail[],
  fail: null as null | Error,
  /** When set, `sendMail` waits for it — SMTP that hangs. */
  gate: null as null | Promise<void>,
}
mock.module('../server/utils/mailer', {
  namedExports: {
    SMTP_KEYS: ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from'],
    getSmtpConfig: async (read: () => Promise<Record<string, string>>) => {
      const map = await read()
      return map.smtp_host ? { host: map.smtp_host, port: 587, secure: false, user: map.smtp_user ?? '', pass: '', from: map.smtp_user ?? '' } : null
    },
    sendMail: async (args: Mail) => {
      if (mail.gate) await mail.gate
      if (mail.fail) throw mail.fail
      mail.sent.push(args)
    },
  },
})

// ─── Edges: answer cache, AI gateway ──────────────────────────────────────────
const cache = { stored: null as null | { answer: string, sources: unknown[], followUps: string[], kind: string }, discarded: [] as string[] }
const KEY = 'c'.repeat(64)
mock.module('../server/services/chatbot-answer-cache', {
  namedExports: {
    answerCacheKey: (input: { historyLength: number }) => (input.historyLength > 1 ? null : KEY),
    readCachedAnswer: async () => cache.stored,
    writeCachedAnswer: async () => true,
    discardCachedAnswer: async (key: string) => { cache.discarded.push(key); return true },
  },
})
const provider = { calls: 0, text: '' }
mock.module('../server/services/ai-gateway', {
  namedExports: {
    callAi: async (_service: string, input: { onChunk?: (chunk: string) => void | Promise<void> }) => {
      provider.calls += 1
      await input.onChunk?.(provider.text)
      return { ok: true, text: provider.text }
    },
  },
})

const { answerGroundedChat } = await import('../server/utils/chatbot/chat-policy')
const { sovereigntyAnswer } = await import('../server/utils/chatbot/sovereignty-guard')
const { ALERT_EVENTS, settleOpsAlerts } = await import('../server/utils/logger')
const { buildOpsAlertMessage, OPS_ALERT_WINDOW_SECONDS, SOVEREIGNTY_ALERT_EVENTS, SOVEREIGNTY_ALERT_WINDOW_SECONDS } = await import('../server/utils/ops-alert')

const OUTPUT_EVENT = 'chatbot.sovereignty_output_replaced'
const CACHED_EVENT = 'chatbot.sovereignty_cached_answer_replaced'
// Markers that must never reach an operator's inbox.
const QUESTION = 'Làm sao để xóa án tích? (mã-câu-hỏi-ZQX81)'
const SESSION_ID = 'phiên-bí-mật-7f3a9c'
const CLIENT_IP = '198.51.100.77'
const CLAIM_ANSWER = 'Ngoài ra, quần đảo Hoàng Sa thuộc chủ quyền của nước khác. (mã-câu-trả-lời-QWV42)'
const PII_MARKERS = ['ZQX81', 'QWV42', SESSION_ID, CLIENT_IP, '198.51.100', 'xóa án tích', 'Hoàng Sa']

function settingsOf(): ChatbotSettings {
  return {
    enabled: true, baseUrl: 'https://api.provider.example/v1', model: 'safe-model', systemPrompt: 'Prompt quản trị tự viết.',
    allowedHosts: ['api.provider.example'], requestTimeoutMs: 1_000, maxResponseBytes: 16_384, maxInputChars: 2_000,
    maxHistoryMessages: 8, retrievalTopK: 3, referenceCharBudget: 6_000, rateLimitRequests: 100, rateLimitWindowSeconds: 60,
    leadCaptureEnabled: true, mode: 'ai', outOfScopeBehavior: 'ai_freeform', answerCacheVersion: 7,
  } as ChatbotSettings
}
const event = () => ({
  node: { req: { headers: {}, socket: { remoteAddress: CLIENT_IP } } },
  context: { chatRateLimit: { retryAfter: null }, chatSessionId: SESSION_ID },
}) as unknown as ChatEvent
const dependencies: ChatDependencies = {
  loadPublishedEntries: async () => [],
  loadSmallTalkEntries: async () => [],
  configuredSecret: () => 'secret-key',
  providerRequest: async () => { throw new Error('the gateway answers in these tests') },
}
const ask = (question = QUESTION) => answerGroundedChat(event(), settingsOf(), [{ role: 'user', content: question }], dependencies)

/** One model answer that the output guard replaces. */
const modelTrip = () => { cache.stored = null; provider.text = CLAIM_ANSWER; return ask() }
/** One cached answer that the stance re-check replaces. */
const cachedTrip = () => {
  cache.stored = { answer: CLAIM_ANSWER, sources: [], followUps: [], kind: 'provider' }
  return ask()
}
const alertPoolQueries = () => poolQueries.filter(query => query.includes('ops-alert'))
const allMailText = () => mail.sent.map(m => `${m.to}\n${m.subject}\n${m.text}`).join('\n=====\n')
const flush = async () => { await settleOpsAlerts(); await new Promise(resolve => setImmediate(resolve)) }

const lines: Array<Record<string, unknown>> = []
let consoleSpies: Array<{ mock: { restore: () => void } }> = []
let unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
// One start instant per test, an hour apart: the dispatcher's in-memory marks live as long as the module.
let hour = 0
const startClock = () => mock.timers.enable({ apis: ['Date'], now: new Date(Date.UTC(2026, 10, 7, hour++, 0, 0)) })

beforeEach(() => {
  lines.length = 0
  unhandled = []
  const capture = (...args: unknown[]) => { try { lines.push(JSON.parse(String(args[0]))) } catch { /* not a log line */ } }
  consoleSpies = [mock.method(console, 'error', capture), mock.method(console, 'log', capture)]
  process.on('unhandledRejection', onUnhandled)
  Object.assign(mail, { sent: [], fail: null, gate: null })
  Object.assign(cache, { stored: null, discarded: [] })
  provider.calls = 0
  fakeDb.counters.clear()
  fakeDb.connectionsOpened = 0
  poolQueries.length = 0
  fakeDb.smtp = [{ key: 'smtp_host', value: 'smtp.example.test' }, { key: 'smtp_user', value: 'ops@example.test' }]
  process.env.OPS_ALERT_EMAIL = 'ops@example.test'
})
afterEach(() => {
  for (const spy of consoleSpies) spy.mock.restore()
  mock.timers.reset()
  process.off('unhandledRejection', onUnhandled)
  delete process.env.OPS_ALERT_EMAIL
})

// ─── Wiring ───────────────────────────────────────────────────────────────────
test('both guard trips are alert events with a 10-minute window; the routine matcher answer is not', () => {
  for (const name of [OUTPUT_EVENT, CACHED_EVENT]) {
    assert.ok(ALERT_EVENTS.includes(name), `${name} must page an operator`)
    assert.ok((SOVEREIGNTY_ALERT_EVENTS as readonly string[]).includes(name))
    assert.equal(OPS_ALERT_WINDOW_SECONDS[name], SOVEREIGNTY_ALERT_WINDOW_SECONDS)
  }
  assert.equal(SOVEREIGNTY_ALERT_WINDOW_SECONDS, 600)
  assert.equal(ALERT_EVENTS.filter(name => name.startsWith('chatbot.sovereignty')).length, 2)
  assert.ok(!ALERT_EVENTS.includes('chatbot.sovereignty_answered'), 'the matcher answers routinely — that is not an incident')
})

// ─── First trip, burst, aggregation ───────────────────────────────────────────
test('the first model-answer trip e-mails the operators, and the citizen still gets the official stance', async () => {
  startClock()
  const result = await modelTrip()
  assert.equal(result.answer, sovereigntyAnswer(QUESTION))
  assert.equal(result.kind, 'curated')
  await flush()
  assert.equal(provider.calls, 1, 'precondition: the trip came from a real model call')
  assert.equal(mail.sent.length, 1)
  assert.equal(mail.sent[0]!.to, 'ops@example.test')
  assert.match(mail.sent[0]!.subject, /chatbot\.sovereignty_output_replaced/)
  assert.match(String(mail.sent[0]!.text), /docs\/runbooks\/chatbot-sovereignty-incident\.md/, 'the mail points at the runbook')
  assert.match(String(mail.sent[0]!.text), /model answer withheld/, 'the fixed, non-identifying consequence line is kept')
  assert.deepEqual(alertPoolQueries(), [], 'the alert used its own short-lived connection, never the shared pool')
  assert.equal(fakeDb.connectionsOpened, 1)
})

test('a burst inside one window sends ONE mail; the next window\'s mail says how many trips it swallowed', async () => {
  startClock()
  for (let i = 0; i < 5; i += 1) {
    const result = await modelTrip()
    assert.equal(result.answer, sovereigntyAnswer(QUESTION), `trip ${i} still answered with the stance`)
    mock.timers.tick(30 * 1000)
  }
  await flush()
  assert.equal(mail.sent.length, 1, 'five trips in 2.5 minutes → one e-mail')
  assert.doesNotMatch(String(mail.sent[0]!.text), /không gửi thư/, 'the first mail has nothing swallowed to report')
  // 11 minutes after the first: a new window.
  mock.timers.tick(11 * 60 * 1000)
  await modelTrip()
  await flush()
  assert.equal(mail.sent.length, 2)
  assert.match(String(mail.sent[1]!.text), /còn 4 lần cùng sự kiện không gửi thư/, 'the aggregated count of the burst')
  assert.match(String(mail.sent[1]!.text), /10 phút/, 'the window is stated')
})

test('a cached-answer trip alerts on its own event, separately from a model-answer trip in the same minute', async () => {
  startClock()
  await modelTrip()
  const cached = await cachedTrip()
  assert.equal(cached.answer, sovereigntyAnswer(QUESTION))
  assert.deepEqual(cache.discarded, [KEY], 'the cached row is dropped, as before')
  await flush()
  assert.deepEqual(mail.sent.map(m => /: (\S+)$/.exec(m.subject)?.[1]).sort(), [CACHED_EVENT, OUTPUT_EVENT])
})

// ─── No personal data ─────────────────────────────────────────────────────────
test('the e-mail carries no question, answer, session or IP — checked on the whole payload of both trips', async () => {
  startClock()
  await modelTrip()
  await cachedTrip()
  await flush()
  assert.equal(mail.sent.length, 2)
  const payload = allMailText()
  for (const marker of PII_MARKERS) assert.ok(!payload.includes(marker), `"${marker}" must not be in an alert e-mail:\n${payload}`)
})

test('even a future log line that adds the question, answer, session or IP cannot put them in the e-mail', () => {
  const record = {
    level: 'warn', time: '2026-11-07T00:00:00.000Z', event: OUTPUT_EVENT,
    consequence: 'model answer withheld, fixed official answer sent instead',
    question: QUESTION, answer: CLAIM_ANSWER, sessionId: SESSION_ID, ip: CLIENT_IP, count: 3,
  }
  const { subject, text } = buildOpsAlertMessage(record, { host: 'cdkt.example', suppressed: 0, windowSeconds: SOVEREIGNTY_ALERT_WINDOW_SECONDS })
  const payload = `${subject}\n${text}`
  for (const marker of PII_MARKERS) assert.ok(!payload.includes(marker), marker)
  assert.match(payload, /model answer withheld/)
  // Every other alert event keeps its full (scrubbed) context: the allowlist is per sovereignty event only.
  const other = buildOpsAlertMessage({ level: 'warn', time: record.time, event: 'backup.restore_failed', filename: 'x.sql.gz' }, { host: 'cdkt.example', suppressed: 0, windowSeconds: 900 })
  assert.match(other.text, /filename: x\.sql\.gz/)
})

// ─── The citizen is never affected ────────────────────────────────────────────
test('SMTP that hangs does not delay the answer: the citizen gets the stance while the mail is still in flight', async () => {
  startClock()
  let release: () => void = () => {}
  mail.gate = new Promise<void>((resolve) => { release = resolve })
  try {
    // Raced against a real timer: a regression that waits for the mail must fail, not hang the suite.
    const result = await Promise.race([
      modelTrip(), // resolves although sendMail has not returned
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('the answer waited for the alert e-mail')), 2_000).unref()),
    ])
    assert.equal(result.answer, sovereigntyAnswer(QUESTION))
    assert.equal(mail.sent.length, 0, 'the mail has not gone out yet')
  } finally {
    release()
  }
  await flush()
  assert.equal(mail.sent.length, 1)
})

test('a failing send is logged, never thrown into the chat, and the stance is still delivered', async () => {
  startClock()
  mail.fail = new Error('fixture: 535 auth failed')
  const result = await modelTrip()
  assert.equal(result.answer, sovereigntyAnswer(QUESTION))
  await flush()
  assert.equal(mail.sent.length, 0)
  const failure = lines.filter(line => line.event === 'ops.alert_failed')
  assert.equal(failure.length, 1)
  assert.equal(failure[0]!.alertEvent, OUTPUT_EVENT)
  assert.deepEqual(unhandled, [])
  // The guard's own log line is still written: the log remains the full record.
  assert.equal(lines.filter(line => line.event === OUTPUT_EVENT).length, 1)
})

test('SMTP not configured in admin → silent fallback to the log; the stance is delivered', async () => {
  startClock()
  fakeDb.smtp = []
  const result = await modelTrip()
  assert.equal(result.answer, sovereigntyAnswer(QUESTION))
  await flush()
  assert.equal(mail.sent.length, 0)
  assert.match(String(lines.find(line => line.event === 'ops.alert_failed')?.error), /SMTP chưa được cấu hình/)
  assert.equal(lines.filter(line => line.event === OUTPUT_EVENT).length, 1)
  assert.deepEqual(unhandled, [])
})

test('OPS_ALERT_EMAIL unset → no database is touched, nothing is mailed, the stance is delivered', async () => {
  startClock()
  delete process.env.OPS_ALERT_EMAIL
  const result = await modelTrip()
  assert.equal(result.answer, sovereigntyAnswer(QUESTION))
  await flush()
  assert.equal(mail.sent.length, 0)
  assert.equal(fakeDb.connectionsOpened, 0)
  assert.equal(lines.filter(line => line.event === OUTPUT_EVENT).length, 1)
})

test('no trip, no alert: a clean model answer sends nothing', async () => {
  startClock()
  cache.stored = null
  provider.text = 'Anh/chị liên hệ Công an xã nơi cư trú để được hướng dẫn.'
  const result = await ask()
  assert.equal(result.answer, provider.text)
  await flush()
  assert.equal(mail.sent.length, 0)
})
