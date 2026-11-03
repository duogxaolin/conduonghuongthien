import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildMostReadQuery, listDataKey } from '../app/utils/public-article-list'

/**
 * The "Đọc nhiều" sidebar of the news category pages follows the language
 * (design D25).
 *
 * `NewsCategoryList.vue` fetched it under the constant key
 * `'news-category-most-read'` with no `lang` in the query: an English reader got
 * Vietnamese titles, and — the key being constant — whatever language was
 * fetched first stayed in Nuxt's payload cache for every later visit in the
 * session, even after switching. The other list pages already used
 * `usePublicMostRead`, which keys on the full query including `lang`.
 */

test('the most-read key changes with the language, so Nuxt fetches again', () => {
  const vi = buildMostReadQuery('news', 'vi')
  const en = buildMostReadQuery('news', 'en')
  assert.equal(en.lang, 'en')
  assert.equal(en.type, 'news')
  assert.equal(en.sort, 'views')
  assert.notEqual(
    listDataKey('public-articles-most-read', vi),
    listDataKey('public-articles-most-read', en),
  )
})

test('NewsCategoryList uses the shared, language-keyed most-read loader', () => {
  const source = readFileSync(new URL('../app/components/NewsCategoryList.vue', import.meta.url), 'utf8')
  const script = source.slice(source.indexOf('<script setup'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.match(script, /usePublicMostRead\('news', currentLang\)/)
  assert.doesNotMatch(script, /'news-category-most-read'/, 'a constant key replays one language to every visitor in the session')
  // Exactly one fetch of `sort: 'views'` — no hand-written copy beside the loader.
  assert.doesNotMatch(script, /sort: 'views'/)
})
