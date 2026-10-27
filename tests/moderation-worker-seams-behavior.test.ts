/**
 * Behaviour across the seams of `moderation-worker.ts` (wave3-long-term 4.3, D-SPLIT).
 *
 * Written BEFORE the 822-line file was split, and green on it (9905d0d): it must stay
 * green, unchanged, on the barrel + `moderation-worker-*.ts` parts. Everything goes
 * through the barrel — the one path the endpoints, comments, livestream chat, the
 * chatbot and the rescan job use.
 *
 * `moderation-worker-behavior.test.ts` already pins the verdicts. This file pins what a
 * split breaks without a type error: the paths that cross the new file boundaries.
 *   - the runtime export list, exactly (a re-export lost or a helper leaked);
 *   - `workerStats` counters written from several files into ONE object
 *     (`moderation-stats.ts`): the per-path deltas;
 *   - the write path (`insertQueueRowOnce` / `applyAutoHide`) reached from the AI pass:
 *     dedup + its log line, the no-id insert, the `article` target with nothing to hide,
 *     both writes failing (reported, logged, counted);
 *   - the rules read failing inside the AI pass (logged, counted, AI still asked) and
 *     the two fallbacks that only a rules hiccup can reach (critical keyword when the AI
 *     fails; keyword severity when the AI is not configured);
 *   - `onAiUnavailable: 'skip'` (the rescan's rules-only switch) and the two log lines
 *     every check ends with.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { aiModerationQueue, aiModerationRules, articleComments, chatMessages } from '../server/db/schema.ts'

const dialect = new MySqlDialect()

type Row = Record<string, unknown>
const rec = {
  rules: [] as Row[],
  /** The next N reads of `ai_moderation_rules` throw. */
  ruleReadFailures: 0,
  queue: [] as Row[],
  updates: [] as Array<{ table: unknown; set: Row }>,
  updateAttempts: 0,
  failQueue: false,
  failUpdate: false,
  ai: { ok: true, text: '{"verdict":"safe"}' } as Row,
  aiThrows: false,
  aiDelayMs: 0,
  aiCalls: 0,
}

const fakeDb = {
  select: () => ({
    from: (t: unknown) => ({
      where: () => {
        if (t === aiModerationRules) {
          if (rec.ruleReadFailures > 0) {
            rec.ruleReadFailures--
            return Promise.reject(new Error('rules table unreachable'))
          }
          return Promise.resolve(rec.rules)
        }
        return Promise.resolve([])
      },
    }),
  }),
  // No-id review rows (and `recordInstantBlock`) use a plain insert.
  insert: (t: unknown) => ({
    values: async (v: Row) => {
      if (rec.failQueue) throw new Error('queue insert refused')
      if (t === aiModerationQueue) rec.queue.push(v)
    },
  }),
  // A review row for an item WITH an id: `INSERT … SELECT … WHERE NOT EXISTS (pending row, same item)`.
  execute: async (q: Parameters<MySqlDialect['sqlToQuery']>[0]) => {
    if (rec.failQueue) throw new Error('queue insert refused')
    const { sql, params } = dialect.sqlToQuery(q)
    const cols = /^insert into `ai_moderation_queue` \(([^)]+)\)/i.exec(sql)
    if (!cols) throw new Error(`unexpected execute: ${sql}`)
    const names = cols[1]!.split(',').map(c => c.trim().replace(/`/g, '').replace(/_(\w)/g, (_m, ch: string) => ch.toUpperCase()))
    const row: Row = Object.fromEntries(names.map((n, i) => [n, params[i]]))
    row.matchedRules = JSON.parse(String(row.matchedRules))
    const [tt, tid, status] = params.slice(names.length)
    if (rec.queue.some(r => r.targetType === tt && r.targetId === tid && r.status === status)) return [{ affectedRows: 0 }, undefined]
    rec.queue.push(row)
    return [{ affectedRows: 1 }, undefined]
  },
  update: (t: unknown) => ({
    set: (s: Row) => ({
      where: async () => {
        rec.updateAttempts++
        if (rec.failUpdate) throw new Error('hide refused')
        rec.updates.push({ table: t, set: s })
      },
    }),
  }),
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb, getPool: () => null } })
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url), {
  namedExports: {
    callAi: async () => {
      rec.aiCalls++
      if (rec.aiDelayMs > 0) await new Promise(resolve => setTimeout(resolve, rec.aiDelayMs))
      if (rec.aiThrows) throw new Error('provider exploded')
      return rec.ai
    },
  },
})

// The logger prints one JSON line: info → console.log, warn/error → console.error.
const logged: Row[] = []
const capture = (line: unknown) => {
  try { logged.push(JSON.parse(String(line)) as Row) } catch { /* not a log line */ }
}
mock.method(console, 'log', capture)
mock.method(console, 'error', capture)

const svc = await import('../server/services/moderation-worker.ts')

const rule = (o: Row): Row => ({ id: 1, pattern: 'x', ruleType: 'keyword', category: 'custom', severity: 'high', action: 'auto_hide', isEnabled: true, ...o })
const VIOLATION = { ok: true, text: '{"verdict":"violation","intent":"spam","riskLevel":"high","reason":"r"}' }

function reset() {
  rec.rules = []; rec.ruleReadFailures = 0; rec.queue = []; rec.updates = []; rec.updateAttempts = 0
  rec.failQueue = false; rec.failUpdate = false
  rec.ai = { ok: true, text: '{"verdict":"safe"}' }; rec.aiThrows = false; rec.aiDelayMs = 0; rec.aiCalls = 0
  svc.invalidateModerationRulesCache()
  return logged.length
}
const eventsSince = (mark: number, event: string) => logged.slice(mark).filter(line => line.event === event)

/** `getWorkerStats()` counters only (the snapshot also carries uptime and memory). */
function counters() {
  const s = svc.getWorkerStats()
  return { totalScanned: s.totalScanned, blockedInstant: s.blockedInstant, blockedAi: s.blockedAi, allowedCount: s.allowedCount, errorCount: s.errorCount }
}
function delta(before: ReturnType<typeof counters>) {
  const after = counters()
  return Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v - before[k as keyof typeof before]]))
}

test('the barrel exposes exactly the pre-split runtime API (9 values) plus matchInstantRuleBatch and earlierTurnsToWithhold, and the rescan limits are frozen', () => {
  assert.deepEqual(Object.keys(svc).sort(), [
    'MODERATION_RESCAN_LIMITS',
    'checkAndModerateContent',
    // Added on purpose (verify of 4.3c follow-up, W5): the chat history's withhold set — a turn
    // that trips a rule OR that the request budget never reached (`moderation-worker-prescreen.ts`).
    'earlierTurnsToWithhold',
    'fastPreModerate',
    'getActiveModerationRules',
    'getWorkerStats',
    'invalidateModerationRulesCache',
    'matchInstantRule',
    // Added on purpose after the split (wave3 4.3c follow-up): the chat endpoints' earlier user
    // turns in ONE bounded `vm` pass — `tests/moderation-regex-budget.test.ts`.
    'matchInstantRuleBatch',
    'rescanExistingContent',
    'resetWorkerStats',
  ])
  assert.ok(Object.isFrozen(svc.MODERATION_RESCAN_LIMITS))
  assert.deepEqual({ ...svc.MODERATION_RESCAN_LIMITS }, { batchSize: 100, maxComments: 1000, maxMessages: 5000 })
})

test('counters: each path moves the one shared workerStats object by the same amounts as before', async () => {
  reset()
  let before = counters()
  await svc.checkAndModerateContent({ content: 'một câu bình thường', targetType: 'comment', targetId: 1 })
  // fastPreModerate: scanned + allowed; the AI's "safe": allowed again.
  assert.deepEqual(delta(before), { totalScanned: 1, blockedInstant: 0, blockedAi: 0, allowedCount: 2, errorCount: 0 })

  reset()
  rec.ai = VIOLATION
  before = counters()
  await svc.checkAndModerateContent({ content: 'một câu lạ', targetType: 'comment', targetId: 2 })
  assert.deepEqual(delta(before), { totalScanned: 1, blockedInstant: 0, blockedAi: 1, allowedCount: 1, errorCount: 0 })

  reset()
  before = counters()
  await svc.checkAndModerateContent({ content: 'mày dcm', targetType: 'comment', targetId: 3 })
  assert.deepEqual(delta(before), { totalScanned: 1, blockedInstant: 1, blockedAi: 0, allowedCount: 0, errorCount: 0 })

  reset()
  rec.aiThrows = true
  before = counters()
  await svc.checkAndModerateContent({ content: 'một câu lạ', targetType: 'comment', targetId: 4 })
  assert.deepEqual(delta(before), { totalScanned: 1, blockedInstant: 0, blockedAi: 0, allowedCount: 1, errorCount: 1 })
  assert.equal(svc.getWorkerStats().lastError, 'provider exploded')

  reset()
  rec.aiDelayMs = 30
  await svc.checkAndModerateContent({ content: 'một câu bình thường', targetType: 'comment', targetId: 5 })
  assert.ok(svc.getWorkerStats().lastAiLatencyMs >= 15, `AI latency not recorded: ${svc.getWorkerStats().lastAiLatencyMs}`)
  svc.resetWorkerStats()
})

test('a failed rules read inside the AI pass: logged, counted as a worker error, and the AI is still asked', async () => {
  const mark = reset()
  // Read 1 is the instant pass (it falls back to the built-in rules silently), read 2 the AI pass.
  rec.ruleReadFailures = 2
  const before = counters()
  const out = await svc.checkAndModerateContent({ content: 'một câu bình thường', targetType: 'comment', targetId: 12 })
  assert.deepEqual(out, { flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [] })
  assert.equal(rec.aiCalls, 1, 'the AI pass ran anyway')
  assert.equal(delta(before).errorCount, 1)
  assert.equal(svc.getWorkerStats().lastError, 'rules table unreachable')
  const warn = eventsSince(mark, 'ai_moderation.rules_unavailable')
  assert.equal(warn.length, 1)
  assert.equal(warn[0]!.level, 'warn')
  assert.equal(warn[0]!.targetType, 'comment')
  assert.equal(warn[0]!.targetId, 12)
  assert.equal(warn[0]!.error, 'rules table unreachable')
  svc.resetWorkerStats()
})

test('AI fails after a rules hiccup: a critical keyword still hides the comment, marked as the AI fallback', async () => {
  for (const [label, arrange, failure] of [
    ['provider error', () => { rec.ai = { ok: false, error: 'provider_error' } }, 'provider_error'],
    ['call threw', () => { rec.aiThrows = true }, 'exception'],
  ] as const) {
    reset()
    rec.rules = [rule({ pattern: 'từ-nguy-hiểm', category: 'sec', severity: 'critical' })]
    rec.ruleReadFailures = 1 // the instant pass misses the rule; the AI pass sees it
    arrange()
    const out = await svc.checkAndModerateContent({ content: 'có từ-nguy-hiểm ở đây', targetType: 'comment', targetId: 21 })
    const reason = 'Khớp từ khóa an ninh: "từ-nguy-hiểm" (Dự phòng lỗi AI)'
    assert.deepEqual(out, {
      flagged: true,
      action: 'auto_hide',
      severity: 'critical',
      reasons: [reason],
      matchedRules: ['[sec] từ-nguy-hiểm'],
      hidden: true,
      failures: [],
      aiFailed: true,
      aiFailure: failure,
    }, label)
    assert.equal(rec.queue.length, 1, label)
    assert.equal(rec.queue[0]!.targetId, 21, label)
    assert.equal(rec.queue[0]!.severity, 'critical', label)
    assert.deepEqual(rec.updates, [{ table: articleComments, set: { isHidden: true, flagReason: reason } }], label)
  }
  svc.resetWorkerStats()
})

test('AI not configured with keyword hits: flag_only at the highest keyword severity, keywords named, nothing hidden', async () => {
  reset()
  rec.rules = [
    rule({ pattern: 'nhạy-cảm', category: 'kw', severity: 'high' }),
    rule({ id: 2, pattern: 'khác', category: 'kw2', severity: 'low' }),
  ]
  rec.ruleReadFailures = 1
  rec.ai = { ok: false, error: 'service_inactive' }
  const out = await svc.checkAndModerateContent({ content: 'chuyện nhạy-cảm và khác', targetType: 'comment', targetId: 22 })
  assert.deepEqual(out, {
    flagged: true,
    action: 'flag_only',
    severity: 'high',
    reasons: ['AI kiểm duyệt chưa cấu hình; khớp từ khóa nhạy cảm: "nhạy-cảm", "khác" — cần con người đối soát'],
    matchedRules: ['[kw] nhạy-cảm', '[kw2] khác'],
    hidden: false,
    failures: [],
  })
  assert.equal(rec.queue.length, 1)
  assert.equal(rec.queue[0]!.severity, 'high')
  assert.equal(rec.updateAttempts, 0, 'flag_only never hides')
})

test("onAiUnavailable: 'skip' → the exact aiUnavailable result, no review row, no check log line", async () => {
  for (const error of ['service_not_found', 'service_inactive', 'no_api_key']) {
    const mark = reset()
    rec.ai = { ok: false, error }
    const out = await svc.checkAndModerateContent({ content: 'một câu lạ', targetType: 'comment', targetId: 23 }, { onAiUnavailable: 'skip' })
    assert.deepEqual(out, { flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [], aiUnavailable: true }, error)
    assert.equal(rec.queue.length, 0, error)
    assert.equal(rec.updateAttempts, 0, error)
    assert.equal(eventsSince(mark, 'ai_moderation.checked_safe').length + eventsSince(mark, 'ai_moderation.flagged').length, 0, error)
  }
})

test('a target with a pending review row is not queued twice, and the skip is logged', async () => {
  const mark = reset()
  rec.ai = { ok: false, error: 'no_api_key' }
  const first = await svc.checkAndModerateContent({ content: 'xin chào', targetType: 'comment', targetId: 31 })
  const second = await svc.checkAndModerateContent({ content: 'xin chào', targetType: 'comment', targetId: 31 })
  assert.deepEqual([first.action, first.failures, second.action, second.failures], ['flag_only', [], 'flag_only', []])
  assert.equal(rec.queue.length, 1)
  const skipped = eventsSince(mark, 'ai_moderation.queue_already_pending')
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0]!.level, 'info')
  assert.equal(skipped[0]!.targetType, 'comment')
  assert.equal(skipped[0]!.targetId, 31)
})

test('no targetId: every flag is queued (no dedup possible) and nothing is hidden', async () => {
  reset()
  rec.ai = VIOLATION
  for (let i = 0; i < 2; i++) {
    const out = await svc.checkAndModerateContent({ content: 'một câu lạ', targetType: 'chat', authorName: 'Ẩn danh' })
    assert.deepEqual([out.action, out.hidden, out.failures], ['auto_hide', false, []])
  }
  assert.equal(rec.queue.length, 2)
  assert.deepEqual(rec.queue.map(r => [r.targetType, r.targetId, r.authorName, r.status]), [['chat', null, 'Ẩn danh', 'pending'], ['chat', null, 'Ẩn danh', 'pending']])
  assert.equal(rec.updateAttempts, 0)
})

test("an 'article' target is queued but has no column to hide: hidden false, no failure", async () => {
  reset()
  rec.ai = VIOLATION
  const out = await svc.checkAndModerateContent({ content: 'một câu lạ', targetType: 'article', targetId: 41 })
  assert.deepEqual([out.flagged, out.action, out.hidden, out.failures], [true, 'auto_hide', false, []])
  assert.equal(rec.queue.length, 1)
  assert.equal(rec.queue[0]!.targetType, 'article')
  assert.equal(rec.updateAttempts, 0)
})

test('an instant block reached through checkAndModerateContent hides only when there is an id', async () => {
  reset()
  const noId = await svc.checkAndModerateContent({ content: 'mày dcm', targetType: 'comment' })
  assert.deepEqual(noId, {
    flagged: true,
    action: 'auto_hide',
    severity: 'high',
    reasons: ['Nội dung vi phạm tiêu chuẩn an ninh và quy định cộng đồng (Chửi thề thô tục).'],
    matchedRules: ['Chửi thề thô tục'],
    hidden: false,
    failures: [],
  })
  assert.equal(rec.updateAttempts, 0)
  assert.equal(rec.aiCalls, 0)
  const withId = await svc.checkAndModerateContent({ content: 'mày dcm', targetType: 'chat', targetId: 42 })
  assert.equal(withId.hidden, true)
  assert.deepEqual(rec.updates, [{ table: chatMessages, set: { isFlagged: true, flagReason: noId.reasons[0] } }])
})

test('both writes failing: reported in order, each logged with its target, each counted as a worker error', async () => {
  const mark = reset()
  rec.ai = VIOLATION
  rec.failQueue = true
  rec.failUpdate = true
  const before = counters()
  const out = await svc.checkAndModerateContent({ content: 'một câu lạ', targetType: 'chat', targetId: 51 })
  assert.deepEqual([out.flagged, out.action, out.hidden, out.failures], [true, 'auto_hide', false, ['queue', 'hide']])
  assert.equal(rec.updateAttempts, 1, 'the hide is still attempted after the queue write failed')
  assert.equal(delta(before).errorCount, 2)
  assert.equal(svc.getWorkerStats().lastError, 'hide refused')
  const queueFailed = eventsSince(mark, 'ai_moderation.queue_insert_failed')
  assert.equal(queueFailed.length, 1)
  assert.deepEqual([queueFailed[0]!.level, queueFailed[0]!.targetType, queueFailed[0]!.targetId, queueFailed[0]!.severity, queueFailed[0]!.error], ['error', 'chat', 51, 'high', 'queue insert refused'])
  const hideFailed = eventsSince(mark, 'ai_moderation.hide_failed')
  assert.equal(hideFailed.length, 1)
  assert.deepEqual([hideFailed[0]!.level, hideFailed[0]!.targetType, hideFailed[0]!.targetId, hideFailed[0]!.error], ['error', 'chat', 51, 'hide refused'])
  svc.resetWorkerStats()
})

test('every check ends with one log line: warn ai_moderation.flagged, or info ai_moderation.checked_safe', async () => {
  let mark = reset()
  const content = 'một câu bình thường'
  await svc.checkAndModerateContent({ content: `  ${content}  `, targetType: 'comment', targetId: 61 })
  const safe = eventsSince(mark, 'ai_moderation.checked_safe')
  assert.equal(safe.length, 1)
  assert.deepEqual(
    [safe[0]!.level, safe[0]!.targetType, safe[0]!.targetId, safe[0]!.contentLength, safe[0]!.matchedKeywordsCount],
    ['info', 'comment', 61, content.length, 0],
  )
  assert.equal(eventsSince(mark, 'ai_moderation.flagged').length, 0)

  mark = reset()
  rec.ai = VIOLATION
  await svc.checkAndModerateContent({ content, targetType: 'comment', targetId: 62 })
  const flagged = eventsSince(mark, 'ai_moderation.flagged')
  assert.equal(flagged.length, 1)
  assert.deepEqual(
    [flagged[0]!.level, flagged[0]!.targetType, flagged[0]!.targetId, flagged[0]!.action, flagged[0]!.severity, flagged[0]!.reasons],
    ['warn', 'comment', 62, 'auto_hide', 'high', ['r']],
  )
  assert.equal(eventsSince(mark, 'ai_moderation.checked_safe').length, 0)
})
