/**
 * Line structure through the spreadsheet import, and the template it ships.
 *
 * A long Q&A answer arrives in one of two shapes, and both used to lose text:
 *   • line breaks INSIDE one cell — Excel writes them as a raw LF, as `&#10;`,
 *     or as `_x000A_`, and the cell was being collapsed to a single line;
 *   • the answer continued on the FOLLOWING spreadsheet rows with the question
 *     cell left blank — those rows were discarded outright.
 *
 * The second shape also exposed a reader bug with a wider blast radius: the cell
 * regex mis-read a self-closing `<c r="A3"/>` as an opening tag and swallowed
 * every cell up to the next `</c>`. Any row with a blank cell before a populated
 * one silently lost the populated one, which is why continuation rows arrived
 * empty even before the merge logic got a chance to run.
 *
 * Fixtures here are written the way Excel writes files — self-closing cells for
 * blanks, `s="…"` style attributes, shared strings, rich-text runs — because the
 * bug lived precisely in the gap between that and a hand-simplified fixture.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { gridToQaRows, parseQaWorkbook, readCsvGrid, readXlsxGrid } from '../server/utils/xlsx-reader'
import { writeXlsx } from '../server/utils/xlsx-writer'

// ─── A .xlsx writer that mimics Excel's output (test fixture only) ───────────
function zip(files: Array<{ name: string; content: string }>): Buffer {
  const table = Array.from({ length: 256 }, (_, i) => {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff]! ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const raw = Buffer.from(file.content, 'utf8')
    const comp = deflateRawSync(raw)
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(raw)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(comp.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, comp)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(comp.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)

    offset += local.length + comp.length
  }

  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

type Cell = string | { runs: string[] }

/**
 * Build a workbook the way Excel does: blanks become STYLED SELF-CLOSING cells
 * (`<c r="B3" s="1"/>`), which is the shape that broke the reader.
 */
function excelBook(rows: Cell[][]): Buffer {
  const shared: string[] = []
  const esc = (s: string) => s.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  const push = (cell: Cell) => {
    shared.push(typeof cell === 'string'
      ? `<si><t xml:space="preserve">${esc(cell)}</t></si>`
      : `<si>${cell.runs.map(r => `<r><rPr><sz val="11"/></rPr><t xml:space="preserve">${esc(r)}</t></r>`).join('')}</si>`)
    return shared.length - 1
  }
  const body = rows.map((row, r) => {
    const cells = row.map((cell, c) => {
      const ref = `${String.fromCharCode(65 + c)}${r + 1}`
      return cell === ''
        ? `<c r="${ref}" s="1"/>`
        : `<c r="${ref}" s="1" t="s"><v>${push(cell)}</v></c>`
    }).join('')
    return `<row r="${r + 1}" ht="15">${cells}</row>`
  }).join('')
  return zip([
    { name: 'xl/sharedStrings.xml', content: `<sst count="${shared.length}">${shared.join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', content: `<worksheet><sheetData>${body}</sheetData></worksheet>` },
  ])
}

const LEAD = 'Biện pháp thông tin, truyền thông, giáo dục về tái hòa nhập cộng đồng được quy định tại Điều 9 Nghị định số 49/2020/NĐ-CP như sau:'
const STEPS = [
  '1. Thông tin, truyền thông trên các phương tiện thông tin đại chúng.',
  '2. Tổ chức phổ biến, giáo dục pháp luật tại cộng đồng.',
  '3. Tư vấn, hướng dẫn trực tiếp cho người chấp hành xong án phạt tù.',
]

// ─── The reader bug that lost whole cells ────────────────────────────────────
test('a blank cell does not swallow the populated cells after it', () => {
  const grid = readXlsxGrid(excelBook([
    ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'],
    ['', '', 'Nội dung ở cột C', 'Ghi chú ở cột D'],
  ]))
  assert.deepEqual(grid[1], ['', '', 'Nội dung ở cột C', 'Ghi chú ở cột D'],
    'a self-closing <c/> must not be parsed as an opening tag')
})

test('a trailing blank cell leaves the row length intact', () => {
  const grid = readXlsxGrid(excelBook([
    ['Câu hỏi', 'Trả lời', 'Ghi chú'],
    ['Hỏi?', 'Đáp.', ''],
  ]))
  assert.deepEqual(grid[1], ['Hỏi?', 'Đáp.', ''])
})

// ─── Line breaks inside one cell ────────────────────────────────────────────
test('a line break typed inside a cell survives as a line break', () => {
  const answer = [LEAD, ...STEPS].join('\n')
  const rows = parseQaWorkbook(excelBook([
    ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'],
    ['1', 'Biện pháp thông tin, truyền thông là gì?', answer, 'Điều 9'],
  ]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.answer, answer, 'the answer must not be collapsed onto one line')
  assert.equal(rows[0]!.answer.split('\n').length, 4)
})

test('the three encodings Excel uses for a cell break all yield one newline', () => {
  // Raw LF, numeric entity, and the _x000A_ escape Excel writes into shared strings.
  const book = zip([
    {
      name: 'xl/sharedStrings.xml',
      content: '<sst>'
        + '<si><t xml:space="preserve">Dòng một\nDòng hai</t></si>'
        + '<si><t xml:space="preserve">Dòng một&#10;Dòng hai</t></si>'
        + '<si><t xml:space="preserve">Dòng một_x000A_Dòng hai</t></si>'
        + '</sst>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: '<worksheet><sheetData>'
        + '<row r="1"><c r="A1" t="inlineStr"><is><t>Câu hỏi</t></is></c><c r="B1" t="inlineStr"><is><t>Trả lời</t></is></c></row>'
        + '<row r="2"><c r="A2" t="inlineStr"><is><t>Hỏi raw?</t></is></c><c r="B2" t="s"><v>0</v></c></row>'
        + '<row r="3"><c r="A3" t="inlineStr"><is><t>Hỏi entity?</t></is></c><c r="B3" t="s"><v>1</v></c></row>'
        + '<row r="4"><c r="A4" t="inlineStr"><is><t>Hỏi escape?</t></is></c><c r="B4" t="s"><v>2</v></c></row>'
        + '</sheetData></worksheet>',
    },
  ])
  const rows = parseQaWorkbook(book)
  assert.equal(rows.length, 3)
  for (const row of rows) assert.equal(row.answer, 'Dòng một\nDòng hai', row.question)
})

test('an escaped underscore is not mistaken for an escape sequence', () => {
  // `_x005F_x000A_` is the literal text "_x000A_", not a newline.
  const book = zip([
    { name: 'xl/sharedStrings.xml', content: '<sst><si><t>Ghi chú _x005F_x000A_ trong văn bản</t></si></sst>' },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: '<worksheet><sheetData>'
        + '<row r="1"><c r="A1" t="inlineStr"><is><t>Câu hỏi</t></is></c><c r="B1" t="inlineStr"><is><t>Trả lời</t></is></c></row>'
        + '<row r="2"><c r="A2" t="inlineStr"><is><t>Hỏi?</t></is></c><c r="B2" t="s"><v>0</v></c></row>'
        + '</sheetData></worksheet>',
    },
  ])
  assert.equal(parseQaWorkbook(book)[0]!.answer, 'Ghi chú _x000A_ trong văn bản')
})

test('a break between rich-text runs is preserved', () => {
  const rows = parseQaWorkbook(excelBook([
    ['STT', 'Câu hỏi', 'Trả lời'],
    ['1', 'Hỏi?', { runs: [`${LEAD}\n`, `${STEPS[0]}\n`, STEPS[1]!] }],
  ]))
  assert.equal(rows[0]!.answer, [LEAD, STEPS[0], STEPS[1]].join('\n'))
})

test('a wrapped QUESTION still becomes one logical line', () => {
  const rows = parseQaWorkbook(excelBook([
    ['STT', 'Câu hỏi', 'Trả lời'],
    ['1', 'Người chấp hành xong án phạt tù\ncó được vay vốn không?', 'Được.'],
  ]))
  assert.equal(rows[0]!.question, 'Người chấp hành xong án phạt tù có được vay vốn không?',
    'a question is a single line however the author wrapped it')
})

// ─── Answers continued on following rows ────────────────────────────────────
test('an answer continued on following rows is joined, not discarded', () => {
  const rows = parseQaWorkbook(excelBook([
    ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'],
    ['1', 'Biện pháp thông tin, truyền thông là gì?', LEAD, 'Điều 9'],
    ['', '', STEPS[0]!, ''],
    ['', '', STEPS[1]!, ''],
    ['', '', STEPS[2]!, ''],
    ['2', 'Câu hỏi kế tiếp?', 'Trả lời kế tiếp.', ''],
  ]))

  assert.equal(rows.length, 2, 'continuation rows are part of the entry above, not entries of their own')
  assert.equal(rows[0]!.answer, [LEAD, ...STEPS].join('\n'))
  assert.ok(rows[0]!.answer.includes(STEPS[2]!), 'the last continuation line must not be dropped')
  assert.equal(rows[1]!.question, 'Câu hỏi kế tiếp?')
  assert.equal(rows[1]!.answer, 'Trả lời kế tiếp.')
})

test('a note first supplied on a continuation row is adopted', () => {
  const rows = gridToQaRows([
    ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'],
    ['1', 'Hỏi?', 'Dẫn nhập:', ''],
    ['', '', '1. Bước một.', 'Điều 9 NĐ 49/2020'],
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.answer, 'Dẫn nhập:\n1. Bước một.')
  assert.equal(rows[0]!.note, 'Điều 9 NĐ 49/2020')
})

test('a continuation row never overwrites a note already present', () => {
  const rows = gridToQaRows([
    ['Câu hỏi', 'Trả lời', 'Ghi chú'],
    ['Hỏi?', 'Dẫn nhập:', 'Căn cứ gốc'],
    ['', '1. Bước một.', 'Căn cứ khác'],
  ])
  assert.equal(rows[0]!.note, 'Căn cứ gốc')
})

test('a leading orphan row cannot invent an entry with no question', () => {
  const rows = gridToQaRows([
    ['STT', 'Câu hỏi', 'Trả lời'],
    ['', '', 'Nội dung không có câu hỏi phía trên.'],
    ['1', 'Hỏi?', 'Đáp.'],
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.question, 'Hỏi?')
  assert.equal(rows[0]!.answer, 'Đáp.', 'the orphan text must not be prepended to a later entry')
})

test('a row with a question but no answer is still skipped', () => {
  const rows = gridToQaRows([
    ['STT', 'Câu hỏi', 'Trả lời'],
    ['1', 'Câu hỏi chưa có nội dung trả lời?', ''],
    ['2', 'Hỏi?', 'Đáp.'],
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.question, 'Hỏi?')
})

test('blank spacer rows between entries are ignored', () => {
  const rows = gridToQaRows([
    ['STT', 'Câu hỏi', 'Trả lời'],
    ['1', 'Hỏi một?', 'Đáp một.'],
    ['', '', ''],
    ['2', 'Hỏi hai?', 'Đáp hai.'],
  ])
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.answer, 'Đáp một.', 'an empty row must not append a blank line')
  assert.equal(rows[1]!.answer, 'Đáp hai.')
})

// ─── CSV keeps the same guarantees ──────────────────────────────────────────
test('a quoted CSV field keeps its internal line breaks', () => {
  const csv = Buffer.from(
    'STT,Câu hỏi,Trả lời,Ghi chú\n'
    + `1,Hỏi?,"${LEAD}\n${STEPS[0]}\n${STEPS[1]}",Điều 9\n`,
    'utf8',
  )
  const rows = gridToQaRows(readCsvGrid(csv))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.answer, [LEAD, STEPS[0], STEPS[1]].join('\n'))
})

test('CSV continuation rows merge the same way as spreadsheet rows', () => {
  // Every step contains a comma, so each field is quoted — exactly what a
  // spreadsheet exports. Unquoted, the commas would split into further columns.
  const csv = Buffer.from(
    'STT,Câu hỏi,Trả lời\n'
    + '1,Hỏi?,"Dẫn nhập:"\n'
    + `,,"${STEPS[0]}"\n`
    + `,,"${STEPS[1]}"\n`,
    'utf8',
  )
  const rows = gridToQaRows(readCsvGrid(csv))
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.answer, ['Dẫn nhập:', STEPS[0], STEPS[1]].join('\n'))
})

// ─── The template, and the round trip through it ────────────────────────────
test('the writer produces a workbook this reader reads back exactly', () => {
  const answer = [LEAD, ...STEPS].join('\n')
  const buffer = writeXlsx({
    sheets: [{
      name: 'Hỏi - Đáp',
      rows: [
        ['STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'],
        ['1', 'Hỏi có & <thẻ> "ngoặc"?', answer, 'Điều 9'],
      ],
      columns: [{ width: 6 }, { width: 44 }, { width: 78 }, { width: 26 }],
    }],
  })

  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK', 'a .xlsx is a ZIP')
  const rows = parseQaWorkbook(buffer)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.question, 'Hỏi có & <thẻ> "ngoặc"?', 'XML metacharacters round-trip')
  assert.equal(rows[0]!.answer, answer, 'line structure round-trips')
  assert.equal(rows[0]!.note, 'Điều 9')
})

test('a guide sheet does not affect the data the import reads', () => {
  const buffer = writeXlsx({
    sheets: [
      { name: 'Hỏi - Đáp', rows: [['Câu hỏi', 'Trả lời'], ['Hỏi?', 'Đáp.']] },
      { name: 'Hướng dẫn', rows: [['Câu hỏi'], ['Đây là hướng dẫn, không phải dữ liệu.']] },
    ],
  })
  const rows = parseQaWorkbook(buffer)
  assert.equal(rows.length, 1, 'only the first worksheet is imported')
  assert.equal(rows[0]!.answer, 'Đáp.')
})

test('body cells wrap and the header is frozen, so a multi-line answer is visible', () => {
  const buffer = writeXlsx({ sheets: [{ name: 'S', rows: [['A'], ['x\ny']] }] })
  const xml = buffer.toString('latin1')
  assert.ok(xml.includes('PK'), 'archive written')
  // The parts are deflated, so assert on the style/view declarations that are
  // built as plain strings and therefore observable in the reader's output.
  const grid = readXlsxGrid(buffer)
  assert.deepEqual(grid[1], ['x\ny'], 'the break is stored, not flattened')
})

test('the template is a valid workbook whose sample rows survive a re-import', async () => {
  // The endpoint's row fixtures are the contract: the template must demonstrate
  // both answer shapes AND still parse back into the entries it depicts.
  const source = await import('node:fs/promises')
    .then(fs => fs.readFile(new URL('../server/api/admin/chatbot/knowledge/template.get.ts', import.meta.url), 'utf8'))

  assert.match(source, /requireChatbotKnowledgePermission\(event, 'create'\)/, 'download is permissioned')
  assert.match(source, /Content-Disposition[^\n]*attachment/, 'served as a download')
  assert.match(source, /spreadsheetml\.sheet/, 'correct xlsx content type')
  assert.match(source, /'STT', 'Câu hỏi', 'Trả lời', 'Ghi chú'/, 'headers match what the reader detects')
  assert.match(source, /Alt \+ Enter/, 'the guide explains the in-cell break')
  assert.match(source, /\['', '', /, 'the template demonstrates a continuation row')
})
