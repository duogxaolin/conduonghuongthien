import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { aiModerationQueue } from '../server/db/schema.ts'

/**
 * Every instantly-blocked chat message used to write one `ai_moderation_queue`
 * row, so one address repeating a profane line buried the officers' review queue.
 * Public inbound flows (anonymous chatbot, reader comments, livestream chat) now
 * opt in to MODERATION_QUEUE_CAP rows per source per hour — per address (IPv6 by
 * /64) and, for signed-in readers, per account too. The message is still blocked
 * every time — only the review row is capped — and admin rescans (which do not
 * opt in) still record every hit.
 * Real moderation-worker; fake DB; rate-limit store on its in-process fallback.
 */

const queue: Array<Record<string, unknown>> = []
/** When set, the queue insert rejects with this error (see the logging test). */
let insertFailure: Error | null = null
const fakeDb = {
  select: () => ({ from: () => ({ where: async () => [] }) }),
  insert: (table: unknown) => ({
    values: async (row: Record<string, unknown>) => {
      if (table !== aiModerationQueue) return
      if (insertFailure) throw insertFailure
      queue.push(row)
    },
  }),
}
mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb, getPool: () => null } })
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url), { namedExports: { callAi: async () => ({ ok: true, text: '{}' }) } })

const { fastPreModerate } = await import('../server/services/moderation-worker.ts')
const { MODERATION_QUEUE_CAP } = await import('../server/services/moderation-instant.ts')

const PROFANE = 'mày dcm'

test('a flood from one address stops adding review rows at the cap, but every message is still blocked', async () => {
  queue.length = 0
  const ip = '203.0.113.50'
  let blocked = 0
  for (let i = 0; i < MODERATION_QUEUE_CAP.inserts * 3; i++) {
    const result = await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: ip, capQueuePerSource: true })
    if (result.blocked) blocked++
  }
  assert.equal(blocked, MODERATION_QUEUE_CAP.inserts * 3, 'the cap never lets a message through')
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts, `expected ${MODERATION_QUEUE_CAP.inserts} rows, got ${queue.length}`)
})

test('rotating the session token does not reset the cap — it is keyed on the address', async () => {
  queue.length = 0
  const ip = '203.0.113.51'
  for (let i = 0; i < MODERATION_QUEUE_CAP.inserts * 2; i++) {
    await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: ip, sessionId: `fresh-token-${i}`, capQueuePerSource: true })
  }
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts)
})

test('another address is recorded independently', async () => {
  queue.length = 0
  for (let i = 0; i < MODERATION_QUEUE_CAP.inserts + 5; i++) {
    await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: '203.0.113.52', capQueuePerSource: true })
  }
  await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: '198.51.100.9', capQueuePerSource: true })
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts + 1)
  assert.equal(queue.at(-1)!.authorIp, '198.51.100.9')
})

test('without an address, the session is the source', async () => {
  queue.length = 0
  for (let i = 0; i < MODERATION_QUEUE_CAP.inserts + 5; i++) {
    await fastPreModerate(PROFANE, { targetType: 'chat', sessionId: 'session-only', capQueuePerSource: true })
  }
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts)
})

test('flows that do not opt in (admin rescans) still record every hit', async () => {
  queue.length = 0
  const total = MODERATION_QUEUE_CAP.inserts * 2
  for (let i = 0; i < total; i++) {
    await fastPreModerate(PROFANE, { targetType: 'livestream_chat', contextTitle: `Quét lại tin #${i}` })
  }
  assert.equal(queue.length, total)
})

test('rotating addresses inside one IPv6 /64 does not reset the cap — the /64 is the source', async () => {
  queue.length = 0
  const total = MODERATION_QUEUE_CAP.inserts * 3
  for (let i = 1; i <= total; i++) {
    // A fresh interface id every message, same subscriber prefix.
    await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: `2001:db8:77:1:${i.toString(16)}::${(i * 13).toString(16)}`, capQueuePerSource: true })
  }
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts, `one /64 wrote ${queue.length} rows`)
  // A neighbouring /64 is another subscriber and is recorded on its own.
  await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: '2001:db8:77:2::1', capQueuePerSource: true })
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts + 1)
})

test('an IPv4-mapped address shares the bucket of the plain IPv4 address', async () => {
  queue.length = 0
  for (let i = 0; i < MODERATION_QUEUE_CAP.inserts; i++) {
    await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: '198.51.100.77', capQueuePerSource: true })
  }
  await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: '::ffff:198.51.100.77', capQueuePerSource: true })
  await fastPreModerate(PROFANE, { targetType: 'chat', authorIp: '::ffff:c633:644d', capQueuePerSource: true })
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts)
})

test('a signed-in reader is capped on the account even when the address keeps changing', async () => {
  queue.length = 0
  const total = MODERATION_QUEUE_CAP.inserts * 3
  for (let i = 1; i <= total; i++) {
    // Distinct IPv4 addresses: the address cap alone would record every one.
    await fastPreModerate(PROFANE, { targetType: 'comment', readerId: 4101, authorIp: `192.0.2.${i}`, capQueuePerSource: true })
  }
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts, `one account wrote ${queue.length} rows`)
})

test('many accounts behind one address are capped on the address', async () => {
  queue.length = 0
  const total = MODERATION_QUEUE_CAP.inserts * 3
  for (let i = 1; i <= total; i++) {
    await fastPreModerate(PROFANE, { targetType: 'livestream_chat', readerId: 5000 + i, authorIp: '198.51.100.200', capQueuePerSource: true })
  }
  assert.equal(queue.length, MODERATION_QUEUE_CAP.inserts, `one address wrote ${queue.length} rows across accounts`)
})

test('a failed queue insert is logged once, without the message, and the message is still blocked', async () => {
  queue.length = 0
  const secretText = 'mày dcm bí-mật-nội-dung-xyz'
  const ip = '203.0.113.201'
  // Shape of drizzle-orm's DrizzleQueryError: its own message embeds every bound
  // parameter (content snippet, IP, display name); the driver error is the cause.
  const driverError = Object.assign(new Error(`Incorrect string value: '${secretText}' for column 'content_snippet' at row 1`), { code: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', errno: 1366 })
  class DrizzleQueryError extends Error {
    query: string
    params: unknown[]
    constructor(query: string, params: unknown[], cause: Error) {
      super(`Failed query: ${query}\nparams: ${params.join(',')}`)
      this.query = query
      this.params = params
      this.cause = cause
    }
  }
  insertFailure = new DrizzleQueryError('insert into ai_moderation_queue', [secretText, ip, 'Người gửi bí mật'], driverError)

  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  let outcome: Awaited<ReturnType<typeof fastPreModerate>> | null = null
  try {
    outcome = await fastPreModerate(secretText, { targetType: 'comment', authorIp: ip, authorName: 'Người gửi bí mật', readerId: 6001, sessionId: 'sess-6001' })
  } finally {
    console.error = original
    insertFailure = null
  }

  assert.ok(outcome, 'fastPreModerate must resolve, not throw')
  const result = outcome
  assert.equal(result.blocked, true, 'the block decision must not depend on the review row')
  assert.equal(result.action, 'block')
  assert.match(result.reason, /vi phạm/)
  assert.equal(queue.length, 0)

  const failures = lines.filter(line => line.includes('ai_moderation.queue_insert_failed'))
  assert.equal(failures.length, 1, `expected one queue_insert_failed line, got ${failures.length}: ${lines.join('\n')}`)
  const record = JSON.parse(failures[0]!) as Record<string, unknown>
  assert.equal(record.event, 'ai_moderation.queue_insert_failed')
  assert.equal(record.targetType, 'comment')
  assert.equal(record.readerId, 6001)
  assert.equal(record.errorCode, 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD')
  for (const leak of ['bí-mật-nội-dung-xyz', 'dcm', ip, 'Người gửi bí mật']) {
    assert.ok(!failures[0]!.includes(leak), `log line leaks ${leak}: ${failures[0]}`)
  }
})

test('a statement-wrapping error with no driver cause: its message (the bound params) is withheld', async () => {
  queue.length = 0
  const secretText = 'mày dcm nội-dung-không-cause-abc'
  const ip = '203.0.113.202'
  insertFailure = Object.assign(new Error(`Failed query: insert into ai_moderation_queue\nparams: ${secretText},${ip}`), {
    query: 'insert into ai_moderation_queue',
    params: [secretText, ip],
  })

  const lines: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')) }
  let outcome: Awaited<ReturnType<typeof fastPreModerate>> | null = null
  try {
    outcome = await fastPreModerate(secretText, { targetType: 'livestream_chat', authorIp: ip, readerId: 6002 })
  } finally {
    console.error = original
    insertFailure = null
  }

  assert.equal(outcome?.blocked, true)
  const failures = lines.filter(line => line.includes('ai_moderation.queue_insert_failed'))
  assert.equal(failures.length, 1)
  for (const leak of ['nội-dung-không-cause-abc', 'dcm', ip]) {
    assert.ok(!failures[0]!.includes(leak), `log line leaks ${leak}: ${failures[0]}`)
  }
})
