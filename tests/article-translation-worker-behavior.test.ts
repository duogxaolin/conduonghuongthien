/**
 * Hành vi của job dịch bài viết và dịch hàng loạt, chạy với db/AI giả.
 *
 * Viết TRƯỚC khi tách `article-translations.ts` thành worker + bulk: các khẳng định
 * ở đây phải xanh trên cả mã cũ lẫn mã mới (chuyển nguyên văn, không đổi hành vi).
 * Chỉ import qua `article-translations.ts` — chính là đường mà endpoint và
 * `universal-translation.ts` dùng — nên cũng khoá việc re-export.
 */
import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { articleTranslations, articles } from '../server/db/schema.ts'

type Row = Record<string, unknown>
const state = {
  articles: new Map<number, Row>(),
  translations: [] as Row[],
  updates: [] as Array<{ table: unknown; set: Row }>,
  inserts: [] as Array<{ table: unknown; values: Row }>,
  aiCalls: 0,
  budgetAllowed: true,
  aiText: '{"translatedTitle":"Title EN","translatedExcerpt":"Excerpt EN"}',
}

function reset() {
  state.articles.clear()
  state.translations = []
  state.updates = []
  state.inserts = []
  state.aiCalls = 0
  state.budgetAllowed = true
  state.aiText = '{"translatedTitle":"Title EN","translatedExcerpt":"Excerpt EN"}'
}

/** Fake chainable db: select().from(t).where().limit(), update(t).set().where(), insert(t).values(). */
const fakeDb = {
  select() {
    let table: unknown
    const chain: any = {
      from(t: unknown) { table = t; return chain },
      where() { return chain },
      limit() { return chain },
      then(resolve: (v: Row[]) => unknown) {
        if (table === articles) return resolve([...state.articles.values()].slice(0, 1))
        if (table === articleTranslations) return resolve(state.translations.slice(0, 1))
        return resolve([])
      },
    }
    return chain
  },
  update(table: unknown) {
    return {
      set(set: Row) {
        state.updates.push({ table, set })
        return { where: async () => undefined }
      },
    }
  },
  insert(table: unknown) {
    return {
      values: async (values: Row) => { state.inserts.push({ table, values }) },
    }
  },
}

mock.module(new URL('../server/utils/db.ts', import.meta.url), {
  namedExports: { getDb: () => fakeDb },
})
mock.module(new URL('../server/services/ai-gateway.ts', import.meta.url), {
  namedExports: {
    callAi: async () => {
      state.aiCalls++
      return { ok: true, text: state.aiText }
    },
  },
})
mock.module(new URL('../server/utils/ai-budget.ts', import.meta.url), {
  namedExports: { checkBudget: async () => ({ allowed: state.budgetAllowed }) },
})

/** Việc chạy nền bắt đầu bằng setTimeout 0; state module còn dấu của lượt trước nên chờ `startedAt` đổi rồi mới chờ `completedAt`. */
async function waitForBulkRun(startedBefore: string | null) {
  for (let i = 0; i < 300; i++) {
    const s = svc.getBulkTranslationTaskState()
    if (s.startedAt !== startedBefore && s.completedAt) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error('bulk run did not finish')
}

const svc = await import('../server/services/article-translations.ts')

const statusesWritten = () => state.updates
  .filter(u => u.table === articleTranslations && 'status' in u.set)
  .map(u => u.set.status)

test('re-export giữ đủ bề mặt công khai của module cũ', () => {
  for (const name of [
    'runTranslationWorker', 'parseTitleAndExcerpt', 'bulkTriggerTranslation',
    'getBulkTranslationTaskState', 'triggerTranslation', 'listTranslationsForArticle',
  ]) {
    assert.equal(typeof (svc as Record<string, unknown>)[name], 'function', name)
  }
})

test('bài viết không tồn tại → job ghi failed, không gọi AI', async () => {
  reset()
  await svc.runTranslationWorker(404, 'en', 'English')
  assert.deepEqual(statusesWritten(), ['failed'])
  assert.equal(state.updates[0]!.set.errorMessage, 'Bài viết không tồn tại.')
  assert.equal(state.aiCalls, 0)
})

test('hết ngân sách AI → job ghi failed, không gọi AI', async () => {
  reset()
  state.articles.set(1, { id: 1, title: 'Tiêu đề', excerpt: 'Tóm tắt', content: '<p>Xin chào</p>' })
  state.budgetAllowed = false
  await svc.runTranslationWorker(1, 'en', 'English')
  assert.deepEqual(statusesWritten(), ['failed'])
  assert.equal(state.updates[0]!.set.errorMessage, 'Ngân sách AI đã hết.')
  assert.equal(state.aiCalls, 0)
})

test('job chạy tới cùng: gọi AI cho tiêu đề + nội dung và kết thúc ở trạng thái đích', async () => {
  for (const target of ['ai_draft', 'published'] as const) {
    reset()
    state.articles.set(1, { id: 1, title: 'Tiêu đề', excerpt: 'Tóm tắt', content: '<p>Xin chào</p>' })
    await svc.runTranslationWorker(1, 'en', 'English', target)
    assert.ok(state.aiCalls >= 2, 'tiêu đề/tóm tắt + ít nhất một đoạn nội dung')
    const statuses = statusesWritten()
    assert.equal(statuses.at(-1), target)
    assert.ok(!statuses.includes('failed'))
    const last = state.updates.at(-1)!.set
    assert.equal(last.progress, 100)
    assert.ok(last.completedAt instanceof Date)
  }
})

test('dịch hàng loạt: bài chưa có bản dịch được insert + dịch, trạng thái tổng kết đúng', async () => {
  reset()
  state.articles.set(7, { id: 7, type: 'news', title: 'Bài 7', excerpt: 'x', content: '<p>a</p>' })
  // Bài 7 chưa có bản dịch → insert 'translating' rồi chạy worker.
  const actor = { id: 1, isSuperAdmin: true, roleId: 1, permissions: [] } as never
  const before = svc.getBulkTranslationTaskState().startedAt
  const res = await svc.bulkTriggerTranslation(actor, [7], 'en')
  assert.deepEqual(res, { ok: true, count: 1 })
  // Ngay sau khi xếp hàng, tác vụ nền phải báo đang chạy (UI poll `active` để hiện banner).
  assert.equal(svc.getBulkTranslationTaskState().active, true)
  // Việc chạy nền (setTimeout 0): chờ tới khi trạng thái tổng kết có completedAt.
  await waitForBulkRun(before)
  const s = svc.getBulkTranslationTaskState()
  assert.equal(s.total, 1)
  assert.equal(s.processed, 1)
  assert.equal(s.langCode, 'en')
  assert.equal(s.langName, 'English')
  assert.equal(s.active, false)
  assert.equal(s.currentArticleId, null)
  assert.ok(s.completedAt)
  const insert = state.inserts.find(i => i.table === articleTranslations)
  assert.ok(insert, 'bài chưa có bản dịch phải được insert')
  assert.equal(insert!.values.status, 'translating')
  assert.equal(insert!.values.translatedBy, 'ai')
  assert.ok(state.aiCalls >= 2)
})

test('getBulkTranslationTaskState trả bản sao, không lộ state nội bộ', () => {
  const a = svc.getBulkTranslationTaskState()
  a.total = 999
  assert.notEqual(svc.getBulkTranslationTaskState().total, 999)
})

test('dịch hàng loạt: bài đã published thì bỏ qua — không insert, không gọi AI', async () => {
  reset()
  state.articles.set(9, { id: 9, type: 'news', title: 'Bài 9', excerpt: 'x', content: '<p>a</p>' })
  state.translations = [{ id: 1, articleId: 9, langCode: 'en', status: 'published' }]
  const actor = { id: 1, isSuperAdmin: true, roleId: 1, permissions: [] } as never
  const before = svc.getBulkTranslationTaskState().startedAt
  await svc.bulkTriggerTranslation(actor, [9], 'en')
  await waitForBulkRun(before)
  assert.equal(svc.getBulkTranslationTaskState().processed, 1)
  assert.equal(state.inserts.filter(i => i.table === articleTranslations).length, 0)
  assert.equal(state.aiCalls, 0)
})

test('job dịch AI không ghi HTML nguy hiểm vào bản dịch (sanitize ở worker)', async () => {
  reset()
  state.articles.set(1, { id: 1, title: 'Tiêu đề', excerpt: 'Tóm tắt', content: '<p>Xin chào</p>' })
  state.aiText = '<p>ok</p><script>alert(1)</script><img src=x onerror=alert(2)>'
  await svc.runTranslationWorker(1, 'en', 'English')
  const written = state.updates.map(u => u.set.content).filter((c): c is string => typeof c === 'string')
  assert.ok(written.length > 0, 'phải có ít nhất một lần ghi content')
  for (const c of written) assert.ok(!/<script|onerror/i.test(c), `content chưa được lọc: ${c}`)
})
