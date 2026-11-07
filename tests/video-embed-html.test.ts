import assert from 'node:assert/strict'
import test from 'node:test'
import { isEmbeddableVideo, videoEmbedHtml, type EmbeddableVideoInput } from '../app/utils/video-embed-html.ts'
import { registerVideoLibraryButton, VIDEO_LIBRARY_BUTTON } from '../app/utils/tinymce-video-picker.ts'
import { sanitizeHtml } from '../server/utils/sanitize-html.ts'
import type { AdminMediaItem } from '../app/types/admin-api.ts'
import type { TinyMceEditorInstance } from '../app/types/tinymce.ts'

/**
 * What the editor inserts for a video of the library, and the toolbar button that inserts it. The point of
 * the whole: whatever is inserted must be exactly what the HTML filter keeps — an inserted frame the filter
 * strips would silently vanish on save.
 */

const base: EmbeddableVideoInput = {
  shortId: 'Ab3_x-9Qz1k', title: 'Lễ trao quyết định', source: 'upload', youtubeVideoId: null, status: 'published', processingStatus: 'ready',
}

test('a published, processed upload becomes the portal player frame (a relative path)', () => {
  assert.equal(videoEmbedHtml(base), '<iframe src="/media/embed/Ab3_x-9Qz1k" title="Lễ trao quyết định" width="640" height="360" loading="lazy" allowfullscreen></iframe>')
})

test('a published YouTube item becomes the no-cookie YouTube embed', () => {
  const html = videoEmbedHtml({ ...base, source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ', processingStatus: 'pending' })
  assert.match(html!, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/)
})

test('drafts, archived items and unfinished uploads cannot be embedded', () => {
  for (const extra of [{ status: 'draft' }, { status: 'archived' }, { processingStatus: 'processing' }, { processingStatus: 'failed' }, { processingStatus: 'pending' }]) {
    assert.equal(isEmbeddableVideo({ ...base, ...extra }), false, JSON.stringify(extra))
    assert.equal(videoEmbedHtml({ ...base, ...extra }), null)
  }
})

test('a malformed id is never turned into a frame', () => {
  assert.equal(videoEmbedHtml({ ...base, shortId: '../admin' }), null)
  assert.equal(videoEmbedHtml({ ...base, shortId: 'a b' }), null)
  assert.equal(videoEmbedHtml({ ...base, source: 'youtube', youtubeVideoId: 'short' }), null)
  assert.equal(videoEmbedHtml({ ...base, source: 'youtube', youtubeVideoId: null }), null)
})

test('the title is escaped as an attribute value', () => {
  const html = videoEmbedHtml({ ...base, title: 'Tin "nóng" <b> & hơn' })!
  assert.match(html, /title="Tin &quot;nóng&quot; &lt;b&gt; &amp; hơn"/)
})

test('both shapes survive the HTML filter unchanged (what is inserted is what is kept)', () => {
  for (const input of [base, { ...base, source: 'youtube', youtubeVideoId: 'dQw4w9WgXcQ' }]) {
    const html = videoEmbedHtml(input)!
    assert.equal(sanitizeHtml(html), html)
  }
})

test('the toolbar button opens the library; the chosen item is inserted as a paragraph with its frame', () => {
  const buttons: Record<string, { icon: string, tooltip: string, onAction: () => void }> = {}
  const inserted: string[] = []
  const editor = {
    ui: { registry: { addButton: (name: string, spec: { icon: string, tooltip: string, onAction: () => void }) => { buttons[name] = spec } } },
    insertContent: (html: string) => { inserted.push(html) },
  } as unknown as TinyMceEditorInstance
  let chosen: ((item: AdminMediaItem) => void) | null = null
  registerVideoLibraryButton(editor, (onPick) => { chosen = onPick })

  const button = buttons[VIDEO_LIBRARY_BUTTON]!
  assert.ok(button, 'the button is registered under its name')
  assert.deepEqual(inserted, [], 'nothing is inserted before a choice')
  button.onAction()
  assert.ok(chosen, 'pressing it opens the library')

  chosen!(base as unknown as AdminMediaItem)
  assert.deepEqual(inserted, [`<p>${videoEmbedHtml(base)}</p>`])
  chosen!({ ...base, status: 'draft' } as unknown as AdminMediaItem)
  assert.equal(inserted.length, 1, 'an item that cannot be embedded inserts nothing')
})

test('an editor without a UI registry (a stand-in, or one that failed to start) is left alone', () => {
  assert.doesNotThrow(() => registerVideoLibraryButton({} as TinyMceEditorInstance, () => {}))
})
