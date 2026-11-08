import assert from 'node:assert/strict'
import test, { after, beforeEach, mock } from 'node:test'

/**
 * Two public chatbot endpoints no suite ran before: `POST /api/public/chatbot/lead` (the visitor
 * leaves contact details when the bot has no answer) and `GET /api/public/chatbot/sources?id=`
 * (the full text behind a citation). Run as the real handlers: real h3 app, Drizzle's own MySQL
 * statements executed on SQLite (tests/_sqlite-mysql-db.ts).
 *
 * What is pinned:
 *   - lead: the rate limit is charged FIRST — a refused request writes nothing and validates
 *     nothing; one `submissions` row with the fixed form title and the visitor's fields; the
 *     recipient is chosen server-side (chatbot lead e-mail, else the site `email` setting) and a
 *     broken mail step — including a failed settings read — never fails the visitor;
 *   - sources: a non-integer id is 400, a draft is 404 like an unknown id, a published row comes
 *     back as exactly id/question/answer/topic/source.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { submissions, settings, chatbotKnowledge } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([submissions, settings, chatbotKnowledge])

const errors: Array<Record<string, unknown>> = []
mock.module('../server/utils/logger', {
  namedExports: {
    log: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: (fields: Record<string, unknown>) => { errors.push(fields) },
    SECURITY_EVENTS: new Proxy({}, { get: (_target, key) => `event.${String(key)}` }),
  },
})
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })

/** Each charge, in order, with the statements already run when it was charged. */
const charges: Array<{ key: string, rule: unknown, statementsBefore: number }> = []
let blocked = false
mock.module('../server/utils/rate-limit-store', {
  namedExports: {
    recordRateLimitHit: async (key: string, rule: unknown) => {
      charges.push({ key, rule, statementsBefore: harness.statements.length })
      return { blocked, count: blocked ? 6 : 1, remaining: blocked ? 0 : 4, resetAt: Date.now() + 600_000 }
    },
  },
})

let leadCaptureEmail = ''
mock.module('../server/services/chatbot-settings', {
  namedExports: { getChatbotSettings: async () => ({ leadCaptureEmail }) },
})

let smtpConfigured = true
const mails: Array<{ to: string, subject: string, text: string, html: string }> = []
mock.module('../server/utils/mailer', {
  namedExports: {
    getSmtpConfig: async () => (smtpConfigured ? { host: 'smtp.example.test', port: 587 } : null),
    sendMail: async (args: { to: string, subject: string, text: string, html: string }) => { mails.push(args) },
  },
})

const { installH3Globals, startHandlerServer } = await import('./_h3-handler-server')
installH3Globals()
const lead = (await import('../server/api/public/chatbot/lead.post')).default
const sources = (await import('../server/api/public/chatbot/sources.get')).default
const server = await startHandlerServer([
  { method: 'post', path: '/api/public/chatbot/lead', handler: lead },
  { method: 'get', path: '/api/public/chatbot/sources', handler: sources },
])
after(() => server.close())

const postLead = (body: unknown) => server.request('POST', '/api/public/chatbot/lead', { body })

beforeEach(async () => {
  harness.reset()
  errors.length = 0
  charges.length = 0
  mails.length = 0
  blocked = false
  leadCaptureEmail = ''
  smtpConfigured = true
})

test('lead: one submissions row with the visitor\'s fields and the fixed form title; the id is returned', async () => {
  leadCaptureEmail = 'tiepnhan@example.vn'
  const response = await postLead({ name: '  Nguyễn Văn A  ', phone: '0912 345 678', question: 'Tôi cần hỏi về xoá án tích' })
  assert.equal(response.status, 200)
  const rows = harness.rows(submissions)
  assert.equal(rows.length, 1)
  assert.deepEqual(response.body, { ok: true, id: rows[0]!.id })
  assert.equal(rows[0]!.fullName, 'Nguyễn Văn A')
  assert.equal(rows[0]!.phone, '0912 345 678')
  assert.equal(rows[0]!.email, null)
  assert.equal(rows[0]!.message, 'Tôi cần hỏi về xoá án tích')
  assert.equal(rows[0]!.formTitle, 'Chatbot – Yêu cầu hỗ trợ')
  assert.equal(rows[0]!.status, 'new')
  // The chatbot's own lead address wins; the settings table is not read at all.
  assert.deepEqual(mails.map(mail => mail.to), ['tiepnhan@example.vn'])
  assert.ok(!harness.statements.some(sql => /from `settings`/.test(sql)), 'settings read although the chatbot address was set')
  assert.match(mails[0]!.text, /Số điện thoại: 0912 345 678/)
  assert.match(mails[0]!.text, /Email: \(không cung cấp\)/)
})

test('lead: no name and only an e-mail — the placeholder name, an empty phone, the site e-mail as recipient', async () => {
  await harness.db.insert(settings).values({ key: 'email', value: '  lienhe@example.vn  ' })
  harness.statements.length = 0
  const response = await postLead({ email: 'khach@example.vn', message: 'Nội dung qua trường message' })
  assert.equal(response.status, 200)
  const [row] = harness.rows(submissions)
  assert.equal(row!.fullName, 'Khách (Chatbot)')
  assert.equal(row!.phone, '')
  assert.equal(row!.email, 'khach@example.vn')
  assert.equal(row!.message, 'Nội dung qua trường message', '`message` is read when `question` is absent')
  assert.deepEqual(mails.map(mail => mail.to), ['lienhe@example.vn'])
  assert.deepEqual(
    harness.statements.map(sql => sql.split(' ').slice(0, 4).join(' ')),
    ['insert into `submissions` (`id`,', 'select `value` from `settings`'],
    'the row is written first, then the fallback recipient is read',
  )
})

test('lead: a failed settings read is logged and the visitor still gets ok with the stored row', async () => {
  harness.failNext(/from `settings`/)
  const response = await postLead({ phone: '0912345678' })
  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(harness.rows(submissions).length, 1)
  assert.equal(mails.length, 0)
  assert.deepEqual(errors.map(entry => entry.event), ['chatbot.lead_email_failed'])
})

test('lead: no recipient configured, or no SMTP — stored, no mail, no error', async () => {
  assert.equal((await postLead({ phone: '0912345678' })).status, 200)
  leadCaptureEmail = 'tiepnhan@example.vn'
  smtpConfigured = false
  assert.equal((await postLead({ phone: '0912345679' })).status, 200)
  assert.equal(harness.rows(submissions).length, 2)
  assert.equal(mails.length, 0)
  assert.deepEqual(errors, [])
})

test('lead: the rate limit is charged before anything else; a refused request writes nothing', async () => {
  blocked = true
  const response = await postLead({ phone: 'not a phone' })
  assert.equal(response.status, 429, 'refused before the body is validated')
  assert.deepEqual(charges.map(charge => [charge.key, charge.rule, charge.statementsBefore]), [['lead:127.0.0.1', { limit: 5, windowSeconds: 600 }, 0]])
  assert.deepEqual(harness.statements, [])
  assert.equal(harness.rows(submissions).length, 0)
})

test('lead: invalid input is a 400 after the charge and writes nothing', async () => {
  for (const [body, message] of [
    [{ name: 'A' }, /số điện thoại hoặc email/],
    [{ phone: 'abc' }, /Số điện thoại không hợp lệ/],
    [{ email: 'khong-phai-email' }, /Email không hợp lệ/],
  ] as const) {
    const response = await postLead(body)
    assert.equal(response.status, 400, JSON.stringify(body))
    assert.match(String(response.body.message ?? response.body.statusMessage), message)
  }
  assert.equal(charges.length, 3)
  assert.deepEqual(harness.statements, [])
})

type Knowledge = typeof chatbotKnowledge.$inferInsert
const knowledge = (over: Partial<Knowledge> & Pick<Knowledge, 'id' | 'status'>): Knowledge => ({
  canonicalQuestion: `Câu hỏi ${over.id}`,
  normalizedQuestion: `cau hoi ${over.id}`,
  approvedAnswer: `Trả lời đầy đủ ${over.id}`,
  topic: 'Pháp luật',
  sourceLabel: 'Bộ luật Hình sự',
  internalNotes: 'INTERNAL-NOTE-SENTINEL',
  authorId: 77,
  ...over,
})

test('sources: a published row is served with exactly its public fields', async () => {
  await harness.db.insert(chatbotKnowledge).values([knowledge({ id: 4, status: 'published', sourceReference: 'Điều 70' })])
  const response = await server.request('GET', '/api/public/chatbot/sources?id=4')
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    ok: true,
    source: { id: 4, question: 'Câu hỏi 4', answer: 'Trả lời đầy đủ 4', topic: 'Pháp luật', source: { label: 'Bộ luật Hình sự', reference: 'Điều 70', url: null } },
  })
  assert.ok(!JSON.stringify(response.body).includes('INTERNAL-NOTE-SENTINEL'))
})

test('sources: a draft or archived row is a 404 exactly like an id that does not exist', async () => {
  await harness.db.insert(chatbotKnowledge).values([knowledge({ id: 5, status: 'draft' }), knowledge({ id: 6, status: 'archived' })])
  for (const id of ['5', '6', '999']) {
    const response = await server.request('GET', `/api/public/chatbot/sources?id=${id}`)
    assert.equal(response.status, 404, id)
  }
})

test('sources: a non-integer or non-positive id is a 400 and runs no query', async () => {
  for (const id of ['', 'abc', '0', '-3', '1.5', '9007199254740993']) {
    const response = await server.request('GET', `/api/public/chatbot/sources?id=${id}`)
    assert.equal(response.status, 400, id)
  }
  assert.deepEqual(harness.statements, [])
})
