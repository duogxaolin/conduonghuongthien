/**
 * Mã trạng thái SSR của ba trang công khai còn sót sau F6 (bản build không CSDL,
 * 2026-10-14, trước bản vá — `/role-models/x`, `/reintegration-models/x`,
 * `/news/<chuyên mục>/x`, `/video/x`, `/legal-qa` đều trả **200**, các tuyến chi tiết
 * còn kèm `s-maxage=60` và lượt thứ hai ra từ bộ đệm SWR):
 *
 *  1. `app/pages/[slug].vue` hai đoạn `/<thể loại>/<X>`: lượt kiểm chuyên mục hỏng bị
 *     hiểu là "không phải chuyên mục" → rơi sang ArticleDetail.
 *  2. `components/ArticleDetail.vue`: lỗi KHÁC 404 → nhánh lỗi nhưng HTTP 200; còn bài
 *     không tồn tại (API trả 404) lại hiện nhánh "không tải được, thử lại" + 200.
 *  3. `/legal-qa`: CSDL sập → 200 kèm nhánh lỗi.
 *
 * Phần 1 chạy thật các hàm quyết định. Phần 2 kiểm dây nối (đọc mã nguồn): mỗi trang
 * gọi `useSsrFailureStatus` với ĐÚNG biểu thức quyết định nhánh hiển thị. Hành vi trên
 * Nuxt thật: tests/e2e/public-detail-status.spec.ts (404, nhánh lỗi + thử lại phía
 * client); nhánh 503 dò tay trên bản build không CSDL (công thức ở đầu
 * tests/error-no-store.test.ts).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  applySsrNotFoundResponse,
  resolveDetailFetch,
  type SsrResponseTarget,
} from '../app/utils/ssr-failure-response'

function recorder() {
  const calls: { status: Array<[number, string]>; headers: Array<[string, string]> } = { status: [], headers: [] }
  const target: SsrResponseTarget = {
    setStatus: (code, text) => { calls.status.push([code, text]) },
    setHeader: (name, value) => { calls.headers.push([name, value]) },
  }
  return { target, calls }
}

// ─── Phần 1: hàm quyết định ──────────────────────────────────────────────────

test('resolveDetailFetch: API trả 404 → not-found (KHÔNG phải nhánh lỗi + thử lại)', () => {
  // Hình dạng NuxtError của useAsyncData, và FetchError thô của ofetch.
  assert.equal(resolveDetailFetch({ status: 'error', error: { statusCode: 404 }, hasContent: false }), 'not-found')
  assert.equal(resolveDetailFetch({ status: 'error', error: { response: { status: 404 } }, hasContent: false }), 'not-found')
})

test('resolveDetailFetch: lỗi khác 404 (503, 500, mạng) → failed', () => {
  assert.equal(resolveDetailFetch({ status: 'error', error: { statusCode: 503 }, hasContent: false }), 'failed')
  assert.equal(resolveDetailFetch({ status: 'error', error: { statusCode: 500 }, hasContent: false }), 'failed')
  assert.equal(resolveDetailFetch({ status: 'error', error: new TypeError('fetch failed'), hasContent: false }), 'failed')
  // Lỗi đứng trước dữ liệu: lượt tải lại hỏng không được hiện như bài cũ còn đó.
  assert.equal(resolveDetailFetch({ status: 'error', error: { statusCode: 503 }, hasContent: true }), 'failed')
})

test('resolveDetailFetch: thành công có bài → found; không có bài → not-found; chưa xong → pending', () => {
  assert.equal(resolveDetailFetch({ status: 'success', error: null, hasContent: true }), 'found')
  assert.equal(resolveDetailFetch({ status: 'success', error: null, hasContent: false }), 'not-found')
  assert.equal(resolveDetailFetch({ status: 'pending', error: null, hasContent: false }), 'pending')
  assert.equal(resolveDetailFetch({ status: 'idle', error: null, hasContent: false }), 'pending')
})

test('applySsrNotFoundResponse: 404, không thêm no-store; không làm gì khi không cần / phía trình duyệt', () => {
  const { target, calls } = recorder()
  assert.equal(applySsrNotFoundResponse(target, true), true)
  assert.deepEqual(calls, { status: [[404, 'Not Found']], headers: [] })

  const idle = recorder()
  assert.equal(applySsrNotFoundResponse(idle.target, false), false)
  assert.deepEqual(idle.calls, { status: [], headers: [] })
  assert.equal(applySsrNotFoundResponse(null, true), false)
})

// ─── Phần 2: dây nối (kiểm cấu trúc) ─────────────────────────────────────────

const read = (relative: string) => readFileSync(new URL(`../app/${relative}`, import.meta.url), 'utf8')

test('useSsrFailureStatus: 404 chỉ xét khi lượt đọc KHÔNG hỏng (hỏng thì chưa biết có hay không)', () => {
  const source = read('composables/useSsrFailureStatus.ts')
  assert.match(source, /const applied = applySsrFailureResponse\(target, failed\(\)\)\s*\n\s*if \(!applied && options\.notFound\) applySsrNotFoundResponse\(target, options\.notFound\(\)\)/)
})

test('ArticleDetail: nhánh lỗi, 503 và 404 dùng CÙNG một quyết định', () => {
  const source = read('components/ArticleDetail.vue')
  assert.match(source, /const fetchOutcome = computed\(\(\) => resolveDetailFetch\(/)
  assert.match(source, /const loadError = computed\(\(\) => fetchOutcome\.value === 'failed'\)/)
  assert.match(source, /useSsrFailureStatus\(\(\) => articleAsync, \(\) => loadError\.value, \{ notFound: \(\) => fetchOutcome\.value === 'not-found' \}\)/)
  assert.match(source, /const \{ data, pending, error, status, refresh \} = articleAsync/)
  const template = source.slice(0, source.indexOf('<script'))
  assert.match(template, /v-else-if="loadError"[\s\S]*?@click="refresh\(\)"/, 'nhánh lỗi giữ nút thử lại gọi đúng lượt đọc bài')
})

test('/legal-qa: 503 khi và chỉ khi nhánh lỗi hiện (cùng biểu thức loadError)', () => {
  const source = read('pages/legal-qa/index.vue')
  assert.match(source, /useSsrFailureStatus\(\(\) => faqAsync, \(\) => loadError\.value\)/)
  assert.match(source, /const loadError = computed\(\(\) => !!error\.value \|\| \(data\.value as \{ ok\?: boolean \}\)\?\.ok === false\)/)
  assert.match(source, /const \{ data, pending, error, refresh \} = faqAsync/)
})

test('[slug].vue hai đoạn: lượt kiểm chuyên mục hỏng → nhánh lỗi + 503, không bao giờ ArticleDetail', () => {
  const source = read('pages/[slug].vue')
  assert.match(source, /resolveCategoryRoute\(\{ status: catStatus\.value, data: catData\.value, slug: idParam\.value \}\)/)
  assert.match(source, /useSsrFailureStatus\(\(\) => catAsync, \(\) => categoryLookupFailed\.value\)/)
  // Trước `await` đầu tiên (sau await mất ngữ cảnh Nuxt).
  assert.ok(source.indexOf('useSsrFailureStatus(() => catAsync') < source.indexOf('await asyncData'))
  const template = source.slice(0, source.indexOf('<script'))
  const errorAt = template.search(/v-else-if="showCategoryLookupError"/)
  const articleAt = template.search(/<ArticleDetail/)
  assert.ok(errorAt > 0 && articleAt > errorAt, 'nhánh lỗi đứng trước ArticleDetail (v-else)')
  assert.match(template, /<BlockLoadError[\s\S]*?@retry="retryCategoryLookup"/)
  assert.match(source, /import BlockLoadError from '~\/components\/blocks\/BlockLoadError\.vue'/)
  // HTML mang nhánh lỗi (CSDL chập chờn lúc SSR) → thử lại một lần ở trình duyệt.
  assert.match(source, /if \(categoryLookupFailed\.value\) void retryCategoryLookup\(\)/)
})
