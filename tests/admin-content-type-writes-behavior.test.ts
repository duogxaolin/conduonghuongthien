import assert from 'node:assert/strict'
import test, { beforeEach, mock } from 'node:test'

/**
 * `POST /api/admin/content-types` and `PUT /api/admin/content-types/:id`, run for real on
 * SQLite (`_sqlite-mysql-db.ts`: Drizzle's own MySQL SQL, executed on SQLite). Written to
 * pin what the handlers do BEFORE their queries moved into a service, so the move can be
 * shown to change nothing — the statements, their order, and what runs after them:
 *
 *   - a slug rename updates the type, then cascades the old slug to `categories.type` and
 *     `articles.type`, THEN bumps the chatbot answer-cache version, then the i18n update,
 *     then purges the public page cache;
 *   - a system type's slug is never edited (400, nothing written, nothing purged);
 *   - a body that changes nothing writes nothing and purges nothing;
 *   - a create picks a collision-free slug, inserts, then translates, then purges.
 *
 * The cascade is three UPDATEs with NO transaction (unchanged by the refactor, on purpose):
 * the last test pins that a failing `articles` UPDATE leaves the type and its categories
 * already renamed. That is today's behaviour, recorded so that a change to it is a decision,
 * not a side effect of moving code.
 */

const { createSqliteMysqlDb } = await import('./_sqlite-mysql-db')
const { contentTypes, categories, articles } = await import('../server/db/schema')
const harness = createSqliteMysqlDb([contentTypes, categories, articles])

const trail: string[] = harness.statements
mock.module('../server/utils/db', { namedExports: { getDb: () => harness.db, getPool: () => null } })
mock.module('../server/services/chatbot-answer-cache', { namedExports: { bumpAnswerCacheVersion: async () => { trail.push('@bump'); return 1 } } })
mock.module('../server/utils/public-page-cache', { namedExports: { purgePublicPageCacheAfterWrite: async (reason: string) => { trail.push(`@purge ${reason}`) } } })
mock.module('../server/services/i18n-auto-translate', {
  namedExports: {
    autoTranslateContentType: async (_actor: unknown, ...rest: unknown[]) => { trail.push(`@translate-create ${JSON.stringify(rest)}`) },
    autoTranslateContentTypeUpdate: async (_actor: unknown, ...rest: unknown[]) => { trail.push(`@translate-update ${JSON.stringify(rest)}`) },
  },
})

type Event = { body: unknown, params: Record<string, string>, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getRouterParam = (event: Event, key: string) => event.params[key]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

type Result = { ok: true, id?: number, slug: string }
const createType = (await import('../server/api/admin/content-types/index.post')).default as unknown as (event: Event) => Promise<Result>
const updateType = (await import('../server/api/admin/content-types/[id].put')).default as unknown as (event: Event) => Promise<Result>

const editor = { id: 7, isSuperAdmin: false, permissions: [{ resource: 'categories', canCreate: true, canRead: true, canUpdate: true, canDelete: false }] }
const put = (id: number, body: unknown) => updateType({ body, params: { id: String(id) }, context: { adminUser: editor } })
const post = (body: unknown) => createType({ body, params: {}, context: { adminUser: editor } })
/** Lets the fire-and-forget i18n call land before the trail is read. */
const settle = () => new Promise(resolve => setImmediate(resolve))
async function refusal(work: () => Promise<unknown>): Promise<{ statusCode?: number, statusMessage?: string }> {
  try { await work() } catch (err) { return err as { statusCode?: number, statusMessage?: string } }
  assert.fail('expected a refusal')
}

const SELECT_TYPE = 'select `id`, `name`, `slug`, `icon`, `description`, `display_order`, `is_system`, `created_at` from `content_types` where `content_types`.`id` = ? limit ?'
const types = () => harness.rows(contentTypes).map(row => `${row.id}:${row.slug}:${row.name}`)
const categoryTypes = () => harness.rows(categories).map(row => `${row.id}:${row.type}`)
const articleTypes = () => harness.rows(articles).map(row => `${row.id}:${row.type}`)

beforeEach(async () => {
  harness.reset()
  await harness.db.insert(contentTypes).values([
    { id: 1, name: 'Tin tức', slug: 'news', isSystem: true, displayOrder: 0 },
    { id: 2, name: 'Mô hình', slug: 'mo-hinh', isSystem: false, displayOrder: 1, description: 'mô tả' },
  ])
  await harness.db.insert(categories).values([
    { id: 8, name: 'Tin nổi bật', slug: 'tin-noi-bat', type: 'news' },
    { id: 9, name: 'Mô hình A', slug: 'mo-hinh-a', type: 'mo-hinh' },
  ])
  await harness.db.insert(articles).values([
    { id: 31, type: 'mo-hinh', title: 'A', slug: 'a', status: 'published' },
    { id: 32, type: 'news', title: 'B', slug: 'b', status: 'draft' },
  ])
  trail.length = 0
})

test('a slug rename updates the type, cascades to categories and articles, then bumps, translates and purges — in that order', async () => {
  const result = await put(2, { slug: 'Mô hình mới', description: ' Mới ' })
  await settle()
  assert.deepEqual(result, { ok: true, slug: 'mo-hinh-moi' })
  assert.deepEqual(trail, [
    SELECT_TYPE,
    'select `id`, `slug` from `content_types` where (`content_types`.`slug` like ? and `content_types`.`id` <> ?)',
    'update `content_types` set `slug` = ?, `description` = ? where `content_types`.`id` = ?',
    'update `categories` set `type` = ? where `categories`.`type` = ?',
    'update `articles` set `type` = ? where `articles`.`type` = ?',
    '@bump',
    '@translate-update ["mo-hinh-moi","Mô hình","Mới"]',
    '@purge content_types.update',
  ])
  assert.deepEqual(types(), ['1:news:Tin tức', '2:mo-hinh-moi:Mô hình'])
  assert.deepEqual(categoryTypes(), ['8:news', '9:mo-hinh-moi'])
  assert.deepEqual(articleTypes(), ['31:mo-hinh-moi', '32:news'])
  assert.equal(harness.transactionsBegun, 0, 'the cascade runs without a transaction today')
})

test('a name-only edit updates the type alone: no cascade, no bump; translate then purge', async () => {
  const result = await put(2, { name: ' Mô hình (sửa) ', displayOrder: 7 })
  await settle()
  assert.deepEqual(result, { ok: true, slug: 'mo-hinh' })
  assert.deepEqual(trail, [
    SELECT_TYPE,
    'update `content_types` set `name` = ?, `display_order` = ? where `content_types`.`id` = ?',
    '@translate-update ["mo-hinh","Mô hình (sửa)","mô tả"]',
    '@purge content_types.update',
  ])
})

test('the slug a type already has is not a rename: nothing is written or purged', async () => {
  assert.deepEqual(await put(2, { slug: 'mo-hinh' }), { ok: true, slug: 'mo-hinh' })
  await settle()
  assert.deepEqual(trail, [SELECT_TYPE, 'select `id`, `slug` from `content_types` where (`content_types`.`slug` like ? and `content_types`.`id` <> ?)'])
})

test("a system type's slug is refused with 400, before any write or purge", async () => {
  const err = await refusal(() => put(1, { slug: 'tin' }))
  assert.equal(err.statusCode, 400)
  assert.equal(err.statusMessage, 'Không thể đổi định danh (slug) của thể loại hệ thống.')
  await settle()
  assert.deepEqual(trail, [SELECT_TYPE])
  assert.deepEqual(types(), ['1:news:Tin tức', '2:mo-hinh:Mô hình'])
})

test('an empty body writes nothing and purges nothing', async () => {
  assert.deepEqual(await put(2, {}), { ok: true, slug: 'mo-hinh' })
  await settle()
  assert.deepEqual(trail, [SELECT_TYPE])
})

test('an unknown id is a 404 after the lookup; a non-numeric id is a 400 before it', async () => {
  assert.equal((await refusal(() => put(99, { name: 'x' }))).statusCode, 404)
  assert.deepEqual(trail, [SELECT_TYPE])
  trail.length = 0
  assert.equal((await refusal(() => put(Number.NaN, { name: 'x' }))).statusCode, 400)
  assert.deepEqual(trail, [])
})

test('a create picks a free slug, inserts, then translates, then purges', async () => {
  const result = await post({ name: 'X', slug: 'Mô hình', icon: ' fa-x ', description: 'null', displayOrder: 4 })
  await settle()
  assert.deepEqual(result, { ok: true, id: 3, slug: 'mo-hinh-2' })
  assert.deepEqual(trail, [
    'select `id`, `slug` from `content_types` where `content_types`.`slug` like ?',
    'insert into `content_types` (`id`, `name`, `slug`, `icon`, `description`, `display_order`, `is_system`, `created_at`) values (default, ?, ?, ?, ?, ?, ?, default)',
    '@translate-create ["mo-hinh-2","X",null]',
    '@purge content_types.create',
  ])
  const { createdAt: _createdAt, ...created } = harness.rows(contentTypes).find(row => row.id === 3)!
  assert.deepEqual(created, { id: 3, name: 'X', slug: 'mo-hinh-2', icon: 'fa-x', description: null, displayOrder: 4, isSystem: false })
})

test('a create without a name is a 400 before any query', async () => {
  assert.equal((await refusal(() => post({ name: '  ' }))).statusCode, 400)
  assert.deepEqual(trail, [])
})

test('characterization (finding, not a goal): a failing articles UPDATE leaves the type and its categories renamed', async () => {
  harness.failNext(/^update `articles`/)
  await assert.rejects(put(2, { slug: 'Mô hình mới' }))
  await settle()
  assert.deepEqual(types(), ['1:news:Tin tức', '2:mo-hinh-moi:Mô hình'])
  assert.deepEqual(categoryTypes(), ['8:news', '9:mo-hinh-moi'])
  assert.deepEqual(articleTypes(), ['31:mo-hinh', '32:news'], 'the articles still carry the old slug')
  assert.ok(!trail.includes('@bump') && !trail.some(line => line.startsWith('@purge')), 'nothing runs after the failed write')
})
