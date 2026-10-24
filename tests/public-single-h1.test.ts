import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { blocksRenderOwnH1 } from '../app/utils/blocks/page-heading'

/**
 * Exactly one `<h1>` per public page (spec public-accessibility, design D22).
 *
 * The site brand in the header was an `<h1>` on every page, so every article,
 * list and media page had two — and the home page three (brand, a screen-reader
 * `<h1>`, the hero title). Screen-reader users navigating by heading landed on
 * the brand first everywhere. Now the brand is a `<p>` with the same classes;
 * block pages add a screen-reader `<h1>` only when no block renders one.
 * Browser proof: `tests/e2e/public-single-h1.spec.ts`.
 */

const read = (path: string) => readFileSync(new URL(`../app/${path}`, import.meta.url), 'utf8')

test('the header brand is not a heading, and keeps its classes', () => {
  const header = read('components/layout/DefaultHeader.vue').replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(header, /<h1\b/)
  const brand = /<p class="([^"]*)">CON ĐƯỜNG HƯỚNG THIỆN<\/p>/.exec(header)
  assert.ok(brand, 'brand line not found')
  // Same classes as the heading it replaces — the line must look identical.
  assert.equal(brand[1], 'text-[0.82rem] sm:text-[0.95rem] lg:text-[1.35rem] font-extrabold text-[#4A6741] tracking-[0.2px] sm:tracking-[0.5px] leading-[1.2] whitespace-nowrap')
})

test('a hero block anywhere in the visible tree supplies the page heading', () => {
  assert.equal(blocksRenderOwnH1([]), false)
  assert.equal(blocksRenderOwnH1([{ id: 1, blockType: 'heading', data: {} }, { id: 2, blockType: 'news', data: {} }]), false)
  assert.equal(blocksRenderOwnH1([{ id: 1, blockType: 'hero', data: {} }]), true)
  // Inside a section → row → column.
  assert.equal(blocksRenderOwnH1([{
    id: 1, blockType: 'section', data: {}, children: [{
      id: 2, blockType: 'row', data: {}, children: [{ id: 3, blockType: 'column', data: {}, children: [{ id: 4, blockType: 'hero', data: {} }] }],
    }],
  }]), true)
  // A hidden hero renders nothing, so it supplies no heading either.
  assert.equal(blocksRenderOwnH1([{ id: 1, blockType: 'hero', data: {}, isVisible: false }]), false)
  assert.equal(blocksRenderOwnH1([{ id: 1, blockType: 'section', data: {}, isVisible: false, children: [{ id: 2, blockType: 'hero', data: {} }] }]), false)
})

test('block pages render a screen-reader <h1> only when no block renders one', () => {
  for (const page of ['pages/index.vue', 'pages/about.vue', 'pages/contact.vue', 'pages/[slug].vue']) {
    const source = read(page)
    const srOnly = /<h1 v-if="([^"]*)" class="sr-only">/.exec(source)
    assert.ok(srOnly, `${page}: block pages have no <h1> at all once the brand is not a heading`)
    assert.match(srOnly[1]!, /!pageHasOwnH1/, `${page}: the screen-reader <h1> doubles the hero title`)
    assert.match(source, /blocksRenderOwnH1\(blocks\.value\)/)
  }
})
