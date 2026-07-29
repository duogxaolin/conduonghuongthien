import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from '@vue/compiler-sfc'

const source = await readFile(new URL('../app/pages/admin/chatbot/knowledge/index.vue', import.meta.url), 'utf8')
const sfc = parse(source, { filename: 'app/pages/admin/chatbot/knowledge/index.vue' })
const script = sfc.descriptor.scriptSetup?.content ?? ''
const template = sfc.descriptor.template?.content ?? ''

test('knowledge import SFC parses and maps stable stage and raw labels', () => {
  assert.equal(sfc.errors.length, 0)
  assert.match(script, /parse: 'Đọc tệp'/)
  assert.match(script, /save: 'Lưu dữ liệu'/)
  assert.match(script, /publish: 'Xuất bản'/)
  for (const label of ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú']) assert.ok(script.includes(label))
})

test('import report renders accessible scrollable red cards with ranges and stable keys', () => {
  assert.match(template, /role="alert"/)
  assert.match(template, /aria-live="polite"/)
  assert.match(template, /overflow-y-auto/)
  assert.match(template, /border-\[#e4a4a1\]/)
  assert.match(template, /importRowLabel\(e\)/)
  assert.match(template, /importStageLabel\[e\.stage\]/)
  assert.match(template, /:key="`\$\{e\.row\}-\$\{e\.endRow\}-\$\{e\.stage\}-\$\{e\.code\}`"/)
})

test('raw previews preserve line breaks, wrap safely, and expose truncation', () => {
  assert.match(template, /whitespace-pre-wrap/)
  assert.match(template, /break-words/)
  assert.match(template, /importRawFields\(e\)/)
  assert.match(template, /importFieldTruncated\(e, field\)/)
  assert.match(template, /đã rút gọn/)
  assert.doesNotMatch(template, /v-html/)
})

test('summary distinguishes clean, partial, and failed imports', () => {
  assert.match(template, /importResult\.errors\?\.length/)
  assert.match(template, /importResult\.imported \? 'border-\[#e8c56f\]/)
  assert.match(template, /border-\[#f1b8b5\]/)
  assert.match(template, /border-\[#8ed694\]/)
  assert.match(template, /chưa nhập/)
})

test('modal remains usable after a partial result', () => {
  assert.match(template, /@change="onImportFile"/)
  assert.match(template, /@click="closeImport"/)
  assert.match(template, /@click="runImport"/)
  assert.doesNotMatch(template, /v-if="!importResult"[^>]*>\s*<label[^>]*>Chọn tệp/)
})
