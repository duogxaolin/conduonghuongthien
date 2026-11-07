import assert from 'node:assert/strict'
import test from 'node:test'
import { imageFilePicker } from '../app/utils/tinymce-image-picker.ts'
import type { MediaItem } from '../app/types/media.ts'

/**
 * The browse button of TinyMCE's image dialog (`file_picker_callback`): it opens the media library for one
 * image and hands the dialog the URL and an alt text. The browser flow — the library above TinyMCE's modal,
 * the choice in the source field — is tests/e2e/admin-editor-media-picker.spec.ts.
 */

const media = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: 7, filename: 'a.webp', originalName: 'Ảnh lễ trao quyết định.webp', mimeType: 'image/webp', sizeBytes: 10, provider: 'local',
  url: '/uploads/2026/11/a.webp', ...extra,
})

test('an image request opens the library once, and the choice fills the dialog with its url and alt text', () => {
  const asked: number[] = []
  let chosen: ((m: MediaItem) => void) | null = null
  const picker = imageFilePicker((onPick) => { asked.push(1); chosen = onPick })
  const filled: Array<[string, Record<string, string> | undefined]> = []

  picker((url, meta) => filled.push([url, meta]), '', { filetype: 'image' })
  assert.equal(asked.length, 1, 'the library opens')
  assert.deepEqual(filled, [], 'nothing is filled until the visitor chooses')

  chosen!(media())
  assert.deepEqual(filled, [['/uploads/2026/11/a.webp', { alt: 'Ảnh lễ trao quyết định.webp' }]])
})

test('a request for another kind of file (media, file) opens nothing', () => {
  let opened = 0
  const picker = imageFilePicker(() => { opened += 1 })
  for (const filetype of ['media', 'file', undefined]) picker(() => assert.fail('no callback'), '', { filetype })
  assert.equal(opened, 0)
})

test('closing the library without choosing never calls the dialog back', () => {
  let called = 0
  const picker = imageFilePicker(() => { /* closed with no choice */ })
  picker(() => { called += 1 }, '', { filetype: 'image' })
  assert.equal(called, 0)
})
