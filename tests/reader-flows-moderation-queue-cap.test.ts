import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { aiModerationQueue, articles, livestreamSessions, readerAccounts } from '../server/db/schema.ts'

/**
 * A flood of blocked reader comments / livestream messages, end to end through
 * the REAL moderation worker and the REAL rate-limit store (its in-process
 * fallback, on a test clock). Before the fix both flows moderated before their
 * own rate limits and did not opt in to MODERATION_QUEUE_CAP, so every blocked
 * message wrote one `ai_moderation_queue` row — sixty messages, sixty rows. Now
 * the limits run first and the review rows are capped per account AND per
 * address (IPv6 by /64). Every message is still refused.
 */

const queueRows: Array<Record<string, unknown>> = []
const otherInserts: unknown[] = []
let clock = Date.parse('2026-10-14T08:00:00Z')
let memory = new Map<string, { count: number, expiresAt: number }>()

/** `where()` is both awaited directly (rules cache) and chained with `.limit()`. */
function rows(list: unknown[]) {
  return Object.assign(Promise.resolve(list), { limit: async () => list })
}
const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => {
        if (table === articles) return rows([{ id: 1, title: 'Bài thử', slug: 'bai-thu', status: 'published', commentsEnabled: true }])
        if (table === readerAccounts) return rows([{ id: 1, isBanned: false, displayName: 'Người đọc', customDisplayName: null }])
        if (table === livestreamSessions) return rows([{ id: 77, title: 'Phát thử' }])
        return rows([]) // ai_moderation_rules: no custom rules, built-ins only
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: async (row: Record<string, unknown>) => {
      if (table === aiModerationQueue) queueRows.push(row)
      else otherInserts.push(row)
      return [{ insertId: 1 }]
    },
  }),
  transaction: async (callback: (tx: unknown) => Promise<void>) => callback(fakeDb),
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb, getPool: () => null } })
// One limiter for the flows and the queue cap: in-process store, test clock.
const limiter = () => ({ execute: null, memory, now: () => clock })
mock.module(new URL('../server/utils/rate-limit-deps.ts', import.meta.url), { namedExports: { rateLimitDeps: limiter } })
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url), { namedExports: { callAi: async () => ({ ok: true, text: '{}' }) } })
mock.module(new URL('../server/services/ip-bans.ts', import.meta.url), { namedExports: { loadIpBanValues: async () => [] } })
mock.module(new URL('../server/services/notifications.ts', import.meta.url), { namedExports: { createReplyNotification: async () => null } })
mock.module(new URL('../server/services/notification-email.ts', import.meta.url), { namedExports: { sendReplyEmail: async () => {} } })

const { createComment } = await import('../server/services/comments.ts')
const { sendChatMessage } = await import('../server/services/livestream-chat.ts')
const { MODERATION_QUEUE_CAP } = await import('../server/services/moderation-instant.ts')

const PROFANE = 'mày dcm'
const CAP = MODERATION_QUEUE_CAP.inserts
const FLOOD = CAP * 3

function reset() {
  queueRows.length = 0
  otherInserts.length = 0
  memory = new Map()
  clock += 2 * 60 * 60 * 1000
}

const comment = (readerId: number, ip: string) => createComment({
  readerId, articleId: 1, parentId: null, body: PROFANE, ip, userAgent: null, event: {} as never,
})
const chat = (readerId: number, ip: string) => sendChatMessage(
  { sender: { id: readerId, displayName: 'Người đọc', customDisplayName: null }, ip, content: PROFANE, sessionId: 77 },
  { db: fakeDb as never, rateLimit: limiter() },
)

describe('reader comments: blocked-message flood vs the review queue', () => {
  it('one account: rows stop at the cap; every comment is still refused', async () => {
    reset()
    const statuses: number[] = []
    for (let i = 0; i < FLOOD; i++) {
      // Stay inside the per-reader limit (limit 10/min; the store refuses the 10th
      // hit) so only the queue cap is in play.
      if (i > 0 && i % 9 === 0) clock += 61_000
      const result = await comment(101, '203.0.113.60')
      statuses.push(result.ok ? 200 : result.statusCode)
    }
    assert.ok(statuses.every(status => status === 400), `every blocked comment is a 400: ${statuses.join(',')}`)
    assert.equal(queueRows.length, CAP, `one account wrote ${queueRows.length} review rows`)
    assert.equal(otherInserts.length, 0, 'no comment row is ever written')
  })

  it('many accounts behind one address: rows stop at the cap', async () => {
    reset()
    for (let i = 0; i < FLOOD; i++) {
      if (i > 0 && i % 20 === 0) clock += 61_000 // per-address limit is 25/min
      await comment(2000 + i, '203.0.113.61')
    }
    assert.equal(queueRows.length, CAP, `one address wrote ${queueRows.length} review rows`)
  })

  it('many accounts rotating addresses inside one IPv6 /64: rows stop at the cap', async () => {
    reset()
    for (let i = 1; i <= FLOOD; i++) {
      await comment(3000 + i, `2001:db8:61:1:${i.toString(16)}::1`)
    }
    assert.equal(queueRows.length, CAP, `one /64 wrote ${queueRows.length} review rows`)
  })

  it('past the rate limit a blocked comment is a 429 and writes no review row', async () => {
    reset()
    const statuses: number[] = []
    for (let i = 0; i < 30; i++) {
      const result = await comment(4001, '203.0.113.62')
      statuses.push(result.ok ? 200 : result.statusCode)
    }
    // Reader limit 10/min: the store blocks at the 10th hit, so 9 are moderated.
    const moderated = statuses.filter(status => status === 400).length
    assert.equal(statuses.filter(status => status === 429).length, 30 - moderated)
    assert.ok(moderated < 10, `${moderated} requests reached moderation`)
    assert.equal(queueRows.length, moderated, 'only requests inside the limit can write a review row')
  })
})

describe('livestream chat: blocked-message flood vs the review queue', () => {
  it('one account: rows stop at the cap; every message is still refused', async () => {
    reset()
    const statuses: number[] = []
    for (let i = 0; i < FLOOD; i++) {
      // Per-reader limit is 20 / 5 min.
      if (i > 0 && i % 15 === 0) clock += 301_000
      const result = await chat(501, '198.51.100.60')
      statuses.push(result.ok ? 200 : result.statusCode)
    }
    assert.ok(statuses.every(status => status === 400), `every blocked message is a 400: ${statuses.join(',')}`)
    assert.equal(queueRows.length, CAP, `one account wrote ${queueRows.length} review rows`)
    assert.equal(otherInserts.length, 0, 'no chat row is ever written')
  })

  it('many accounts behind one address: rows stop at the cap', async () => {
    reset()
    for (let i = 0; i < FLOOD; i++) {
      if (i > 0 && i % 40 === 0) clock += 301_000 // per-address limit is 50 / 5 min
      await chat(6000 + i, '198.51.100.61')
    }
    assert.equal(queueRows.length, CAP, `one address wrote ${queueRows.length} review rows`)
  })

  it('past the rate limit a blocked message is a 429 and writes no review row', async () => {
    reset()
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) {
      const result = await chat(7001, '198.51.100.62')
      statuses.push(result.ok ? 200 : result.statusCode)
    }
    const moderated = statuses.filter(status => status === 400).length
    assert.ok(moderated < 20, `${moderated} requests reached moderation`)
    assert.equal(statuses.filter(status => status === 429).length, 40 - moderated)
    assert.equal(queueRows.length, moderated)
  })
})
