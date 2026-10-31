/**
 * The slug field on the three admin taxonomy pages — content categories, content
 * types, media-portal categories — runs the page's real `<script setup>` (compiled
 * with `@vue/compiler-sfc`, Nuxt auto-imports stubbed, `$fetch` recorded).
 *
 * Each page used to carry its own `slugifyLocal` arrow-function copy of `slugify`,
 * missing exactly the line CLAUDE.md names ("`slugify` một bản duy nhất"): the trim
 * of hanging hyphens. The UI therefore accepted and SENT `tin-nong-` (the server's
 * `unique*Slug()` re-slugifies, so the stored slug was right, but the form lied).
 *
 * The fix is two functions from ONE module, `shared/slugify.ts`:
 *  - `slugifyDraft` while typing — same character rules, but a trailing `-` stays,
 *    or staff could never type the hyphen between two words;
 *  - `slugify` (canonical) for a slug derived from the name, on blur, and in the
 *    save payload.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, it } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import type { ElementNode, TemplateChildNode } from '@vue/compiler-core'
import * as Vue from 'vue'

type FetchCall = { url: string, opts?: { method?: string, body?: Record<string, unknown> } }
type Page = {
  form: Record<string, unknown> & { name: string, slug: string }
  slugError?: string
  openCreate: () => void
  openEdit: (row: Record<string, unknown>) => void
  handleSave: () => Promise<void>
} & Record<string, unknown>

/** Resolve an import of the page the way Nuxt would (`~~/` = root, `~/` = app/). */
async function resolveImport(from: string): Promise<Record<string, unknown>> {
  if (from === 'vue') return Vue
  if (from.endsWith('.vue')) return { default: {} }
  if (from.startsWith('~~/')) return import(new URL(`../${from.slice(3)}.ts`, import.meta.url).href)
  if (from.startsWith('~/')) return import(new URL(`../app/${from.slice(2)}.ts`, import.meta.url).href)
  throw new Error(`unexpected import in page: ${from}`)
}

async function runPage(file: string) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename: file })
  const compiled = compileScript(descriptor, { id: 'admin-slug-input-test' })
  const modules: Record<string, Record<string, unknown>> = {}
  for (const [, from] of compiled.content.matchAll(/import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g)) modules[from!] = await resolveImport(from!)
  const code = stripTypeScriptTypes(compiled.content)
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_m, names: string, from: string) =>
      `const {${names.replace(/\s+as\s+/g, ': ')}} = __modules[${JSON.stringify(from)}];`)
    .replace(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"];?/g, (_m, name: string, from: string) =>
      `const ${name} = __modules[${JSON.stringify(from)}].default;`)
    .replace(/export default/, 'return')

  const calls: FetchCall[] = []
  const record = async (url: string, opts?: FetchCall['opts']) => { calls.push({ url, opts }); return { ok: true, items: [] } }
  const auto: Record<string, unknown> = {
    definePageMeta: () => {},
    useToast: () => ({ success: () => {}, error: () => {}, warning: () => {}, info: () => {} }),
    useConfirm: () => ({ confirm: async () => true }),
    useRoute: () => ({ query: {} }),
    useAdminAuth: () => ({ hasPermission: () => true }),
    useBulkSelection: () => ({ count: Vue.ref(0), keepOnly: () => {}, clear: () => {} }),
    useBulkAction: () => ({ busy: Vue.ref(false), run: async () => {} }),
    errorMessage: (_err: unknown, fallback: string) => fallback,
    ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch, nextTick: Vue.nextTick,
    onMounted: () => {},
    // A page moved to `adminFetch<T>()` (D-FETCH) reaches the same recorder — same wire.
    $fetch: record,
    adminFetch: record,
  }
  // A name the page imports itself (`import { errorMessage } from …`) is not an auto-import.
  for (const [, names] of compiled.content.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const name of names!.split(',')) delete auto[name.split(/\s+as\s+/).at(-1)!.trim()]
  }
  const component = new Function('__modules', ...Object.keys(auto), code)(modules, ...Object.values(auto)) as {
    setup: (props: object, ctx: object) => Record<string, unknown>
  }
  const page = Vue.proxyRefs(component.setup({}, { expose: () => {}, emit: () => {}, attrs: {}, slots: {} })) as Page
  return { page, calls, descriptor }
}

/** The `@blur` handler expression on the slug `<input v-model="form.slug">`, if any. */
function slugBlurHandler(descriptor: ReturnType<typeof parse>['descriptor']): string | null {
  const walk = (nodes: TemplateChildNode[]): string | null => {
    for (const node of nodes) {
      if (node.type !== 1) continue
      const el = node as ElementNode
      const isSlugInput = el.tag === 'input' && el.props.some(p => p.type === 7 && p.name === 'model'
        && p.exp?.type === 4 && p.exp.content === 'form.slug')
      if (isSlugInput) {
        const blur = el.props.find(p => p.type === 7 && p.name === 'on' && p.arg?.type === 4 && p.arg.content === 'blur')
        return blur && blur.type === 7 && blur.exp?.type === 4 ? blur.exp.content : null
      }
      const found = walk(el.children)
      if (found !== null) return found
    }
    return null
  }
  return walk(descriptor.template!.ast!.children)
}

const lastBody = (calls: FetchCall[]) => calls.filter(c => c.opts?.method === 'POST' || c.opts?.method === 'PUT').at(-1)?.opts?.body

for (const file of ['app/pages/admin/content/categories/index.vue', 'app/pages/admin/content/content-types.vue']) {
  describe(`${file} — slug typed by hand`, () => {
    it('a slug derived from the name is canonical (no hanging hyphen)', async () => {
      const { page } = await runPage(file)
      page.openCreate()
      page.form.name = 'Tin nóng -'
      await Vue.nextTick()
      assert.equal(page.form.slug, 'tin-nong')
    })

    it('typing keeps a trailing hyphen so the next word can follow, and it is not flagged', async () => {
      const { page } = await runPage(file)
      page.openCreate()
      page.form.slug = 'tin-'
      await Vue.nextTick()
      assert.equal(page.form.slug, 'tin-', 'trimming here would make "-" impossible to type')
      assert.equal(page.slugError, '', 'a half-typed slug must not show the red error and disable Save')
      page.form.slug = 'Tin-Nóng'
      await Vue.nextTick()
      assert.equal(page.form.slug, 'tin-nong', 'invalid characters are still cleaned while typing')
    })

    it('blur turns the slug canonical', async () => {
      const { page, descriptor } = await runPage(file)
      const handler = slugBlurHandler(descriptor)
      assert.ok(handler, 'the slug input needs an @blur that applies the canonical slugify')
      page.openCreate()
      page.form.slug = 'tin-nong-'
      await Vue.nextTick()
      ;(page[handler!] as () => void)()
      assert.equal(page.form.slug, 'tin-nong')
    })

    it('save sends the canonical slug — no trailing hyphen', async () => {
      const { page, calls } = await runPage(file)
      page.openCreate()
      page.form.name = 'Tin nóng'
      await Vue.nextTick()
      page.form.slug = 'tin-nong-'
      await Vue.nextTick()
      await page.handleSave()
      assert.equal(lastBody(calls)?.slug, 'tin-nong')
    })
  })
}

describe('app/pages/admin/content/content-types.vue — system types', () => {
  it('editing a system type shows its real slug (role_model), untouched by the typing normaliser', async () => {
    const { page, calls } = await runPage('app/pages/admin/content/content-types.vue')
    page.openEdit({ id: 3, name: 'Gương sáng', slug: 'role_model', isSystem: true, icon: '', description: '', displayOrder: 0 })
    await Vue.nextTick()
    assert.equal(page.form.slug, 'role_model', 'the disabled field used to read "rolemodel"')
    await page.handleSave()
    assert.equal(lastBody(calls)?.slug, undefined, 'a system type never sends a slug')
  })
})

describe('app/pages/admin/media-portal/categories.vue — slug', () => {
  const file = 'app/pages/admin/media-portal/categories.vue'

  it('a slug derived from the name is canonical (no hanging hyphen)', async () => {
    const { page } = await runPage(file)
    page.openCreate()
    page.form.name = 'Video hoạt động - '
    await Vue.nextTick()
    assert.equal(page.form.slug, 'video-hoat-dong')
  })

  it('save sends the canonical slug — no trailing hyphen', async () => {
    const { page, calls } = await runPage(file)
    page.openCreate()
    page.form.name = 'Video'
    await Vue.nextTick()
    page.form.slug = 'video-hoat-dong-'
    await page.handleSave()
    assert.equal(lastBody(calls)?.slug, 'video-hoat-dong')
  })
})
