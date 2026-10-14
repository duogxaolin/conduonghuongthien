import assert from 'node:assert/strict'
import test from 'node:test'
import { renderChatMarkdown } from '../app/utils/markdown'

/**
 * Chat answers are model output rendered with v-html. A link or image is allowed
 * to an https URL or to a path on this site. `//evil.example/x` used to pass as a
 * "site path" because the rule was "starts with /" — the browser resolves it as a
 * protocol-relative URL to another host (and `/\evil.example` the same way).
 */

const hrefs = (html: string) => [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map(m => m[1]!)

test('protocol-relative and backslash tricks are not links', () => {
  for (const url of ['//evil.example/phish', '/\\evil.example/phish', '//evil.example']) {
    for (const md of [`[Cổng dịch vụ](${url})`, `![ảnh](${url})`]) {
      const html = renderChatMarkdown(md)
      assert.deepEqual(hrefs(html), [], `${md} -> ${html}`)
      assert.doesNotMatch(html, /<a |<img /)
    }
  }
})

test('site paths and https URLs still render', () => {
  assert.deepEqual(hrefs(renderChatMarkdown('[Tin](/news/nguyen-van-a)')), ['/news/nguyen-van-a'])
  assert.deepEqual(hrefs(renderChatMarkdown('[Trang chủ](/)')), ['/'])
  assert.deepEqual(hrefs(renderChatMarkdown('[Bộ](https://bocongan.gov.vn/a?b=1)')), ['https://bocongan.gov.vn/a?b=1'])
  const image = renderChatMarkdown('![Ảnh bìa](https://cdn.example/a.jpg)')
  assert.ok(hrefs(image).includes('https://cdn.example/a.jpg'))
  assert.match(renderChatMarkdown('![video](/media/aB3x9zK1234)'), /href="\/media\/aB3x9zK1234"/)
})

test('non-https schemes are never linked', () => {
  for (const url of ['javascript:alert(1)', 'http://plain.example/x', 'data:text/html,x', 'JAVASCRIPT:alert(1)']) {
    const html = renderChatMarkdown(`[x](${url})`)
    assert.deepEqual(hrefs(html), [], `${url} -> ${html}`)
  }
})

test('a whitespace character cannot smuggle a second slash', () => {
  for (const md of ['[x](/\t/evil.example)', '[x](/ /evil.example)']) {
    const links = hrefs(renderChatMarkdown(md))
    for (const href of links) assert.ok(!/^\/\s*[/\\]/.test(href), `${md} -> ${href}`)
  }
})
