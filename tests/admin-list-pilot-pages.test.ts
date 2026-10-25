/**
 * Source contract for the admin list pages moved to `useAdminList` + `adminFetch`
 * (design.md D-FETCH, wave2 task 6.4). Wave 3 adds pages to `ADMIN_LIST_PAGES`.
 *
 * What a migrated page must look like, and why each point is pinned here:
 *   1. No `$fetch` at all — every request goes through `adminFetch<T>()`, so there
 *      is no `($fetch as (u: string, o?: …) => Promise<…>)` cast left to drift
 *      from the endpoint it describes. Checked on the whole file and tolerant of
 *      whitespace, so a differently-spelled cast does not slip past.
 *   2. The list state comes from `useAdminList(` — the race guard (an older answer
 *      never overwrites a newer one) lives there and is tested in
 *      tests/admin-list.test.ts; a page hand-rolling its own load would lose it.
 *   3. The first load runs from `onMounted` — `loading` starts true, so a page
 *      that never calls `reload` shows its skeleton forever. Not from setup: on
 *      SSR the request would go out without the admin cookie.
 *   4. The error/retry block stays IN THE PAGE (`role="alert"`, a "Thử lại"
 *      button bound to `reload`). tests/admin-error-retry-ui.test.ts reads each
 *      page file's own source; moving that block into a shared component would
 *      take the page out of its reach (split-guard rule).
 *   5. The coverage gates still see the page: a migrated page contains no
 *      `$fetch`, so the gates' fetch pattern must recognise `adminFetch`/
 *      `useAdminList` (tests/_admin-fetch-call.ts).
 *
 * LIMITATION — this reads source text. Behaviour (stale answers, abort, retry,
 * error text) is proven in tests/admin-list.test.ts against real ofetch.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

import { ADMIN_FETCH_CALL } from './_admin-fetch-call.ts'

const ADMIN_LIST_PAGES = [
  'pages/admin/comments/index.vue',
  'pages/admin/readers/index.vue',
  'pages/admin/chatbot/sessions/index.vue',
]

async function sfc(file: string) {
  const source = await readFile(new URL(`../app/${file}`, import.meta.url), 'utf8')
  const { descriptor } = parse(source, { filename: file })
  return {
    source,
    script: descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '',
    template: descriptor.template?.content ?? '',
  }
}

test('migrated list pages carry no $fetch — every request is a typed adminFetch<T>()', async () => {
  for (const file of ADMIN_LIST_PAGES) {
    const { source } = await sfc(file)
    assert.doesNotMatch(source, /\(\s*\$fetch\s+as\b/, `${file} still casts $fetch — use adminFetch<T>(url, opts)`)
    assert.doesNotMatch(source, /\$fetch\b/, `${file} still calls $fetch directly — go through adminFetch<T>()`)
  }
})

test('migrated list pages take their list state from useAdminList and load on mount', async () => {
  for (const file of ADMIN_LIST_PAGES) {
    const { script } = await sfc(file)
    assert.match(script, /\buseAdminList\s*</, `${file} must build its list with useAdminList<TItem, TFilters>()`)
    assert.match(
      script,
      /onMounted\(\s*(?:\(\)\s*=>\s*\{?\s*)?(?:list\.)?reload\b/,
      `${file} must run the first load from onMounted — loading starts true and nothing else starts it`,
    )
  }
})

test('the error branch and its retry stay in the page itself, bound to reload', async () => {
  for (const file of ADMIN_LIST_PAGES) {
    const { script, template } = await sfc(file)
    assert.match(script, /const error\s*=\s*computed\(\s*\(\)\s*=>\s*list\.error\.value\s*\)/, `${file} must expose the list error as its own \`error\``)
    assert.match(script, /const reload\s*=\s*list\.reload\b/, `${file} must name the retry handler \`reload\` in this file`)
    assert.match(template, /v-else-if="error"/, `${file} must render the error branch`)
    assert.ok(template.includes('role="alert"'), `${file} must keep role="alert" on its error branch`)
    assert.match(template, /@click="reload(\(\))?"/, `${file} must offer a retry bound to reload`)
  }
})

test('the coverage gates still recognise migrated pages as fetching', async () => {
  for (const file of ADMIN_LIST_PAGES) {
    const { source } = await sfc(file)
    assert.match(source, ADMIN_FETCH_CALL, `${file} would drop out of the error/skeleton coverage gates`)
  }
})
