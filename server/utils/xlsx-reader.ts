import { inflateRawSync } from 'node:zlib'

/**
 * Zero-dependency reader for the small subset of the .xlsx (OOXML) and .csv
 * formats we need to import a Q&A knowledge sheet. Deliberately avoids any
 * third-party spreadsheet library (supply-chain / CVE surface) — a .xlsx is a
 * ZIP of XML parts, so we unzip the two parts we care about (sharedStrings +
 * the first worksheet) and read the cells.
 *
 * Only reads the FIRST worksheet. Returns a rectangular grid of trimmed string
 * cells. Numeric/inline cells are read as their string form. Not a general
 * spreadsheet engine — merged cells, formulas and styles are ignored.
 */

export type SheetGrid = string[][]

type SourceRange = { start: number; end: number }
const SOURCE_RANGE = Symbol('xlsx-reader-source-range')
type SourceRow = string[] & { [SOURCE_RANGE]?: SourceRange }

function setSourceRange(row: string[], start: number, end = start): void {
  Object.defineProperty(row, SOURCE_RANGE, {
    value: { start, end },
    configurable: false,
    enumerable: false,
    writable: false,
  })
}

function sourceRange(row: string[] | undefined, fallback: number): SourceRange {
  return (row as SourceRow | undefined)?.[SOURCE_RANGE] ?? { start: fallback, end: fallback }
}

const MAX_ENTRIES = 4096
const MAX_UNCOMPRESSED = 40 * 1024 * 1024 // 40 MB guard per extracted XML part

// ── Minimal ZIP central-directory reader ─────────────────────────────────────
type ZipEntry = { method: number; compSize: number; localOffset: number }

function openZip(buf: Buffer) {
  // Locate End Of Central Directory record (scan backwards for its signature).
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new XlsxError('Tệp không phải định dạng .xlsx hợp lệ.')
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const cdCount = buf.readUInt16LE(eocd + 10)
  if (cdCount > MAX_ENTRIES) throw new XlsxError('Tệp .xlsx có quá nhiều thành phần.')

  const files = new Map<string, ZipEntry>()
  let p = cdOffset
  for (let i = 0; i < cdCount; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    files.set(name, { method, compSize, localOffset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return files
}

function extractEntry(buf: Buffer, entry: ZipEntry | undefined): string | null {
  if (!entry) return null
  const lo = entry.localOffset
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) throw new XlsxError('Cấu trúc .xlsx bị hỏng.')
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const dataStart = lo + 30 + nameLen + extraLen
  const comp = buf.subarray(dataStart, dataStart + entry.compSize)
  let out: Buffer
  if (entry.method === 0) out = Buffer.from(comp)
  else if (entry.method === 8) out = inflateRawSync(comp)
  else throw new XlsxError('Thành phần .xlsx dùng kiểu nén không hỗ trợ.')
  if (out.length > MAX_UNCOMPRESSED) throw new XlsxError('Nội dung .xlsx quá lớn.')
  return out.toString('utf8')
}

// ── XML helpers (regex-based; OK for the well-formed parts we read) ───────────
function xmlUnescape(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try { return String.fromCodePoint(code) } catch { return '' }
}

/**
 * Excel cannot put a raw control character in sharedStrings, so it escapes them
 * as `_xHHHH_` — an in-cell line break becomes `_x000A_`. A literal underscore
 * that would otherwise start such a sequence is itself escaped as `_x005F_`.
 *
 * Decoded in ONE left-to-right pass so that ordering is honoured: `_x005F_x000A_`
 * is the literal text "_x000A_", not a newline. Escapes other than CR/LF are
 * left verbatim — this exists to preserve line structure, not to be a general
 * unescaper.
 */
function decodeExcelEscapes(value: string): string {
  return value.replace(/_x005F_|_x([0-9A-Fa-f]{4})_/g, (match, hex?: string) => {
    if (!hex) return '_'
    const code = Number.parseInt(hex, 16)
    if (code === 10) return '\n'
    if (code === 13) return ''
    return match
  })
}

/**
 * A cell's text with its line structure intact.
 *
 * Excel writes an in-cell break as a literal LF, as `&#10;`, or as `_x000A_`;
 * all three must survive as `\n`. Only the outer edges are trimmed — collapsing
 * the interior is what turned a numbered answer into a single run-on line.
 */
function normalizeCellText(value: string): string {
  return decodeExcelEscapes(value).replace(/\r\n?/gu, '\n').trim()
}

/** Concatenate every <t>…</t> run inside a fragment (handles <si> and <is>). */
function collectText(fragment: string): string {
  let out = ''
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(fragment))) out += xmlUnescape(m[1] ?? '')
  return out
}

function columnToIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export class XlsxError extends Error {
  constructor(message: string) { super(message); this.name = 'XlsxError' }
}

/** Read the first worksheet of an .xlsx buffer into a rectangular string grid. */
export function readXlsxGrid(buf: Buffer): SheetGrid {
  const files = openZip(buf)

  const sharedXml = extractEntry(buf, files.get('xl/sharedStrings.xml'))
  const shared: string[] = []
  if (sharedXml) {
    const re = /<si>([\s\S]*?)<\/si>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(sharedXml))) shared.push(collectText(m[1] ?? ''))
  }

  // First worksheet by sorted name (sheet1.xml, sheet2.xml, …).
  const sheetName = [...files.keys()]
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0]
  if (!sheetName) throw new XlsxError('Không tìm thấy worksheet trong tệp .xlsx.')
  const sheetXml = extractEntry(buf, files.get(sheetName)) || ''

  const grid: SheetGrid = []
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  /**
   * The attribute run is LAZY and the two endings are one alternation, so a
   * self-closing `<c r="A3"/>` cannot be read as an open tag.
   *
   * The previous form — `…"([^>]*)>([\s\S]*?)<\/c>|…"([^>]*)\/>` — let `[^>]*`
   * consume the `/` of a self-closing cell; the first branch then matched and its
   * lazy body ran on to the NEXT `</c>`, swallowing every cell in between. Any
   * row with a blank cell before a populated one silently lost that cell, which
   * is how continuation rows arrived empty.
   */
  const cellRe = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(sheetXml))) {
    const cells: string[] = []
    const physicalRow = Number(/\br="(\d+)"/.exec(rowMatch[0])?.[1]) || grid.length + 1
    let cellMatch: RegExpExecArray | null
    cellRe.lastIndex = 0
    while ((cellMatch = cellRe.exec(rowMatch[1] ?? ''))) {
      const col = cellMatch[1] ?? ''
      const attrs = cellMatch[2] ?? ''
      // Absent for a self-closing cell, which carries no value.
      const inner = cellMatch[3] ?? ''
      const ci = columnToIndex(col)
      const type = /t="([^"]+)"/.exec(attrs)?.[1]
      let value = ''
      if (type === 's') {
        const idx = Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1])
        value = Number.isInteger(idx) ? (shared[idx] ?? '') : ''
      } else if (type === 'inlineStr') {
        value = collectText(inner)
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
        value = raw ? xmlUnescape(raw) : ''
      }
      cells[ci] = normalizeCellText(value)
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = ''
    setSourceRange(cells, physicalRow)
    grid.push(cells)
  }
  return grid
}

/** Parse a CSV buffer (RFC-4180-ish: quoted fields, "" escape, CR/LF rows). */
export function readCsvGrid(buf: Buffer): SheetGrid {
  let text = buf.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // strip BOM
  const grid: SheetGrid = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let recordStartLine = 1
  let physicalLine = 1

  const finishRow = (endLine: number) => {
    const normalized = row.map(normalizeCellText)
    setSourceRange(normalized, recordStartLine, endLine)
    grid.push(normalized)
    row = []
    field = ''
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else {
        field += ch
        if (ch === '\n') physicalLine++
      }
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n') {
      row.push(field)
      finishRow(physicalLine)
      physicalLine++
      recordStartLine = physicalLine
    } else if (ch === '\r') { /* ignore, handled by \n */ }
    else field += ch
  }
  if (field.length || row.length) { row.push(field); finishRow(physicalLine) }
  return grid
}

export type QaRawRow = { stt: string; question: string; answer: string; note: string }
export type QaRow = QaRawRow & { sourceRow?: number; sourceEndRow?: number }
export type QaParseIssueCode = 'missing_answer' | 'missing_question' | 'missing_required_fields'
export type QaParseIssue = {
  row: number
  endRow: number
  code: QaParseIssueCode
  message: string
  raw: QaRawRow
}
export type QaParseDiagnostics = { rows: QaRow[]; issues: QaParseIssue[]; scannedRows: number }

type QaColumns = { headerIdx: number; qCol: number; aCol: number; nCol: number; sCol: number }

function detectQaColumns(grid: SheetGrid): QaColumns {
  const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase().trim()
  let headerIdx = -1
  let qCol = 1, aCol = 2, nCol = 3, sCol = 0
  for (let i = 0; i < Math.min(grid.length, 10); i++) {
    const norm = (grid[i] ?? []).map(strip)
    const qi = norm.findIndex(c => c.includes('cau hoi'))
    const ai = norm.findIndex(c => c.includes('tra loi') || c.includes('cau tra loi'))
    if (qi >= 0 && ai >= 0) {
      headerIdx = i; qCol = qi; aCol = ai
      nCol = norm.findIndex(c => c.includes('ghi chu'))
      sCol = norm.findIndex(c => c === 'stt' || c === 'tt' || c.includes('so thu tu'))
      break
    }
  }
  return { headerIdx, qCol, aCol, nCol, sCol }
}

/**
 * Diagnose a raw Q&A grid without silently discarding malformed nonblank rows.
 * Valid continuation rows extend the previous candidate's source range.
 */
export function diagnoseQaGrid(grid: SheetGrid): QaParseDiagnostics {
  const { headerIdx, qCol, aCol, nCol, sCol } = detectQaColumns(grid)
  const start = headerIdx >= 0 ? headerIdx + 1 : 0
  const rows: QaRow[] = []
  const issues: QaParseIssue[] = []
  let openRow: QaRow | null = null
  let scannedRows = 0

  for (let i = start; i < grid.length; i++) {
    const cells = grid[i] ?? []
    const range = sourceRange(cells, i + 1)
    const raw: QaRawRow = {
      stt: sCol >= 0 ? (cells[sCol] || '').trim() : '',
      question: (cells[qCol] || '').trim(),
      answer: (cells[aCol] || '').trim(),
      note: nCol >= 0 ? (cells[nCol] || '').trim() : '',
    }
    if (!Object.values(raw).some(Boolean)) continue
    scannedRows++

    // Questions are one logical line; answers retain line structure.
    const question = raw.question.replace(/\s+/gu, ' ').trim()
    if (question && raw.answer) {
      openRow = {
        ...raw,
        question,
        stt: raw.stt || String(rows.length + 1),
        sourceRow: range.start,
        sourceEndRow: range.end,
      }
      rows.push(openRow)
      continue
    }

    if (!question && raw.answer && !raw.stt && openRow) {
      openRow.answer = `${openRow.answer}\n${raw.answer}`
      if (raw.note && !openRow.note) openRow.note = raw.note
      openRow.sourceEndRow = range.end
      continue
    }

    if (question && !raw.answer) {
      issues.push({ row: range.start, endRow: range.end, code: 'missing_answer', message: 'Thiếu Trả lời.', raw })
    } else if (!question && raw.answer) {
      issues.push({ row: range.start, endRow: range.end, code: 'missing_question', message: 'Thiếu Câu hỏi hoặc không có mục hợp lệ phía trên để nối tiếp.', raw })
    } else {
      issues.push({ row: range.start, endRow: range.end, code: 'missing_required_fields', message: 'Thiếu Câu hỏi và Trả lời.', raw })
    }
    // A malformed row breaks the continuation chain, preventing later text from
    // being attached to an unrelated valid item above it.
    openRow = null
  }

  return { rows, issues, scannedRows }
}

/**
 * Map a raw grid to compatible Q&A rows. Existing callers still receive only
 * valid candidates; diagnostics are available through diagnoseQaGrid().
 */
export function gridToQaRows(grid: SheetGrid): QaRow[] {
  return diagnoseQaGrid(grid).rows
}

/** Detect format by magic bytes and parse to Q&A rows with diagnostics. */
export function parseQaWorkbookDiagnostics(buf: Buffer): QaParseDiagnostics {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)
  const grid = isZip ? readXlsxGrid(buf) : readCsvGrid(buf)
  return diagnoseQaGrid(grid)
}

/** Detect format by magic bytes and preserve the original parser API. */
export function parseQaWorkbook(buf: Buffer): QaRow[] {
  return parseQaWorkbookDiagnostics(buf).rows
}
