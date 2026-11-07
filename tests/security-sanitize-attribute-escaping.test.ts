import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeHtml } from '../server/utils/sanitize-html.ts'

/**
 * Attribute values leave the HTML filter escaped — once. Two defects, both found by an independent review
 * of the video-embed change (2026-11-07), both older than it:
 *
 *  1. STORED XSS: the YouTube `<iframe src>` is checked on entity-DECODED text and was re-emitted through
 *     replacements that replaced each character with itself (`'"'` → `'"'`), so a `"` smuggled in the query
 *     (`&#34;`) ended the attribute and the rest became attributes of the frame: `onload="…"`. The public
 *     read paths filter a second time, which hid it; paths that filter once (a translation read by the admin
 *     quick view, then `v-html`) did not.
 *  2. DOUBLE ESCAPING: an entity the editor had already written (`&quot;`, `&amp;`) had its `&` escaped again,
 *     so every pass made `alt`/`title` longer and left entity junk in the accessible name.
 */

const PROBES = [
  'https://www.youtube.com/embed/AAAAAAAAAAA?&#34; onload=&#34;alert(1)',
  'https://www.youtube.com/embed/AAAAAAAAAAA?&#x22; onload=&#x22;alert(1)',
  'https://www.youtube.com/embed/AAAAAAAAAAA?&quot; onload=&quot;alert(1)',
  'https://www.youtube.com/embed/AAAAAAAAAAA?x=1&#62;&#60;script&#62;alert(1)',
  'https://www.youtube.com/embed/AAAAAAAAAAA?a b',
]

test('a quote or bracket in the YouTube query never reaches the output as markup (nor survives as a src)', () => {
  for (const src of PROBES) {
    const out = sanitizeHtml(`<iframe src="${src}"></iframe>`)
    assert.doesNotMatch(out, /\sonload=|<script|alert\(1\)/, `one pass: ${src}`)
    assert.equal(out, '<iframe></iframe>', `the src is refused: ${src}`)
  }
})

test('the same break-out through a single-quoted attribute is refused too', () => {
  const out = sanitizeHtml(`<iframe src='https://www.youtube.com/embed/AAAAAAAAAAA?" onload="alert(1)'></iframe>`)
  assert.doesNotMatch(out, /\sonload=/)
})

test('a real YouTube query survives, escaped once, and a second pass changes nothing', () => {
  const once = sanitizeHtml('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?modestbranding=1&rel=0&start=30" title="Video"></iframe>')
  assert.equal(once, '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1&amp;rel=0&amp;start=30" title="Video"></iframe>')
  assert.equal(sanitizeHtml(once), once)
  const asWritten = sanitizeHtml('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?modestbranding=1&amp;rel=0"></iframe>')
  assert.equal(asWritten, '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?modestbranding=1&amp;rel=0"></iframe>')
})

test('an entity the editor wrote in alt/title is kept as it is, not escaped again, pass after pass', () => {
  const html = '<p><img src="/uploads/a.webp" alt="Tin &quot;nóng&quot; &amp; hơn &lt;3" title="a &#39;b&#39;"></p>'
  const once = sanitizeHtml(html)
  assert.equal(once, '<p><img src="/uploads/a.webp" alt="Tin &quot;nóng&quot; &amp; hơn &lt;3" title="a &#39;b&#39;"></p>')
  assert.equal(sanitizeHtml(sanitizeHtml(once)), once, 'stable over repeated saves')
})

test('a bare & or a raw quote/bracket in an attribute is still escaped', () => {
  assert.equal(sanitizeHtml('<img src="/a.webp" alt="R&D">'), '<img src="/a.webp" alt="R&amp;D">')
  assert.equal(sanitizeHtml(`<img src="/a.webp" alt='say "hi" <b'>`), '<img src="/a.webp" alt="say &quot;hi&quot; &lt;b">')
})
