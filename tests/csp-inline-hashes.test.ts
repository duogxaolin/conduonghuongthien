import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { cspReportOnlyWithInlineHashes, CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY_REPORT_ONLY } from '../shared/csp-policy.ts'
import { inlineScriptHash, inlineScriptHashes } from '../server/utils/csp-inline-hashes.ts'

/**
 * CSP giai đoạn 3 (openspec `wave3-long-term`, D-CSP): hash của script inline THẬT trong trang
 * vào header Report-Only; header THỰC THI không đổi. Hai lớp: hàm thuần băm HTML, và plugin
 * thật (`server/plugins/csp-inline-hashes.ts`) nạp qua `defineNitroPlugin` giả (cùng mẹo với
 * `tests/error-no-store.test.ts`).
 */

const sha = (s: string) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`

test('hash đúng từng byte của chuỗi giữa hai thẻ, kể cả khoảng trắng và xuống dòng', () => {
  const content = '\n  window.__NUXT__={};\n  window.__NUXT__.config={public:{}}\n'
  assert.deepEqual(inlineScriptHashes(`<head><script>${content}</script></head>`), [sha(content)])
  assert.equal(inlineScriptHash(content), sha(content))
  // Một byte khác → hash khác (trình duyệt so từng byte).
  assert.notEqual(inlineScriptHash(content), inlineScriptHash(content.trim()))
})

test('importmap, module và script không type đều được băm; khối dữ liệu và script có src thì không', () => {
  const html = [
    '<script type="importmap">{"imports":{"#entry":"/_nuxt/a.js"}}</script>',
    '<script type="module">import "/_nuxt/b.js"</script>',
    '<script>var a=1</script>',
    "<script type='text/javascript'>var b=2</script>",
    '<script type="application/json" id="__NUXT_DATA__">[1,2]</script>',
    '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>',
    '<script src="/_nuxt/entry.js" type="module"></script>',
    '<script>   </script>',
  ].join('')
  assert.deepEqual(inlineScriptHashes(html), [
    sha('{"imports":{"#entry":"/_nuxt/a.js"}}'),
    sha('import "/_nuxt/b.js"'),
    sha('var a=1'),
    sha('var b=2'),
  ])
})

test('script trùng nội dung chỉ một hash; trang không có script inline → không hash', () => {
  assert.equal(inlineScriptHashes('<script>x()</script><p></p><script>x()</script>').length, 1)
  assert.deepEqual(inlineScriptHashes('<html><body><p>không có script</p></body></html>'), [])
})

test('header Report-Only với hash: chỉ thêm token sha256 vào script-src, mọi chỉ thị khác y nguyên', () => {
  const h = sha('a()')
  const withHash = cspReportOnlyWithInlineHashes([h])
  const base = CONTENT_SECURITY_POLICY_REPORT_ONLY
  assert.equal(cspReportOnlyWithInlineHashes([]), base, 'không hash → đúng từng byte bản mặc định')
  assert.equal(withHash.replace(` ${h}`, ''), base)
  assert.match(withHash, new RegExp(`script-src 'self' 'report-sample' ${h.replace(/[+/]/g, '\\$&')} https://`))
  assert.doesNotMatch(withHash, /script-src[^;]*'unsafe-inline'/)
})

test('giá trị không phải hash sha256 hợp lệ bị bỏ, không bao giờ vào header', () => {
  const policy = cspReportOnlyWithInlineHashes(["'unsafe-inline'", "'sha256-abc'", "'sha256-x'; script-src *", 'https://evil.example', sha('ok()')])
  assert.equal(policy.includes('evil'), false)
  assert.equal(policy.includes('unsafe-inline'), true, "style-src giữ 'unsafe-inline' (D-CSP3) — nhưng không nằm trong script-src")
  assert.equal(/script-src[^;]*unsafe-inline/.test(policy), false)
  assert.equal(policy.includes("'sha256-abc'"), false)
  assert.ok(policy.includes(sha('ok()')))
})

test('header THỰC THI không đổi: vẫn \'unsafe-inline\' cho script, không hash nào', () => {
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self' 'unsafe-inline' /)
  assert.equal(CONTENT_SECURITY_POLICY.includes('sha256-'), false)
})

// ─── Plugin thật ───────────────────────────────────────────────────────────────
type Hook = (response: { body?: unknown, headers?: Record<string, unknown> }, ctx?: { event?: unknown }) => unknown
const hooks = new Map<string, Hook[]>()
;(globalThis as { defineNitroPlugin?: (fn: (app: unknown) => void) => void }).defineNitroPlugin = (fn) => {
  fn({ hooks: { hook: (name: string, handler: Hook) => hooks.set(name, [...(hooks.get(name) ?? []), handler]) } })
}
await import('../server/plugins/csp-inline-hashes.ts')

/** Event tối thiểu mà h3 `get/setResponseHeader` đọc: `event.node.res`. */
function fakeEvent(headers: Record<string, string> = {}) {
  const store = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    store,
    node: { res: { getHeader: (n: string) => store.get(n.toLowerCase()), setHeader: (n: string, v: string) => { store.set(n.toLowerCase(), v) } } },
  }
}
const run = (response: { body?: unknown, headers?: Record<string, unknown> }, event = fakeEvent()) => {
  for (const handler of hooks.get('render:response') ?? []) handler(response, { event })
  return { response, event }
}
const REPORT_ONLY = 'content-security-policy-report-only'

test('plugin: renderer Nuxt 4 — `response.headers` KHÔNG tồn tại, content-type trên event → header ghi lên event (lỗi bản đầu)', () => {
  const script = 'window.__NUXT__={};'
  const { event, response } = run(
    { body: `<!DOCTYPE html><html><head><script>${script}</script></head></html>` },
    fakeEvent({ 'Content-Type': 'text/html;charset=utf-8' }),
  )
  assert.equal(event.store.get(REPORT_ONLY), cspReportOnlyWithInlineHashes([sha(script)]))
  assert.equal(response.headers, undefined, 'không tự dựng response.headers')
})

test('plugin: chưa có content-type ở đâu cả → nhận HTML theo thân', () => {
  const html = '<!DOCTYPE html><html><head><script>boot()</script></head></html>'
  const { event } = run({ body: html })
  assert.equal(event.store.get(REPORT_ONLY), cspReportOnlyWithInlineHashes([sha('boot()')]))
  // …nhưng thân không phải HTML thì để yên.
  const json = run({ body: '{"statusCode":500,"x":"<script>a()</script>"}' })
  assert.equal(json.event.store.has(REPORT_ONLY), false)
})

test('plugin: có `response.headers` thì ghi cùng giá trị ở đó nữa; tên header Content-Type không phân biệt hoa/thường', () => {
  const { response, event } = run({ body: '<script>a()</script>', headers: { 'Content-Type': 'TEXT/HTML' } })
  const expected = cspReportOnlyWithInlineHashes([sha('a()')])
  assert.equal(response.headers![REPORT_ONLY], expected)
  assert.equal(event.store.get(REPORT_ONLY), expected)
})

test('plugin: không đụng phản hồi không phải HTML dạng chuỗi, hay HTML không có script inline', () => {
  for (const [response, type] of [
    [{ body: '<script>a()</script>' }, 'application/json'],
    [{ body: { stream: true } }, 'text/html'],
    [{ body: '<p>không script</p>' }, 'text/html'],
    [{}, 'text/html'],
  ] as const) {
    const { event } = run(response as { body?: unknown }, fakeEvent({ 'content-type': type }))
    assert.equal(event.store.has(REPORT_ONLY), false, JSON.stringify(response))
  }
})

test('plugin: mã theo dõi chèn thêm (GTM, pixel) nằm trong HTML cuối nên được băm', () => {
  const gtm = "(function(w,d,s,l,i){w[l]=w[l]||[]})(window,document,'script','dataLayer','GTM-XXXX');"
  const { event } = run({ body: `<!DOCTYPE html><head><script>${gtm}</script><script>boot()</script></head>` }, fakeEvent({ 'content-type': 'text/html' }))
  const header = String(event.store.get(REPORT_ONLY))
  assert.ok(header.includes(sha(gtm)) && header.includes(sha('boot()')))
})

test('plugin: lỗi bên trong không bao giờ làm hỏng trang', () => {
  const broken = { get body(): string { throw new Error('boom') } }
  assert.doesNotThrow(() => run(broken as { body?: unknown }))
})
