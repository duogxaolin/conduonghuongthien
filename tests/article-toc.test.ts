import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import { TOC_MIN_HEADINGS, buildToc, headingText, slugifyHeading } from '../app/utils/toc'

/**
 * The outline is derived from stored article HTML at render time, so these are
 * real unit tests of the derivation rather than source-text assertions. The one
 * source assertion at the bottom pins the wiring in ArticleDetail.vue, which
 * cannot be exercised without the Nuxt runtime.
 */

// ─── Anchor ids ──────────────────────────────────────────────────────────────

test('slugifyHeading strips Vietnamese diacritics into a readable ASCII fragment', () => {
  assert.equal(slugifyHeading('Chính sách hỗ trợ'), 'chinh-sach-ho-tro')
  assert.equal(slugifyHeading('Điều 5: Quyền và nghĩa vụ'), 'dieu-5-quyen-va-nghia-vu')
  assert.equal(slugifyHeading('ĐÀO TẠO NGHỀ'), 'dao-tao-nghe')
})

test('slugifyHeading never emits a leading, trailing or doubled separator', () => {
  assert.equal(slugifyHeading('  ***  Mục 1  ***  '), 'muc-1')
  assert.equal(slugifyHeading('A — B'), 'a-b')
})

test('slugifyHeading truncates without leaving a trailing separator', () => {
  const id = slugifyHeading('a'.repeat(78) + ' xin chao')
  assert.ok(id.length <= 80, `id too long: ${id.length}`)
  assert.doesNotMatch(id, /-$/)
})

test('a heading with no ASCII-representable characters still yields a usable id', () => {
  // slugifyHeading returns '' here; buildToc must not emit id="".
  const { headings } = buildToc('<h2>日本語</h2><h2>中文</h2><h3>한국어</h3>')
  assert.deepEqual(headings.map(h => h.id), ['muc', 'muc-2', 'muc-3'])
})

test('duplicate heading text produces distinct ids', () => {
  const { html, headings } = buildToc('<h2>Kết luận</h2><h2>Kết luận</h2><h2>Kết luận</h2>')
  assert.deepEqual(headings.map(h => h.id), ['ket-luan', 'ket-luan-2', 'ket-luan-3'])
  // Each id must exist exactly once in the output, or the anchors collide.
  for (const h of headings) {
    assert.equal(html.split(`id="${h.id}"`).length - 1, 1, `${h.id} emitted more than once`)
  }
})

// ─── Which headings become entries ───────────────────────────────────────────

test('only h2-h4 are collected; h1 is the page title and h5/h6 are too fine', () => {
  const { headings } = buildToc('<h1>Tiêu đề</h1><h2>Hai</h2><h3>Ba</h3><h4>Bốn</h4><h5>Năm</h5><h6>Sáu</h6>')
  assert.deepEqual(headings.map(h => h.level), [2, 3, 4])
  assert.deepEqual(headings.map(h => h.text), ['Hai', 'Ba', 'Bốn'])
})

test('an empty or decorative heading is left alone rather than linked to', () => {
  const source = '<h2></h2><h2>  </h2><h2><img src="/a.png" alt=""></h2><h2>Thật</h2>'
  const { html, headings } = buildToc(source)
  assert.deepEqual(headings.map(h => h.text), ['Thật'])
  assert.match(html, /<h2><\/h2>/, 'empty heading was rewritten')
  assert.match(html, /<h2><img src="\/a\.png" alt=""><\/h2>/, 'image-only heading was rewritten')
})

test('headings are collected in document order, not grouped by level', () => {
  const { headings } = buildToc('<h2>A</h2><h3>A1</h3><h2>B</h2><h3>B1</h3><h4>B1a</h4>')
  assert.deepEqual(headings.map(h => `${h.level}:${h.text}`), ['2:A', '3:A1', '2:B', '3:B1', '4:B1a'])
})

test('an article with fewer headings than the threshold yields no outline', () => {
  const { headings } = buildToc('<h2>Một</h2><p>Nội dung</p><h2>Hai</h2>')
  assert.ok(headings.length < TOC_MIN_HEADINGS, 'threshold no longer filters short articles')
})

test('empty, null and undefined content are handled without throwing', () => {
  for (const value of ['', null, undefined]) {
    const result = buildToc(value)
    assert.deepEqual(result.headings, [])
    assert.equal(result.html, '')
  }
})

// ─── Heading text extraction ─────────────────────────────────────────────────

test('headingText drops inline markup and resolves entities', () => {
  assert.equal(headingText('<strong>Điều 5</strong> &amp; <em>Điều 6</em>'), 'Điều 5 & Điều 6')
  assert.equal(headingText('Ph&#x1EA1;m vi'), 'Phạm vi')
  assert.equal(headingText('A&nbsp;B'), 'A B')
})

test('headingText leaves an unknown entity as written rather than mangling it', () => {
  assert.equal(headingText('a &notanentity; b'), 'a &notanentity; b')
})

// ─── The body HTML that comes back out ───────────────────────────────────────

test('the body is returned unchanged apart from the added ids', () => {
  const source = '<h2>Một</h2><p>Đoạn <strong>đậm</strong></p><h2>Hai</h2><ul><li>x</li></ul><h2>Ba</h2>'
  const { html } = buildToc(source)
  assert.equal(html.replace(/ id="[^"]*"/g, ''), source)
})

test('heading attributes an author set are preserved', () => {
  const { html } = buildToc('<h2 class="lead" style="color:#385130">Một</h2><h2>Hai</h2><h2>Ba</h2>')
  assert.match(html, /class="lead"/)
  assert.match(html, /style="color:#385130"/)
})

test('an existing safe id is reused so inbound links keep working', () => {
  const { html, headings } = buildToc('<h2 id="dieu-khoan">Điều khoản</h2><h2>Hai</h2><h2>Ba</h2>')
  assert.equal(headings[0]?.id, 'dieu-khoan')
  assert.match(html, /<h2 id="dieu-khoan">/)
  assert.equal(html.split('id=').length - 1, 3, 'a second id was added alongside the existing one')
})

test('an unusable or duplicated authored id is replaced rather than trusted', () => {
  // Leading digit is not a valid fragment name; the second reuses the first's id.
  const { html, headings } = buildToc('<h2 id="1bad">Một</h2><h2 id="muc">Hai</h2><h2 id="muc">Ba</h2>')
  assert.equal(headings[0]?.id, 'mot')
  assert.equal(headings[1]?.id, 'muc')
  assert.equal(headings[2]?.id, 'ba')
  assert.doesNotMatch(html, /id="1bad"/)
  assert.equal(html.split('id="muc"').length - 1, 1, 'duplicate id survived')
})

test('a heading with an id-like attribute on a nested tag is not confused for its own id', () => {
  const { headings } = buildToc('<h2><span id="inner">Một</span></h2><h2>Hai</h2><h2>Ba</h2>')
  assert.equal(headings[0]?.id, 'mot', 'took the nested span id as the heading id')
})

test('a stored body cannot inject an attribute through the id it is given', () => {
  // The id is derived from slugified text, so nothing quote-like can reach the
  // attribute; assert that directly rather than trusting the slugifier by eye.
  const { html, headings } = buildToc('<h2>a" onmouseover="alert(1)</h2><h2>Hai</h2><h2>Ba</h2>')
  assert.doesNotMatch(headings[0]?.id ?? '', /["'<>\s]/)
  assert.doesNotMatch(html, /onmouseover="alert\(1\)"/)
})

test('close tags are matched to their own level, so nested levels do not swallow content', () => {
  const { headings, html } = buildToc('<h2>Ngoài</h2><div><h3>Trong</h3></div><h2>Cuối</h2>')
  assert.deepEqual(headings.map(h => h.text), ['Ngoài', 'Trong', 'Cuối'])
  assert.match(html, /<div><h3 id="trong">Trong<\/h3><\/div>/)
})

// ─── Wiring (source assertion: needs the Nuxt runtime to render) ──────────────

test('ArticleDetail renders the toc-processed HTML, not the raw content', () => {
  const source = readFileSync(new URL('../app/components/ArticleDetail.vue', import.meta.url), 'utf8')
  assert.match(source, /v-html="toc\.html"/, 'body no longer renders the id-stamped HTML')
  assert.doesNotMatch(source, /v-html="article\.content"/, 'body reverted to raw content, so anchors point nowhere')
  assert.match(source, /toc\.headings\.length >= TOC_MIN_HEADINGS/, 'the short-article guard was dropped')
  // scroll-margin-top keeps a targeted heading clear of the sticky header.
  assert.match(source, /scroll-margin-top/, 'anchor offset for the sticky header was removed')
})
