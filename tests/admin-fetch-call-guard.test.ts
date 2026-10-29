/**
 * `fetchesData` (tests/_admin-fetch-call.ts) — what the error/retry and skeleton directory gates
 * count as "this admin view fetches". Decided on CODE: a comment quoting `adminFetch(…)` no longer
 * keeps a view in the scan after its code stopped fetching, and handing the fetcher on as a value
 * (`request: adminFetch`, ChunkedUploader.vue) counts (verifier lô F, L1 / V20).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { fetchesData, stripComments } from './_admin-fetch-call.ts'

test('code that fetches counts, whatever the position of adminFetch', () => {
  for (const code of [
    'const r = await adminFetch<T>(url)',
    'useMediaUploadSession({ request: adminFetch })',
    'const list = useAdminList<Row, F>({})',
    "const b = await $fetch('/api/x')",
    "const u = 'https://example.vn/a'; const r = await $fetch(u)",
    'const { data } = await useAsyncData(key, fn)',
  ]) assert.equal(fetchesData(code), true, code)
})

test('a comment that only quotes a fetch does not count', () => {
  for (const prose of [
    '// request: (url, options) => adminFetch(url, options)\nconst request = reject',
    '/** Calls `adminFetch(url)` and `$fetch` — see D-FETCH. */\nconst x = 1',
    '<template><!-- $fetch, adminFetch(…) --><div /></template>',
    '  /* useAdminList<T>() */ const y = 2',
  ]) assert.equal(fetchesData(prose), false, prose)
})

test('stripping keeps code next to URLs and drops line comments', () => {
  assert.equal(stripComments("const u = 'https://a.vn' // nhận xét"), "const u = 'https://a.vn' ")
  assert.equal(stripComments('a: 1, // adminFetch(x)\nb: 2'), 'a: 1, \nb: 2')
})

test('the real ChunkedUploader (hands adminFetch to the upload session) is a view that fetches', () => {
  const source = readFileSync(new URL('../app/components/admin/ChunkedUploader.vue', import.meta.url), 'utf8')
  assert.match(source, /request: adminFetch,/)
  assert.equal(fetchesData(source), true)
})
