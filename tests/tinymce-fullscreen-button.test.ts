import assert from 'node:assert/strict'
import test from 'node:test'
import { FULLSCREEN_BUTTON, registerFullscreenButton } from '../app/utils/tinymce-fullscreen-button.ts'
import type { TinyMceEditorInstance } from '../app/types/tinymce.ts'

/**
 * The article editor's labelled "Toàn màn hình" toggle. Pressed state follows the plugin's `FullscreenStateChanged`
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
    ui: { registry: { addButton: () => {}, addToggleButton: (name: string, spec: Spec) => { buttons.set(name, spec) } } },
  } as unknown as TinyMceEditorInstance
  const fire = (state: boolean) => handlers.get('FullscreenStateChanged')?.forEach(handler => handler({ state }))
  return { editor, buttons, handlers, commands, fire }
}

test('a labelled toggle that runs TinyMCE\'s own full-screen command', () => {
  const { editor, buttons, commands } = fakeEditor()
  registerFullscreenButton(editor)
  const spec = buttons.get(FULLSCREEN_BUTTON)!
  assert.equal(FULLSCREEN_BUTTON, 'cdktfullscreen')
  assert.equal(spec.text, 'Toàn màn hình', 'a visible label, not an icon alone')
  assert.equal(spec.icon, 'fullscreen')
  assert.match(spec.tooltip, /^Toàn màn hình/)
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
