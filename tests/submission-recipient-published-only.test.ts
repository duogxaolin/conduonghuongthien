import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import test, { mock } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { createEvent, getCookie, getQuery, getRouterParam, setResponseHeader, type H3Event } from 'h3'
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm'
import { MySqlDialect } from 'drizzle-orm/mysql-core'

/**
 * Where a citizen's submission may be delivered (spec public-submissions,
 * design D2).
 *
 * The recipient allowlist used to be built from EVERY stored form block: every
 * page's published tree AND its unpublished draft, hidden nodes included, plus
 * every legacy flat row — including the stale flat rows of a page that has since
 * been published as a tree. An editor could plant `recipientEmail` in a draft
 * nobody reviews, and the public form (which sent its own block's address) would
 * deliver citizens' names, phones and messages there.
 *
 * Now the allowlist mirrors the public read rule of `pages/[slug]`: visible nodes
 * of the published tree (a hidden node takes its subtree with it); for a page with
 * no published tree, visible flat rows. And the public page no longer publishes
 * the address at all.
 *
 * The REAL handlers run against in-memory SQLite tables; every WHERE clause is
 * compiled by the MySQL dialect, so a filter the handler forgets is a failure
 * here, not something a fake quietly does for it.
 */

const { pages, pageBlocks, settings, submissions } = await import('../server/db/schema')
type Table = typeof pages | typeof pageBlocks | typeof settings | typeof submissions

const sqlite = new DatabaseSync(':memory:')
const dialect = new MySqlDialect()
for (const table of [pages, pageBlocks, settings, submissions]) {
  sqlite.exec(`CREATE TABLE ${getTableName(table)} (${Object.values(getTableColumns(table)).map(c => `\`${c.name}\``).join(', ')}${table === submissions ? ', PRIMARY KEY (`id`)' : ''})`)
}

type Row = Record<string, unknown>
type Column = { name: string, columnType: string }
const columnsOf = (table: Table) => getTableColumns(table) as unknown as Record<string, Column>
const toDriver = (value: unknown) => (typeof value === 'boolean' ? Number(value) : value)
const fromDriver = (column: Column, value: unknown) => (column.columnType === 'MySqlJson' && typeof value === 'string' ? JSON.parse(value) : value ?? null)

/** Every `select` the handlers run: table name + the COLUMN names projected. */
const selects: Array<{ table: string, columns: string[] }> = []

function runSelect(table: Table, projection: Row | undefined, where?: SQL): Row[] {
  const columns = columnsOf(table)
  const keys = projection
    ? Object.keys(projection).map(key => [key, (projection[key] as Column).name] as const)
    : Object.entries(columns).map(([key, column]) => [key, column.name] as const)
  selects.push({ table: getTableName(table), columns: keys.map(([, name]) => name) })
  const query = where ? dialect.sqlToQuery(where) : { sql: '1 = 1', params: [] }
  const raw = sqlite.prepare(`SELECT * FROM ${getTableName(table)} WHERE ${query.sql}`).all(...query.params.map(toDriver) as never[]) as Row[]
  const byName = Object.fromEntries(Object.values(columns).map(column => [column.name, column]))
  return raw.map(row => Object.fromEntries(keys.map(([key, name]) => [key, fromDriver(byName[name]!, row[name])])))
}

function select(projection?: Row) {
  return {
    from(table: Table) {
      const all = () => runSelect(table, projection)
      const filtered = (where: SQL) => {
        const rows = () => runSelect(table, projection, where)
        return { limit: async () => rows(), orderBy: async () => rows(), then: (resolve: (rows: Row[]) => unknown) => resolve(rows()) }
      }
      return { where: filtered, then: (resolve: (rows: Row[]) => unknown) => resolve(all()) }
    },
  }
}
let nextSubmissionId = 1
const fakeDb = {
  select,
  insert: () => ({ values: async () => [{ insertId: nextSubmissionId++ }] }),
  update: () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) }),
}
mock.module('../server/utils/db', { namedExports: { getDb: () => fakeDb, getPool: () => null } })

const sent: Array<{ to: string }> = []
mock.module('../server/utils/mailer', {
  namedExports: {
    getSmtpConfig: async () => ({ host: 'smtp.example.vn', port: 587, secure: false, user: 'u', pass: 'p', from: 'noreply@example.vn' }),
    sendMail: async (args: { to: string }) => { sent.push({ to: args.to }) },
  },
})
mock.module('../server/utils/rate-limit-store', { namedExports: { recordRateLimitHit: async () => ({ blocked: false, retryAfterSeconds: 0 }) } })
mock.module('../server/utils/rate-limit-deps', { namedExports: { rateLimitDeps: () => ({}) } })

const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: H3Event & { body?: unknown }) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)
globals.setResponseHeader = setResponseHeader
globals.getQuery = getQuery
globals.getCookie = getCookie
globals.getRouterParam = getRouterParam

function makeEvent(url: string, body?: unknown, params?: Record<string, string>): H3Event {
  const req = new IncomingMessage(new Socket())
  req.url = url
  req.method = body === undefined ? 'GET' : 'POST'
  req.headers = { host: 'localhost' }
  const event = createEvent(req, new ServerResponse(req))
  if (params) event.context.params = params
  return Object.assign(event, { body })
}

const submit = (await import('../server/api/submissions.post.ts')).default as unknown as (event: H3Event) => Promise<{ ok: boolean }>
const publicPage = (await import('../server/api/public/pages/[slug].get.ts')).default as unknown as (event: H3Event) => Promise<{ ok: boolean, blocks: unknown[] }>

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SITE = 'site@example.vn'
const form = (recipientEmail: string, extra: Row = {}) => ({ blockType: 'contact_form', isVisible: true, data: { title: 'Liên hệ', recipientEmail }, ...extra })

function reset(rows: { pages?: Row[], flat?: Row[] }) {
  for (const table of ['pages', 'page_blocks', 'settings']) sqlite.exec(`DELETE FROM ${table}`)
  sqlite.prepare('INSERT INTO settings (`key`, `value`) VALUES (?, ?)').run('email', SITE)
  const addPage = sqlite.prepare('INSERT INTO pages (`id`, `slug`, `title`, `published_blocks`, `draft_blocks`) VALUES (?, ?, ?, ?, ?)')
  for (const page of rows.pages ?? []) {
    addPage.run(page.id as number, page.slug as string, 'Trang', page.published === undefined ? null : JSON.stringify(page.published), page.draft === undefined ? null : JSON.stringify(page.draft))
  }
  const addFlat = sqlite.prepare('INSERT INTO page_blocks (`id`, `page_id`, `block_type`, `display_order`, `data`, `is_visible`) VALUES (?, ?, ?, ?, ?, ?)')
  for (const row of rows.flat ?? []) {
    addFlat.run(row.id as number, row.pageId as number, row.blockType as string, 1, JSON.stringify(row.data), row.isVisible === false ? 0 : 1)
  }
  sent.length = 0
  selects.length = 0
}

/** Submit from a form that asks for `requested`; return where the e-mail went. */
async function deliveredTo(requested: string): Promise<string | undefined> {
  sent.length = 0
  const result = await submit(makeEvent('/api/submissions', {
    formTitle: 'Liên hệ',
    recipientEmail: requested,
    answers: [{ id: 'n', label: 'Họ tên', value: 'Nguyễn Văn A', map: 'name', type: 'text' }],
  }))
  assert.equal(result.ok, true, 'the submission itself always succeeds')
  assert.equal(sent.length, 1, `expected exactly one e-mail, got ${sent.length}`)
  return sent[0]!.to
}

// ─── Scenarios (spec public-submissions) ──────────────────────────────────────

test('a recipient that exists only in an unpublished draft is not honoured — the site e-mail gets it', async () => {
  reset({ pages: [{ id: 1, slug: 'contact', published: [form('')], draft: [form('draft@attacker.example')] }] })
  assert.equal(await deliveredTo('draft@attacker.example'), SITE)
})

test('a hidden published node — or anything inside a hidden container — is not a recipient', async () => {
  reset({ pages: [{
    id: 1, slug: 'contact', published: [
      form('hidden@example.vn', { isVisible: false }),
      { blockType: 'section', isVisible: false, data: {}, children: [{ blockType: 'row', isVisible: true, data: {}, children: [form('inside-hidden@example.vn')] }] },
    ],
  }] })
  assert.equal(await deliveredTo('hidden@example.vn'), SITE)
  assert.equal(await deliveredTo('inside-hidden@example.vn'), SITE)
})

test('a stale flat row of a page that is published as a tree is not a recipient', async () => {
  reset({
    pages: [{ id: 1, slug: 'contact', published: [form('')] }],
    flat: [{ id: 10, pageId: 1, blockType: 'contact_form', data: { recipientEmail: 'stale@example.vn' } }],
  })
  assert.equal(await deliveredTo('stale@example.vn'), SITE)
})

test('the one visible published form that names a recipient is honoured (asked for, or as the single configured one)', async () => {
  reset({ pages: [
    { id: 1, slug: 'contact', published: [{ blockType: 'section', isVisible: true, data: {}, children: [form('phong-tiep-dan@example.vn')] }], draft: [form('draft@attacker.example')] },
    { id: 2, slug: 'home', published: [{ blockType: 'support_form', isVisible: true, data: { recipientEmail: '' } }] },
  ] })
  assert.equal(await deliveredTo('phong-tiep-dan@example.vn'), 'phong-tiep-dan@example.vn')
  // The public page no longer carries the address, so the form sends nothing.
  assert.equal(await deliveredTo(''), 'phong-tiep-dan@example.vn')
})

test('a page with no published tree (NULL, or an empty array — the public read falls back for both) uses its VISIBLE flat rows', async () => {
  reset({
    pages: [{ id: 1, slug: 'about' }, { id: 2, slug: 'legacy-empty', published: [] }],
    flat: [
      { id: 10, pageId: 1, blockType: 'contact_form', data: { recipientEmail: 'flat@example.vn' } },
      { id: 11, pageId: 1, blockType: 'support_form', isVisible: false, data: { recipientEmail: 'flat-hidden@example.vn' } },
      { id: 12, pageId: 2, blockType: 'support_form', data: { recipientEmail: 'flat-empty-tree@example.vn' } },
    ],
  })
  assert.equal(await deliveredTo('flat@example.vn'), 'flat@example.vn')
  assert.equal(await deliveredTo('flat-empty-tree@example.vn'), 'flat-empty-tree@example.vn')
  assert.equal(await deliveredTo('flat-hidden@example.vn'), SITE, 'two visible recipients configured, none asked for → site e-mail')
})

test('the recipient lookup never reads the draft trees', async () => {
  reset({ pages: [{ id: 1, slug: 'contact', published: [form('a@example.vn')], draft: [form('b@example.vn')] }] })
  await deliveredTo('a@example.vn')
  const pageReads = selects.filter(entry => entry.table === 'pages')
  assert.ok(pageReads.length > 0)
  for (const read of pageReads) assert.ok(!read.columns.includes('draft_blocks'), `the pages query projects ${read.columns.join(', ')}`)
})

// ─── The public page does not publish the address ─────────────────────────────

test('public page JSON carries no recipientEmail — tree (nested, translations) and flat path alike', async () => {
  reset({
    pages: [
      { id: 1, slug: 'contact', published: [{ blockType: 'section', isVisible: true, data: {}, children: [
        form('phong-tiep-dan@example.vn', { data: { title: 'Liên hệ', recipientEmail: 'phong-tiep-dan@example.vn', translations: { en: { title: 'Contact', recipientEmail: 'en-desk@example.vn' } } } }),
      ] }] },
      { id: 2, slug: 'about' },
    ],
    flat: [{ id: 10, pageId: 2, blockType: 'support_form', data: { title: 'Hỗ trợ', recipientEmail: 'flat@example.vn' } }],
  })
  for (const [url, slug] of [['/api/public/pages/contact', 'contact'], ['/api/public/pages/contact?lang=en', 'contact'], ['/api/public/pages/about', 'about']] as const) {
    const response = await publicPage(makeEvent(url, undefined, { slug }))
    assert.equal(response.ok, true)
    assert.ok(response.blocks.length > 0, `${url}: the page rendered no blocks`)
    const text = JSON.stringify(response)
    assert.doesNotMatch(text, /recipientEmail/, `${url} exposes recipientEmail`)
    assert.doesNotMatch(text, /@example\.vn/, `${url} exposes a recipient address`)
  }
})
