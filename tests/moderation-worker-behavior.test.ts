/**
 * Hành vi của moderation-worker (chặn tức thì, cache luật, thống kê, quét AI), chạy với db/AI giả.
 *
 * Viết TRƯỚC khi tách `moderation-worker.ts`: phải xanh trên cả mã cũ lẫn mới. Chỉ import qua
 * `moderation-worker.ts` — đường mà 6 endpoint, comments, livestream-chat và chatbot dùng.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { aiModerationRules, aiModerationQueue, articleComments, chatMessages } from '../server/db/schema.ts'

type Row = Record<string, unknown>
const rec = {
  rules: [] as Row[],
  ruleSelects: 0,
  queue: [] as Row[],
  updates: [] as Array<{ table: unknown; set: Row }>,
  ai: { ok: true, text: '{"verdict":"safe"}', error: undefined as string | undefined } as Row,
  aiThrows: false,
  aiCalls: 0,
}
function reset(svc: { invalidateModerationRulesCache(): void }) {
  rec.rules = []; rec.ruleSelects = 0; rec.queue = []; rec.updates = []
  rec.ai = { ok: true, text: '{"verdict":"safe"}', error: undefined }
  rec.aiThrows = false; rec.aiCalls = 0
  svc.invalidateModerationRulesCache()
}

const fakeDb = {
  select: () => ({
    from: (t: unknown) => ({
      where: async () => {
        if (t === aiModerationRules) { rec.ruleSelects++; return rec.rules }
        return []
      },
    }),
  }),
  insert: (t: unknown) => ({ values: async (v: Row) => { if (t === aiModerationQueue) rec.queue.push(v) } }),
  update: (t: unknown) => ({
    set: (s: Row) => ({ where: async () => { rec.updates.push({ table: t, set: s }) } }),
  }),
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), { namedExports: { getDb: () => fakeDb } })
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url), {
  namedExports: {
    callAi: async () => {
      rec.aiCalls++
      if (rec.aiThrows) throw new Error('provider exploded')
      return rec.ai
    },
  },
})

const svc = await import('../server/services/moderation-worker.ts')
const rule = (o: Row): Row => ({ id: 1, pattern: 'x', ruleType: 'keyword', category: 'custom', severity: 'high', action: 'auto_hide', isEnabled: true, ...o })

test('bề mặt công khai còn đủ sau khi tách', () => {
  for (const n of [
    'fastPreModerate', 'checkAndModerateContent', 'rescanExistingContent',
    'getActiveModerationRules', 'invalidateModerationRulesCache', 'getWorkerStats', 'resetWorkerStats',
  ]) assert.equal(typeof (svc as Record<string, unknown>)[n], 'function', n)
})

test('nội dung rỗng/khoảng trắng → allow, không tính lượt quét', async () => {
  reset(svc)
  const before = svc.getWorkerStats().totalScanned
  const r = await svc.fastPreModerate('   ')
  assert.deepEqual(r, { blocked: false, action: 'allow', severity: 'low', reason: '', matchedRule: '' })
  assert.equal(svc.getWorkerStats().totalScanned, before)
})

test('chặn tức thì: thô tục (high), chống phá (critical), cờ bạc (high) — ghi hàng đợi + đếm', async () => {
  reset(svc)
  const s0 = svc.getWorkerStats().blockedInstant
  const a = await svc.fastPreModerate('mày dcm', { authorName: 'A', targetType: 'comment' })
  assert.equal(a.blocked, true)
  assert.equal(a.action, 'block')
  assert.equal(a.severity, 'high')
  assert.equal(a.matchedRule, 'Chửi thề thô tục')
  assert.match(a.reason, /^Nội dung vi phạm tiêu chuẩn an ninh và quy định cộng đồng \(Chửi thề thô tục\)\.$/)
  const b = await svc.fastPreModerate('muốn lật đổ chính quyền')
  assert.equal(b.severity, 'critical')
  const c = await svc.fastPreModerate('chơi tài xỉu uy tín')
  assert.equal(c.severity, 'high')
  assert.equal(c.matchedRule, 'Cờ bạc / Đánh bạc trực tuyến')
  assert.equal(svc.getWorkerStats().blockedInstant, s0 + 3)
  assert.equal(rec.queue.length, 3)
  assert.equal(rec.queue[0]!.authorName, 'A')
  assert.equal(rec.queue[0]!.status, 'pending')
  assert.deepEqual(rec.queue[0]!.matchedRules, ['[Chặn tức thì - profanity] Chửi thề thô tục'])
  assert.equal(rec.queue[1]!.authorName, 'Khách')
  assert.match(String((rec.queue[1]!.matchedRules as string[])[0]), /anti_state/)
})

test('luật tuỳ biến từ DB: keyword, regex hợp lệ, regex hỏng bị bỏ qua; cache 60s', async () => {
  reset(svc)
  rec.rules = [
    rule({ pattern: 'nhạy cảm', category: 'kw', severity: 'medium' }),
    rule({ id: 2, pattern: '(', ruleType: 'regex', category: 'bad-regex' }),
    rule({ id: 3, pattern: 'abc\\d+', ruleType: 'regex', category: 'rx', severity: 'critical' }),
  ]
  const kw = await svc.fastPreModerate('Có từ NHẠY CẢM ở đây')
  assert.equal(kw.blocked, true)
  assert.equal(kw.severity, 'medium')
  assert.equal(kw.matchedRule, 'Từ khóa: nhạy cảm')
  const rx = await svc.fastPreModerate('mã abc123 nè')
  assert.equal(rx.severity, 'critical')
  assert.equal(rx.matchedRule, 'Mẫu regex: abc\\d+')
  const ok = await svc.fastPreModerate('xin chào bình thường')
  assert.equal(ok.blocked, false)
  assert.equal(rec.ruleSelects, 1, 'ba lượt quét dùng chung một lần đọc DB (cache)')
  assert.equal(svc.getWorkerStats().cachedRulesCount, 3)
  svc.invalidateModerationRulesCache()
  assert.equal(svc.getWorkerStats().cachedRulesCount, 0)
  await svc.fastPreModerate('lại')
  assert.equal(rec.ruleSelects, 2, 'invalidate buộc đọc lại')
})

test('getWorkerStats: hình dạng, trạng thái active/degraded; resetWorkerStats xoá lỗi + cache', async () => {
  reset(svc)
  rec.rules = [rule({ pattern: 'a', severity: 'critical' })]
  rec.aiThrows = true
  for (let i = 0; i < 11; i++) await svc.checkAndModerateContent({ content: 'bình thường', targetType: 'chat' })
  const s = svc.getWorkerStats()
  assert.ok(s.errorCount >= 11)
  assert.equal(s.status, 'degraded')
  assert.equal(s.lastError, 'provider exploded')
  assert.ok(s.lastErrorAt)
  assert.equal(typeof s.uptimeSeconds, 'number')
  assert.ok(s.memoryUsageMb.heapLimit > 0)
  assert.ok(s.memoryUsageMb.heapUsedPercent >= 0)
  svc.resetWorkerStats()
  const r = svc.getWorkerStats()
  assert.equal(r.errorCount, 0)
  assert.equal(r.lastError, null)
  assert.equal(r.status, 'active')
  assert.equal(r.cachedRulesCount, 0)
})

test('checkAndModerateContent: chặn tức thì + targetId → ẩn bình luận / flag chat / xoá livestream', async () => {
  reset(svc)
  const out = await svc.checkAndModerateContent({ content: 'djt', targetType: 'comment', targetId: 5 })
  assert.equal(out.flagged, true)
  assert.equal(out.action, 'auto_hide')
  assert.equal(rec.aiCalls, 0, 'không gọi AI khi đã bị chặn tức thì')
  assert.equal(rec.updates[0]!.table, articleComments)
  assert.equal(rec.updates[0]!.set.isHidden, true)
  rec.updates = []
  await svc.checkAndModerateContent({ content: 'djt', targetType: 'chat', targetId: 6 })
  assert.equal(rec.updates[0]!.table, chatMessages)
  assert.equal(rec.updates[0]!.set.isFlagged, true)
  rec.updates = []
  await svc.checkAndModerateContent({ content: 'djt', targetType: 'livestream_chat', targetId: 7 })
  assert.equal(rec.updates[0]!.set.isDeleted, true)
})

test('AI trả violation → auto_hide + hàng đợi + ẩn; AI trả safe → allow', async () => {
  reset(svc)
  rec.ai = { ok: true, text: '```json\n{"verdict":"violation","intent":"propaganda","riskLevel":"critical","reason":"kích động"}\n```' }
  const bad = await svc.checkAndModerateContent({ content: 'một câu lạ', targetType: 'comment', targetId: 9, authorName: 'N' })
  assert.equal(bad.flagged, true)
  assert.equal(bad.action, 'auto_hide')
  assert.equal(bad.severity, 'critical')
  assert.deepEqual(bad.reasons, ['kích động'])
  assert.deepEqual(bad.matchedRules, ['[AI Ngữ cảnh] propaganda'])
  assert.equal(rec.queue.length, 1)
  assert.equal(rec.queue[0]!.targetId, 9)
  assert.equal(rec.updates[0]!.table, articleComments)
  reset(svc)
  rec.ai = { ok: true, text: '{"verdict":"safe"}' }
  const ok = await svc.checkAndModerateContent({ content: 'một câu lạ', targetType: 'comment', targetId: 9 })
  assert.deepEqual(ok, { flagged: false, action: 'allow', severity: 'low', reasons: [], matchedRules: [] })
  assert.equal(rec.queue.length, 0)
  assert.equal(rec.aiCalls, 1)
})

test('AI chưa cấu hình → flag_only (không ẩn) vào hàng đợi; lỗi AI + từ khoá critical → auto_hide', async () => {
  reset(svc)
  rec.ai = { ok: false, error: 'no_api_key' }
  const a = await svc.checkAndModerateContent({ content: 'bình thường', targetType: 'comment', targetId: 3 })
  assert.equal(a.flagged, true)
  assert.equal(a.action, 'flag_only')
  assert.equal(a.severity, 'medium')
  assert.equal(rec.queue.length, 1)
  assert.equal(rec.updates.length, 0, 'flag_only không ẩn nội dung')
  reset(svc)
  rec.rules = [rule({ pattern: 'nguyhiem', severity: 'critical' })]
  rec.aiThrows = true
  const b = await svc.checkAndModerateContent({ content: 'đây là nguyhiem', targetType: 'comment' })
  // 'nguyhiem' cũng bị fastPreModerate chặn trước (luật keyword DB, mức critical) → vẫn auto_hide critical.
  assert.equal(b.action, 'auto_hide')
  assert.equal(b.severity, 'critical')
})

test('rescanExistingContent trả cấu trúc tổng kết', async () => {
  reset(svc)
  const r = await svc.rescanExistingContent()
  assert.deepEqual(r, { scannedComments: 0, hiddenComments: 0, scannedMessages: 0, deletedMessages: 0 })
})
