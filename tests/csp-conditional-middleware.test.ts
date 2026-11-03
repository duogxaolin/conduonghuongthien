import assert from 'node:assert/strict'
import test from 'node:test'

import handler from '../server/middleware/10.csp-conditional.ts'

/**
 * Phản hồi 304 của trang swr chỉ mang header route rule — tức header Report-Only mặc định không
 * hash — và trình duyệt áp nó lên thân HTML đã lưu, nên console báo lại script inline của cổng.
 * Middleware bỏ header đó khỏi yêu cầu có điều kiện (xem tệp). Test chạy middleware THẬT với
 * `event` tối thiểu (`event.node.req/res`, thứ h3 `getRequestHeader/removeResponseHeader` đọc).
 */
const REPORT_ONLY = 'content-security-policy-report-only'

function run(method: string, requestHeaders: Record<string, string>) {
  const res = new Map<string, string>([[REPORT_ONLY, 'default-src \'self\''], ['content-security-policy', 'default-src \'self\'; script-src \'unsafe-inline\'']])
  const event = {
    method,
    node: {
      req: { method, headers: requestHeaders },
      res: {
        getHeader: (n: string) => res.get(n.toLowerCase()),
        removeHeader: (n: string) => { res.delete(n.toLowerCase()) },
        setHeader: (n: string, v: string) => { res.set(n.toLowerCase(), v) },
      },
    },
  }
  handler(event as never)
  return res
}

test('GET có If-None-Match hoặc If-Modified-Since → bỏ Report-Only; header thực thi còn nguyên', () => {
  for (const headers of [{ 'if-none-match': 'W/"abc"' }, { 'if-modified-since': 'Tue, 03 Nov 2026 11:06:17 GMT' }]) {
    const res = run('GET', headers)
    assert.equal(res.has(REPORT_ONLY), false, JSON.stringify(headers))
    assert.ok(res.get('content-security-policy')?.includes('unsafe-inline'))
  }
  assert.equal(run('HEAD', { 'if-none-match': '*' }).has(REPORT_ONLY), false)
})

test('yêu cầu không điều kiện, hay phương thức ghi → giữ nguyên header', () => {
  assert.equal(run('GET', {}).has(REPORT_ONLY), true)
  assert.equal(run('POST', { 'if-none-match': '*' }).has(REPORT_ONLY), true)
  assert.equal(run('DELETE', { 'if-none-match': '*' }).has(REPORT_ONLY), true)
})
