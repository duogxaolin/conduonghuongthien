import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { resolveCategoryRoute } from '../app/utils/category-route-decision.ts'

/**
 * `/news/<X>`: lượt đọc chuyên mục HỎNG không được hiểu là "không phải chuyên mục"
 * (trước đây: rơi sang ArticleDetail, 200 cho `/news/tin-tuc` khi CSDL sập).
 */

const items = [{ slug: 'tin-tuc' }, { slug: 'tin-dia-phuong' }]

test('chuyên mục có thật → category; slug khác → article', () => {
  assert.equal(resolveCategoryRoute({ status: 'success', data: { ok: true, items }, slug: 'tin-tuc' }), 'category')
  assert.equal(resolveCategoryRoute({ status: 'success', data: { ok: true, items }, slug: 'mot-bai-viet' }), 'article')
  assert.equal(resolveCategoryRoute({ status: 'success', data: { ok: true, items: [] }, slug: 'tin-tuc' }), 'article')
})

test('lượt đọc hỏng (503 → status error) → lookup-failed, KHÔNG phải article', () => {
  assert.equal(resolveCategoryRoute({ status: 'error', data: { ok: true, items: [] }, slug: 'tin-tuc' }), 'lookup-failed')
})

test('thân { ok: false } với mã 200 cũng là hỏng, không phải "danh sách rỗng"', () => {
  assert.equal(resolveCategoryRoute({ status: 'success', data: { ok: false, items: [] }, slug: 'tin-tuc' }), 'lookup-failed')
  assert.equal(resolveCategoryRoute({ status: 'success', data: null, slug: 'tin-tuc' }), 'lookup-failed')
})

test('chưa xong (idle/pending) → pending', () => {
  assert.equal(resolveCategoryRoute({ status: 'idle', data: { ok: true, items: [] }, slug: 'tin-tuc' }), 'pending')
  assert.equal(resolveCategoryRoute({ status: 'pending', data: { ok: true, items }, slug: 'tin-tuc' }), 'pending')
})

// Nối dây trong trang (template + SSR) — phần duy nhất phải đọc chữ.
test('news/[category]/index.vue: nhánh lỗi + 503 dùng CÙNG quyết định, ArticleDetail chỉ ở nhánh còn lại', () => {
  const source = readFileSync(new URL('../app/pages/news/[category]/index.vue', import.meta.url), 'utf8')
  assert.match(source, /resolveCategoryRoute\(/)
  assert.match(source, /useSsrFailureStatus\(\(\) => catAsync, \(\) => lookupFailed\.value\)/)
  // useSsrFailureStatus phải đứng TRƯỚC `await catAsync` (sau await mất ngữ cảnh Nuxt).
  const serverAwait = source.search(/if \(import\.meta\.server\) \{\s*await catAsync\s*\}/)
  assert.ok(serverAwait > 0, 'SSR vẫn chờ lượt kiểm chuyên mục trước khi chọn nhánh')
  assert.ok(source.indexOf('useSsrFailureStatus(') < serverAwait)
  const template = source.slice(0, source.indexOf('<script'))
  const errorAt = template.search(/v-else-if="showLookupError"/)
  const articleAt = template.search(/<ArticleDetail/)
  assert.ok(errorAt > 0 && articleAt > errorAt, 'nhánh lỗi đứng trước ArticleDetail (v-else)')
  assert.match(template, /<BlockLoadError[\s\S]*?@retry="retryLookup"/)
  // Bản build đầu tiên dựng ra `<!---->`: Nuxt đăng ký component này là
  // `BlocksBlockLoadError`, nên tên ngắn phải được import tường minh.
  assert.match(source, /import BlockLoadError from '~\/components\/blocks\/BlockLoadError\.vue'/)
})
