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

/**
 * A just-enough DOM for the control: elements that remember attributes, children and listeners. The bar is built by
 * `registerZoomControl` itself, so what is asserted is what a user can reach: the buttons, the slider, the wheel.
 */
class FakeElement {
  attributes: Record<string, string> = {}
  children: FakeElement[] = []
  listeners: Record<string, Array<(event: unknown) => void>> = {}
  parentElement: FakeElement | null = null
  textContent = ''
  type = ''
  min = ''
  max = ''
  step = ''
  value = ''
  clientWidth = 0
  matches: Record<string, FakeElement> = {}
  ownerDocument = { createElement: (_tag: string) => new FakeElement() }
  setAttribute(name: string, value: string) { this.attributes[name] = value }
  addEventListener(name: string, handler: (event: unknown) => void) { (this.listeners[name] ??= []).push(handler) }
  append(...nodes: FakeElement[]) { for (const node of nodes) { node.parentElement = this; this.children.push(node) } }
  insertBefore(node: FakeElement, reference: FakeElement) { node.parentElement = this; this.children.splice(this.children.indexOf(reference), 0, node) }
  querySelector(selector: string): FakeElement | null {
    if (this.matches[selector]) return this.matches[selector]
    for (const child of this.children) { const found = child.querySelector(selector); if (found) return found }
    return null
  }
  click() { for (const handler of this.listeners.click ?? []) handler({}) }
}

function mountedControl(options: { stored?: string, areaWidth?: number, withAnchor?: boolean, withBar?: boolean } = {}) {
  const container = new FakeElement()
  const bar = new FakeElement()
  const anchor = new FakeElement()
  const area = new FakeElement()
  area.clientWidth = options.areaWidth ?? 0
  container.matches['.tox-edit-area'] = area
  if (options.withBar !== false) container.matches['.tox-statusbar'] = bar
  if (options.withAnchor !== false) { bar.append(anchor); bar.matches['.tox-statusbar__right-container'] = anchor }
  const properties: Record<string, string> = {}
  const wheel: Array<(event: { ctrlKey: boolean, deltaY: number, preventDefault: () => void }) => void> = []
  const wheelOptions: unknown[] = []
  const handlers: Record<string, () => void> = {}
  const editor = {
    on: (event: string, handler: () => void) => { handlers[event] = handler },
    getContainer: () => container,
    getDoc: () => ({
      documentElement: { style: { setProperty: (name: string, value: string) => { properties[name] = value } } },
      addEventListener: (_name: string, handler: (typeof wheel)[number], opts: unknown) => { wheel.push(handler); wheelOptions.push(opts) },
    }),
    dispatch: () => {},
    nodeChanged: () => {},
  } as unknown as TinyMceEditorInstance
  const stored: Record<string, string> = options.stored ? { [ZOOM_STORAGE_KEY]: options.stored } : {}
  const storage = { getItem: (key: string) => stored[key] ?? null, setItem: (key: string, value: string) => { stored[key] = value } } as Storage
  registerZoomControl(editor, { localStorage: storage })
  handlers.init!()
  const control = bar.children.find(child => 'data-cdkt-zoom' in child.attributes) ?? null
  const byLabel = (label: string) => control?.children.find(child => child.attributes['aria-label'] === label) as FakeElement
  return { control, bar, anchor, properties, stored, wheel, wheelOptions, byLabel }
}

test('the control sits in the status bar before its right-hand corner, labelled, with a 50–200 slider in steps of 5', () => {
  const { control, bar, anchor, byLabel } = mountedControl()
  assert.ok(control, 'built')
  assert.equal(bar.children.indexOf(control!), bar.children.indexOf(anchor) - 1, 'right before the right container')
  const slider = byLabel('Mức phóng to của trang soạn')
  assert.deepEqual([slider.type, slider.min, slider.max, slider.step], ['range', '50', '200', '5'])
  for (const label of ['Giảm mức xem', 'Tăng mức xem', 'Về mức 100%', 'Vừa với bề rộng khung soạn']) assert.ok(byLabel(label), label)
  assert.equal(byLabel('Về mức 100%').textContent, '100%')
})

test('without the right-hand corner the control is appended; without any status bar nothing is built', () => {
  const noAnchor = mountedControl({ withAnchor: false })
  assert.equal(noAnchor.bar.children.at(-1), noAnchor.control)
  assert.equal(mountedControl({ withBar: false }).control, null)
})

test('− and + move the level by 10 points, the slider and the label follow, and the level is remembered', () => {
  const { properties, stored, byLabel } = mountedControl()
  byLabel('Tăng mức xem').click()
  assert.equal(properties.zoom, '1.1')
  assert.equal(byLabel('Về mức 100%').textContent, '110%')
  assert.equal(byLabel('Mức phóng to của trang soạn').value, '110')
  assert.equal(stored[ZOOM_STORAGE_KEY], '1.1')
  byLabel('Giảm mức xem').click()
  byLabel('Giảm mức xem').click()
  assert.equal(properties.zoom, '0.9')
  for (let i = 0; i < 20; i++) byLabel('Giảm mức xem').click()
  assert.equal(properties.zoom, '0.5', 'never below 50%')
  for (let i = 0; i < 30; i++) byLabel('Tăng mức xem').click()
  assert.equal(properties.zoom, '2', 'never above 200%')
})

test('the slider sets the level it shows, and the percentage button goes back to 100%', () => {
  const { properties, byLabel } = mountedControl()
  const slider = byLabel('Mức phóng to của trang soạn')
  slider.value = '70'
  for (const handler of slider.listeners.input!) handler({})
  assert.equal(properties.zoom, '0.7')
  byLabel('Về mức 100%').click()
  assert.equal(properties.zoom, '1')
  assert.equal(slider.value, '100')
})

test('a remembered level is shown straight away; "Vừa khít" fits the sheet to the editing area', () => {
  const { properties, byLabel } = mountedControl({ stored: '1.5', areaWidth: 604 })
  assert.equal(properties.zoom, '1.5')
  assert.equal(byLabel('Về mức 100%').textContent, '150%')
  byLabel('Vừa với bề rộng khung soạn').click()
  assert.equal(properties.zoom, '0.66')
})

test('Ctrl + wheel over the page zooms (up = closer) and is not passive; a plain wheel is left to scroll', () => {
  const { properties, wheel, wheelOptions } = mountedControl()
  assert.deepEqual(wheelOptions, [{ passive: false }], 'passive:false so the browser\'s own page zoom can be prevented')
  let prevented = 0
  const spin = (ctrlKey: boolean, deltaY: number) => wheel[0]!({ ctrlKey, deltaY, preventDefault: () => { prevented++ } })
  spin(false, -100)
  assert.equal(properties.zoom, '1', 'no Ctrl: untouched')
  assert.equal(prevented, 0)
  spin(true, -100)
  assert.equal(properties.zoom, '1.1')
  spin(true, 100)
  spin(true, 100)
  assert.equal(properties.zoom, '0.9')
  assert.equal(prevented, 3)
})
