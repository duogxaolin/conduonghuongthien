/**
 * Source guards for the public pages split in wave3 4.2 whose parts sit in their own
 * directory (`/news` → components/news/, `/profile` → components/reader-profile/): the
 * parts render only — no request, no navigation — and the page keeps every loading /
 * error + retry branch it had.
 *
 * Why it matters: the error card, its `role="alert"` and its "Thử lại" call the page's own
 * request (`refresh()` of the list); a part that fetched for itself would bring a failure
 * the page never shows and a second request per view the list's tests do not count. The
 * page's behaviour is pinned by tests/news-index-page.test.ts (mounting the real page and
 * its parts); this file pins the boundary, read from the family's directory
 * (tests/_component-family.ts), so a part added later is checked without editing it.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { NEWS_PAGE_FAMILY, READER_PROFILE_FAMILY, familyFiles, familyVueFiles, readAppFile } from './_component-family.ts'

/**
 * A request or a navigation. `publicFetch` (D-FETCH lot G) is the typed `$fetch` of the
 * public site: a part calling it requests exactly as one calling `$fetch` would.
 */
const SIDE_EFFECT = /\$fetch\b|\bpublicFetch\b|\buseFetch\b|\buseAsyncData\b|\bnavigateTo\b|\buseRoute\b|\buseRouter\b|\busePublicArticleList\b|\busePublicMostRead\b/

const templateOf = (source: string) => source.slice(source.indexOf('<template>'), source.lastIndexOf('</template>'))

/** Comments removed: the parts' doc comments name the page's composables to say they are not theirs. */
const code = (source: string) => source
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

describe('/news — the wave3 4.2 parts', () => {
  const family = NEWS_PAGE_FAMILY
  const offenders = (overrides?: Record<string, string>) =>
    familyFiles(family, overrides).filter(f => f.file !== family.parent && SIDE_EFFECT.test(code(f.source))).map(f => f.file)
  const vHtml = (overrides?: Record<string, string>) =>
    familyVueFiles(family, overrides).filter(f => /\bv-html\b|innerHTML/.test(f.source)).map(f => f.file)

  it('the parts and the helper module request nothing and navigate nowhere', () => {
    assert.deepEqual(offenders(), [])
  })

  it('the page keeps the requests, the list skeleton, the error card and its retry', () => {
    const page = readAppFile(family.parent)
    const template = templateOf(page)
    assert.match(page, /usePublicArticleList\(/)
    assert.match(page, /usePublicMostRead\(/)
    assert.match(page, /useAsyncData\(/, 'the categories are read by the page')
    assert.match(template, /<div v-if="pending" role="status" aria-busy="true"/)
    assert.match(template, /v-else-if="loadError"\s+role="alert"/)
    assert.match(template, /@click="refresh\(\)"/)
    // The list's card, and "Đọc nhiều" failing (FINDING-N3) with its own retry.
    assert.equal(template.match(/role="alert"/g)?.length, 2, 'every error branch stays in the page')
    assert.match(template, /v-else-if="mostReadFailed" role="alert"/)
    assert.match(template, /@click="retryMostRead\(\)"/)
    assert.match(template, /<div v-if="catPending" role="status" aria-busy="true"/, 'the filter bar\'s loading chips stay in the page')
    assert.match(template, /<div v-if="mostReadPending" role="status" aria-busy="true"/, '"Đọc nhiều" skeleton stays in the page')
  })

  it('no file of the family renders HTML', () => {
    assert.deepEqual(vHtml(), [])
  })

  it('proof: a request or a navigation planted in a part, in the helper or in a new part is caught; so is v-html', () => {
    const part = 'components/news/NewsCategoryPills.vue'
    for (const planted of [
      "const r = await $fetch('/api/public/categories')",
      "const r = await publicFetch<unknown>('/api/public/categories')",
      "const { data } = useAsyncData('x', () => Promise.resolve(1))",
      "navigateTo('/news/x')",
      'const route = useRoute()',
    ]) {
      const source = readAppFile(part).replace('</script>', `${planted}\n</script>`)
      assert.deepEqual(offenders({ [part]: source }), [part], planted)
    }
    const util = 'utils/news/list-display.ts'
    assert.deepEqual(offenders({ [util]: `${readAppFile(util)}\nexport const leak = () => $fetch('/x')\n` }), [util])
    const added = `${family.partsDir}/NewsExtra.vue`
    assert.deepEqual(offenders({ [added]: '<script setup lang="ts">\nconst route = useRoute()\n</script>' }), [added])

    const grid = 'components/news/NewsArticleGrid.vue'
    assert.deepEqual(vHtml({ [grid]: readAppFile(grid).replace('{{ item.title }}', '<span v-html="item.title"></span>') }), [grid])
  })
})

/**
 * `/profile` (the reader's page): every load stays on the page, inside `<client-only>`,
 * after mount (tests/reader-profile-page.test.ts pins those chains); the writes went to
 * three composables that RECEIVE the request — so neither the composables nor the parts
 * call `$fetch` or touch the reader's identity/notifications/history stores themselves.
 * A part that did would read the module state of `useReaderAuth` on its own, outside the
 * page's 401 handling.
 */
describe('/profile — the wave3 4.2 parts and write composables', () => {
  const family = READER_PROFILE_FAMILY
  // The stores by CALL: a part imports their types (`import type { NotificationItem } from
  // '~/composables/useReaderNotifications'`), which reads nothing.
  const READER_STATE = /\$fetch\b|\bpublicFetch\b|\buseFetch\b|\buseAsyncData\b|\bnavigateTo\b|\buseReaderAuth\(|\buseReaderNotifications\(|\buseReadingHistory\(|\blocalStorage\b|\bsessionStorage\b/
  const offenders = (overrides?: Record<string, string>) =>
    familyFiles(family, overrides).filter(f => f.file !== family.parent && READER_STATE.test(code(f.source))).map(f => f.file)

  it('parts and composables neither request nor reach the reader stores', () => {
    assert.deepEqual(offenders(), [])
  })

  it('the page keeps the identity, the three loads and their error branches', () => {
    const page = readAppFile(family.parent)
    const template = templateOf(page)
    assert.match(page, /useReaderAuth\(\)/)
    assert.match(page, /useReaderNotifications\(\)/)
    assert.match(page, /useReadingHistory\(\)/)
    // D-FETCH lot G: the four requests became `publicFetch<…>(…)` calls; they stay on the page.
    assert.equal(page.match(/\bpublicFetch<[^>]+>\(/g)?.length, 4, 'the four requests (two loads, two writes handed to the composables) stay on the page')
    assert.equal(page.match(/\$fetch\b/g), null, 'no bare or cast $fetch left on the page')
    assert.equal(template.match(/role="alert"/g)?.length, 3, 'notifications, comments and chats: every load error branch stays in the page')
  })

  it('proof: a request or a store read planted in a part, in a composable or in a new part is caught', () => {
    const part = 'components/reader-profile/ReaderProfileChatClaim.vue'
    for (const planted of ["void $fetch('/api/public/reader/chats')", "void publicFetch<unknown>('/api/public/reader/chats')", 'const { reader } = useReaderAuth()', "localStorage.getItem('cdkt_sessions_v1')"]) {
      assert.deepEqual(offenders({ [part]: readAppFile(part).replace('</script>', `${planted}\n</script>`) }), [part], planted)
    }
    const composable = 'composables/useReaderNameEdit.ts'
    assert.deepEqual(offenders({ [composable]: `${readAppFile(composable)}\nexport const leak = () => $fetch('/api/public/reader/profile')\n` }), [composable])
    const added = `${family.partsDir}/ReaderProfileExtra.vue`
    assert.deepEqual(offenders({ [added]: '<script setup lang="ts">\nconst n = useReaderNotifications()\n</script>' }), [added])
  })
})
