import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { extractKeywords } from '../server/utils/chatbot/keywords'
import { diagnoseQaGrid, parseQaWorkbookDiagnostics, readCsvGrid, gridToQaRows, parseQaWorkbook, readXlsxGrid, XlsxError } from '../server/utils/xlsx-reader'
import { retrieveKnowledge, type RetrievalEntry } from '../server/utils/chatbot/retrieval'

/**
 * Operators bulk-load the knowledge bank from a Q&A spreadsheet
 * (STT / Câu hỏi / Trả lời / Ghi chú). Keywords are derived from each question
 * so that a visitor phrasing things casually still matches the right entry.
 */

// ─── Minimal .xlsx writer (test fixture only) ────────────────────────────────
function zip(files: Array<{ name: string; content: string }>): Buffer {
  const encoder = new TextEncoder()
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  for (const file of files) {
    const raw = Buffer.from(encoder.encode(file.content))
    const compressed = deflateRawSync(raw)
    const nameBuf = Buffer.from(file.name, 'utf8')
    const crc = crc32(raw)

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)
    locals.push(local, compressed)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)

    offset += local.length + compressed.length
  }

  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

function workbook(rows: string[][]): Buffer {
  const shared: string[] = []
  const indexOf = (value: string) => {
    const found = shared.indexOf(value)
    if (found >= 0) return found
    shared.push(value)
    return shared.length - 1
  }
  const body = rows.map((row, r) => {
    const cells = row.map((value, c) =>
      `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="s"><v>${indexOf(value)}</v></c>`).join('')
    return `<row r="${r + 1}">${cells}</row>`
  }).join('')
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return zip([
    { name: 'xl/sharedStrings.xml', content: `<sst>${shared.map(s => `<si><t>${escape(s)}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', content: `<worksheet><sheetData>${body}</sheetData></worksheet>` },
  ])
}

const SAMPLE = [
  ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'],
  ['1', 'Việc xoá án tích đối với người chấp hành xong án phạt tù như thế nào?', 'Trả lời về xoá án tích.', 'Điều 70 BLHS'],
  ['2', 'Trách nhiệm của Ủy ban nhân dân cấp xã trong công tác tái hòa nhập cộng đồng?', 'Trả lời về UBND cấp xã.', ''],
  ['3', 'Chính sách tín dụng, vay vốn ngân hàng đối với người chấp hành xong án phạt tù?', 'Trả lời về vay vốn.', 'QĐ 22/2023'],
]

// ─── Spreadsheet parsing ─────────────────────────────────────────────────────
test('an .xlsx workbook is parsed into Q&A rows', () => {
  const rows = parseQaWorkbook(workbook(SAMPLE))
  assert.equal(rows.length, 3)
  assert.equal(rows[0].stt, '1')
  assert.ok(rows[0].question.startsWith('Việc xoá án tích'))
  assert.equal(rows[0].answer, 'Trả lời về xoá án tích.')
  assert.equal(rows[0].note, 'Điều 70 BLHS')
})

test('the header row is located by name, not by position', () => {
  const shifted = [['Báo cáo nội bộ', '', '', ''], ['Ghi chú', 'Trả lời', 'Câu hỏi', 'STT'], ['x', 'Đáp án', 'Hỏi gì đó?', '9']]
  const rows = gridToQaRows(shifted)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].question, 'Hỏi gì đó?')
  assert.equal(rows[0].answer, 'Đáp án')
  assert.equal(rows[0].stt, '9')
})

test('rows missing a question or an answer are skipped by the compatible API', () => {
  const rows = gridToQaRows([
    ['STT', 'Câu hỏi', 'Trả lời'],
    ['1', 'Có câu hỏi', ''],
    ['2', '', 'Chỉ có trả lời'],
    ['3', 'Đầy đủ', 'Có đáp án'],
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].question, 'Đầy đủ')
})

test('diagnostics reports malformed nonblank rows and keeps valid rows', () => {
  const result = diagnoseQaGrid([
    ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'],
    ['1', 'Thiếu đáp án', '', 'nguồn'],
    ['2', '', 'Mồ côi', ''],
    ['3', 'Đủ dữ liệu', 'Đáp án', ''],
    ['', '', 'Nối tiếp hợp lệ', ''],
    ['', '', '', ''],
    ['4', '', '', 'Chỉ ghi chú'],
  ])
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0]!.answer, 'Đáp án\nNối tiếp hợp lệ')
  assert.deepEqual(result.issues.map(item => [item.code, item.row]), [
    ['missing_answer', 2],
    ['missing_question', 3],
    ['missing_required_fields', 7],
  ])
})

test('valid continuation reports the physical source range in XLSX', () => {
  const shared = ['STT', 'Câu hỏi', 'Trả lời', '1', 'Hỏi?', 'Dẫn nhập', 'Bước hai']
  const cell = (ref: string, index: number) => `<c r="${ref}" t="s"><v>${index}</v></c>`
  const sheet = '<worksheet><sheetData>'
    + `<row r="1">${cell('A1', 0)}${cell('B1', 1)}${cell('C1', 2)}</row>`
    + `<row r="2">${cell('A2', 3)}${cell('B2', 4)}${cell('C2', 5)}</row>`
    + '<row r="5"><c r="A5"/><c r="B5"/>' + cell('C5', 6) + '</row>'
    + '</sheetData></worksheet>'
  const book = zip([
    { name: 'xl/sharedStrings.xml', content: `<sst>${shared.map(item => `<si><t>${item}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
  ])
  const result = parseQaWorkbookDiagnostics(book)
  assert.equal(result.rows[0]!.sourceRow, 2)
  assert.equal(result.rows[0]!.sourceEndRow, 5)
  assert.equal(result.rows[0]!.answer, 'Dẫn nhập\nBước hai')
})

test('CSV input is accepted, including quoted fields and embedded separators', () => {
  const csv = Buffer.from('STT,Câu hỏi,Trả lời,Ghi chú\n1,"Hỏi, có dấu phẩy?","Đáp ""trong ngoặc""",note\n', 'utf8')
  const rows = gridToQaRows(readCsvGrid(csv))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].question, 'Hỏi, có dấu phẩy?')
  assert.equal(rows[0].answer, 'Đáp "trong ngoặc"')
})

test('a non-spreadsheet payload is rejected rather than silently accepted', () => {
  assert.throws(() => readXlsxGrid(Buffer.from('not a zip at all')), XlsxError)
})

// ─── Keyword extraction ──────────────────────────────────────────────────────
test('keywords keep distinctive terms and drop generic function words', () => {
  const keywords = extractKeywords('Việc xoá án tích đối với người chấp hành xong án phạt tù như thế nào?')
  assert.ok(keywords.includes('xoá'))
  assert.ok(keywords.includes('tích'))
  assert.ok(!keywords.includes('như'), 'generic word leaked')
  assert.ok(!keywords.includes('của'), 'generic word leaked')
})

test('keywords include adjacent phrases so near-identical questions stay distinct', () => {
  const xa = extractKeywords('Trách nhiệm của Ủy ban nhân dân cấp xã?')
  const tinh = extractKeywords('Trách nhiệm của Ủy ban nhân dân cấp tỉnh?')
  assert.ok(xa.includes('cấp xã'))
  assert.ok(tinh.includes('cấp tỉnh'))
  assert.ok(!xa.includes('cấp tỉnh'))
})

test('extraction is defensive about empty and non-string input', () => {
  assert.deepEqual(extractKeywords(''), [])
  assert.deepEqual(extractKeywords('   '), [])
  assert.deepEqual(extractKeywords(undefined as unknown as string), [])
})

// ─── End-to-end: imported rows answer casually-phrased questions ─────────────
function toEntry(id: number, question: string, answer: string): RetrievalEntry {
  const now = new Date('2026-01-01T00:00:00Z')
  return {
    id,
    canonicalQuestion: question,
    normalizedQuestion: question.toLowerCase(),
    approvedAnswer: answer,
    topic: 'general',
    sourceLabel: 'Tài liệu Hỏi – Đáp',
    sourceUrl: null,
    sourceReference: null,
    internalNotes: null,
    status: 'published',
    priority: 0,
    isQuickQuestion: false,
    authorId: 1,
    reviewerId: null,
    reviewedAt: null,
    publishedAt: now,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    terms: extractKeywords(question).map(value => ({ kind: 'keyword' as const, value, normalizedValue: value })),
  } as RetrievalEntry
}

test('casually-phrased questions match the right imported entry', () => {
  const rows = parseQaWorkbook(workbook(SAMPLE))
  const entries = rows.map((row, i) => toEntry(i + 1, row.question, row.answer))

  const cases: Array<[string, string]> = [
    ['tôi muốn xoá án tích thì làm sao', 'Trả lời về xoá án tích.'],
    ['ubnd cấp xã có trách nhiệm gì', 'Trả lời về UBND cấp xã.'],
    ['làm sao vay vốn ngân hàng sau khi ra tù', 'Trả lời về vay vốn.'],
  ]
  for (const [query, expected] of cases) {
    const [top] = retrieveKnowledge(entries, query, { topK: 3 })
    assert.ok(top, `no match for: ${query}`)
    assert.equal(top.answer, expected, `wrong entry for: ${query}`)
  }
})

test('an unrelated question matches nothing rather than guessing', () => {
  const entries = parseQaWorkbook(workbook(SAMPLE)).map((row, i) => toEntry(i + 1, row.question, row.answer))
  assert.equal(retrieveKnowledge(entries, 'công thức nấu phở bò', { topK: 3 }).length, 0)
})
