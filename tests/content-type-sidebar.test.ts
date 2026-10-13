import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

/**
 * `ContentTypeListSection.vue` had grown to 705 lines; its right-hand rail (most read,
 * categories, hotline, quick tools) is purely presentational, so it moved to
 * `content-type/ContentTypeSidebar.vue` verbatim. The page's rendered DOM was
 * compared before and after on three pages (identical) and the category buttons
 * were clicked in a real browser; these checks keep the wiring from being undone.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const parent = read('../app/components/ContentTypeListSection.vue')
const child = read('../app/components/content-type/ContentTypeSidebar.vue')
const childSfc = parse(child, { filename: 'ContentTypeSidebar.vue' })
const parentSfc = parse(parent, { filename: 'ContentTypeListSection.vue' })

test('the parent no longer holds the rail and passes the sidebar everything it shows', () => {
  const template = parentSfc.descriptor.template?.content ?? ''
  assert.doesNotMatch(template, /<aside/, 'the rail is back in the parent')
  const tag = template.match(/<ContentTypeSidebar[\s\S]*?\/>/)?.[0] ?? ''
  assert.ok(tag, 'the parent must render <ContentTypeSidebar>')
  for (const binding of [':type-slug="typeSlug"', ':most-read="mostRead"', ':most-read-pending="mostReadPending"', ':root-categories="rootCategories"', ':active-category="activeCategory"', '@select-category="setCategory"']) {
    assert.ok(tag.includes(binding), `missing ${binding}`)
  }
})

test('the sidebar is stateless: props in, one event out, no data fetching of its own', () => {
  const script = childSfc.descriptor.scriptSetup?.content ?? ''
  assert.match(script, /defineEmits<\{ 'select-category': \[slug: string\] \}>\(\)/)
  assert.doesNotMatch(script, /useAsyncData|\$fetch|useRoute|navigateTo|ref\(|watch\(/, 'the rail must not grow state or navigation')
  const template = childSfc.descriptor.template?.content ?? ''
  assert.match(template, /<aside\b/)
  assert.equal((template.match(/\$emit\('select-category'/g) ?? []).length, 2, '"all" and each category')
})

test('the category buttons keep their accessible text and the most-read skeleton keeps its status role', () => {
  const template = childSfc.descriptor.template?.content ?? ''
  assert.match(template, /role="status" aria-busy="true"/)
  assert.match(template, /motion-reduce:animate-none/)
  assert.match(template, /t\('n_most_read_short'\)/)
  assert.match(template, /t\('n_category_widget'\)/)
})

test('the page is under the size the project asks files to stay near', () => {
  assert.ok(parent.split('\n').length < 600, 'ContentTypeListSection grew back')
})
