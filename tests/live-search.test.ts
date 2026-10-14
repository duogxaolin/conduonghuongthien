/**
 * Ô tìm kiếm nhanh ở header (`app/utils/live-search.ts`): lỗi ≠ không có kết quả.
 *
 * Lỗi đã gặp: `useLiveSearch` bắt lỗi của `/api/public/search` (503 khi CSDL hỏng)
 * rồi đặt `items = []`, nên khung gợi ý báo "Không tìm thấy kết quả phù hợp". Ở đây
 * chạy thật máy trạng thái với đồng hồ và lượt gọi mạng giả.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveSearch, type LiveSearchState } from '../app/utils/live-search'

interface Item { id: number }

function harness(fetchImpl: (q: string, signal: AbortSignal) => Promise<{ ok?: boolean; items?: Item[] } | null>) {
  const states: Array<LiveSearchState<Item>> = []
  const timers = new Map<number, () => void>()
  let nextId = 1
  const calls: Array<{ q: string; signal: AbortSignal }> = []
  const live = createLiveSearch<Item>({
    fetch: (q, signal) => { calls.push({ q, signal }); return fetchImpl(q, signal) },
    onChange: (s) => states.push(s),
    schedule: (run) => { const id = nextId++; timers.set(id, run); return id },
    cancel: (id) => { timers.delete(id as number) },
  })
  /** Hết thời gian debounce: chạy mọi bộ hẹn giờ còn sống. */
  const elapse = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(run => run()) }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))
  return { live, states, calls, timers, elapse, settle, last: () => states.at(-1)! }
}

test('API hỏng (ném lỗi, vd. 503) → trạng thái error, KHÔNG phải success rỗng', async () => {
  const h = harness(() => Promise.reject(new Error('503')))
  h.live.input('vay vốn')
  assert.deepEqual(h.last(), { status: 'loading', items: [], visible: true })
  h.elapse()
  await h.settle()
  assert.deepEqual(h.last(), { status: 'error', items: [], visible: true })
})

test('phản hồi { ok: false } cũng là lỗi', async () => {
  const h = harness(() => Promise.resolve({ ok: false, items: [] }))
  h.live.input('vay')
  h.elapse()
  await h.settle()
  assert.equal(h.last().status, 'error')
})

test('không có kết quả thật (ok: true, items: []) → success rỗng (nhánh "Không tìm thấy")', async () => {
  const h = harness(() => Promise.resolve({ ok: true, items: [] }))
  h.live.input('xyz')
  h.elapse()
  await h.settle()
  assert.deepEqual(h.last(), { status: 'success', items: [], visible: true })
})

test('thử lại sau lỗi → gọi lại NGAY đúng từ khoá cũ, thành công thì hiện kết quả', async () => {
  let fail = true
  const h = harness(() => (fail ? Promise.reject(new Error('down')) : Promise.resolve({ ok: true, items: [{ id: 1 }] })))
  h.live.input('  học nghề ')
  h.elapse()
  await h.settle()
  assert.equal(h.last().status, 'error')
  fail = false
  h.live.retry()
  assert.equal(h.timers.size, 0, 'thử lại không chờ debounce')
  await h.settle()
  assert.deepEqual(h.calls.map(c => c.q), ['học nghề', 'học nghề'])
  assert.deepEqual(h.last(), { status: 'success', items: [{ id: 1 }], visible: true })
})

test('debounce: gõ liên tiếp chỉ gọi một lần với từ khoá cuối', async () => {
  const h = harness((q) => Promise.resolve({ ok: true, items: [{ id: q.length }] }))
  h.live.input('ho')
  h.live.input('hoc')
  h.live.input('hoc n')
  assert.equal(h.timers.size, 1)
  h.elapse()
  await h.settle()
  assert.deepEqual(h.calls.map(c => c.q), ['hoc n'])
})

test('gõ lùi dưới 2 ký tự trong lúc lượt đang bay → huỷ lượt đó, kết quả về muộn không mở lại khung', async () => {
  let resolveSlow: (v: { ok: boolean; items: Item[] }) => void = () => {}
  const h = harness(() => new Promise(resolve => { resolveSlow = resolve }))
  h.live.input('vay')
  h.elapse()
  h.live.input('v')
  assert.deepEqual(h.last(), { status: 'idle', items: [], visible: false })
  assert.equal(h.calls[0]!.signal.aborted, true, 'lượt đang bay phải bị huỷ')
  resolveSlow({ ok: true, items: [{ id: 9 }] })
  await h.settle()
  assert.deepEqual(h.last(), { status: 'idle', items: [], visible: false })
})

test('xoá ô (reset) trong lúc đang chờ debounce → không gọi gì nữa', async () => {
  const h = harness(() => Promise.resolve({ ok: true, items: [{ id: 1 }] }))
  h.live.input('vay')
  h.live.reset()
  assert.equal(h.timers.size, 0)
  h.elapse()
  await h.settle()
  assert.equal(h.calls.length, 0)
  assert.deepEqual(h.last(), { status: 'idle', items: [], visible: false })
})

test('hai lượt chồng nhau: lượt cũ về SAU không đè kết quả của lượt mới', async () => {
  const resolvers: Array<(v: { ok: boolean; items: Item[] }) => void> = []
  const h = harness(() => new Promise(resolve => { resolvers.push(resolve) }))
  h.live.input('vay')
  h.elapse()
  h.live.input('vay von')
  h.elapse()
  resolvers[1]!({ ok: true, items: [{ id: 2 }] })
  await h.settle()
  resolvers[0]!({ ok: true, items: [{ id: 1 }] })
  await h.settle()
  assert.deepEqual(h.last().items, [{ id: 2 }])
  assert.equal(h.calls[0]!.signal.aborted, true)
})

test('đang gõ tiếp thì gợi ý cũ được giữ (không nhấp nháy theo từng phím)', async () => {
  const h = harness(() => Promise.resolve({ ok: true, items: [{ id: 1 }] }))
  h.live.input('vay')
  h.elapse()
  await h.settle()
  h.live.input('vay v')
  assert.deepEqual(h.last(), { status: 'loading', items: [{ id: 1 }], visible: true })
})
