import assert from 'node:assert/strict'
import test from 'node:test'
import { slugify } from '../server/utils/slug'
import { normalizeBlocks, VERSION_LIMITS } from '../server/utils/page-versions'
import { clampColSpan, isValidBlockType, getDefaultData, BLOCK_TYPES } from '../app/utils/blocks/registry'
import { readFileSync } from 'node:fs'

/**
 * The page builder is the CMS surface an editor actually touches, and it is the
 * write path that feeds `v-html` on the public site. These tests pin the
 * behaviour that keeps a malformed or hostile payload from reaching the DB.
 */

// ─── Slugs ───────────────────────────────────────────────────────────────────
test('slugify transliterates Vietnamese and yields a URL-safe slug', () => {
  assert.equal(slugify('Tái hòa nhập cộng đồng'), 'tai-hoa-nhap-cong-dong')
  assert.equal(slugify('Đường lối & Chính sách'), 'duong-loi-chinh-sach')
  assert.equal(slugify('  Nhiều   khoảng   trắng  '), 'nhieu-khoang-trang')
})

test('slugify strips characters that would break a URL', () => {
  const slug = slugify('a/b?c#d&e%f<g>h"i')
  assert.match(slug, /^[a-z0-9-]*$/, `slug leaked unsafe characters: ${slug}`)
})

test('slugify degrades safely on empty and non-textual input', () => {
  assert.equal(slugify(''), '')
  assert.equal(slugify('!!!'), '')
})

// ─── Block tree normalisation (draft save / publish / version restore) ────────
function node(overrides: Record<string, unknown> = {}) {
  return { blockType: 'heading', data: { text: 'Xin chào' }, isVisible: true, ...overrides }
}

test('unknown block types are dropped together with their subtree', () => {
  const out = normalizeBlocks([
    node(),
    { blockType: 'evil_block', data: { x: 1 }, children: [node()] },
    node({ blockType: 'richtext' }),
  ])
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(b => b.blockType), ['heading', 'richtext'])
})

test('display order is re-sequenced per container, not globally flattened', () => {
  const out = normalizeBlocks([
    { blockType: 'section', data: {}, children: [node(), node(), node()] },
    node(),
  ])
  assert.deepEqual(out.map(b => b.displayOrder), [1, 2])
  assert.deepEqual(out[0].children!.map(b => b.displayOrder), [1, 2, 3])
})

test('column spans are clamped into the 12-column grid', () => {
  const out = normalizeBlocks([{ blockType: 'column', data: {}, colSpan: 99 }])
  assert.equal(out[0].colSpan, 12)
  assert.equal(normalizeBlocks([{ blockType: 'column', data: {}, colSpan: -5 }])[0].colSpan, 1)
  assert.equal(clampColSpan('nonsense'), 12)
})

test('pathological nesting is cut off rather than accepted', () => {
  // Build a tree far deeper than the Section > Row > Column > Element model.
  let deep: any = node()
  for (let i = 0; i < 20; i++) deep = { blockType: 'section', data: {}, children: [deep] }
  let depth = 0
  for (let cursor = normalizeBlocks([deep])[0]; cursor; cursor = cursor.children?.[0] as any) depth++
  assert.ok(depth <= 6, `tree accepted ${depth} levels of nesting`)
})

test('rich-text inside block data is sanitised during normalisation', () => {
  const out = normalizeBlocks([
    { blockType: 'richtext', data: { html: '<p onclick="alert(1)">x</p><script>alert(2)</script>' } },
    { blockType: 'content_aside', data: { bodyHtml: '<img src=x onerror=alert(1)>' } },
  ])
  const serialised = JSON.stringify(out)
  assert.ok(!/<script/i.test(serialised), 'script element survived normalisation')
  assert.ok(!/\son\w+\s*=/i.test(serialised), 'event handler survived normalisation')
  assert.ok(serialised.includes('<p>x</p>'), 'legitimate markup was destroyed')
})

test('non-array and malformed input never throws', () => {
  for (const input of [null, undefined, 'text', 42, {}, [null, 'x', 7]]) {
    assert.deepEqual(normalizeBlocks(input as unknown), [])
  }
})

test('isVisible defaults to true but an explicit false is preserved', () => {
  assert.equal(normalizeBlocks([node({ isVisible: undefined })])[0].isVisible, true)
  assert.equal(normalizeBlocks([node({ isVisible: false })])[0].isVisible, false)
})

// ─── Registry ────────────────────────────────────────────────────────────────
test('every registered block type validates and yields default data', () => {
  assert.ok(BLOCK_TYPES.length >= 15, `unexpectedly few block types: ${BLOCK_TYPES.length}`)
  for (const type of BLOCK_TYPES) {
    assert.ok(isValidBlockType(type), `registry type rejected by validator: ${type}`)
    assert.equal(typeof getDefaultData(type), 'object', `no default data for ${type}`)
  }
})

test('the block validator rejects anything outside the registry', () => {
  for (const type of ['', 'nope', '__proto__', 'constructor', 'HEADING']) {
    assert.equal(isValidBlockType(type), false, `validator accepted: ${type}`)
  }
})

test('version quotas leave room for the origin snapshot plus manual saves', () => {
  assert.equal(VERSION_LIMITS.origin, 1)
  assert.ok(VERSION_LIMITS.auto >= 1 && VERSION_LIMITS.manual >= 1)
})

// ─── One definition of the block tree ────────────────────────────────────────
test('the block tree shape is declared once and shared', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const types = read('app/utils/blocks/types.ts')
  assert.match(types, /export interface BlockNode/)
  assert.match(types, /export type BuilderNode/)

  // The server previously carried its own copy of the interface; the client
  // carried `any`. Either one drifting from the other silently corrupts a page
  // on save, so both must come from the shared module.
  const versions = read('server/utils/page-versions.ts')
  assert.match(versions, /export type SnapshotBlock = BlockNode/, 'the server redeclares the tree shape')
  assert.doesNotMatch(versions, /interface SnapshotBlock/)

  const builder = read('app/pages/admin/content/pages/[id].vue')
  assert.match(builder, /import type \{[^}]*BuilderNode[^}]*\} from '~\/utils\/blocks\/types'/)
  assert.doesNotMatch(builder, /const blocks = ref<any\[\]>/, 'the builder holds an untyped tree again')
})

test('the JSON columns holding block trees declare what is in them', () => {
  const schema = readFileSync(new URL('../server/db/schema.ts', import.meta.url), 'utf8')
  for (const column of ['published_blocks', 'draft_blocks']) {
    assert.match(
      schema,
      new RegExp(`json\\('${column}'\\)\\.\\$type<BlockNode\\[\\]>`),
      `${column} is back to an untyped json column`,
    )
  }
  assert.match(schema, /json\('blocks'\)\.notNull\(\)\.\$type<BlockNode\[\]>/)
})
