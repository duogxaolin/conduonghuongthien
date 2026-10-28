/**
 * Where the per-request regex budget (`createModerationRegexBudget`, 250 ms) is wired, and what a
 * blocked reader is told — verify of wave3 4.3c follow-up, W7 and W8(a). The REAL moderation
 * worker and regex runtime run here; only the database, the AI gateway, the limiter store and
 * the mail/notification edges are faked.
 *
 * W7: livestream chat and the rescan job ran their moderation with no request budget, so one call
 * with five 190-ms rules blocked the event loop ~950 ms (and the livestream message's background
 * moderation another ~950). Now one budget per livestream message (the instant check and the
 * moderation behind it), one per rescanned item (a comment's full check and its rules-only
 * fallback), and `fastPreModerate` / `checkAndModerateContent` give a call without one its own.
 *
 * W8(a): a blocked comment or livestream message answered 400 with `reason` —
 * `Nội dung vi phạm … (Mẫu regex: <mẫu>).` — the rule's pattern, handed to the submitter.
 *
 * Slow rules are real database rules (`chậm-0` … `chậm-4`, valid patterns) whose `test()` busy-
 * waits 190 ms of wall time: under the 200-ms window budget, so only the request budget stops them.
 */
import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import { aiModerationQueue, aiModerationRules, articleComments, articles, livestreamMessages, livestreamSessions, readerAccounts } from '../server/db/schema.ts'

type Row = Record<string, unknown>
const state = {
  rules: [] as Row[],
  queue: [] as Row[],
  comments: [] as Row[],
  messages: [] as Row[],
  ai: { ok: true, text: '{"verdict":"safe"}' } as Row,
}

/** A drizzle builder: awaitable at `.where()`, chainable with `.limit()` and `.orderBy().limit()`. */
const rows = (list: Row[]) => Object.assign(Promise.resolve(list), { limit: async () => list, orderBy: () => ({ limit: async (n: number) => list.slice(0, n) }) })
const counted = (projection: Row | undefined, list: Row[]) => rows(projection && 'total' in projection ? [{ total: list.length }] : list)
const fakeDb = {
  select: (projection?: Row) => ({
    from: (table: unknown) => ({
      where: () => {
        if (table === aiModerationRules) return rows(state.rules)
        if (table === articles) return rows([{ id: 1, title: 'Bài thử', slug: 'bai-thu', status: 'published', commentsEnabled: true }])
        if (table === readerAccounts) return rows([{ id: 7, isBanned: false, displayName: 'Người đọc', customDisplayName: null, displayNameReserved: false }])
        if (table === livestreamSessions) return rows([{ id: 77, title: 'Phát thử' }])
        if (table === articleComments) return counted(projection, state.comments)
        if (table === livestreamMessages) return counted(projection, state.messages)
        return rows([])
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: async (row: Row) => {
      if (table === aiModerationQueue) state.queue.push(row)
      return [{ insertId: 900, affectedRows: 1 }]
    },
  }),
  execute: async () => [{ affectedRows: 1 }, undefined],
  update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
  transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeDb),
}

const memory = new Map<string, { count: number, expiresAt: number }>()
const limiter = () => ({ execute: null, memory, now: () => Date.now() })
mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb, getPool: () => null } })
mock.module(new URL('../server/utils/rate-limit-deps.ts', import.meta.url), { namedExports: { rateLimitDeps: limiter } })
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url), { namedExports: { callAi: async () => state.ai } })
mock.module(new URL('../server/services/ip-bans.ts', import.meta.url), { namedExports: { loadIpBanValues: async () => [] } })
mock.module(new URL('../server/services/notifications.ts', import.meta.url), { namedExports: { createReplyNotification: async () => null } })
mock.module(new URL('../server/services/notification-email.ts', import.meta.url), { namedExports: { sendReplyEmail: async () => {} } })

const { createComment } = await import('../server/services/comments.ts')
const { sendChatMessage } = await import('../server/services/livestream-chat.ts')
const worker = await import('../server/services/moderation-worker.ts')
const regex = await import('../server/services/moderation-regex.ts')
const { INSTANT_BLOCK_PUBLIC_MESSAGE } = await import('../server/services/moderation-instant.ts')

const REQUEST_BUDGET_MS = 250
/** Scheduling, interrupt latency and the non-regex work of a call, generous for a loaded runner. */
const SLACK_MS = 150
const SLOW = Array.from({ length: 5 }, (_, i) => `chậm-${i}`)

let nextRuleId = 1
const rule = (pattern: string, ruleType: 'regex' | 'keyword' = 'regex'): Row => ({
  id: nextRuleId++, pattern, ruleType, category: 'thử', severity: 'high', action: 'auto_hide', isEnabled: true,
})

function reset(rules: Row[]): void {
  state.rules = rules
  state.queue = []
  state.comments = []
  state.messages = []
  state.ai = { ok: true, text: '{"verdict":"safe"}' }
  memory.clear()
  worker.invalidateModerationRulesCache()
  regex.setModerationRegexTimingForTests(null)
}

/** Make `chậm-*` rules cost 190 ms of wall time per window; count their windows. */
function slowRules(): { windows: () => number, restore: () => void } {
  let windows = 0
  const original = RegExp.prototype.test
  const spy = mock.method(RegExp.prototype, 'test', function (this: RegExp, input: string) {
    if (!this.source.startsWith('chậm-')) return original.call(this, input)
    windows += 1
    const end = performance.now() + 190
    while (performance.now() < end);
    return false
  })
  return { windows: () => windows, restore: () => spy.mock.restore() }
}

const sender = { id: 7, displayName: 'Người đọc', customDisplayName: null, displayNameReserved: false }
const chat = (content: string, moderate?: typeof worker.checkAndModerateContent) => sendChatMessage(
  { sender, ip: '203.0.113.70', content, sessionId: 77 },
  { db: fakeDb as never, rateLimit: limiter(), ...(moderate ? { moderate } : {}) },
)
const comment = (body: string) => createComment({ readerId: 7, articleId: 1, parentId: null, body, ip: '203.0.113.71', userAgent: null, event: {} as never })

describe('W7: the request budget reaches livestream chat and the rescan job', () => {
  it('livestream: one message, five 190-ms rules — the instant check and the moderation behind it share ONE budget, ≤ 250 ms in all', async () => {
    reset(SLOW.map(pattern => rule(pattern)))
    const budgets: unknown[] = []
    let background: Promise<unknown> | undefined
    const moderate: typeof worker.checkAndModerateContent = (input, options) => {
      budgets.push(options?.regexBudget)
      background = worker.checkAndModerateContent(input, options)
      return background as ReturnType<typeof worker.checkAndModerateContent>
    }
    const slow = slowRules()
    let requestMs = 0
    let totalMs = 0
    try {
      const started = performance.now()
      const result = await chat('chào cả nhà', moderate)
      requestMs = performance.now() - started
      await background
      totalMs = performance.now() - started
      assert.equal(result.ok, true, 'a clean message is stored and sent')
    } finally {
      slow.restore()
    }
    const label = `${slow.windows()} slow windows; the request ${requestMs.toFixed(0)} ms, with its background moderation ${totalMs.toFixed(0)} ms (unbounded: 10 × 190)`
    assert.ok(requestMs <= REQUEST_BUDGET_MS + SLACK_MS, label)
    assert.ok(totalMs <= REQUEST_BUDGET_MS + SLACK_MS, `${label} — the moderation behind the message must not get a second 250 ms`)
    assert.equal((budgets[0] as { limitMs?: number } | undefined)?.limitMs, REQUEST_BUDGET_MS, 'the background moderation is handed the request budget')
  })

  it('rescan: each comment and each livestream message runs on one budget — five 190-ms rules cost ≤ 250 ms per item, not ~1–2 s', async () => {
    reset(SLOW.map(pattern => rule(pattern)))
    state.comments = [{ id: 11, body: 'bình luận cũ' }]
    state.messages = [{ id: 21, content: 'tin chat cũ' }]
    const marks: Array<{ at: number, comments: number, messages: number }> = []
    const slow = slowRules()
    try {
      const summary = await worker.rescanExistingContent({ onProgress: progress => marks.push({ at: performance.now(), comments: progress.scannedComments, messages: progress.scannedMessages }) })
      assert.equal(summary.scannedComments, 1)
      assert.equal(summary.scannedMessages, 1)
    } finally {
      slow.restore()
    }
    const span = (from: (m: typeof marks[number]) => boolean, to: (m: typeof marks[number]) => boolean) => marks.find(to)!.at - marks.find(from)!.at
    const commentMs = span(m => m.comments === 0, m => m.comments === 1)
    const messageMs = span(m => m.comments === 1 && m.messages === 0, m => m.messages === 1)
    const label = `comment ${commentMs.toFixed(0)} ms, message ${messageMs.toFixed(0)} ms, ${slow.windows()} slow windows (unbounded: 10 and 5 × 190 ms)`
    assert.ok(commentMs <= REQUEST_BUDGET_MS + SLACK_MS, label)
    assert.ok(messageMs <= REQUEST_BUDGET_MS + SLACK_MS, label)
  })

  it('rescan without an AI: the comment\'s full check and its rules-only fallback share the item\'s ONE budget', async () => {
    reset(SLOW.map(pattern => rule(pattern)))
    state.ai = { ok: false, error: 'service_not_found' }
    state.comments = [{ id: 12, body: 'bình luận cũ' }]
    const marks: number[] = []
    const slow = slowRules()
    let summary: Awaited<ReturnType<typeof worker.rescanExistingContent>> | undefined
    try {
      marks.push(performance.now())
      summary = await worker.rescanExistingContent({ maxMessages: 0 })
      marks.push(performance.now())
    } finally {
      slow.restore()
    }
    assert.equal(summary!.aiUnavailable, true, 'the rules-only fallback ran')
    const itemMs = marks[1]! - marks[0]!
    assert.ok(itemMs <= REQUEST_BUDGET_MS + SLACK_MS, `${itemMs.toFixed(0)} ms for one comment, ${slow.windows()} slow windows (a second budget for the fallback: ~500)`)
  })

  it('a moderation call handed no budget gets one of its own: fastPreModerate and checkAndModerateContent alone are ≤ 250 ms', async () => {
    reset(SLOW.map(pattern => rule(pattern)))
    const slow = slowRules()
    const walls: number[] = []
    try {
      for (const call of [() => worker.fastPreModerate('một tin', { targetType: 'chat' }), () => worker.checkAndModerateContent({ content: 'một tin', targetType: 'comment', targetId: 5 })]) {
        const started = performance.now()
        await call()
        walls.push(performance.now() - started)
      }
    } finally {
      slow.restore()
    }
    for (const ms of walls) assert.ok(ms <= REQUEST_BUDGET_MS + SLACK_MS, `${walls.map(w => w.toFixed(0)).join(', ')} ms (unbounded: 950 and 1900)`)
  })
})

/**
 * The per-item budget bounds ONE item (≤ 250 ms); it does not let anything else run between items.
 * Every await of a rescan item resolves as a microtask when the AI answers from memory or is not
 * configured (rules only) — the verify of the wave3 4.3c follow-ups measured a 40 + 40-item run
 * with a sub-threshold cubic rule (`₫*₫*$`) blocking the event loop 1.09–1.12 s in ONE stretch
 * (`rescan-lag-node24-cpus2.log`): no request, timer or lock heartbeat ran until the run ended.
 * Pinned on the event loop itself, not on a clock: between two scanned items at least one
 * `setImmediate` turn must have run.
 */
describe('the rescan yields to the event loop between items', () => {
  for (const ai of [{ ok: true, text: '{"verdict":"safe"}' }, { ok: false, error: 'service_not_found' }]) {
    it(`an event-loop turn runs between every two scanned items (comments then livestream messages; AI ${ai.ok ? 'answering' : 'not configured'})`, async () => {
      reset([rule('lô\\s*đề')])
      state.ai = ai
      state.comments = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, body: `bình luận cũ ${i}` }))
      state.messages = Array.from({ length: 12 }, (_, i) => ({ id: 200 + i, content: `tin chat cũ ${i}` }))
      let turns = 0
      let beating = true
      const beat = () => { if (beating) { turns += 1; setImmediate(beat) } }
      setImmediate(beat)
      /** `turnsAt[n]`: event-loop turns seen when the n-th item was reported scanned. */
      const turnsAt: number[] = []
      try {
        const summary = await worker.rescanExistingContent({ onProgress: (p) => { turnsAt[p.scannedComments + p.scannedMessages] ??= turns } })
        assert.equal(summary.scannedComments, 12)
        assert.equal(summary.scannedMessages, 12)
        assert.equal(summary.aiUnavailable, !ai.ok)
      } finally {
        beating = false
      }
      const stalls = turnsAt.slice(1).flatMap((at, n) => (n > 0 && at <= turnsAt[n]! ? [`item ${n} → ${n + 1}`] : []))
      assert.deepEqual(stalls, [], `no event-loop turn between: ${stalls.join(', ')} (turns at each item: ${turnsAt.join(' ')})`)
    })
  }
})

describe('W8(a): a blocked reader is never told which rule matched', () => {
  const PATTERN = 'mẫu-bí-mật-\\d+'
  for (const [label, rules, text] of [
    ['a regex rule', () => [rule(PATTERN)], 'có mẫu-bí-mật-42 ở đây'],
    ['a keyword rule', () => [rule('từ-khoá-bí-mật', 'keyword')], 'có từ-khoá-bí-mật ở đây'],
    ['a built-in rule', () => [], 'mày dcm'],
  ] as const) {
    it(`comment and livestream message blocked by ${label}: the 400 says only that it is refused; the review row keeps the rule`, async () => {
      reset(rules())
      const blockedComment = await comment(text)
      const blockedChat = await chat(text)
      for (const result of [blockedComment, blockedChat]) {
        assert.equal(result.ok, false)
        assert.equal(result.ok === false && result.statusCode, 400)
        const message = result.ok === false ? result.message : ''
        assert.equal(message, INSTANT_BLOCK_PUBLIC_MESSAGE)
        assert.doesNotMatch(message, /Mẫu regex|Từ khóa|bí-mật|dcm|thô tục/i)
      }
      assert.equal(state.queue.length, 2, 'both are filed for review')
      if (label === 'a regex rule') for (const row of state.queue) assert.match(String(row.flaggedReason), /Mẫu regex: mẫu-bí-mật-\\d\+/, 'the admins still see which rule')
    })
  }
})
