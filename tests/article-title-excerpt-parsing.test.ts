import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTitleAndExcerpt } from '../server/services/article-translations.ts'

test('parseTitleAndExcerpt — handles clean JSON', () => {
  const raw = '{"translatedTitle": "Ninh Binh Program", "translatedExcerpt": "Support for ex-convicts"}'
  const res = parseTitleAndExcerpt(raw)
  assert.equal(res.title, 'Ninh Binh Program')
  assert.equal(res.excerpt, 'Support for ex-convicts')
})

test('parseTitleAndExcerpt — handles markdown fenced JSON', () => {
  const raw = '```json\n{"translatedTitle": "French Title", "translatedExcerpt": "French Excerpt"}\n```'
  const res = parseTitleAndExcerpt(raw)
  assert.equal(res.title, 'French Title')
  assert.equal(res.excerpt, 'French Excerpt')
})

test('parseTitleAndExcerpt — fixes contaminated prompt text reported by user', () => {
  const raw = `Keep HTML if present.
Return JSON:
{"translatedTitle":"...","translatedExcerpt":"..."}

[TITLE]: Ninh Binh launches program to help ex-convicts return home and pursue their dreams.
[EXCERPT]: Ninh Binh Provincial Police, the Vietnam Fatherland Front Committee, the Department of Home Affairs, and the Policy Bank have signed a coordination program (No. 89/CTrPH-CAT-UBMTTQVNT-SNV-CNNHCSXHT) on June 16, 2026, aimed at providing support and assistance to individuals who have completed their prison sentences.`

  const res = parseTitleAndExcerpt(raw, 'Tiêu đề gốc', 'Tóm tắt gốc')
  assert.equal(res.title, 'Ninh Binh launches program to help ex-convicts return home and pursue their dreams.')
  assert.equal(
    res.excerpt,
    'Ninh Binh Provincial Police, the Vietnam Fatherland Front Committee, the Department of Home Affairs, and the Policy Bank have signed a coordination program (No. 89/CTrPH-CAT-UBMTTQVNT-SNV-CNNHCSXHT) on June 16, 2026, aimed at providing support and assistance to individuals who have completed their prison sentences.',
  )
})

test('parseTitleAndExcerpt — handles tagged format without JSON', () => {
  const raw = `[TIÊU ĐỀ]: Chương trình hỗ trợ tái hòa nhập
[TÓM TẮT]: Công an tỉnh Ninh Bình phối hợp các đơn vị.`
  const res = parseTitleAndExcerpt(raw)
  assert.equal(res.title, 'Chương trình hỗ trợ tái hòa nhập')
  assert.equal(res.excerpt, 'Công an tỉnh Ninh Bình phối hợp các đơn vị.')
})

test('parseTitleAndExcerpt — handles empty or whitespace input safely', () => {
  const res = parseTitleAndExcerpt('', 'Tiêu đề gốc', 'Tóm tắt gốc')
  assert.equal(res.title, '')
  assert.equal(res.excerpt, '')
})

test('parseTitleAndExcerpt — strips outer quotes and leading colons', () => {
  const raw = '{"translatedTitle": ": \\"Clean Title\\"", "translatedExcerpt": "\'Clean Excerpt\'"}'
  const res = parseTitleAndExcerpt(raw)
  assert.equal(res.title, 'Clean Title')
  assert.equal(res.excerpt, 'Clean Excerpt')
})
