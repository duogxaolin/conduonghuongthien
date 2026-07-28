import { deflateRawSync } from 'node:zlib'

/**
 * Zero-dependency .xlsx writer, just large enough to emit the import template.
 *
 * Same reasoning as the reader: a spreadsheet library would be a large
 * supply-chain surface for something the format lets us do directly. A .xlsx is
 * a ZIP of XML parts, so we build the parts Excel requires and deflate them.
 *
 * Text goes out as `inlineStr`, which avoids a sharedStrings table entirely, and
 * body cells carry a wrap-text style so a multi-line answer is visible in the
 * grid rather than hidden behind a one-line row.
 */

// ── CRC-32 (required by the ZIP local/central headers) ───────────────────────
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

type ZipInput = { name: string; content: string }

/** Build a ZIP archive (deflate, no directory entries, no zip64). */
function buildZip(files: ZipInput[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const raw = Buffer.from(file.content, 'utf8')
    const compressed = deflateRawSync(raw)
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(raw)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)   // version needed
    local.writeUInt16LE(0, 6)    // flags
    local.writeUInt16LE(8, 8)    // method: deflate
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    locals.push(local, compressed)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)  // version made by
    central.writeUInt16LE(20, 6)  // version needed
    central.writeUInt16LE(8, 10)  // method: deflate
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centrals.push(central)

    offset += local.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralDirectory, end])
}

/**
 * Drop the characters XML 1.0 forbids.
 *
 * Written as a code-point test rather than a regex range because the range would
 * have to spell out control characters, and a stray literal one in the source is
 * both invisible and fatal to whoever edits this next. Tab and LF are kept: a
 * cell break depends on LF surviving.
 */
function stripInvalidXmlChars(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code >= 32) out += ch
  }
  return out
}

/** XML text escape for element content and attribute values. */
function escapeXml(value: string): string {
  return stripInvalidXmlChars(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    // A cell break goes out as an entity: a raw LF inside <t> is legal XML but
    // Excel is inconsistent about honouring it. The reader accepts both forms.
    .replace(/\n/gu, '&#10;')
}

function columnName(index: number): string {
  let name = ''
  let n = index
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

/**
 * Two cell styles live in styles.xml: index 1 is a bold header on a tinted fill,
 * index 2 is a top-aligned wrapping body cell.
 */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F7F1"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
</styleSheet>`

export type SheetColumn = { width: number }
export type SheetInput = {
  name: string
  rows: string[][]
  columns?: SheetColumn[]
  /** Row 0 styled as a bold, frozen header. On by default. */
  header?: boolean
}

/** Excel forbids these in a sheet name, and caps the name at 31 characters. */
function safeSheetName(name: string, fallback: string): string {
  return name.replace(/[\\/?*[\]:]/gu, '').slice(0, 31) || fallback
}

function sheetXml(sheet: SheetInput): string {
  const withHeader = sheet.header !== false
  const cols = sheet.columns?.length
    ? `<cols>${sheet.columns.map((col, i) => `<col min="${i + 1}" max="${i + 1}" width="${col.width}" customWidth="1"/>`).join('')}</cols>`
    : ''

  const rows = sheet.rows.map((row, rowIndex) => {
    const isHeader = withHeader && rowIndex === 0
    const style = isHeader ? 1 : 2
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`
      // An empty cell still carries the style so the wrap/alignment is uniform,
      // and self-closing is what the reader expects for "no value".
      if (!value) return `<c r="${ref}" s="${style}"/>`
      return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
    }).join('')
    // The header gets a fixed height; body rows auto-size around wrapped text.
    const attrs = isHeader ? ' ht="28" customHeight="1"' : ''
    return `<row r="${rowIndex + 1}"${attrs}>${cells}</row>`
  }).join('')

  const views = withHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
${views}
${cols}<sheetData>${rows}</sheetData>
</worksheet>`
}

/**
 * Write a workbook of one or more worksheets.
 *
 * Every value is written as text, so an "STT" of `01` keeps its leading zero
 * instead of being reinterpreted as a number. Sheet order is preserved, which
 * matters for the import template: the reader only ever looks at sheet1, so the
 * data sheet has to come first and any guidance sheet after it.
 */
export function writeXlsx(options: { sheets: SheetInput[] }): Buffer {
  const sheets = options.sheets.length ? options.sheets : [{ name: 'Sheet1', rows: [] }]

  // Relationship ids: rId1..rIdN are the worksheets, and styles takes the next.
  const stylesRel = `rId${sheets.length + 1}`

  const files: ZipInput[] = [
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((sheet, i) => `<sheet name="${escapeXml(safeSheetName(sheet.name, `Sheet${i + 1}`))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="${stylesRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      content: sheetXml(sheet),
    })),
  ]

  return buildZip(files)
}
