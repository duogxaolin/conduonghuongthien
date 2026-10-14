import assert from 'node:assert/strict'
import test from 'node:test'
import { renderChatMarkdown } from '../app/utils/markdown'

/**
 * A chat link must come out as `<a href="…" target="_blank" rel="noopener noreferrer">`.
 *
 * The safe-URL rewrite (PR-3a) dropped the space between `href="$2"` and
 * `target=`. Browsers happen to recover `href="x"target="_blank"`, but HTML
 * sanitizers and the HTML spec treat it as a parse error ("missing whitespace
 * between attributes"), and a stricter consumer can lose `target`/`rel` — which is
 * exactly the attribute that keeps an outbound link from reaching `window.opener`.
 */

const anchors = (html: string) => [...html.matchAll(/<a\s[^>]*>/g)].map(m => m[0])

test('every rendered link has whitespace-separated href, target and rel', () => {
  for (const md of ['[Tin](/news/a)', '[Bộ](https://bocongan.gov.vn/x?y=1)', 'xem [ở đây](/)']) {
    const tags = anchors(renderChatMarkdown(md))
    assert.equal(tags.length, 1, md)
    const tag = tags[0]!
    assert.doesNotMatch(tag, /="[^"]*"[a-zA-Z]/, `attributes must be separated by whitespace: ${tag}`)
    assert.match(tag, /\shref="[^"]+"\s/, tag)
    assert.match(tag, /\starget="_blank"\s/, tag)
    assert.match(tag, /\srel="noopener noreferrer"/, tag)
  }
})

test('image and video cards keep their attributes separated too', () => {
  for (const md of ['![Ảnh](https://cdn.example/a.jpg)', '![video](/media/aB3x9zK1234)']) {
    for (const tag of anchors(renderChatMarkdown(md))) {
      assert.doesNotMatch(tag, /="[^"]*"[a-zA-Z]/, tag)
    }
  }
})
