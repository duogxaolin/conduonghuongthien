import assert from 'node:assert/strict'
import test from 'node:test'
import { baselinePath, ratchet, readBaseline, type FileRatchet } from './_ratchet'

/**
 * `$fetch`-cast ratchet (wave3-long-term D-R, task 1.3).
 *
 * Counts hand-written casts of `$fetch` — `($fetch as (url: string) => Promise<{…}>)` —
 * per `.vue`/`.ts` file under `app/`, `server/` and `shared/`. Each one restates a
 * response type at the call site. New code calls `adminFetch<T>()` or `useAdminList`
 * (app/composables/adminFetch.ts, useAdminList.ts) instead, so a new file starts at 0;
 * D-FETCH converts the existing call sites area by area and lowers the baseline.
 *
 * The match is `(` `$fetch` `as`, with any whitespace between, so a reformatted cast
 * still counts. Tests, docs and CLAUDE.md quote the pattern and are not measured.
 *
 * Named entry: `app/composables/adminFetch.ts` holds the one sanctioned cast plus the doc
 * comment that quotes the pattern it replaces (2).
 *
 * Baseline: tests/ratchets/fetch-casts.baseline.json. Regenerate (lowers only):
 *   node --experimental-strip-types --import ./scripts/ts-resolver.mjs tests/ratchets/fetch-casts.test.ts --update
 */

const FETCH_CAST = /\(\s*\$fetch\s+as\b/g

export const FETCH_CASTS: FileRatchet = {
  name: 'fetch-casts',
  unit: '`($fetch as` casts',
  defaultForNewFiles: 0,
  inScope: file => /^(?:app|server|shared)\/.+\.(?:vue|ts)$/.test(file),
  measure: text => text.match(FETCH_CAST)?.length ?? 0,
  hint: 'Call `adminFetch<T>(url, options)` or `useAdminList` (app/composables/adminFetch.ts, useAdminList.ts) instead of casting `$fetch` (design D-FETCH).',
}

ratchet(FETCH_CASTS, () => {
  test('fetch-casts: counts a cast however it is spaced, and nothing else', () => {
    const sample = [
      'const a = await ($fetch as (u: string) => Promise<{ ok: boolean }>)(url)',
      'const b = await (\n  $fetch  as unknown as Fetcher)(url)',
      'const c = await $fetch<Thing>(url)',
      'const d = await $fetch(url) as Thing',
      'const e = await ($fetchAll as Fetcher)(url)',
    ].join('\n')
    assert.equal(FETCH_CASTS.measure(sample, 'app/x.vue'), 2)
  })

  test('fetch-casts: measures app/, server/ and shared/ code only', () => {
    for (const file of ['app/pages/admin/index.vue', 'app/composables/useUpload.ts', 'server/api/auth/google/callback.get.ts', 'shared/x.ts']) {
      assert.ok(FETCH_CASTS.inScope(file), file)
    }
    for (const file of ['tests/admin-list.test.ts', 'docs/CHANGELOG.md', 'CLAUDE.md', 'scripts/x.ts', 'openspec/x.ts']) {
      assert.ok(!FETCH_CASTS.inScope(file), file)
    }
  })

  test('fetch-casts: the new admin helpers and the pilot pages have no cast', () => {
    // Wave 2 (D-FETCH): adminFetch is the one place the assertion lives; useAdminList
    // and the pilot pages go through it. If one of them grows a cast, the helper failed.
    const baseline = readBaseline(baselinePath(FETCH_CASTS.name))
    const adminFetch = baseline['app/composables/adminFetch.ts']
    assert.ok(adminFetch && typeof adminFetch === 'object' && adminFetch.value <= 2 && adminFetch.reason.trim() !== '',
      'app/composables/adminFetch.ts must stay a named entry (its one cast plus the doc comment), with its reason')
    // Absent from the baseline = capped at 0 by the ratchet test above.
    for (const file of ['app/composables/useAdminList.ts', 'app/pages/admin/comments/index.vue', 'app/pages/admin/readers/index.vue',
      'app/pages/admin/chatbot/sessions/index.vue']) {
      assert.equal(baseline[file], undefined, `${file} is in the fetch-cast baseline; it should have no cast`)
    }
  })
})
