/**
 * Source guards of the "Nhà cung cấp & Models" tab after its wave3 4.2 split, read over the
 * whole family (tests/_component-family.ts: the tab, `components/admin/ai/providers/*.vue`
 * and the two write composables), each with an in-suite injection proof.
 *
 *   1. An API key typed by the officer is bound ONLY as `v-model` of an
 *      `<input type="password">` — never printed (`{{ }}`), never bound to another
 *      attribute, never on a text field. The server only ever sends the last four
 *      characters (`apiKeyLastFour`), which is what the card prints.
 *   2. The parts are display only: no part calls the API or owns a toast/confirm. Requests
 *      stay in the tab (the list load, pinned by tests/admin-error-retry-ui.test.ts and
 *      skeleton-loading-ui.test.ts) and in the composables — a part that fetched would need
 *      its own load/error/retry contract.
 *
 * The behaviour (what the officer sees and what is sent) is tests/admin-ai-providers-tab.test.ts.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parse } from '@vue/compiler-sfc'

import { AI_PROVIDERS_TAB_FAMILY, familyFiles, familyVueFiles, readAppFile } from './_component-family.ts'

type TemplateNode = {
  type: number
  tag?: string
  props?: Array<{ type: number, name: string, value?: { content: string }, exp?: { content: string }, arg?: { content: string } }>
  content?: { content: string }
  children?: TemplateNode[]
  loc: { start: { line: number } }
}
const ELEMENT = 1
const INTERPOLATION = 5
const ATTRIBUTE = 6
const DIRECTIVE = 7
/** `apiKey` as a name — not `apiKeyLastFour`. */
const API_KEY = /\bapiKey\b/

/** Every template reference to a typed API key that is not `v-model` on a password input. */
function apiKeyLeaks(files: Array<{ file: string, source: string }>): string[] {
  const out: string[] = []
  for (const { file, source } of files) {
    const ast = parse(source, { filename: file }).descriptor.template?.ast as TemplateNode | undefined
    const visit = (node: TemplateNode) => {
      if (node.type === INTERPOLATION && API_KEY.test(node.content?.content ?? '')) out.push(`${file}:${node.loc.start.line} {{ }}`)
      if (node.type === ELEMENT) {
        const type = node.props?.find(p => p.type === ATTRIBUTE && p.name === 'type')?.value?.content
        const typeBound = node.props?.some(p => p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === 'type')
        for (const p of node.props ?? []) {
          if (p.type !== DIRECTIVE || !API_KEY.test(p.exp?.content ?? '')) continue
          const ok = p.name === 'model' && node.tag === 'input' && type === 'password' && !typeBound
          if (!ok) out.push(`${file}:${node.loc.start.line} <${node.tag}> v-${p.name}${p.arg ? `:${p.arg.content}` : ''}`)
        }
      }
      node.children?.forEach(visit)
    }
    if (ast) visit(ast)
  }
  return out
}

/** Parts (not the tab, not the composables) that reach the API or own a toast/confirm. */
const PART_SIDE_EFFECT = /\$fetch\b|\badminFetch\b|\buseFetch\(|\buseAsyncData\(|\buseAdminList\b|\buseToast\(|\buseConfirm\(/
const partsWithSideEffects = (files: Array<{ file: string, source: string }>) =>
  files.filter(f => f.file.startsWith(`${AI_PROVIDERS_TAB_FAMILY.partsDir}/`) && PART_SIDE_EFFECT.test(f.source)).map(f => f.file)

describe('the split providers tab — source guards', () => {
  it('a typed API key is only ever the v-model of a password field (create + edit dialogs)', () => {
    assert.deepEqual(apiKeyLeaks(familyVueFiles(AI_PROVIDERS_TAB_FAMILY)), [])
    const bound = familyVueFiles(AI_PROVIDERS_TAB_FAMILY).filter(f => /v-model="form\.apiKey"/.test(f.source)).map(f => f.file)
    assert.deepEqual(bound, ['components/admin/ai/providers/ProviderCreateModal.vue', 'components/admin/ai/providers/ProviderEditModal.vue'])
  })

  it('proof: a text field, a printed key, a bound attribute or a new part with the key are each caught', () => {
    const edit = 'components/admin/ai/providers/ProviderEditModal.vue'
    const create = 'components/admin/ai/providers/ProviderCreateModal.vue'
    const source = readAppFile(edit)
    const asText = source.replace('v-model="form.apiKey" type="password"', 'v-model="form.apiKey" type="text"')
    assert.notEqual(asText, source)
    assert.equal(apiKeyLeaks(familyVueFiles(AI_PROVIDERS_TAB_FAMILY, { [edit]: asText })).length, 1)
    const dynamicType = source.replace('v-model="form.apiKey" type="password"', 'v-model="form.apiKey" type="password" :type="shown ? \'text\' : \'password\'"')
    assert.equal(apiKeyLeaks(familyVueFiles(AI_PROVIDERS_TAB_FAMILY, { [edit]: dynamicType })).length, 1)
    const printed = readAppFile(create).replace('<span class="text-xs text-ink-muted font-normal">Có thể nhập sau nếu chưa có.</span>', '<span>{{ form.apiKey }}</span>')
    assert.equal(apiKeyLeaks(familyVueFiles(AI_PROVIDERS_TAB_FAMILY, { [create]: printed })).length, 1)
    const bound = readAppFile(create).replace('placeholder="Nhập API key"', ':title="form.apiKey"')
    assert.equal(apiKeyLeaks(familyVueFiles(AI_PROVIDERS_TAB_FAMILY, { [create]: bound })).length, 1)
    const added = 'components/admin/ai/providers/ProviderKeyField.vue'
    const leaks = apiKeyLeaks(familyVueFiles(AI_PROVIDERS_TAB_FAMILY, { [added]: '<template><input v-model="model.apiKey" type="text" /></template>' }))
    assert.deepEqual(leaks.map(l => l.split(':')[0]), [added])
    // The last four characters the server sends are not the key.
    assert.deepEqual(apiKeyLeaks([{ file: 'x.vue', source: '<template><code>{{ p.apiKeyLastFour }}</code></template>' }]), [])
  })

  it('the parts are display only: no request, no toast, no confirm', () => {
    assert.deepEqual(partsWithSideEffects(familyFiles(AI_PROVIDERS_TAB_FAMILY)), [])
  })

  it('proof: a request or a toast planted in a part is caught; the tab and the composables may fetch', () => {
    const part = 'components/admin/ai/providers/ProviderModelsPanel.vue'
    const withFetch = readAppFile(part).replace('</script>', "void adminFetch('/api/admin/ai/pricing')\n</script>")
    assert.deepEqual(partsWithSideEffects(familyFiles(AI_PROVIDERS_TAB_FAMILY, { [part]: withFetch })), [part])
    const withToast = readAppFile(part).replace('</script>', 'const toast = useToast()\n</script>')
    assert.deepEqual(partsWithSideEffects(familyFiles(AI_PROVIDERS_TAB_FAMILY, { [part]: withToast })), [part])
    assert.match(readAppFile(AI_PROVIDERS_TAB_FAMILY.parent), /\badminFetch</)
  })
})
