import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { mountAdminPage, routes, unmountAll } from './_admin-page-harness.ts'

afterEach(unmountAll)

/**
 * components/admin/TinyMceEditor.vue — "Lưu" inside full screen is opt-in (`save-button`), and it hands the host a model
 * that is already up to date: the host (the translation panel) reads its own copy of the body when it saves.
 */
type Spec = { onAction: () => void }
type Config = { setup?: (editor: unknown) => void }

async function mountEditor(props: Record<string, unknown>) {
  let config: Config = {}
  await mountAdminPage('components/admin/TinyMceEditor.vue', routes({}), {
    props,
    auto: {
      useImagePicker: () => ({ openPicker: () => {} }),
      useVideoPicker: () => ({ openVideoPicker: () => {} }),
      window: { tinymce: { init: (given: Config) => { config = given } } },
    },
  })
  const buttons = new Map<string, Spec>()
  const handlers = new Map<string, () => void>()
  let html = '<p>cũ</p>'
  const registry = { addButton: (name: string, spec: Spec) => { buttons.set(name, spec) }, addToggleButton: (name: string, spec: Spec) => { buttons.set(name, spec) } }
  config.setup?.({
    ui: { registry }, selection: { getNode: () => null },
    on: (events: string, handler: () => void) => { for (const event of events.split(' ')) handlers.set(event, handler) },
    off: () => {}, getContent: () => html, setContent: () => {},
  })
  handlers.get('init')?.() // the editor has taken the model: `<p>cũ</p>` is the baseline
  return { buttons, type: (next: string) => { html = next } }
}

describe('TinyMceEditor "Lưu" in full screen', () => {
  it('without the opt-in there is no save button', async () => {
    const { buttons } = await mountEditor({})
    assert.equal(buttons.has('cdktsave'), false)
    assert.equal(buttons.has('cdktfullscreen'), true, 'every host gets the toggle')
  })

  it('a click brings the model up to date, THEN emits save — typed text not yet pushed is not lost', async () => {
    const events: string[] = []
    const { buttons, type } = await mountEditor({
      saveButton: true,
      'onUpdate:modelValue': (value: string) => { events.push(`model:${value}`) },
      onSave: () => { events.push('save') },
    })
    type('<p>mới gõ</p>') // no `input`/`change` event has fired yet
    buttons.get('cdktsave')!.onAction()
    assert.deepEqual(events, ['model:<p>mới gõ</p>', 'save'])
  })

  it('nothing typed since the baseline: only the save, no needless model update', async () => {
    const events: string[] = []
    const { buttons } = await mountEditor({
      saveButton: true,
      'onUpdate:modelValue': (value: string) => { events.push(`model:${value}`) },
      onSave: () => { events.push('save') },
    })
    buttons.get('cdktsave')!.onAction()
    assert.deepEqual(events, ['save'])
  })
})
