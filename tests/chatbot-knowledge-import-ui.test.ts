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

/**
 * `rawExtraColumns` is an ARRAY of `{ column, value }`, not a string. It used to
 * fall through the scalar `importRawFields` loop, so the operator saw serialized
 * JSON under the literal key name "rawExtraColumns" instead of a readable
 * "Cột E: …" line — precisely the diagnostic that tells them which stray column
 * broke the row.
 */
test('unmapped extra columns render as readable per-column entries, not raw JSON', () => {
  // Excluded from the scalar list, so the array can never be stringified into a <dd>.
  assert.match(script, /function importRawFields[\s\S]*?field !== 'rawExtraColumns'/)
  // Rendered from its own helper, labelled by spreadsheet column letter.
  assert.match(script, /function importExtraColumns\(/)
  assert.match(script, /`Cột \$\{entry\?\.column \|\| '\?'\}`/)
  assert.match(template, /importExtraColumns\(e\)\.length/)
  assert.match(template, /v-for="\(entry, index\) in importExtraColumns\(e\)"/)
  assert.match(template, /importExtraColumnLabel\(entry\)/)
  assert.match(template, /\{\{ entry\.value \}\}/)
})

test('extra-column values keep line structure, wrap, and stay escaped by Vue', () => {
  const block = template.match(/<section v-if="importExtraColumns\(e\)\.length"[\s\S]*?<\/section>/)?.[0] ?? ''
  assert.ok(block, 'the unmapped-column block must exist')
  assert.match(block, /whitespace-pre-wrap/)
  assert.match(block, /break-words/)
  // Interpolation only: a stray column may carry attacker-controlled text.
  assert.doesNotMatch(block, /v-html/)
})

/**
 * The server emits two DIFFERENT truncation keys: the indexed
 * `rawExtraColumns.<i>.value` when one column's value was clipped, and the bare
 * `rawExtraColumns` when whole columns were dropped. Matching only the bare key
 * left every clipped value looking complete.
 */
test('truncation badges match the indexed key the server actually sends', () => {
  assert.match(script, /function importExtraColumnTruncated[\s\S]*?`rawExtraColumns\.\$\{index\}\.value`/)
  assert.match(script, /function importExtraColumnsTruncated[\s\S]*?'rawExtraColumns'/)
  assert.match(template, /importExtraColumnTruncated\(e, index\)/)
  assert.match(template, /importExtraColumnsTruncated\(e\)/)
})

test('extra columns keep server order so positional truncation keys stay aligned', () => {
  // Filtering entries here would shift later indices and pin a badge to the
  // wrong column, so the helper must pass the array through untouched.
  const helper = script.match(/function importExtraColumns\(item: \w+\)[^\n]*/)?.[0] ?? ''
  assert.ok(helper)
  assert.doesNotMatch(helper, /\.filter\(/)
  assert.doesNotMatch(helper, /\.sort\(/)
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
