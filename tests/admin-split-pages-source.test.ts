/**
 * Source guards for the admin pages split in wave3 4.2 whose parts sit beside the page:
 * the display parts call no API and raise no toast/confirm — the page and its composables do.
 *
 * Why it matters: tests/admin-error-retry-ui.test.ts and tests/skeleton-loading-ui.test.ts
 * walk every admin `.vue` that fetches (ADMIN_FETCH_CALL) and demand a load/error/retry
 * contract or a stated exemption. A part that started fetching would join both gates with no
 * error branch to declare, and its failure would land nowhere the page shows — so a part
 * stays display-only (props in, events out) and the page keeps every `role="alert"` + "Thử
 * lại". The parts are read from the family's directory (tests/_component-family.ts), so a
 * part added later is checked without editing this file.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { LANGUAGES_PAGE_FAMILY, familyVueFiles, readAppFile, type ComponentFamily } from './_component-family.ts'
import { ADMIN_FETCH_CALL } from './_admin-fetch-call.ts'

/** A request, a toast or a confirm prompt. */
const SIDE_EFFECT = /\$fetch\b|\badminFetch\b|\buseAdminList\b|\buseFetch\b|\buseAsyncData\b|\buseToast\b|\buseConfirm\b|\btoast\.|\bconfirm\(/

const offenders = (family: ComponentFamily, overrides?: Record<string, string>) =>
  familyVueFiles(family, overrides).filter(f => f.file !== family.parent && SIDE_EFFECT.test(f.source)).map(f => f.file)

describe('/admin/languages — the wave3 4.2 parts', () => {
  it('the display parts call no API and raise no toast or confirm', () => {
    assert.deepEqual(offenders(LANGUAGES_PAGE_FAMILY), [])
  })

  it('the page still fetches (it stays in both coverage gates) and keeps both alerts', () => {
    const page = readAppFile(LANGUAGES_PAGE_FAMILY.parent)
    assert.match(page, ADMIN_FETCH_CALL)
    const template = page.slice(page.indexOf('\n<template>'))
    assert.equal(template.match(/role="alert"/g)?.length, 2, 'the languages list and the translations table each keep their alert in the page')
  })

  it('proof: a request, a toast or a confirm planted in a part — or in a new part — is caught', () => {
    const part = 'components/admin/languages/page/LanguagesPageHeader.vue'
    for (const planted of [
      "const r = await adminFetch<{ ok: true }>('/api/admin/languages')",
      "const toast = useToast()",
      "const { confirm } = useConfirm()",
      "await $fetch('/api/admin/languages/sync', { method: 'POST' })",
    ]) {
      const source = readAppFile(part).replace('</script>', `${planted}\n</script>`)
      assert.deepEqual(offenders(LANGUAGES_PAGE_FAMILY, { [part]: source }), [part], planted)
    }
    const added = 'components/admin/languages/page/LanguagesExtra.vue'
    assert.deepEqual(offenders(LANGUAGES_PAGE_FAMILY, { [added]: '<script setup lang="ts">\nconst toast = useToast()\n</script>' }), [added])
  })
})
