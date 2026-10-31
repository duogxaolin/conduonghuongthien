import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * `/admin/settings/sitemap` prints "Lần lưu cuối: …" from `updatedAt`. The save
 * (`PUT /api/admin/settings/sitemap`) writes two rows, `sitemap_xml` and
 * `sitemap_updated_at`, and answers the time; the read (`GET`) answers it back.
 *
 * FINDING (wave3 7.1 batch C), RED on 9b4821a: the read selected
 * `WHERE key = 'sitemap_xml'` and then looked for `sitemap_updated_at` among those rows —
 * it was never there, so `updatedAt` was always `null`. The time showed right after a save
 * (from the PUT's answer) and vanished on every reload, so an officer could not tell
 * whether, or when, the served sitemap had last been edited.
 *
 * The REAL handlers, with Drizzle's MySQL SQL executed on SQLite (tests/_sqlite-mysql-db.ts):
 * the WHERE clause the handler builds is what decides which rows come back — a fake that
 * ignored it would hide exactly this bug.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { settings, activityLogs } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([settings, activityLogs])

mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db } })
mock.module('../server/utils/permissions', { namedExports: { requireResourcePermission: () => {} } })
mock.module('../server/utils/google-oauth/config', { namedExports: { requestBase: () => 'https://cdkt.example.vn/' } })
const GENERATED = '<?xml version="1.0"?><urlset><url><loc>https://cdkt.example.vn/</loc></url></urlset>'
mock.module('../server/utils/sitemap-builder', { namedExports: { generateSitemap: async () => GENERATED } })

type Event = { body?: unknown, context: Record<string, unknown> }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

type SitemapRead = { ok: boolean, xml: string | null, updatedAt: string | null, generated: string }
const read = (await import('../server/api/admin/settings/sitemap/index.get')).default as unknown as (event: Event) => Promise<SitemapRead>
const save = (await import('../server/api/admin/settings/sitemap/index.put')).default as unknown as (event: Event) => Promise<{ ok: boolean, updatedAt: string }>
const as = (body?: unknown): Event => ({ body, context: { adminUser: { id: 1, isSuperAdmin: true } } })

const XML = '<?xml version="1.0"?><urlset></urlset>'

beforeEach(() => harness.reset())

test('FINDING: after a save, the read answers the time the save recorded — not null', async () => {
  const saved = await save(as({ xml: XML }))
  assert.equal(saved.ok, true)
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/)
  const answer = await read(as())
  assert.equal(answer.xml, XML)
  assert.equal(answer.updatedAt, saved.updatedAt, '"Lần lưu cuối" disappears on reload when the read drops the time row')
})

test('nothing saved yet: xml and updatedAt are null, the generated copy is offered', async () => {
  assert.deepEqual(await read(as()), { ok: true, xml: null, updatedAt: null, generated: GENERATED })
})

test('a blank stored sitemap reads as "nothing saved"; other settings rows never leak in', async () => {
  await harness.db.insert(settings).values([
    { key: 'sitemap_xml', value: '   ' },
    { key: 'smtp_pass', value: 'not-for-this-page' },
  ])
  const answer = await read(as())
  assert.equal(answer.xml, null)
  assert.equal(answer.updatedAt, null)
  assert.doesNotMatch(JSON.stringify(answer), /not-for-this-page/)
})
