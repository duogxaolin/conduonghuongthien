import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { articles, livestreamSessions, readerAccounts } from '../server/db/schema.ts'

/**
 * Reader comments and livestream chat ran the instant moderation check BEFORE
 * their own rate limits. Every message it blocks writes an `ai_moderation_queue`
 * row, so a signed-in reader (or a script holding many Google accounts) could
 * write review rows without any limit applying. The order is now: refusal gates
 * (target closed, banned, no live session…) → reader limit → address limit →
 * moderation → insert. These drive the real services with recorders in place of
 * the limiter and the moderator, and assert on the order of calls.
 * Companion: tests/reader-flows-moderation-queue-cap.test.ts (real moderation).
 */

const order: string[] = []
const moderationContexts: Array<Record<string, unknown>> = []
const backgroundChecks: Array<Record<string, unknown>> = []
const commentInserts: Array<Record<string, unknown>> = []
/** Key prefixes the fake limiter reports as exhausted. */
let exhausted: string[] = []
/** When true, the fake moderator blocks every message. */
let moderatorBlocks = true
let commentsEnabled = true

mock.module(new URL('../server/utils/rate-limit-store.ts', import.meta.url), {
  namedExports: {
    recordRateLimitHit: async (key: string) => {
      order.push(`rate-limit:${key}`)
      const blocked = exhausted.some(prefix => key.startsWith(prefix))
      return { count: blocked ? 99 : 1, blocked, retryAfterSeconds: blocked ? 30 : 0, backend: 'memory' }
    },
  },
})
mock.module(new URL('../server/services/moderation-worker.ts', import.meta.url), {
  namedExports: {
    fastPreModerate: async (_text: string, context: Record<string, unknown>) => {
      order.push('moderation')
      moderationContexts.push(context)
      return moderatorBlocks
        ? { blocked: true, action: 'block', severity: 'high', reason: 'Nội dung vi phạm tiêu chuẩn (thử).', matchedRule: 'thử' }
        : { blocked: false, action: 'allow', severity: 'low', reason: '', matchedRule: '' }
    },
    checkAndModerateContent: async (input: Record<string, unknown>) => {
      backgroundChecks.push(input)
      return { flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [] }
    },
  },
})

const commentDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table === articles) return [{ id: 1, title: 'Bài thử', slug: 'bai-thu', status: 'published', commentsEnabled }]
          if (table === readerAccounts) return [{ id: 7, isBanned: false, displayName: 'Người đọc', customDisplayName: null }]
          return []
        },
      }),
    }),
  }),
  transaction: async (callback: (tx: unknown) => Promise<void>) => callback({
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        order.push('insert')
        commentInserts.push(row)
        return [{ insertId: 900 }]
      },
    }),
  }),
}
mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => commentDb, getPool: () => null } })
mock.module(new URL('../server/services/ip-bans.ts', import.meta.url), { namedExports: { loadIpBanValues: async () => [] } })
mock.module(new URL('../server/services/notifications.ts', import.meta.url), { namedExports: { createReplyNotification: async () => null } })
mock.module(new URL('../server/services/notification-email.ts', import.meta.url), { namedExports: { sendReplyEmail: async () => {} } })

const { createComment } = await import('../server/services/comments.ts')
const { sendChatMessage } = await import('../server/services/livestream-chat.ts')

const LIVE_SESSION = 31
let liveActive = true
const liveInserts: Array<Record<string, unknown>> = []
const liveDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({ limit: async () => (table === livestreamSessions && liveActive ? [{ id: LIVE_SESSION, title: 'Phát thử' }] : []) }),
    }),
  }),
  insert: () => ({
    values: async (row: Record<string, unknown>) => {
      order.push('insert')
      liveInserts.push(row)
      return [{ insertId: 321 }]
    },
  }),
}

function reset(options: { exhausted?: string[], blocks?: boolean } = {}) {
  order.length = 0
  moderationContexts.length = 0
  backgroundChecks.length = 0
  commentInserts.length = 0
  liveInserts.length = 0
  exhausted = options.exhausted ?? []
  moderatorBlocks = options.blocks ?? true
  commentsEnabled = true
  liveActive = true
}

const comment = (body: string) => createComment({
  readerId: 7, articleId: 1, parentId: null, body, ip: '203.0.113.9', userAgent: null, event: {} as never,
})
const chat = (content: string) => sendChatMessage(
  { sender: { id: 7, displayName: 'Người đọc', customDisplayName: null }, ip: '203.0.113.9', content, sessionId: LIVE_SESSION },
  { db: liveDb as never, rateLimit: {} },
)

describe('createComment: rate limits are charged before moderation', () => {
  it('a blocked comment is charged on both keys first, then moderated with the queue cap requested', async () => {
    reset()
    const result = await comment('nội dung bị chặn')
    assert.deepEqual(order, ['rate-limit:comment:reader:7', 'rate-limit:comment:ip:203.0.113.9', 'moderation'])
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.statusCode, 400)
    assert.match(result.ok === false ? result.message : '', /vi phạm/)
    assert.equal(moderationContexts[0]!.capQueuePerSource, true, 'reader flows cap their review rows per source')
    assert.equal(moderationContexts[0]!.readerId, 7, 'the account is part of the cap source')
    assert.equal(moderationContexts[0]!.authorIp, '203.0.113.9', 'the address is part of the cap source')
    assert.equal(commentInserts.length, 0)
  })

  it('a reader over the limit gets the same 429 and never reaches moderation', async () => {
    reset({ exhausted: ['comment:reader:'] })
    const result = await comment('nội dung bị chặn')
    assert.deepEqual(order, ['rate-limit:comment:reader:7'])
    assert.equal(result.ok === false && result.statusCode, 429)
    assert.equal(result.ok === false && result.message, 'Bạn đã gửi quá nhiều bình luận. Vui lòng thử lại sau ít phút.')
    assert.equal(result.ok === false && result.retryAfterSeconds, 30)
  })

  it('an address over the limit gets the same 429 and never reaches moderation', async () => {
    reset({ exhausted: ['comment:ip:'] })
    const result = await comment('nội dung bị chặn')
    assert.deepEqual(order, ['rate-limit:comment:reader:7', 'rate-limit:comment:ip:203.0.113.9'])
    assert.equal(result.ok === false && result.statusCode, 429)
    assert.equal(result.ok === false && result.message, 'Đã có quá nhiều bình luận gửi từ địa chỉ này. Vui lòng thử lại sau ít phút.')
  })

  it('a refusal gate (comments closed) still comes before any allowance is spent', async () => {
    reset()
    commentsEnabled = false
    const result = await comment('xin chào')
    assert.equal(result.ok === false && result.statusCode, 403)
    assert.deepEqual(order, [], 'a request that was always going to fail must not spend allowance or reach moderation')
  })

  it('a clean comment: limits → moderation → insert → background check, unchanged result', async () => {
    reset({ blocks: false })
    const result = await comment('Cảm ơn bài viết hữu ích.')
    assert.deepEqual(result, { ok: true, id: 900 })
    assert.deepEqual(order, ['rate-limit:comment:reader:7', 'rate-limit:comment:ip:203.0.113.9', 'moderation', 'insert'])
    assert.equal(commentInserts[0]!.body, 'Cảm ơn bài viết hữu ích.')
    assert.equal(backgroundChecks.length, 1)
    assert.equal(backgroundChecks[0]!.targetId, 900)
    assert.equal(backgroundChecks[0]!.capQueuePerSource, undefined, 'the background check of a stored comment is not capped')
  })
})

describe('sendChatMessage: rate limits are charged before moderation', () => {
  it('a blocked message is charged on both keys first, then moderated with the queue cap requested', async () => {
    reset()
    const result = await chat('nội dung bị chặn')
    assert.deepEqual(order, ['rate-limit:livestream:chat:reader:7', 'rate-limit:livestream:chat:ip:203.0.113.9', 'moderation'])
    assert.equal(result.ok === false && result.statusCode, 400)
    assert.match(result.ok === false ? result.message : '', /vi phạm/)
    assert.equal(moderationContexts[0]!.capQueuePerSource, true)
    assert.equal(moderationContexts[0]!.readerId, 7)
    assert.equal(moderationContexts[0]!.authorIp, '203.0.113.9')
    assert.equal(moderationContexts[0]!.sessionId, String(LIVE_SESSION), 'the session is the one the server resolved')
    assert.equal(liveInserts.length, 0)
  })

  it('a reader over the limit gets the same 429 and never reaches moderation', async () => {
    reset({ exhausted: ['livestream:chat:reader:'] })
    const result = await chat('nội dung bị chặn')
    assert.deepEqual(order, ['rate-limit:livestream:chat:reader:7'])
    assert.equal(result.ok === false && result.statusCode, 429)
    assert.equal(result.ok === false && result.message, 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng chờ một lát rồi thử lại.')
  })

  it('an address over the limit gets the same 429 and never reaches moderation', async () => {
    reset({ exhausted: ['livestream:chat:ip:'] })
    const result = await chat('nội dung bị chặn')
    assert.deepEqual(order, ['rate-limit:livestream:chat:reader:7', 'rate-limit:livestream:chat:ip:203.0.113.9'])
    assert.equal(result.ok === false && result.statusCode, 429)
    assert.equal(result.ok === false && result.message, 'Đã có quá nhiều tin nhắn gửi từ địa chỉ này. Vui lòng chờ một lát rồi thử lại.')
  })

  it('no live session: refused before any allowance is spent or moderation runs', async () => {
    reset()
    liveActive = false
    const result = await chat('nội dung bị chặn')
    assert.equal(result.ok === false && result.statusCode, 409)
    assert.deepEqual(order, [])
  })

  it('a clean message: limits → moderation → insert, unchanged result', async () => {
    reset({ blocks: false })
    const result = await chat('chào cả nhà')
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.id, 321)
    assert.deepEqual(order, ['rate-limit:livestream:chat:reader:7', 'rate-limit:livestream:chat:ip:203.0.113.9', 'moderation', 'insert'])
    assert.equal(liveInserts[0]!.content, 'chào cả nhà')
  })
})
