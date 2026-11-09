import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { FULLSCREEN_BUTTON, FULLSCREEN_LABEL, FULLSCREEN_TOOLTIP, SAVE_BUTTON, SAVE_LABEL, SAVE_TOOLTIP, fullscreenToolbarGroup, registerFullscreenButton } from '../app/utils/tinymce-fullscreen-button.ts'
import type { TinyMceEditorInstance } from '../app/types/tinymce.ts'

/**
 * The rich-text editors' labelled "Phóng to" toggle and its opt-in "Lưu" (full screen only). Pressed state follows the plugin's `FullscreenStateChanged`
 * (so View → Fullscreen and Ctrl+Shift+F move it too), and starts right when the editor is already full screen. The
 * real thing — the box covering the viewport under the admin layout, the media library above it, leaving the page while
 * full screen — is tests/e2e/admin-editor-fullscreen.spec.ts.
 */

type Api = { setEnabled: (state: boolean) => void, setActive: (state: boolean) => void }
type Spec = { icon: string, text?: string, tooltip: string, onAction: () => void, onSetup?: (api: Api) => () => void }
type Handler = (event: { state?: boolean }) => void

function fakeEditor(options: { fullscreen?: boolean } = {}) {
  const buttons = new Map<string, Spec>()
  const handlers = new Map<string, Set<Handler>>()
  const commands: string[] = []
  const editor = {
    on: (event: string, handler: Handler) => { (handlers.get(event) ?? handlers.set(event, new Set()).get(event)!).add(handler) },
    off: (event: string, handler: Handler) => { handlers.get(event)?.delete(handler) },
    execCommand: (name: string) => { commands.push(name) },
    plugins: options.fullscreen === undefined ? undefined : { fullscreen: { isFullscreen: () => options.fullscreen! } },
    ui: { registry: { addButton: (name: string, spec: Spec) => { buttons.set(name, spec) }, addToggleButton: (name: string, spec: Spec) => { buttons.set(name, spec) } } },
  } as unknown as TinyMceEditorInstance
  const fire = (state: boolean) => handlers.get('FullscreenStateChanged')?.forEach(handler => handler({ state }))
  return { editor, buttons, handlers, commands, fire }
}

test('a labelled toggle that runs TinyMCE\'s own full-screen command', () => {
  const { editor, buttons, commands } = fakeEditor()
  registerFullscreenButton(editor)
  const spec = buttons.get(FULLSCREEN_BUTTON)!
  assert.equal(FULLSCREEN_BUTTON, 'cdktfullscreen')
  assert.equal(spec.text, FULLSCREEN_LABEL)
  assert.equal(FULLSCREEN_LABEL, 'Phóng to', 'a visible label, not an icon alone — short, so Bold/Italic/Underline keep their place on the first row')
  assert.equal(spec.icon, 'fullscreen')
  assert.equal(spec.tooltip, FULLSCREEN_TOOLTIP)
  assert.ok(spec.tooltip.includes(FULLSCREEN_LABEL) && spec.tooltip.includes('toàn màn hình'), 'the accessible name carries the visible label and says what it does')
  assert.match(spec.tooltip, /thoát/, 'the tooltip says how to leave')
  spec.onAction()
  assert.deepEqual(commands, ['mceFullScreen'])
})

test('pressed follows the plugin\'s state, whichever way it changed', () => {
  const { editor, buttons, fire } = fakeEditor({ fullscreen: false })
  registerFullscreenButton(editor)
  const states: boolean[] = []
  buttons.get(FULLSCREEN_BUTTON)!.onSetup!({ setEnabled: () => {}, setActive: state => states.push(state) })
  assert.deepEqual(states, [false])
  fire(true) // the button, View → Fullscreen or Ctrl+Shift+F: the toggle cannot tell, and need not
  fire(false)
  fire(true)
  assert.deepEqual(states, [false, true, false, true])
})

test('a button drawn while the editor is already full screen starts pressed', () => {
  const { editor, buttons } = fakeEditor({ fullscreen: true })
  registerFullscreenButton(editor)
  const states: boolean[] = []
  buttons.get(FULLSCREEN_BUTTON)!.onSetup!({ setEnabled: () => {}, setActive: state => states.push(state) })
  assert.deepEqual(states, [true])
})

test('without the plugin object the button starts released', () => {
  const { editor, buttons } = fakeEditor()
  registerFullscreenButton(editor)
  const states: boolean[] = []
  buttons.get(FULLSCREEN_BUTTON)!.onSetup!({ setEnabled: () => {}, setActive: state => states.push(state) })
  assert.deepEqual(states, [false])
})

test('the button stops listening when the toolbar lets it go', () => {
  const { editor, buttons, handlers, fire } = fakeEditor()
  registerFullscreenButton(editor)
  const states: boolean[] = []
  const teardown = buttons.get(FULLSCREEN_BUTTON)!.onSetup!({ setEnabled: () => {}, setActive: state => states.push(state) })
  assert.equal(handlers.get('FullscreenStateChanged')?.size, 1)
  teardown()
  assert.equal(handlers.get('FullscreenStateChanged')?.size, 0, 'no handler left on the editor')
  fire(true)
  assert.deepEqual(states, [false], 'and no write to a button that is gone')
})

test('an editor without a UI registry gets no button and no error', () => {
  assert.doesNotThrow(() => registerFullscreenButton({} as TinyMceEditorInstance))
})

test('"Lưu" is registered only when the host opts in, and runs the host\'s save', () => {
  const without = fakeEditor()
  registerFullscreenButton(without.editor)
  assert.equal(without.buttons.has(SAVE_BUTTON), false, 'no save callback: no button (a host without one adds nothing)')
  const saves: string[] = []
  const withSave = fakeEditor()
  registerFullscreenButton(withSave.editor, () => { saves.push('saved') })
  const spec = withSave.buttons.get(SAVE_BUTTON)!
  assert.equal(SAVE_BUTTON, 'cdktsave')
  assert.equal(spec.text, SAVE_LABEL)
  assert.equal(spec.icon, 'save')
  assert.equal(spec.tooltip, SAVE_TOOLTIP)
  assert.ok(spec.tooltip.startsWith(SAVE_LABEL), 'the accessible name begins with the visible label')
  spec.onAction()
  spec.onAction()
  assert.deepEqual(saves, ['saved', 'saved'], 'each click is one call; a host that must not run twice guards itself')
  assert.deepEqual(withSave.commands, [], 'saving does not leave full screen')
})

test('the toolbar group names the save button only for a host that registers one', () => {
  assert.equal(fullscreenToolbarGroup(false), 'cdktfullscreen')
  assert.equal(fullscreenToolbarGroup(true), 'cdktfullscreen cdktsave')
})

test('"Lưu" is hidden outside full screen by a rule keyed on the SAME tooltip prefix (TinyMCE 6.8 renders no data-mce-name)', () => {
  const css = readFileSync(new URL('../app/assets/css/main.css', import.meta.url), 'utf8')
  const prefix = SAVE_TOOLTIP.split(' — ')[0]!
  const rule = css.match(/([^{}]*\.tox-tbtn\[aria-label\^="([^"]+)"\])\s*\{([^}]*)\}/)
  assert.ok(rule, 'a rule on the save button by aria-label prefix')
  assert.equal(rule![2], prefix, 'the CSS prefix is the tooltip\'s own')
  assert.match(rule![1]!, /\.tox-tinymce:not\(\.tox-fullscreen\)/, 'hidden unless the editor container is full screen')
  assert.match(rule![3]!, /display:\s*none/)
})
