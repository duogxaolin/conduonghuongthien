import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The public pages were built by copy-and-paste: four article-detail pages and
 * three news-category pages, each a near-identical copy that had already
 * drifted apart. The copies also each carried a private, local-time date
 * formatter, so the same article could show a different day server-side than
 * in the browser.
 *
 * These tests pin the shape those pages were consolidated into. They are
 * source assertions rather than render assertions because mounting a Nuxt page
 * needs the whole app runtime; what matters here is that a future edit cannot
 * silently re-fork the markup or reintroduce the timezone bug.
 */

const appRoot = new URL('../app/', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, appRoot), 'utf8')

const DETAIL_PAGES = [
  'pages/news/[id].vue',
  'pages/news/[category]/[slug].vue',
  'pages/role-models/[id].vue',
  'pages/reintegration-models/[id].vue',
]

const CATEGORY_PAGES = [
  'pages/news/local-news.vue',
  'pages/news/activity-news.vue',
  'pages/news/featured-news.vue',
]

// ─── Article detail consolidation ────────────────────────────────────────────
test('every article-detail page delegates to the shared component', () => {
  for (const page of DETAIL_PAGES) {
    const source = read(page)
    assert.match(source, /<ArticleDetail/, `${page} no longer uses ArticleDetail`)
    assert.doesNotMatch(source, /useFetch\(/, `${page} fetches on its own again`)
    assert.doesNotMatch(source, /useSeoMeta\(/, `${page} sets its own SEO meta again`)
    assert.doesNotMatch(source, /v-html/, `${page} renders article HTML directly again`)
  }
})

test('the detail wrappers stay thin instead of re-forking the markup', () => {
  for (const page of DETAIL_PAGES) {
    const lines = read(page).split('\n').length
    assert.ok(lines <= 45, `${page} has grown back to ${lines} lines — markup is being re-forked`)
  }
})

test('each detail wrapper still passes the labels that distinguish it', () => {
  const required = ['back-to', 'back-label', 'seo-fallback-title', 'seo-fallback-description']
  for (const page of DETAIL_PAGES) {
    const source = read(page)
    for (const prop of required) {
      assert.match(source, new RegExp(`${prop}=`), `${page} stopped passing ${prop}`)
    }
  }
})

test('the shared detail component keeps loading, error, found and not-found states', () => {
  const source = read('components/ArticleDetail.vue')
  assert.match(source, /v-if="pending"/, 'skeleton state lost')
  assert.match(source, /v-else-if="loadError"/, 'load-failure state lost')
  assert.match(source, /v-else-if="article"/, 'article state lost')
  assert.match(source, /<div v-else class="py-10 text-center">/, 'not-found state lost')
  // A 404 from the API must stay distinguishable from a transport failure,
  // otherwise an unpublished article offers the visitor a pointless retry.
  assert.match(source, /const loadError = computed\(\(\) => !!error\.value\)/)
})

test('the shared detail component resolves the category label by precedence', () => {
  const source = read('components/ArticleDetail.vue')
  assert.match(source, /a\.categoryName \|\| props\.typeLabels\[a\.type\] \|\| props\.categoryFallback/)
})

// ─── The timezone bug the consolidation removed ──────────────────────────────
test('no public page formats a date in local time', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(new URL(dir, appRoot), { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.vue')) {
        const source = readFileSync(new URL(path, appRoot), 'utf8')
        // getDate/getMonth/getFullYear read the *runtime* timezone; the server
        // and the visitor's browser can disagree by a day.
        if (/\.get(Date|Month|FullYear)\(\)/.test(source)) offenders.push(path)
      }
    }
  }
  walk('pages/')
  walk('components/')
  assert.deepEqual(offenders, [], `local-time date formatting reintroduced in: ${offenders.join(', ')}`)
})

test('the shared components format dates through the UTC-safe helper', () => {
  for (const file of ['components/ArticleDetail.vue', 'components/NewsCategoryList.vue']) {
    assert.match(read(file), /import \{ formatDateVN \} from '~\/utils\/formatDate'/, `${file} stopped using formatDateVN`)
  }
})

// ─── News category consolidation ─────────────────────────────────────────────
test('the news category pages remain wrappers around one listing component', () => {
  for (const page of CATEGORY_PAGES) {
    const source = read(page)
    assert.match(source, /<NewsCategoryList/, `${page} no longer uses NewsCategoryList`)
    assert.ok(source.split('\n').length <= 25, `${page} has grown its own markup back`)
  }
})

// ─── Accordion accessibility ─────────────────────────────────────────────────
test('the FAQ accordion announces its state to assistive technology', () => {
  const source = read('pages/legal-qa/index.vue')
  assert.match(source, /:aria-expanded="activeIndex === index"/, 'accordion state is invisible to screen readers')
  assert.match(source, /:aria-controls="`faq-answer-\$\{item\.id\}`"/, 'button is not linked to its panel')
  assert.match(source, /:id="`faq-answer-\$\{item\.id\}`"/, 'panel has no id to be controlled by')
  assert.match(source, /type="button"/, 'accordion toggle can submit a surrounding form')
  // The APG warns against landmark proliferation; this list renders up to 50 panels.
  assert.doesNotMatch(source, /role="region"/, 'every open FAQ panel now registers a landmark')
})

test('the accordion +/− glyph is not read out as content', () => {
  const source = read('pages/legal-qa/index.vue')
  assert.match(source, /\{\{ activeIndex === index \? '−' : '\+' \}\}<\/span>/)
  const glyphLine = source.split('\n').find(line => line.includes("'−' : '+'")) ?? ''
  assert.match(glyphLine, /aria-hidden="true"/, 'the decorative toggle glyph is announced')
})

test('keyboard users get a visible focus ring on the accordion', () => {
  assert.match(read('pages/legal-qa/index.vue'), /focus-visible:ring-2/)
})
