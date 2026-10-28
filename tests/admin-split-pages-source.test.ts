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

import {
  LANGUAGES_PAGE_FAMILY, PAGE_BUILDER_FAMILY, familyFiles, familyVueFiles, readAppFile, type ComponentFamily,
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
