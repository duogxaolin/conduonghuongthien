/**
 * Quét lại nền + lỗi ghi của moderation-worker, chạy với DB / AI / pool giả.
 *
 * Canh bốn điều mà bản cũ làm sai:
 *  1. `rescanExistingContent` nạp MỌI bình luận một lượt → nay đọc theo lô (≤ batchSize),
 *     dừng ở trần mỗi lượt, và con trỏ cho lượt sau quét tiếp phần CÒN LẠI (không quét
 *     lại mãi cùng những bình luận mới nhất).
 *  2. Một mục lỗi không làm hỏng cả lượt; mục có lệnh ẩn hỏng KHÔNG được đếm là "đã ẩn".
 *  3. Lệnh ẩn / ghi hàng chờ hỏng được ghi log (sự kiện ổn định + id), không `catch {}`.
 *  4. Job nền giữ khoá đơn luồng (trong tiến trình + khoá tên MySQL), trả tiến độ, và
 *     endpoint trả 202 ngay / 409 khi đang chạy.
 * Thêm: đường `checkAndModerateContent` không còn hạ chữ mẫu regex (`\D` ≠ `\d`).
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { MySqlDialect } from 'drizzle-orm/mysql-core'
import { aiModerationQueue, aiModerationRules, articleComments, livestreamMessages } from '../server/db/schema.ts'

type Row = Record<string, unknown>
type Comment = { id: number; body: string; isHidden: boolean }
type Message = { id: number; content: string; isDeleted: boolean }

const dialect = new MySqlDialect()

const store = {
  comments: [] as Comment[],
  messages: [] as Message[],
  rules: [] as Row[],
  queue: [] as Row[],
  limits: [] as number[],
  failHideIds: new Set<number>(),
  failQueue: false,
  lockHeldElsewhere: false,
  lockHeld: false,
}

function reset() {
  store.comments = []
  store.messages = []
  store.rules = []
  store.queue = []
  store.limits = []
  store.failHideIds = new Set()
  store.failQueue = false
  store.lockHeldElsewhere = false
  ai.gate = null
  ai.calls = 0
  ai.throws = false
  ai.unconfigured = false
  failBatch.reads = new Set()
}

/** `id < ?` bound from a compiled WHERE, or null when the query has no cursor. */
function cursorOf(cond: unknown): number | null {
  if (!cond) return null
  const q = dialect.sqlToQuery(cond as Parameters<typeof dialect.sqlToQuery>[0])
  return /<\s*\?/.test(q.sql) ? Number(q.params[q.params.length - 1]) : null
}
function idOf(cond: unknown): number {
  const q = dialect.sqlToQuery(cond as Parameters<typeof dialect.sqlToQuery>[0])
  return Number(q.params[q.params.length - 1])
}

function visible(table: unknown, before: number | null): Array<Comment | Message> {
  const rows = table === articleComments
    ? store.comments.filter(c => !c.isHidden)
    : table === livestreamMessages ? store.messages.filter(m => !m.isDeleted) : []
  return rows.filter(r => before === null || r.id < before)
}

const fakeDb = {
  select: (fields?: Row) => ({
    from: (table: unknown) => ({
      where: (cond: unknown) => {
        if (table === aiModerationRules) return Object.assign(Promise.resolve(store.rules), {})
        const rows = visible(table, cursorOf(cond))
        if (fields && 'total' in fields) return Object.assign(Promise.resolve([{ total: rows.length }]), {})
        return Object.assign(Promise.resolve(rows), {
          orderBy: () => ({
            limit: async (n: number) => {
              store.limits.push(n)
              if (failBatch.reads.has(store.limits.length)) throw new Error('injected batch read failure')
              return [...rows].sort((a, b) => b.id - a.id).slice(0, n).map(r => ({ ...r }))
            },
          }),
        })
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: async (v: Row) => {
      if (table === aiModerationQueue) {
        if (store.failQueue) throw new Error('queue table unavailable')
        store.queue.push(v)
      }
    },
  }),
  // Hàng chờ cho một mục CÓ id: `INSERT … SELECT … WHERE NOT EXISTS (hàng pending cùng mục)`.
  execute: async (q: Parameters<typeof dialect.sqlToQuery>[0]) => {
    const { sql, params } = dialect.sqlToQuery(q)
    const cols = /^insert into `ai_moderation_queue` \(([^)]+)\)/i.exec(sql)
    if (!cols) throw new Error(`unexpected execute: ${sql}`)
    if (store.failQueue) throw new Error('queue table unavailable')
    const names = cols[1]!.split(',').map(c => c.trim().replace(/`/g, '').replace(/_(\w)/g, (_m, ch: string) => ch.toUpperCase()))
    const row: Row = Object.fromEntries(names.map((n, i) => [n, params[i]]))
    row.matchedRules = JSON.parse(String(row.matchedRules))
    const [tt, tid, status] = params.slice(names.length)
    if (store.queue.some(r => r.targetType === tt && r.targetId === tid && r.status === status)) return [{ affectedRows: 0 }, undefined]
    store.queue.push(row)
    return [{ affectedRows: 1 }, undefined]
  },
  update: (table: unknown) => ({
    set: (s: Row) => ({
      where: async (cond: unknown) => {
        const id = idOf(cond)
        if (store.failHideIds.has(id)) throw new Error(`deadlock on row ${id}`)
        if (table === articleComments) {
          const c = store.comments.find(x => x.id === id)
          if (c && s.isHidden === true) c.isHidden = true
        } else if (table === livestreamMessages) {
          const m = store.messages.find(x => x.id === id)
          if (m && s.isDeleted === true) m.isDeleted = true
        }
      },
    }),
  }),
}

/** MySQL named lock, faked: one holder at a time, plus a switch for "held by another replica". */
const fakePool = {
  getConnection: async () => ({
    query: async (sql: string) => {
      if (sql.includes('GET_LOCK')) {
        if (store.lockHeldElsewhere || store.lockHeld) return [[{ acquired: 0 }]]
        store.lockHeld = true
        return [[{ acquired: 1 }]]
      }
      if (sql.includes('RELEASE_LOCK')) store.lockHeld = false
      return [[]]
    },
    release: () => undefined,
  }),
}

const ai = { gate: null as Promise<void> | null, calls: 0, throws: false, unconfigured: false }
/** Số thứ tự (1-based, đếm qua mọi lượt chạy) các lần đọc lô sẽ ném lỗi. */
const failBatch = { reads: new Set<number>() }

mock.module(new URL('../server/utils/db.ts', import.meta.url), {
  namedExports: { getDb: () => fakeDb, getPool: () => fakePool },
})
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url), {
  namedExports: {
    callAi: async (_service: string, input: { variables?: { content?: string } }) => {
      ai.calls++
      if (ai.gate) await ai.gate
      if (ai.throws) throw new Error('provider exploded')
      if (ai.unconfigured) return { ok: false, error: 'no_api_key' }
      const bad = String(input.variables?.content ?? '').includes('phản động')
      return { ok: true, text: bad ? '{"verdict":"violation","intent":"propaganda","riskLevel":"high","reason":"vi phạm"}' : '{"verdict":"safe"}' }
    },
  },
})

// Capture the JSON log lines (warn/error go to stderr through console.error).
const logged: Row[] = []
mock.method(console, 'error', (line: unknown) => {
  try { logged.push(JSON.parse(String(line)) as Row) } catch { /* not a log line */ }
})

const worker = await import('../server/services/moderation-worker.ts')
const job = await import('../server/services/moderation-rescan-job.ts')

function seedComments(n: number, body = (id: number) => `bình luận bình thường số ${id}`) {
  store.comments = Array.from({ length: n }, (_, i) => ({ id: i + 1, body: body(i + 1), isHidden: false }))
}

// ── 1. Bounded batches, per-run cap, resume cursor ─────────────────────────

test('rescan reads in bounded batches, stops at the per-run cap, and resumes where it stopped', async () => {
  reset()
  seedComments(250)
  const first = await worker.rescanExistingContent({ batchSize: 100, maxComments: 120, maxMessages: 10 })
  assert.equal(first.scannedComments, 120)
  assert.equal(first.totalComments, 120)
  assert.ok(store.limits.every(n => n <= 100), `a query asked for more than one batch: ${store.limits.join(',')}`)
  assert.equal(ai.calls, 120, 'one AI call per scanned comment, no more')
  assert.equal(first.truncated, true)
  assert.equal(first.nextCursor.commentsBeforeId, 131, 'newest first: 250..131 scanned, resume below 131')

  const second = await worker.rescanExistingContent({ batchSize: 100, maxComments: 120, cursor: first.nextCursor })
  assert.equal(second.scannedComments, 120)
  assert.equal(second.nextCursor.commentsBeforeId, 11, 'second run covers 130..11 — disjoint from the first')

  const third = await worker.rescanExistingContent({ batchSize: 100, maxComments: 120, cursor: second.nextCursor })
  assert.equal(third.scannedComments, 10)
  assert.equal(third.truncated, false)
  assert.deepEqual(third.nextCursor, { commentsBeforeId: null, messagesBeforeId: null }, 'walked to the end → restart from newest')
  assert.equal(ai.calls, 250, 'three capped runs scanned every comment exactly once')
})

test('progress is reported per item with planned totals', async () => {
  reset()
  seedComments(5)
  store.messages = [{ id: 1, content: 'xin chào', isDeleted: false }, { id: 2, content: 'mày dcm', isDeleted: false }]
  const seen: Array<{ phase: string; scannedComments: number; scannedMessages: number; totalComments: number; totalMessages: number }> = []
  const summary = await worker.rescanExistingContent({ onProgress: p => seen.push(p) })
  assert.equal(seen[0]!.totalComments, 5)
  assert.equal(seen[0]!.totalMessages, 2)
  assert.deepEqual(seen.filter(p => p.phase === 'comments').map(p => p.scannedComments), [0, 1, 2, 3, 4, 5])
  assert.equal(seen.at(-1)!.phase, 'done')
  assert.equal(summary.deletedMessages, 1)
  assert.equal(store.messages.find(m => m.id === 2)!.isDeleted, true)
})

// ── 2/3. Failures: logged, counted, never counted as hidden, never abort ──

test('a failing hide is logged, not counted as hidden, and does not abort the run', async () => {
  reset()
  seedComments(4, id => (id % 2 === 0 ? `tuyên truyền phản động ${id}` : `bình thường ${id}`))
  store.messages = [
    { id: 7, content: 'mày dcm', isDeleted: false },
    { id: 8, content: 'mày dcm nữa', isDeleted: false },
  ]
  store.failHideIds = new Set([4, 8]) // comment #4 and live message #8: the hide UPDATE throws
  const before = logged.length
  const summary = await worker.rescanExistingContent()
  assert.equal(summary.scannedComments, 4, 'the run went on past the failing item')
  assert.equal(summary.hiddenComments, 1, 'only #2 was really hidden')
  assert.equal(summary.failedComments, 1)
  assert.equal(store.comments.find(c => c.id === 2)!.isHidden, true)
  assert.equal(store.comments.find(c => c.id === 4)!.isHidden, false)
  assert.equal(summary.deletedMessages, 1)
  assert.equal(summary.failedMessages, 1)

  const hideFailures = logged.slice(before).filter(l => l.event === 'ai_moderation.hide_failed')
  assert.deepEqual(hideFailures.map(l => [l.targetType, l.targetId]).sort(), [['comment', 4], ['livestream_chat', 8]])
  assert.ok(hideFailures.every(l => l.level === 'error' && String(l.error).includes('deadlock')))
})

test('checkAndModerateContent reports hide/queue failures on flagged results and logs each', async () => {
  reset()
  store.comments = [{ id: 9, body: 'x', isHidden: false }]
  store.failHideIds = new Set([9])
  store.failQueue = true
  const before = logged.length
  const out = await worker.checkAndModerateContent({ content: 'tuyên truyền phản động', targetType: 'comment', targetId: 9 })
  assert.equal(out.flagged, true)
  assert.equal(out.action, 'auto_hide')
  assert.equal(out.hidden, false)
  assert.deepEqual(out.failures, ['queue', 'hide'])
  const fresh = logged.slice(before)
  assert.equal(fresh.filter(l => l.event === 'ai_moderation.queue_insert_failed' && l.targetId === 9).length, 1)
  assert.equal(fresh.filter(l => l.event === 'ai_moderation.hide_failed' && l.targetId === 9).length, 1)
  assert.ok(worker.getWorkerStats().errorCount >= 2, 'write failures must surface in the worker status')

  // Instant-block path (fastPreModerate matched) also reports a failed hide.
  const instant = await worker.checkAndModerateContent({ content: 'mày dcm', targetType: 'comment', targetId: 9 })
  assert.equal(instant.hidden, false)
  assert.deepEqual(instant.failures, ['hide'])

  // Success path: hidden is true, no failures.
  reset()
  store.comments = [{ id: 10, body: 'x', isHidden: false }]
  const ok = await worker.checkAndModerateContent({ content: 'tuyên truyền phản động', targetType: 'comment', targetId: 10 })
  assert.equal(ok.hidden, true)
  assert.deepEqual(ok.failures, [])
})

test('checkAndModerateContent no longer lower-cases regex rules (\\D stays non-digit)', async () => {
  reset()
  worker.invalidateModerationRulesCache()
  store.rules = [{ id: 1, pattern: '^\\D+$', ruleType: 'pattern', category: 'custom', severity: 'critical', action: 'auto_hide', isEnabled: true }]
  ai.throws = true // AI failure + a critical keyword match is what auto-hides on this path
  const digits = await worker.checkAndModerateContent({ content: '12345', targetType: 'comment' })
  assert.equal(digits.flagged, false, 'lower-casing turned ^\\D+$ into ^\\d+$ and hid an all-digit comment')
  worker.invalidateModerationRulesCache()
  store.rules = []
})

// ── 4. Background job: single flight, progress, 202/409 ────────────────────

test('job: a second start while running is refused (in-process), progress is visible, and it completes', async () => {
  reset()
  seedComments(3)
  let open!: () => void
  ai.gate = new Promise<void>(resolve => { open = resolve })
  const finished: unknown[] = []

  const first = await job.startModerationRescan({ actorId: 1, onFinished: async s => { finished.push(s) } })
  assert.equal(first.started, true)
  assert.equal(first.status.state, 'running')

  const second = await job.startModerationRescan({ actorId: 2 })
  assert.equal(second.started, false)
  assert.equal((second as { reason: string }).reason, 'running_here')
  assert.equal(second.status.state, 'running')

  // Let the AI answer; the job walks the three comments.
  open()
  await job.waitForModerationRescan()
  const done = job.getModerationRescanStatus()
  assert.equal(done.state, 'completed')
  assert.equal(done.startedBy, 1, 'the refused second start must not overwrite the running job')
  assert.equal(done.progress!.scannedComments, 3)
  assert.equal(done.summary!.scannedComments, 3)
  assert.equal(finished.length, 1, 'onFinished runs exactly once, with the summary')
  assert.equal(store.lockHeld, false, 'the named lock is released when the job ends')
  assert.equal(ai.calls, 3, 'the refused start did not trigger a second scan')
})

test('job: a lock held by another replica refuses the start and leaves the previous status intact', async () => {
  reset()
  seedComments(2)
  store.lockHeldElsewhere = true
  const before = job.getModerationRescanStatus()
  const out = await job.startModerationRescan({ actorId: 3 })
  assert.equal(out.started, false)
  assert.equal((out as { reason: string }).reason, 'running_elsewhere')
  assert.deepEqual(job.getModerationRescanStatus(), before)
  assert.equal(ai.calls, 0, 'nothing was scanned without the lock')
})

test('job: progress is observable mid-run through the status snapshot', async () => {
  reset()
  seedComments(2)
  let open!: () => void
  ai.gate = new Promise<void>(resolve => { open = resolve })
  await job.startModerationRescan({ actorId: 1 })
  // Wait until the job is blocked inside the first AI call.
  while (ai.calls === 0) await new Promise(r => setImmediate(r))
  const mid = job.getModerationRescanStatus()
  open()
  assert.equal(mid.state, 'running')
  assert.equal(mid.progress!.totalComments, 2, 'the planned total (the "y") is known before the first item')
  assert.equal(mid.progress!.scannedComments, 0, 'x counts FINISHED items — the one in flight is not yet reported')
  await job.waitForModerationRescan()
  assert.equal(job.getModerationRescanStatus().progress!.scannedComments, 2)
})

test('endpoint: 202 with progress on start, 409 with progress while running, audit at start and at finish', async () => {
  reset()
  seedComments(2)
  const audits: Row[] = []
  const auditDb = { insert: () => ({ values: async (v: Row) => { audits.push(v) } }) }
  // The endpoint writes audit rows with getDb().insert(activityLogs); route those to the recorder.
  const originalInsert = fakeDb.insert
  fakeDb.insert = ((table: unknown) => (table === aiModerationQueue ? originalInsert(table) : auditDb.insert())) as typeof fakeDb.insert

  Object.assign(globalThis, { defineEventHandler: (h: unknown) => h })
  const handler = (await import('../server/api/admin/ai/moderation/rescan-all.post.ts')).default as (e: unknown) => Promise<Row>
  const admin = { id: 1, isSuperAdmin: true, permissions: [] }
  const makeEvent = () => ({ node: { res: { statusCode: 200 } }, context: { adminUser: admin } })

  let open!: () => void
  ai.gate = new Promise<void>(resolve => { open = resolve })
  const e1 = makeEvent()
  const res = await handler(e1)
  assert.equal(e1.node.res.statusCode, 202)
  assert.equal(res.started, true)
  assert.equal((res.rescan as Row).state, 'running')

  await assert.rejects(() => handler(makeEvent()), (err: unknown) => {
    const e = err as { statusCode?: number; data?: { rescan?: Row } }
    assert.equal(e.statusCode, 409)
    assert.equal(e.data?.rescan?.state, 'running')
    return true
  })

  open()
  await job.waitForModerationRescan()
  assert.deepEqual(audits.map(a => (a.meta as Row).operation), ['moderation_rescan_all_started', 'moderation_rescan_all'])
  assert.equal((audits[1]!.meta as Row).scannedComments, 2)

  // A non-admin is refused before anything starts.
  await assert.rejects(() => handler({ node: { res: {} }, context: { adminUser: { id: 2, permissions: [] } } }), /Forbidden/)
  fakeDb.insert = originalInsert
})

// ── 5. Kiểm chứng 2026-10: lô đọc hỏng, AI chưa cấu hình, hàng chờ trùng ────────

test('lô đọc hỏng giữa chừng (cả lần thử lại): job failed, nhả khoá, lượt sau quét TIẾP từ lô cuối đã xong', async () => {
  await job.waitForModerationRescan()
  reset()
  seedComments(150)
  // Lần đọc lô thứ 2 và lần thử lại của nó đều hỏng.
  failBatch.reads = new Set([2, 3])
  assert.equal((await job.startModerationRescan({ actorId: 1 })).started, true)
  await job.waitForModerationRescan()
  const failed = job.getModerationRescanStatus()
  assert.equal(failed.state, 'failed')
  assert.match(String(failed.error), /injected batch read failure/)
  assert.equal(store.lockHeld, false, 'khoá được nhả')
  assert.equal(ai.calls, 100, 'lô đầu (100 bình luận) đã quét')

  failBatch.reads = new Set()
  ai.calls = 0
  assert.equal((await job.startModerationRescan({ actorId: 1 })).started, true)
  await job.waitForModerationRescan()
  const done = job.getModerationRescanStatus()
  assert.equal(done.state, 'completed')
  assert.equal(done.summary!.scannedComments, 50, 'chỉ phần còn lại — không quét lại 100 bình luận đầu')
  assert.equal(ai.calls, 50)
})

test('lô đọc hỏng một lần rồi được: thử lại, lượt quét vẫn xong trọn', async () => {
  await job.waitForModerationRescan()
  reset()
  seedComments(150)
  failBatch.reads = new Set([2])
  const summary = await worker.rescanExistingContent()
  assert.equal(summary.scannedComments, 150)
  assert.equal(ai.calls, 150)
  assert.ok(logged.some(l => l.event === 'ai_moderation.rescan_batch_retry'))
})

test('AI chưa cấu hình: quét lại chỉ chạy luật, không dồn bình luận cũ vào hàng chờ; chạy lại không nhân đôi', async () => {
  await job.waitForModerationRescan()
  reset()
  ai.unconfigured = true
  seedComments(4, id => (id === 2 ? 'mày dcm' : `bình luận bình thường số ${id}`))
  const first = await worker.rescanExistingContent()
  assert.equal(first.aiUnavailable, true)
  assert.equal(first.scannedComments, 4)
  assert.equal(ai.calls, 1, 'phát hiện AI chưa cấu hình ở bình luận đầu, phần còn lại chỉ chạy luật')
  assert.equal(first.hiddenComments, 1, 'luật chặn tức thì vẫn ẩn bình luận thô tục')
  assert.equal(store.comments.find(c => c.id === 2)!.isHidden, true)
  assert.ok(!store.queue.some(r => (r.flaggedReason as string | undefined)?.includes('chưa cấu hình')), 'không có hàng flag_only nào')
  const queued = store.queue.length

  const second = await worker.rescanExistingContent()
  assert.equal(second.aiUnavailable, true)
  assert.equal(store.queue.length, queued, 'chạy lại không thêm hàng chờ nào')
})

test('hàng chờ không nhân đôi cho cùng một mục còn pending (đường nhận nội dung mới, AI chưa cấu hình)', async () => {
  reset()
  ai.unconfigured = true
  const a = await worker.checkAndModerateContent({ content: 'xin chào', targetType: 'comment', targetId: 77 })
  const b = await worker.checkAndModerateContent({ content: 'xin chào', targetType: 'comment', targetId: 77 })
  assert.equal(a.action, 'flag_only')
  assert.equal(b.action, 'flag_only')
  assert.equal(store.queue.filter(r => r.targetId === 77).length, 1)
  // Hàng cũ đã được duyệt (không còn pending) → lần gắn cờ mới ghi hàng mới.
  store.queue[0]!.status = 'approved'
  await worker.checkAndModerateContent({ content: 'xin chào', targetType: 'comment', targetId: 77 })
  assert.equal(store.queue.filter(r => r.targetId === 77).length, 2)
  // Mục không có id (tin chatbot chưa lưu) luôn được ghi.
  await worker.checkAndModerateContent({ content: 'xin chào', targetType: 'chat' })
  await worker.checkAndModerateContent({ content: 'xin chào', targetType: 'chat' })
  assert.equal(store.queue.filter(r => r.targetType === 'chat').length, 2)
})
