import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ZOOM_MAX, ZOOM_MIN, ZOOM_STORAGE_KEY, WEB_PAGE_COLUMN, WEB_PAGE_EDITOR_STYLE,
  applyEditorZoom, clampZoom, fitZoom, loadZoom, registerZoomControl, zoomLabel,
} from '../app/utils/tinymce-web-page.ts'
import type { TinyMceEditorInstance } from '../app/types/tinymce.ts'

/**
 * The article editor as a "web page" sheet (CHANGELOG § 108): the sheet is the public text column wide and set in the
 * public page's own type, and the zoom is a level the editor can show. The real thing — fonts actually loaded, the
 * toolbar bubbles landing on the text at every level, the control in full screen — is tests/e2e/admin-editor-web-page.spec.ts.
 */
const articleBody = readFileSync(new URL('../app/components/article/ArticleBody.vue', import.meta.url), 'utf8')
const articlePage = readFileSync(new URL('../app/components/ArticleDetail.vue', import.meta.url), 'utf8')

test('the sheet is exactly the public text column wide (808 px of the article page\'s grid), plus its own padding', () => {
  assert.equal(WEB_PAGE_COLUMN, 808)
  assert.match(articlePage, /minmax\(0,820px\)_320px/, 'the public grid still gives the text column up to 820 px (808 inside it)')
  assert.match(WEB_PAGE_EDITOR_STYLE, /max-width: 904px/)
  assert.match(WEB_PAGE_EDITOR_STYLE, /padding: 48px/)
  assert.match(WEB_PAGE_EDITOR_STYLE, /box-sizing: border-box/)
})

test('the type is the public page\'s: Inter, 18 px, ink colour, line height 1.75 — and a pasted font-family / size is ignored, as there', () => {
  for (const rule of ['font-size: 1.125rem', 'line-height: 1.75', 'color: #1E251C']) {
    assert.ok(WEB_PAGE_EDITOR_STYLE.includes(rule), `editor: ${rule}`)
    assert.ok(articleBody.includes(rule), `ArticleBody.vue: ${rule}`)
  }
  assert.match(WEB_PAGE_EDITOR_STYLE, /font-family: Inter/)
  assert.match(WEB_PAGE_EDITOR_STYLE, /\[style\*="font-family"\] \{ font-family: inherit !important; \}/)
  assert.match(WEB_PAGE_EDITOR_STYLE, /\[style\*="font-size"\], \[style\*="line-height"\] \{ font-size: inherit !important; line-height: inherit !important; \}/)
  assert.ok(articleBody.includes('[style*="font-family"]') && articleBody.includes('[style*="font-size"]'))
  for (const heading of ['h2 { font-size: 1.5rem; font-weight: 800;', 'h3 { font-size: 1.2rem; font-weight: 800;']) assert.ok(WEB_PAGE_EDITOR_STYLE.includes(heading), heading)
  assert.match(WEB_PAGE_EDITOR_STYLE, /img, video \{[^}]*display: block; margin: 1\.5rem auto;/, 'pictures sit in the middle of the column, as on the page')
})

test('a zoom level is 50%–200% in whole percent; anything else is 100%', () => {
  assert.equal(ZOOM_MIN, 0.5)
  assert.equal(ZOOM_MAX, 2)
  assert.equal(clampZoom(1.234), 1.23)
  assert.equal(clampZoom(0.1), 0.5)
  assert.equal(clampZoom(9), 2)
  assert.equal(clampZoom('1.5'), 1.5)
  for (const bad of [Number.NaN, undefined, null, 'abc', {}]) assert.equal(clampZoom(bad), 1, `${String(bad)} → 100%`)
  assert.equal(zoomLabel(1.5), '150%')
  assert.equal(zoomLabel(0.55), '55%')
})

test('the remembered level is read from storage and survives blocked or empty storage', () => {
  assert.equal(loadZoom({ getItem: key => (key === ZOOM_STORAGE_KEY ? '1.25' : null) }), 1.25)
  assert.equal(loadZoom({ getItem: () => null }), 1)
  assert.equal(loadZoom({ getItem: () => { throw new Error('blocked') } }), 1)
  assert.equal(loadZoom(null), 1)
})

function fakeEditor() {
  const calls: string[] = []
  const properties: Record<string, string> = {}
  const editor = {
    getDoc: () => ({ documentElement: { style: { setProperty: (name: string, value: string) => { properties[name] = value } } } }),
    dispatch: (name: string) => { calls.push(name) },
    nodeChanged: () => { calls.push('nodeChanged') },
    on: () => {},
  } as unknown as TinyMceEditorInstance
  return { editor, calls, properties }
}

test('zooming sets CSS zoom on the editor document and tells TinyMCE the layout moved (an open toolbar bubble follows only then)', () => {
  const { editor, calls, properties } = fakeEditor()
  assert.equal(applyEditorZoom(editor, 1.5), 1.5)
  assert.equal(properties.zoom, '1.5')
  assert.deepEqual(calls, ['ResizeWindow', 'ScrollContent', 'nodeChanged'])
  assert.equal(applyEditorZoom(editor, 7), 2, 'clamped')
  assert.equal(properties.zoom, '2')
})

test('an editor without a document or notifications (a test double, a destroyed editor) is zoomed without error', () => {
  assert.equal(applyEditorZoom({} as TinyMceEditorInstance, 0.7), 0.7)
})

test('the control is built once the editor has initialised, not before', () => {
  const handlers: Record<string, () => void> = {}
  const editor = { on: (event: string, handler: () => void) => { handlers[event] = handler }, getContainer: () => { throw new Error('too early') } } as unknown as TinyMceEditorInstance
  registerZoomControl(editor, { localStorage: undefined as unknown as Storage })
  assert.deepEqual(Object.keys(handlers), ['init'])
})

test('the article editor uses the sheet, the portal font and the zoom control; the other editor keeps its own', () => {
  const composable = readFileSync(new URL('../app/composables/useArticleEditorTinymce.ts', import.meta.url), 'utf8')
  assert.match(composable, /const CONTENT_STYLE = `\$\{WEB_PAGE_EDITOR_STYLE\}/)
  assert.match(composable, /content_css: \['default', '\/assets\/fonts\/inter\.css'\]/)
  assert.match(composable, /registerZoomControl\(editor, window\)/)
  const shared = readFileSync(new URL('../app/components/admin/TinyMceEditor.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(shared, /WEB_PAGE_EDITOR_STYLE|registerZoomControl/, 'Page Builder / translation panel: not in this change')
})

test('"fit" is the zoom at which the whole sheet (904 px) fits the editing area: never above 100%, never below 50%', () => {
  assert.equal(fitZoom(904), 1)
  assert.equal(fitZoom(1500), 1, 'a wide frame is not enlarged')
  assert.equal(fitZoom(604), 0.66)
  assert.equal(fitZoom(300), 0.5, 'floor')
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(fitZoom(bad), 1, String(bad))
})
