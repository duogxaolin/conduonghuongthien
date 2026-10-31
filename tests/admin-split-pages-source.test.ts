/**
 * Source guards for the admin pages split in wave3 4.2 whose parts sit beside the page
 * (`/admin/languages`, the page builder): the display parts call no API and raise no
 * toast/confirm — the page and its composables do.
 *
 * Why it matters: tests/admin-error-retry-ui.test.ts and tests/skeleton-loading-ui.test.ts
 * walk every admin `.vue` that fetches (ADMIN_FETCH_CALL) and demand a load/error/retry
 * contract or a stated exemption. A part that started fetching would join both gates with no
 * error branch to declare, and its failure would land nowhere the page shows — so a part
 * stays display-only (props in, events out) and the page keeps every `role="alert"` + "Thử
 * lại". The parts are read from the family's directory (tests/_component-family.ts), so a
 * part added later is checked without editing this file.
 *
 * The page builder, besides: no file of its family calls `$fetch` (the 10 casts went to
 * `adminFetch<T>()` in 7.1 batch B, tests/admin-fetch-rollout-page-builder.test.ts), and none
 * renders HTML (`v-html`): block HTML is the public renderer's (sanitized, inventoried in
 * tests/security-ai-editorial-html.test.ts), never the builder's.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parse as parseSfc } from '@vue/compiler-sfc'
import ts from 'typescript'

import {
  ARTICLE_EDITOR_FAMILY, LANGUAGES_PAGE_FAMILY, PAGE_BUILDER_FAMILY, familyFiles, familyVueFiles, readAppFile, type ComponentFamily,
} from './_component-family.ts'
import { ADMIN_FETCH_CALL } from './_admin-fetch-call.ts'

/** A request, a toast or a confirm prompt. */
const SIDE_EFFECT = /\$fetch\b|\badminFetch\b|\buseAdminList\b|\buseFetch\b|\buseAsyncData\b|\buseToast\b|\buseConfirm\b|\btoast\.|\bconfirm\(/

const offenders = (family: ComponentFamily, overrides?: Record<string, string>) =>
  familyVueFiles(family, overrides).filter(f => f.file !== family.parent && SIDE_EFFECT.test(f.source)).map(f => f.file)

const templateOf = (source: string) => source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>'))

for (const [family, part, alertCount] of [
  [LANGUAGES_PAGE_FAMILY, 'components/admin/languages/page/LanguagesPageHeader.vue', 2],
  // The page load, and the versions list (shown in the drawer's `#error` slot, FINDING-B1).
  [PAGE_BUILDER_FAMILY, 'components/admin/page-builder/PageMetaModal.vue', 2],
  // One banner: a failed load (with "Thử lại") or a refused save (the save button is its retry).
  [ARTICLE_EDITOR_FAMILY, 'components/admin/articles/editor/ArticleEditorPublishPanel.vue', 1],
] as const) {
  describe(`${family.parent} — the wave3 4.2 parts`, () => {
    it('the display parts call no API and raise no toast or confirm', () => {
      assert.deepEqual(offenders(family), [])
    })

    it('the page still fetches (it stays in both coverage gates) and keeps its alerts', () => {
      const page = readAppFile(family.parent)
      assert.match(page, ADMIN_FETCH_CALL)
      assert.equal(templateOf(page).match(/role="alert"/g)?.length, alertCount, 'every load error branch stays in the page')
    })

    it('proof: a request, a toast or a confirm planted in a part — or in a new part — is caught', () => {
      for (const planted of [
        "const r = await adminFetch<{ ok: true }>('/api/admin/x')",
        "const toast = useToast()",
        "const { confirm } = useConfirm()",
        "await $fetch('/api/admin/x', { method: 'POST' })",
      ]) {
        const source = readAppFile(part).replace('</script>', `${planted}\n</script>`)
        assert.deepEqual(offenders(family, { [part]: source }), [part], planted)
      }
      const added = `${family.partsDir}/Extra.vue`
      assert.deepEqual(offenders(family, { [added]: '<script setup lang="ts">\nconst toast = useToast()\n</script>' }), [added])
    })
  })
}

describe('the page builder family — no $fetch, no v-html', () => {
  const bareFetch = (overrides?: Record<string, string>) => familyFiles(PAGE_BUILDER_FAMILY, overrides).filter(f => /\$fetch\b/.test(f.source)).map(f => f.file)
  const vHtml = (overrides?: Record<string, string>) => familyVueFiles(PAGE_BUILDER_FAMILY, overrides).filter(f => /\bv-html\b|innerHTML/.test(f.source)).map(f => f.file)

  it('no file of the family calls or casts $fetch', () => {
    assert.deepEqual(bareFetch(), [])
  })

  it('no file of the family renders HTML', () => {
    assert.deepEqual(vHtml(), [])
  })

  it('proof: $fetch in a composable or a util, v-html in the page or a part, is caught', () => {
    const composable = 'composables/usePageVersions.ts'
    assert.deepEqual(bareFetch({ [composable]: `${readAppFile(composable)}\nexport const leak = () => $fetch('/api/admin/pages')\n` }), [composable])
    const util = 'utils/blocks/builder-tree.ts'
    assert.deepEqual(bareFetch({ [util]: `${readAppFile(util)}\nexport const leak = () => ($fetch as (u: string) => Promise<unknown>)('/x')\n` }), [util])
    const part = 'components/admin/page-builder/PageVersionsDrawer.vue'
    assert.deepEqual(vHtml({ [part]: readAppFile(part).replace('<span class="truncate">', '<span class="truncate" v-html="v.label">') }), [part])
    assert.deepEqual(vHtml({ [PAGE_BUILDER_FAMILY.parent]: readAppFile(PAGE_BUILDER_FAMILY.parent).replace('<p>{{ loadError }}</p>', '<p v-html="loadError"></p>') }), [PAGE_BUILDER_FAMILY.parent])
  })
})

/**
 * The article editor family (wave3): no `$fetch` (its six casts went to `adminFetch<T>()` in 7.1
 * batch D), no `v-html` (AI HTML reaches the editor through `setEditorContent`, never rendered by
 * the page — the one `v-html` of that flow is ArticleAIPanel's, inventoried in
 * tests/security-ai-editorial-html.test.ts), and ONE TinyMCE init — the project's second init
 * path (CLAUDE.md "TinyMCE admin editor") lives in `useArticleEditorTinymce.ts`, where
 * tests/admin-article-editor.test.ts pins its config byte for byte.
 */
describe('the article editor family — no $fetch, no v-html, one TinyMCE init', () => {
  const TINYMCE_HOME = 'composables/useArticleEditorTinymce.ts'
  const bareFetch = (overrides?: Record<string, string>) => familyFiles(ARTICLE_EDITOR_FAMILY, overrides).filter(f => /\$fetch\b/.test(f.source)).map(f => f.file)
  const vHtml = (overrides?: Record<string, string>) => familyVueFiles(ARTICLE_EDITOR_FAMILY, overrides).filter(f => /\bv-html\b|innerHTML/.test(f.source)).map(f => f.file)
  const inits = (overrides?: Record<string, string>) => familyFiles(ARTICLE_EDITOR_FAMILY, overrides)
    .flatMap(f => tinymceInitCalls(f.file, f.source).map(() => f.file))

  it('no file of the family calls or casts $fetch', () => {
    assert.deepEqual(bareFetch(), [])
  })

  it('no file of the family renders HTML', () => {
    assert.deepEqual(vHtml(), [])
  })

  it('TinyMCE is initialised once, in useArticleEditorTinymce.ts, at height 700', () => {
    assert.deepEqual(inits(), [TINYMCE_HOME])
    assert.match(readAppFile(TINYMCE_HOME), /\n {6}height: 700,\n/)
  })

  it('proof: $fetch in a composable, v-html in a part or the page, a second init anywhere, is caught', () => {
    const composable = 'composables/useArticleEditorSave.ts'
    assert.deepEqual(bareFetch({ [composable]: `${readAppFile(composable)}\nexport const leak = () => $fetch('/api/admin/articles')\n` }), [composable])
    const part = 'components/admin/articles/editor/ArticleEditorMainForm.vue'
    assert.deepEqual(vHtml({ [part]: readAppFile(part).replace('<div :id="editorId"', '<div v-html="title" :id="editorId"') }), [part])
    const page = ARTICLE_EDITOR_FAMILY.parent
    assert.deepEqual(vHtml({ [page]: readAppFile(page).replace('<span>{{ errorMsg || saveError }}</span>', '<span v-html="errorMsg"></span>') }), [page])
    const added = `${ARTICLE_EDITOR_FAMILY.partsDir}/Extra.vue`
    assert.deepEqual(inits({ [added]: '<script setup lang="ts">\nonMounted(() => window.tinymce.init({ selector: "#x" }))\n</script>' }), [TINYMCE_HOME, added])
  })

  it('proof: a second init written with optional chaining, a bracket key or a cast is caught too', () => {
    // The first version of this guard grepped `tinymce.init(` and was blind to every form below.
    assert.equal(/\btinymce\.init\(/.test('window.tinymce?.init({})'), false)
    const added = `${ARTICLE_EDITOR_FAMILY.partsDir}/Extra.vue`
    for (const call of [
      'window.tinymce?.init({ selector: "#x" })',
      "window.tinymce['init']({ selector: '#x' })",
      'window.tinymce?.["init"]({ selector: "#x" })',
      '(window as WindowWithTinyMce).tinymce!.init({ selector: "#x" })',
      '((window as WindowWithTinyMce).tinymce as TinyMceGlobal).init({ selector: "#x" })',
    ]) {
      assert.deepEqual(inits({ [added]: `<script setup lang="ts">\nonMounted(() => ${call})\n</script>` }), [TINYMCE_HOME, added], call)
    }
    const composable = 'composables/useArticleEditorSave.ts'
    assert.deepEqual(inits({ [composable]: `${readAppFile(composable)}\nexport const again = () => (window as WindowWithTinyMce).tinymce?.['init']({})\n` }).sort(), [composable, TINYMCE_HOME].sort())
    const page = ARTICLE_EDITOR_FAMILY.parent
    assert.deepEqual(inits({ [page]: readAppFile(page).replace('</script>', 'onMounted(() => window.tinymce?.init({}))\n</script>') }).sort(), [page, TINYMCE_HOME].sort())
    // Not an init: another method, another object.
    assert.deepEqual(inits({ [added]: '<script setup lang="ts">\nwindow.tinymce?.get("x")?.remove(); editor.init?.(); other.init({})\n</script>' }), [TINYMCE_HOME])
  })
})

/**
 * Every `tinymce.init(…)` call in one file of the family, read with the TypeScript parser — a
 * `.vue` file's `<script>`/`<script setup>` (templates cannot reach `window`). A call is one whose
 * callee is `init` — `.init`, `?.init`, `['init']`, `?.['init']` — on an object that is `tinymce`
 * or ends in `.tinymce`, through parentheses, `!` and `as` casts. An alias (`const t = window
 * .tinymce; t.init(…)`) is out of reach of any source scan; the behaviour suite's fake TinyMCE
 * (tests/admin-article-editor.test.ts) counts the real inits at run time.
 */
function tinymceInitCalls(file: string, source: string): string[] {
  const scripts = file.endsWith('.vue')
    ? (() => { const { descriptor } = parseSfc(source, { filename: file }); return [descriptor.script?.content ?? '', descriptor.scriptSetup?.content ?? ''] })()
    : [source]
  const unwrap = (node: ts.Expression): ts.Expression => {
    let current = node
    while (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression
    return current
  }
  const isTinymce = (node: ts.Expression) => {
    const target = unwrap(node)
    if (ts.isIdentifier(target)) return target.text === 'tinymce'
    if (ts.isPropertyAccessExpression(target)) return target.name.text === 'tinymce'
    if (ts.isElementAccessExpression(target)) return ts.isStringLiteralLike(target.argumentExpression) && target.argumentExpression.text === 'tinymce'
    return false
  }
  const found: string[] = []
  for (const script of scripts) {
    const sf = ts.createSourceFile(file, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression)
        const isInit = (ts.isPropertyAccessExpression(callee) && callee.name.text === 'init')
          || (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression) && callee.argumentExpression.text === 'init')
        if (isInit && isTinymce((callee as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression)) found.push(node.getText(sf))
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return found
}
