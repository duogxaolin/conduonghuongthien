import assert from 'node:assert/strict'
import test from 'node:test'
import { htmlToDocs } from '../server/utils/html-to-docs.ts'

/**
 * An iframe becomes a text line in the Google Docs export. Docs refuses a link that is not absolute and the
 * whole `batchUpdate` fails with it, so an article with the portal's player frame (`/media/embed/<id>`, stored
 * as a path) exported nothing at all. Only an absolute http(s) src gets a link now; the rest stays text.
 */

const linksIn = (html: string) => htmlToDocs(html).requests.flatMap((request) => {
  const style = (request as { updateTextStyle?: { textStyle?: { link?: { url?: string } } } }).updateTextStyle
  return style?.textStyle?.link ? [style.textStyle.link.url] : []
})
const textsIn = (html: string) => htmlToDocs(html).requests.flatMap(request => ((request as { insertText?: { text?: string } }).insertText?.text ? [(request as { insertText: { text: string } }).insertText.text] : []))

test('the portal player frame (a relative path) exports as plain text, with no link Docs would refuse', () => {
  const html = '<p>Xem:</p><iframe src="/media/embed/Ab3_x-9Qz1k" title="Video"></iframe>'
  assert.deepEqual(linksIn(html), [])
  assert.ok(textsIn(html).includes('[Media]\n'))
})

test('a YouTube frame (absolute) keeps its link', () => {
  const url = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
  assert.deepEqual(linksIn(`<iframe src="${url}"></iframe>`), [url])
})

test('a frame with no src exports as plain text too', () => {
  assert.deepEqual(linksIn('<iframe></iframe>'), [])
})
