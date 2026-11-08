import assert from 'node:assert/strict'
import test from 'node:test'
import { IMAGE_EDIT_BUTTON, IMAGE_LIBRARY_BUTTON, libraryImageHtml, registerImageLibraryButtons } from '../app/utils/tinymce-image-picker.ts'
import type { MediaItem } from '../app/types/media.ts'
import type { TinyMceEditorInstance } from '../app/types/tinymce.ts'

/**
 * "Chèn ảnh" in both TinyMCE editors opens the media library at once (TinyMCE's own "Insert/edit image" opened a
 * dialog asking for a URL), the image goes in as a full-width picture (the file's pixel size looked ragged), and
 * editing an image is a labelled "Sửa ảnh" button that is on only while an image is selected. The real TinyMCE
 * (toolbar, Insert menu, quick bars, dialog) is checked in a browser: tests/e2e/admin-editor-image-buttons.spec.ts.
 * The init options of both editors are pinned in tests/admin-article-editor.test.ts and
 * tests/editor-video-button-permission.test.ts.
 */

const media = (extra: Partial<MediaItem> = {}): MediaItem => ({
  id: 7, filename: 'a.webp', originalName: 'Ảnh lễ trao quyết định.webp', mimeType: 'image/webp', sizeBytes: 10, provider: 'local',
  url: '/uploads/2026/11/a.webp', ...extra,
})

type Spec = { icon: string, text?: string, tooltip: string, onAction: () => void, onSetup?: (api: { setEnabled: (state: boolean) => void }) => () => void }
function fakeEditor() {
  const buttons = new Map<string, Spec>()
  const menuItems = new Map<string, { icon: string, text: string, onAction: () => void }>()
  const handlers = new Map<string, Set<() => void>>()
  const state = { inserted: [] as string[], commands: [] as string[], node: { nodeName: 'P' } as { nodeName: string } | null }
  const editor = {
    on: (event: string, handler: () => void) => { (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(handler) },
    off: (event: string, handler: () => void) => { handlers.get(event)?.delete(handler) },
    insertContent: (html: string) => { state.inserted.push(html) },
    execCommand: (name: string) => { state.commands.push(name) },
    selection: { getNode: () => state.node },
    ui: { registry: { addButton: (name: string, spec: Spec) => { buttons.set(name, spec) }, addMenuItem: (name: string, spec: { icon: string, text: string, onAction: () => void }) => { menuItems.set(name, spec) } } },
  } as unknown as TinyMceEditorInstance
  /** What TinyMCE does when the selection moves. */
  const nodeChange = () => handlers.get('NodeChange')?.forEach(handler => handler())
  return { editor, buttons, menuItems, handlers, state, nodeChange }
}

test('the library image is the full width of the column, height following the picture', () => {
  assert.equal(libraryImageHtml(media()), '<img src="/uploads/2026/11/a.webp" alt="Ảnh lễ trao quyết định.webp" style="width: 100%; height: auto;">')
})

test('a file name or url that holds a quote or a tag cannot break out of the attribute', () => {
  const html = libraryImageHtml(media({ originalName: 'a" onerror="alert(1)<b>.png', url: '/uploads/x.png?a=1&b="2' }))
  assert.equal(html, '<img src="/uploads/x.png?a=1&amp;b=&quot;2" alt="a&quot; onerror=&quot;alert(1)&lt;b&gt;.png" style="width: 100%; height: auto;">')
  assert.equal(html.split('"').length - 1, 6, 'only the three attributes\' own quotes are raw — every quote in the values is escaped')
})

test('the insert button, the Insert menu item and the quick-bar entry are one action: the library opens, the choice goes in at the caret', () => {
  const { editor, buttons, menuItems, state } = fakeEditor()
  const asked: Array<(m: MediaItem) => void> = []
  registerImageLibraryButtons(editor, onPick => asked.push(onPick))

  assert.deepEqual([...buttons.keys()], [IMAGE_LIBRARY_BUTTON, IMAGE_EDIT_BUTTON])
  assert.deepEqual([...menuItems.keys()], [IMAGE_LIBRARY_BUTTON])
  assert.match(buttons.get(IMAGE_LIBRARY_BUTTON)!.tooltip, /thư viện/)

  for (const open of [buttons.get(IMAGE_LIBRARY_BUTTON)!.onAction, menuItems.get(IMAGE_LIBRARY_BUTTON)!.onAction]) {
    open()
    assert.deepEqual(state.inserted, [], 'nothing is inserted until the officer chooses')
  }
  assert.equal(asked.length, 2, 'each entry opened the library — not a dialog asking for a URL')

  asked[0]!(media())
  assert.deepEqual(state.inserted, ['<p><img src="/uploads/2026/11/a.webp" alt="Ảnh lễ trao quyết định.webp" style="width: 100%; height: auto;"></p>'])
  assert.deepEqual(state.commands, [], 'TinyMCE\'s image dialog is not opened for an insertion')
})

test('"Sửa ảnh" is labelled, opens the image dialog, and is on only while an image is selected', () => {
  const { editor, buttons, state, nodeChange } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})
  const edit = buttons.get(IMAGE_EDIT_BUTTON)!
  assert.equal(edit.text, 'Sửa ảnh', 'a visible label, not an icon alone')

  const enabled: boolean[] = []
  edit.onSetup!({ setEnabled: state => enabled.push(state) })
  assert.deepEqual(enabled, [false], 'a paragraph is selected when the toolbar is drawn')

  state.node = { nodeName: 'IMG' }
  nodeChange()
  state.node = { nodeName: 'P' }
  nodeChange()
  state.node = null
  nodeChange()
  assert.deepEqual(enabled, [false, true, false, false])

  edit.onAction()
  assert.deepEqual(state.commands, ['mceImage'])
})

test('the button stops following the selection when the toolbar lets it go', () => {
  const { editor, buttons, handlers } = fakeEditor()
  registerImageLibraryButtons(editor, () => {})
  const teardown = buttons.get(IMAGE_EDIT_BUTTON)!.onSetup!({ setEnabled: () => {} })
  assert.equal(handlers.get('NodeChange')?.size, 1)
  teardown()
  assert.equal(handlers.get('NodeChange')?.size, 0, 'no handler left on the editor')
})

test('an editor without a UI registry gets no buttons and no error', () => {
  assert.doesNotThrow(() => registerImageLibraryButtons({} as TinyMceEditorInstance, () => {}))
})
