/**
 * `useI18n()` chạy trong setup của MỌI component dùng `t()` (~28 trên trang chủ), và mỗi lời gọi tự tải bản
 * dịch khi kho còn rỗng — nên một lượt mở trang bắn 28 × `/api/public/translations/vi` (~35 KB, không cache)
 * + 28 × `/api/public/languages` (đo trên cdht.delify.vn: 56 yêu cầu). `createSingleFlight` gộp chúng thành một.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createSingleFlight } from '../app/utils/single-flight'

const deferred = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('28 lời gọi đồng thời cùng khoá chạy tác vụ ĐÚNG MỘT lần và cùng nhận kết quả', async () => {
  const singleFlight = createSingleFlight()
  const gate = deferred<string>()
  let runs = 0
  const results = Array.from({ length: 28 }, () => singleFlight('translations:vi', () => { runs += 1; return gate.promise }))
  gate.resolve('payload')
  assert.deepEqual(await Promise.all(results), Array(28).fill('payload'))
  assert.equal(runs, 1)
})

test('khoá khác nhau chạy độc lập (ngôn ngữ khác, languages)', async () => {
  const singleFlight = createSingleFlight()
  let runs = 0
  await Promise.all([
    singleFlight('translations:vi', async () => { runs += 1 }),
    singleFlight('translations:en', async () => { runs += 1 }),
    singleFlight('languages', async () => { runs += 1 }),
  ])
  assert.equal(runs, 3)
})

test('xong rồi thì giải phóng khoá: lời gọi sau chạy lại (đổi ngôn ngữ, thử lại)', async () => {
  const singleFlight = createSingleFlight()
  let runs = 0
  await singleFlight('k', async () => { runs += 1 })
  await singleFlight('k', async () => { runs += 1 })
  assert.equal(runs, 2)
})

test('lỗi: mọi bên đang chờ cùng nhận lỗi, rồi khoá được giải phóng để thử lại', async () => {
  const singleFlight = createSingleFlight()
  const gate = deferred<void>()
  let runs = 0
  const waiting = [1, 2, 3].map(() => singleFlight('k', () => { runs += 1; return gate.promise }))
  gate.reject(new Error('boom'))
  for (const p of waiting) await assert.rejects(p, /boom/)
  assert.equal(runs, 1)
  assert.equal(await singleFlight('k', async () => 'again'), 'again')
})

test('tác vụ ném lỗi đồng bộ vẫn trở thành promise bị từ chối và không làm kẹt khoá', async () => {
  const singleFlight = createSingleFlight()
  await assert.rejects(singleFlight('k', () => { throw new Error('sync') }), /sync/)
  assert.equal(await singleFlight('k', async () => 'ok'), 'ok')
})

test('useI18n tải bản dịch và danh sách ngôn ngữ qua singleFlight, không gọi $fetch trần', () => {
  const source = readFileSync(new URL('../app/composables/useI18n.ts', import.meta.url), 'utf8')
  const fetchCalls = source.match(/\$fetch as/g) ?? []
  assert.equal(fetchCalls.length, 2, 'đúng hai đường tải: languages + translations')
  assert.match(source, /singleFlight\('languages'/)
  assert.match(source, /singleFlight\(`translations:\$\{lang\}`/)
})
