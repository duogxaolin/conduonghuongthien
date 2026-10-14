/**
 * Lượt SSR hỏng của một trang công khai → 503 + `Cache-Control: no-store`, không phải
 * 200 (`app/utils/ssr-failure-response.ts`).
 *
 * Lỗi đã gặp (bộ kiểm chứng, bản build chạy với CSDL không với tới): API công khai
 * đã trả 503, nhưng TRANG `/`, `/about`, `/contact`, `/<slug>` vẫn trả 200 + `s-maxage=60`
 * với nhánh lỗi trong HTML → bộ đệm SWR/CDN phát lại trang lỗi cho mọi người. Bộ
 * đệm route của Nitro không lưu phản hồi ≥ 400, nên 503 là thứ chặn được.
 *
 * Phần 1 chạy thật hàm quyết định. Phần 2 kiểm cấu trúc (đọc mã nguồn): bốn trang gọi
 * nó với ĐÚNG biểu thức quyết định nhánh lỗi — lệch nhau thì hoặc trang lỗi vẫn 200,
 * hoặc trang đúng thành 503. Chiều ngược (CSDL khoẻ vẫn 200 + s-maxage) có test trình
 * duyệt thật: tests/e2e/public-ssr-status.spec.ts. Chiều hỏng trên bản build thật được
 * dò tay (bộ e2e dùng chung một CSDL phải sống) — xem báo cáo.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  applySsrFailureResponse,
  SSR_FAILURE_HEADERS,
  SSR_FAILURE_STATUS,
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

test('lượt đọc hỏng → 503 + Cache-Control: no-store', () => {
  const { target, calls } = recorder()
  assert.equal(applySsrFailureResponse(target, true), true)
  assert.deepEqual(calls.status, [[503, 'Service Unavailable']])
  assert.deepEqual(calls.headers, [['cache-control', 'no-store']])
  assert.equal(SSR_FAILURE_STATUS, 503)
  assert.equal(SSR_FAILURE_HEADERS['cache-control'], 'no-store')
})

test('lượt đọc thành công → không đụng gì (trang vẫn 200 và vẫn được đệm)', () => {
  const { target, calls } = recorder()
  assert.equal(applySsrFailureResponse(target, false), false)
  assert.deepEqual(calls, { status: [], headers: [] })
})

test('không có sự kiện yêu cầu (phía trình duyệt) → không làm gì, không ném lỗi', () => {
  assert.equal(applySsrFailureResponse(null, true), false)
  assert.equal(applySsrFailureResponse(undefined, true), false)
})

// ─── Phần 2: dây nối ở bốn trang (kiểm cấu trúc) ─────────────────────────────

const read = (relative: string) => readFileSync(new URL(`../app/${relative}`, import.meta.url), 'utf8')

for (const [file, asyncName] of [['pages/index.vue', 'homeAsync'], ['pages/about.vue', 'aboutAsync'], ['pages/contact.vue', 'contactAsync']] as const) {
  test(`${file}: 503 khi và chỉ khi nhánh lỗi hiện (cùng biểu thức error.value)`, () => {
    const source = read(file)
    assert.match(source, new RegExp(`useSsrFailureStatus\\(\\(\\) => ${asyncName}, \\(\\) => !!error\\.value\\)`))
    assert.match(source, /const loadError = computed\(\(\) => error\.value \|\| null\)/, 'nhánh lỗi đổi biểu thức — cập nhật lời gọi useSsrFailureStatus cho khớp')
    assert.match(source, new RegExp(`const \\{ data, pending, error, refresh \\} = ${asyncName}`))
  })
}

test('[slug].vue: 503 khi lượt tra trang/thể loại hỏng (lookupFailed), gọi trước mọi await', () => {
  const source = read('pages/[slug].vue')
  assert.match(source, /useSsrFailureStatus\(\(\) => asyncData, \(\) => !idParam\.value && lookupFailed\.value\)/)
  const callAt = source.indexOf('useSsrFailureStatus(')
  const firstAwait = source.indexOf('await asyncData')
  assert.ok(callAt > 0 && callAt < firstAwait, 'phải gọi trước `await` đầu tiên (sau await mất ngữ cảnh Nuxt)')
})

for (const file of ['composables/usePublicArticleList.ts', 'composables/usePublicMediaList.ts']) {
  test(`${file}: danh sách hỏng lúc SSR → 503 (cùng biểu thức loadError của nhánh lỗi)`, () => {
    // Đo trên bản build không có CSDL: `/media`, `/news/<chuyên mục>` từng trả 200 +
    // `s-maxage=60` kèm nhánh lỗi — cùng lớp lỗi với bốn trang dựng bằng khối.
    const source = read(file)
    assert.match(source, /useSsrFailureStatus\(\(\) => asyncList, \(\) => loadError\.value\)/)
    assert.match(source, /const loadError = computed\(\(\) => !!error\.value \|\| data\.value\?\.ok === false\)/)
    assert.match(source, /const \{ data, pending, error, refresh \} = asyncList/)
  })
}

test('composable lấy event/header ngay trong setup và chỉ chạy phía máy chủ', () => {
  const source = read('composables/useSsrFailureStatus.ts')
  assert.match(source, /if \(!import\.meta\.server\) return/)
  const prefetchAt = source.indexOf('onServerPrefetch(')
  assert.ok(source.indexOf('useRequestEvent()') < prefetchAt, 'useRequestEvent phải gọi trước onServerPrefetch')
  assert.ok(source.indexOf('useResponseHeader(') < prefetchAt, 'useResponseHeader phải gọi trước onServerPrefetch')
  assert.match(source, /await settled\(\)[\s\S]*applySsrFailureResponse\([\s\S]*failed\(\)/, 'phải đọc failed() SAU khi lượt đọc xong')
})
