import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeHtml, sanitizeBlockData } from '../server/utils/sanitize-html'
import { escapeHtml } from '../server/utils/escape-html'

/**
 * Article bodies and rich-text block fields are rendered with `v-html` on the
 * public site, so anything an editor stores must be neutralised on write.
 * A "live tag" below means any element other than the formatting tags we allow.
 */

// `iframe` không nằm trong `EXECUTABLE` nữa — nó hợp lệ khi `src` là YouTube embed
// (xem test "iframe YouTube" bên dưới). `isNeutralised` chỉ flag các tag vẫn nguy
// hiểm kể cả không có handler.
const EXECUTABLE = /<\s*(script|object|embed|svg|math|style|form|input|button)\b/i
const EVENT_HANDLER = /\son[a-z]+\s*=/i
const DANGEROUS_SCHEME = /(javascript|vbscript|data:text\/html)\s*:/i

function isNeutralised(html: string): boolean {
  return !EXECUTABLE.test(html) && !EVENT_HANDLER.test(html) && !DANGEROUS_SCHEME.test(html)
}

test('script-bearing elements are dropped together with their content', () => {
  assert.equal(sanitizeHtml('<script>alert(1)</script>Xin chào'), 'Xin chào')
  assert.equal(sanitizeHtml('<style>*{x:expression(alert(1))}</style>ok'), 'ok')
  assert.equal(sanitizeHtml('<svg><script>alert(1)</script></svg>text'), 'text')
  // `iframe` với `src` không phải YouTube: `src` bị drop, tag `<iframe>` rỗng
  // còn lại (không nguy hiểm vì không có origin để tải). Mở `iframe` cho YouTube
  // là chủ đích — xem test "iframe YouTube" bên dưới.
  assert.equal(sanitizeHtml('<iframe src="https://evil.test"></iframe>'), '<iframe></iframe>')
  assert.equal(sanitizeHtml('<form action="/x"><input name="y"></form>hi'), 'hi')
})

test('inline event handlers are stripped but the element survives', () => {
  const out = sanitizeHtml('<p onclick="alert(1)" onmouseover="x()">nội dung</p>')
  assert.equal(out, '<p>nội dung</p>')
  assert.ok(isNeutralised(out))
})

test('javascript:, vbscript: and encoded scheme variants are rejected on href/src', () => {
  for (const payload of [
    '<a href="javascript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="&#106;avascript:alert(1)">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<img src="javascript:alert(1)">',
  ]) {
    const out = sanitizeHtml(payload)
    assert.ok(isNeutralised(out), `payload leaked: ${payload} -> ${out}`)
    assert.ok(!/href="j/i.test(out) && !/src="j/i.test(out), `scheme survived: ${out}`)
  }
})

test('data: URLs allow only raster images, never svg+xml', () => {
  assert.ok(sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=">').includes('data:image/png'))
  assert.equal(sanitizeHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">'), '<img>')
  assert.equal(sanitizeHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">'), '<img>')
})

test('style attributes are scrubbed of expression()/url() but plain rules survive', () => {
  assert.equal(sanitizeHtml('<p style="color:red">Đỏ</p>'), '<p style="color:red">Đỏ</p>')
  assert.ok(isNeutralised(sanitizeHtml('<p style="background:url(javascript:alert(1))">x</p>')))
  assert.ok(isNeutralised(sanitizeHtml('<p style="width:expression(alert(1))">x</p>')))
})

test('HTML comments cannot smuggle markup back in', () => {
  assert.equal(sanitizeHtml('<!-- <script>alert(1)</script> -->an toàn'), 'an toàn')
})

test('legitimate editorial markup is preserved verbatim', () => {
  const input = '<h3>Tiêu đề</h3><p>Xin chào <strong>C11</strong> và <em>cộng đồng</em></p>'
    + '<ul><li>Mục 1</li><li>Mục 2</li></ul>'
    + '<a href="https://chinhphu.vn">liên kết</a>'
    + '<table><tr><td colspan="2">ô</td></tr></table>'
  assert.equal(sanitizeHtml(input), input)
})

test('links opening a new tab are forced to carry rel="noopener noreferrer"', () => {
  const out = sanitizeHtml('<a href="https://x.gov.vn" target="_blank">link</a>')
  assert.ok(out.includes('rel="noopener noreferrer"'), out)
})

test('non-string input degrades to an empty string', () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(sanitizeHtml(value as unknown), '')
  }
})

test('sanitizeBlockData cleans rich-text fields and leaves other fields untouched', () => {
  const data = sanitizeBlockData({
    bodyHtml: '<p onclick="alert(1)">x</p><script>alert(2)</script>',
    html: '<img src=x onerror=alert(1)>',
    asideTitle: 'Cục C11',
    maxItems: 5,
  }) as Record<string, unknown>

  assert.ok(isNeutralised(String(data.bodyHtml)))
  assert.ok(isNeutralised(String(data.html)))
  assert.equal(data.asideTitle, 'Cục C11', 'plain text fields must not be altered')
  assert.equal(data.maxItems, 5, 'non-string fields must not be altered')
})

/**
 * Đầu vào không phải object cho ra `{}`, KHÔNG phải chính giá trị đó.
 *
 * Trước đây hàm khai trả `unknown` và trả nguyên đầu vào, nên `null` đi xuyên
 * qua nó rồi vào cột `page_blocks.data`. Cột đó nullable ở CSDL nhưng
 * `BlockNode.data` thì không — mọi nơi đọc cây block (trình dựng, renderer) đọc
 * thẳng `node.data.x`, nên một hàng `data = NULL` nổ ở đúng đó, trên trang công
 * khai. Ba nơi gọi thật đều đã tự chặn non-object trước khi gọi
 * (`[blockId].put.ts` trả 400, hai nơi kia thay bằng `{}`), nên hợp đồng "luôn
 * trả về một BlockData" không làm mất dữ liệu của ai — nó chỉ bỏ đi con đường
 * mà một nơi gọi thứ tư có thể vô tình ghi `NULL` vào cột.
 */
test('sanitizeBlockData luôn trả về một object block, kể cả với đầu vào lạ', () => {
  assert.deepEqual(sanitizeBlockData(null), {})
  assert.deepEqual(sanitizeBlockData(undefined), {})
  assert.deepEqual(sanitizeBlockData([1, 2]), {})
  assert.deepEqual(sanitizeBlockData('text'), {})
})

test('escapeHtml neutralises the five HTML metacharacters', () => {
  assert.equal(escapeHtml(`<b>"a"&'x'</b>`), '&lt;b&gt;&quot;a&quot;&amp;&#39;x&#39;&lt;/b&gt;')
  assert.equal(escapeHtml(null), '')
  assert.equal(escapeHtml(undefined), '')
})

// ─── iframe YouTube — nhúng video trong bài viết ──────────────────────────────
// TinyMCE plugin `media` sinh `<iframe>` cho YouTube. Sanitizer mở `iframe` CHO
// YOUTUBE DUY NHẤT — `src` phải là `youtube.com/embed/<id>` hoặc
// `youtube-nocookie.com/embed/<id>`. Mọi origin khác bị strip `src`, và
// `javascript:`/`data:` bị drop hoàn toàn.
test('iframe YouTube hợp lệ được giữ, src rewrite sang youtube-nocookie.com', () => {
  const out = sanitizeHtml('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315" allowfullscreen title="Video"></iframe>')
  assert.match(out, /<iframe[^>]*src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/)
  assert.match(out, /width="560"/)
  assert.match(out, /height="315"/)
  assert.match(out, /allowfullscreen/)
  assert.match(out, /title="Video"/)
  assert.ok(!/www\.youtube\.com\/embed/.test(out), 'youtube.com chưa rewrite sang nocookie')
})

test('iframe youtube-nocookie.com giữ nguyên, không rewrite nữa', () => {
  const out = sanitizeHtml('<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1"></iframe>')
  assert.match(out, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?modestbranding=1"/)
})

test('iframe với src lạ bị strip src, tag rỗng còn lại', () => {
  assert.equal(sanitizeHtml('<iframe src="https://evil.test/embed/abc"></iframe>'), '<iframe></iframe>')
  assert.equal(sanitizeHtml('<iframe src="javascript:alert(1)"></iframe>'), '<iframe></iframe>')
  // `data:text/html` có thể chứa `<script>` làm parser ambiguous; ở đây chỉ kiểm
  // scheme `data:` không phải ảnh → `isSafeIframeSrc` reject → src bị drop.
  assert.equal(sanitizeHtml('<iframe src="data:text/html;base64,WFpIP25"></iframe>'), '<iframe></iframe>')
})

test('iframe với ID sai độ dài (không 11 ký tự) bị strip src', () => {
  assert.equal(sanitizeHtml('<iframe src="https://www.youtube.com/embed/short"></iframe>'), '<iframe></iframe>')
  assert.equal(sanitizeHtml('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQextra"></iframe>'), '<iframe></iframe>')
})

test('iframe với scheme http (không https) bị strip src', () => {
  assert.equal(sanitizeHtml('<iframe src="http://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'), '<iframe></iframe>')
})

test('event handler trên iframe bị strip', () => {
  const out = sanitizeHtml('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" onload="alert(1)"></iframe>')
  assert.ok(!/onload/i.test(out), 'onload handler còn')
  assert.match(out, /youtube-nocookie\.com/)
})

test('video/audio/object/embed vẫn bị DROP_TREE', () => {
  assert.equal(sanitizeHtml('<video src="https://evil.test/x.mp4"></video>'), '')
  assert.equal(sanitizeHtml('<audio src="https://evil.test/x.mp3"></audio>'), '')
  assert.equal(sanitizeHtml('<object data="https://evil.test"></object>'), '')
  assert.equal(sanitizeHtml('<embed src="https://evil.test">'), '')
})
