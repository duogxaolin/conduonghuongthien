import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { livestreamSessions } from '../server/db/schema.ts'

/**
 * `sendChatMessage` (server/services/livestream-chat.ts) — the ORDER of its steps, run for real.
 *
 * Invariant: every reason to refuse a message that does not depend on how fast the sender is
 * (bad content, no live session, a stale session id) is decided BEFORE any allowance is
 * spent — otherwise requests that were always going to fail burn the sender's (or a victim's)
 * allowance. After the allowance: reader key, address key, then the instant moderation check
 * (a block files a review row, so it must be rate-limited first), and the INSERT comes last.
 *
 * Until now the order was also pinned by an `indexOf` over the function's source in
 * `tests/livestream-chat.test.ts`. Here the real function runs with recorders in place of the
 * limiter, the moderator and the database, and each step reports itself into one timeline.
 * Companions on the limiter keys and the response shapes: `tests/livestream-chat.test.ts`,
 * `tests/reader-flows-rate-limit-before-moderation.test.ts`.
 */

const order: string[] = []
const inserts: Array<Record<string, unknown>> = []
let moderatorBlocks = false
let liveSession: number | null = 31

mock.module(new URL('../server/utils/rate-limit-store.ts', import.meta.url), {
  namedExports: {
    recordRateLimitHit: async (key: string) => {
      order.push(`rate-limit:${key}`)
      return { count: 1, blocked: false, retryAfterSeconds: 0, backend: 'memory' }
    },
  },
})
mock.module(new URL('../server/services/moderation-worker.ts', import.meta.url), {
  namedExports: {
    fastPreModerate: async () => {
      order.push('moderation')
      return moderatorBlocks
        ? { blocked: true, action: 'block', severity: 'high', reason: 'RULE-NAME-NOT-FOR-READERS', matchedRule: 'thử', publicMessage: 'Nội dung vi phạm tiêu chuẩn.' }
        : { blocked: false, action: 'allow', severity: 'low', reason: '', matchedRule: '', publicMessage: '' }
    },
    // The background pass that follows a stored message — not what this file is about.
    checkAndModerateContent: async () => ({ flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [] }),
  },
})
mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb, getPool: () => null } })

const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => {
          if (table !== livestreamSessions) return []
          order.push('active-session')
          return liveSession === null ? [] : [{ id: liveSession, title: 'Phát thử' }]
        },
      }),
    }),
  }),
  insert: () => ({
    values: async (row: Record<string, unknown>) => {
      order.push('insert')
      inserts.push(row)
      return [{ insertId: 321 }]
    },
  }),
}

const { sendChatMessage } = await import('../server/services/livestream-chat.ts')

const sender = { id: 7, displayName: 'Người đọc', customDisplayName: null }
const send = (content: unknown, sessionId: unknown = 31) => sendChatMessage(
  { sender, ip: '203.0.113.9', content: content as string, sessionId: sessionId as number },
  { db: fakeDb as never, rateLimit: {} },
)
function reset(options: { blocks?: boolean, session?: number | null } = {}) {
  order.length = 0
  inserts.length = 0
  moderatorBlocks = options.blocks ?? false
  liveSession = options.session === undefined ? 31 : options.session
}
const statusOf = (result: Awaited<ReturnType<typeof send>>) => (result.ok ? 200 : result.statusCode)
const SPENT = /^(rate-limit:|moderation|insert)/

describe('sendChatMessage: refusals that do not depend on speed come before any allowance is spent', () => {
  for (const [label, content] of [
    ['empty', ''],
    ['only spaces', '   \n  '],
    ['not a string', 42],
    ['a control character', 'xin chào\u0000'],
    ['over the length limit', 'a'.repeat(100_000)],
  ] as const) {
    it(`bad content (${label}): 400, no allowance, no moderation, no insert`, async () => {
      reset()
      const result = await send(content)
      assert.equal(statusOf(result), 400)
      assert.deepEqual(order.filter(step => SPENT.test(step)), [], `spent before refusing: ${order.join(' > ')}`)
      assert.equal(inserts.length, 0)
    })
  }

  it('no live session: 409 after one lookup, nothing spent, nothing inserted', async () => {
    reset({ session: null })
    const result = await send('xin chào')
    assert.equal(statusOf(result), 409)
    assert.deepEqual(order, ['active-session'])
    assert.equal(inserts.length, 0)
  })

  for (const [label, claimed] of [['an older session id', 30], ['a newer session id', 32], ['NaN', Number.NaN], ['no id (null)', null], ['a string id', '31']] as const) {
    it(`a message for the wrong session (${label}): 409, nothing spent, nothing inserted`, async () => {
      reset()
      const result = await send('xin chào', claimed)
      assert.equal(statusOf(result), 409)
      assert.deepEqual(order, ['active-session'])
      assert.equal(inserts.length, 0)
    })
  }
})

describe('sendChatMessage: once past the refusals the order is limits, moderation, insert', () => {
  it('a clean message: reader key → address key → moderation → insert, and the insert is the last step', async () => {
    reset()
    const result = await send('chào cả nhà')
    assert.equal(result.ok && result.id, 321)
    assert.deepEqual(order, [
      'active-session',
      'rate-limit:livestream:chat:reader:7',
      'rate-limit:livestream:chat:ip:203.0.113.9',
      'moderation',
      'insert',
    ])
    assert.equal(inserts[0]!.content, 'chào cả nhà')
  })

  it('a message the instant check blocks: limits first, then moderation, and NEVER an insert; the reader sees the public text only', async () => {
    reset({ blocks: true })
    const result = await send('nội dung bị chặn')
    assert.equal(statusOf(result), 400)
    assert.deepEqual(order, [
      'active-session',
      'rate-limit:livestream:chat:reader:7',
      'rate-limit:livestream:chat:ip:203.0.113.9',
      'moderation',
    ])
    assert.equal(inserts.length, 0)
    const message = result.ok ? '' : result.message
    assert.equal(message, 'Nội dung vi phạm tiêu chuẩn.')
    assert.ok(!message.includes('RULE-NAME-NOT-FOR-READERS'), 'the rule that matched must not reach the sender')
  })
})
