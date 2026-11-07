import assert from 'node:assert/strict'
import test from 'node:test'
import { sanitizeHtml } from '../server/utils/sanitize-html.ts'

/**
 * The portal's own player frame (`/media/embed/<short_id>`, app/pages/media/embed/[shortId].vue) is the
 * ONLY same-origin iframe the HTML filter keeps (the other is YouTube). The filter accepts that path — bare,
 * or behind an `http(s)://host` (TinyMCE makes the `src` absolute the moment the frame is inserted) — and
 * ALWAYS EMITS THE BARE PATH: the host is dropped, so what survives is a same-origin frame whatever host was
 * written. Anything else — an extra part, a way out of the folder, a host that is not a plain host — loses its
 * `src` and leaves an empty frame, as every other refused iframe does.
 */

const frame = (src: string) => `<iframe src="${src}" title="Video" width="640" height="360" loading="lazy" allowfullscreen></iframe>`

test('the portal player frame is kept exactly as written', () => {
  const html = frame('/media/embed/Ab3_x-9Qz1k')
  assert.equal(sanitizeHtml(html), '<iframe src="/media/embed/Ab3_x-9Qz1k" title="Video" width="640" height="360" loading="lazy" allowfullscreen></iframe>')
  assert.equal(sanitizeHtml(sanitizeHtml(html)), sanitizeHtml(html), 'sanitizing twice changes nothing')
})

test('the short id may be 6 to 16 base64url characters', () => {
  for (const id of ['abcdef', 'abcdefghijklmnop']) assert.match(sanitizeHtml(frame(`/media/embed/${id}`)), /src="\/media\/embed\//)
  for (const id of ['abcde', 'abcdefghijklmnopq']) assert.equal(sanitizeHtml(frame(`/media/embed/${id}`)), '<iframe title="Video" width="640" height="360" loading="lazy" allowfullscreen></iframe>', id)
})

test('an absolute URL (what TinyMCE writes) is emitted as the bare path — the host is dropped, never kept', () => {
  for (const src of [
    'http://localhost:3123/media/embed/Ab3_x-9Qz1k',
    'https://cdht.delify.vn/media/embed/Ab3_x-9Qz1k',
    'https://evil.test/media/embed/Ab3_x-9Qz1k', // a foreign host with the same tail: the result is OUR frame, not theirs
    'http://10.0.0.5:8080/media/embed/Ab3_x-9Qz1k',
  ]) {
    const out = sanitizeHtml(frame(src))
    assert.match(out, /src="\/media\/embed\/Ab3_x-9Qz1k"/, src)
    assert.doesNotMatch(out, /evil\.test|cdht\.delify|localhost|10\.0\.0\.5|http/, `the host survived: ${src}`)
  }
})

test('anything else loses its src', () => {
  const refused = [
    '//evil.test/media/embed/Ab3_x-9Qz1k',            // protocol-relative: not a scheme the filter reads
    'https://user:pw@evil.test/media/embed/Ab3_x-9Qz1k', // userinfo
    'https://evil.test@good.test/media/embed/Ab3_x-9Qz1k',
    'https://[::1]/media/embed/Ab3_x-9Qz1k',          // bracketed host
    'https://evil.test/x/media/embed/Ab3_x-9Qz1k',    // another folder first
    'ftp://evil.test/media/embed/Ab3_x-9Qz1k',        // another scheme
    '/media/embed/Ab3_x-9Qz1k?autoplay=1',            // query
    '/media/embed/Ab3_x-9Qz1k#t=10',                  // fragment
    'https://evil.test/media/embed/Ab3_x-9Qz1k?x=1',
    '/media/embed/Ab3_x-9Qz1k/',                      // trailing part
    '/media/embed/../../admin/login',                 // out of the folder
    '/media/embed/%2e%2e/admin',                      // encoded dots
    '/media/embed/',                                  // no id
    '/media/embed/ab cdef',                           // a space
    '/media/embedx/Ab3_x-9Qz1k',                      // another folder
    '/Media/embed/Ab3_x-9Qz1k',                       // case matters: routes are case-sensitive here
    'media/embed/Ab3_x-9Qz1k',                        // not rooted
    '/admin/content/articles/1',                      // an admin page
    'javascript:alert(1)',
  ]
  for (const src of refused) {
    assert.doesNotMatch(sanitizeHtml(frame(src)), /src=/, `kept: ${src}`)
  }
})

test('an encoded form of a valid path is judged on its decoded text (no smuggling through entities)', () => {
  // `&#x2f;` decodes to `/`: the filter decodes entities before it checks, then emits the decoded, checked value.
  assert.equal(sanitizeHtml('<iframe src="&#x2f;media&#x2f;embed&#x2f;Ab3_x-9Qz1k"></iframe>'), '<iframe src="/media/embed/Ab3_x-9Qz1k"></iframe>')
  assert.equal(sanitizeHtml('<iframe src="&#x2f;&#x2f;evil.test&#x2f;media&#x2f;embed&#x2f;Ab3_x-9Qz1k"></iframe>'), '<iframe></iframe>')
})

test('event handlers and non-allowlisted attributes on the portal frame are still dropped', () => {
  const out = sanitizeHtml('<iframe src="/media/embed/Ab3_x-9Qz1k" onload="alert(1)" srcdoc="x" sandbox="" name="x" style="position:fixed"></iframe>')
  assert.doesNotMatch(out, /onload|srcdoc|sandbox|name=/)
  assert.match(out, /src="\/media\/embed\/Ab3_x-9Qz1k"/)
})

test('the same frame inside other markup survives, and a script next to it does not', () => {
  const out = sanitizeHtml(`<p>Xem video:</p>${frame('/media/embed/Ab3_x-9Qz1k')}<script>alert(1)</script>`)
  assert.match(out, /<p>Xem video:<\/p><iframe src="\/media\/embed\/Ab3_x-9Qz1k"/)
  assert.doesNotMatch(out, /script|alert/)
})

test('the portal player frame keeps a title with special characters unchanged across passes', () => {
  const html = '<iframe src="/media/embed/Ab3_x-9Qz1k" title="Tin &quot;nóng&quot; &amp; hơn" width="640" height="360" loading="lazy" allowfullscreen></iframe>'
  assert.equal(sanitizeHtml(html), html)
  assert.equal(sanitizeHtml(sanitizeHtml(html)), html)
})
